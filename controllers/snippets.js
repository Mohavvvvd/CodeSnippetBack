const { Snippet, Favorite } = require('../models/Snippet');

// @desc    Get all snippets
// @route   GET /api/snippets
// @access  Public
const getSnippets = async (req, res) => {
  try {
    const { 
      search, 
      tags, 
      language, 
      favorite, 
      page = 1, 
      limit = 10, 
      sort = '-createdAt' 
    } = req.query;

    // Build query - only show user's snippets or public ones
    let query = {
      $or: [
        { userId: req.user.uid }, // User's own snippets
        { isPublic: true } // Public snippets from other users
      ]
    };
    
    // Search in title, content, and tags
    if (search && search.trim() !== '') {
      const searchRegex = new RegExp(search, 'i');
      query.$and = [
        { $or: query.$or },
        {
          $or: [
            { title: searchRegex },
            { content: searchRegex },
            { tags: searchRegex }
          ]
        }
      ];
      delete query.$or;
    }

    // Filter by tags
    if (tags && tags.trim() !== '') {
      const tagArray = tags.split(',').map(tag => tag.trim().toLowerCase()).filter(tag => tag !== '');
      if (tagArray.length > 0) {
        query.tags = { $in: tagArray };
      }
    }

    // Filter by language
    if (language && language !== 'all' && language.trim() !== '') {
      query.language = language;
    }

    // Parse pagination parameters
    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const skip = (pageNum - 1) * limitNum;

    // If filtering by favorites, get favorite snippet IDs first
    let favoriteSnippetIds = [];
    if (favorite === 'true') {
      const favorites = await Favorite.find({ userId: req.user.uid }).select('snippetId');
      favoriteSnippetIds = favorites.map(fav => fav.snippetId);
      
      // Only show snippets that are in favorites
      query._id = { $in: favoriteSnippetIds };
      // Ensure user can only see their own snippets or public ones in favorites
      query.$or = [
        { userId: req.user.uid },
        { isPublic: true }
      ];
    }

    // Execute query with pagination
    let snippets = await Snippet.find(query)
      .sort(sort)
      .limit(limitNum)
      .skip(skip);

    // Get user's favorite snippet IDs to set isFavorited virtual
    if (favorite !== 'true') {
      const favorites = await Favorite.find({ userId: req.user.uid }).select('snippetId');
      favoriteSnippetIds = favorites.map(fav => fav.snippetId);
    }

    // Set isFavorited virtual for each snippet
    snippets = snippets.map(snippet => {
      const snippetObj = snippet.toObject();
      snippetObj.isFavorited = favoriteSnippetIds.some(favId => 
        favId.toString() === snippet._id.toString()
      );
      return snippetObj;
    });

    // Get total count for pagination
    const total = await Snippet.countDocuments(query);

    res.json({
      success: true,
      count: snippets.length,
      total,
      pagination: {
        page: pageNum,
        pages: Math.ceil(total / limitNum),
        limit: limitNum
      },
      data: snippets
    });
  } catch (error) {
    console.error('Error in getSnippets:', error);
    res.status(500).json({
      success: false,
      message: 'Server Error',
      error: error.message
    });
  }
};

// @desc    Get single snippet
// @route   GET /api/snippets/:id
// @access  Public
const getSnippet = async (req, res) => {
  try {
    const snippet = await Snippet.findById(req.params.id);
    
    if (!snippet) {
      return res.status(404).json({
        success: false,
        message: 'Snippet not found'
      });
    }

    // Check if user can access this snippet (either owner or public)
    if (snippet.userId !== req.user.uid && !snippet.isPublic) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to access this snippet'
      });
    }

    // Check if user has favorited this snippet
    const isFavorited = await Favorite.exists({
      userId: req.user.uid,
      snippetId: snippet._id
    });

    const snippetData = snippet.toObject();
    snippetData.isFavorited = !!isFavorited;

    res.json({
      success: true,
      data: snippetData
    });
  } catch (error) {
    console.error('Error in getSnippet:', error);
    res.status(500).json({
      success: false,
      message: 'Server Error',
      error: error.message
    });
  }
};

// @desc    Create new snippet
// @route   POST /api/snippets
// @access  Public
const createSnippet = async (req, res) => {
  try {
    console.log('Request body:', req.body); // Debugging line
    const { title, content, language, tags, description, isPublic , by } = req.body;

    // Basic validation
    if (!title || !title.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Title is required'
      });
    }

    if (!content || !content.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Content is required'
      });
    }

    // Process tags - convert to lowercase and remove duplicates
    let processedTags = [];
    if (tags && Array.isArray(tags)) {
      processedTags = [...new Set(tags.map(tag => tag.toLowerCase().trim()).filter(tag => tag !== ''))];
    }
    const byValue = by && by.trim() !== '' ? by.trim() : 'Unknown';

    const snippetData = {
      title: title.trim(),
      content: content.trim(),
      language: language || 'text',
      tags: processedTags,
      by : byValue ,
      description: description ? description.trim() : '',
      isPublic: isPublic || false,
      userId: req.user.uid,
      userEmail: req.user.email
    };

    const snippet = await Snippet.create(snippetData);

    res.status(201).json({
      success: true,
      message: 'Snippet created successfully',
      data: snippet
    });
  } catch (error) {
    console.error('Error in createSnippet:', error);
    
    if (error.name === 'ValidationError') {
      const messages = Object.values(error.errors).map(val => val.message);
      return res.status(400).json({
        success: false,
        message: 'Validation Error',
        errors: messages
      });
    }
    
    res.status(500).json({
      success: false,
      message: 'Server Error',
      error: error.message
    });
  }
};

// @desc    Update snippet
// @route   PUT /api/snippets/:id
// @access  Public
const updateSnippet = async (req, res) => {
  try {
    const { title, content, language, tags, description, isPublic } = req.body;

    // First, verify the snippet belongs to the user
    const existingSnippet = await Snippet.findById(req.params.id);
    if (!existingSnippet) {
      return res.status(404).json({
        success: false,
        message: 'Snippet not found'
      });
    }

    if (existingSnippet.userId !== req.user.uid) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to update this snippet'
      });
    }

    // Process tags
    let processedTags = [];
    if (tags && Array.isArray(tags)) {
      processedTags = [...new Set(tags.map(tag => tag.toLowerCase().trim()).filter(tag => tag !== ''))];
    }

    const updateData = {
      ...(title && { title: title.trim() }),
      ...(content && { content: content.trim() }),
      ...(language && { language }),
      ...(tags && { tags: processedTags }),
      ...(description !== undefined && { description: description.trim() }),
      ...(isPublic !== undefined && { isPublic })
      // REMOVED: favorite field since it's now user-specific
    };

    const snippet = await Snippet.findByIdAndUpdate(
      req.params.id,
      updateData,
      { 
        new: true,
        runValidators: true
      }
    );

    res.json({
      success: true,
      message: 'Snippet updated successfully',
      data: snippet
    });
  } catch (error) {
    console.error('Error in updateSnippet:', error);
    
    if (error.name === 'ValidationError') {
      const messages = Object.values(error.errors).map(val => val.message);
      return res.status(400).json({
        success: false,
        message: 'Validation Error',
        errors: messages
      });
    }
    
    res.status(500).json({
      success: false,
      message: 'Server Error',
      error: error.message
    });
  }
};

// @desc    Delete snippet
// @route   DELETE /api/snippets/:id
// @access  Public
const deleteSnippet = async (req, res) => {
  try {
    const snippet = await Snippet.findById(req.params.id);

    if (!snippet) {
      return res.status(404).json({
        success: false,
        message: 'Snippet not found'
      });
    }

    if (snippet.userId !== req.user.uid) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to delete this snippet'
      });
    }

    await Snippet.findByIdAndDelete(req.params.id);
    // Favorites will be automatically deleted due to the middleware in the model

    res.json({
      success: true,
      message: 'Snippet deleted successfully'
    });
  } catch (error) {
    console.error('Error in deleteSnippet:', error);
    res.status(500).json({
      success: false,
      message: 'Server Error',
      error: error.message
    });
  }
};

// @desc    Get all tags
// @route   GET /api/tags
// @access  Public
const getTags = async (req, res) => {
  try {
    const tags = await Snippet.getTagsWithCounts(req.user.uid);

    res.json({
      success: true,
      data: tags
    });
  } catch (error) {
    console.error('Error in getTags:', error);
    res.status(500).json({
      success: false,
      message: 'Server Error',
      error: error.message
    });
  }
};

// @desc    Toggle favorite status
// @route   PATCH /api/snippets/:id/favorite
// @access  Public
const toggleFavorite = async (req, res) => {
  try {
    const snippet = await Snippet.findById(req.params.id);
    
    if (!snippet) {
      return res.status(404).json({
        success: false,
        message: 'Snippet not found'
      });
    }

    // Check if user can access this snippet (either owner or public)
    if (snippet.userId !== req.user.uid && !snippet.isPublic) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to favorite this snippet'
      });
    }

    const result = await Snippet.toggleFavorite(req.params.id, req.user.uid);

    res.json({
      success: true,
      message: `Snippet ${result.favorited ? 'added to' : 'removed from'} favorites`,
      data: { favorited: result.favorited }
    });
  } catch (error) {
    console.error('Error in toggleFavorite:', error);
    res.status(500).json({
      success: false,
      message: 'Server Error',
      error: error.message
    });
  }
};

// @desc    Get user's favorite snippets
// @route   GET /api/snippets/favorites
// @access  Public
const getFavorites = async (req, res) => {
  try {
    const { page = 1, limit = 10 } = req.query;
    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);

    const result = await Snippet.getUserFavorites(req.user.uid, pageNum, limitNum);

    res.json({
      success: true,
      count: result.snippets.length,
      total: result.totalFavorites,
      pagination: {
        page: pageNum,
        pages: result.totalPages,
        limit: limitNum
      },
      data: result.snippets
    });
  } catch (error) {
    console.error('Error in getFavorites:', error);
    res.status(500).json({
      success: false,
      message: 'Server Error',
      error: error.message
    });
  }
};

// @desc    Check if snippet is favorited by user
// @route   GET /api/snippets/:id/favorite
// @access  Public
const checkFavorite = async (req, res) => {
  try {
    const isFavorited = await Favorite.exists({
      userId: req.user.uid,
      snippetId: req.params.id
    });

    res.json({
      success: true,
      data: { isFavorited: !!isFavorited }
    });
  } catch (error) {
    console.error('Error in checkFavorite:', error);
    res.status(500).json({
      success: false,
      message: 'Server Error',
      error: error.message
    });
  }
};

module.exports = {
  getSnippets,
  getSnippet,
  createSnippet,
  updateSnippet,
  deleteSnippet,
  getTags,
  toggleFavorite,
  getFavorites,
  checkFavorite
};