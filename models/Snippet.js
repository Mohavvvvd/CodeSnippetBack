const mongoose = require('mongoose');

const snippetSchema = new mongoose.Schema({
  title: {
    type: String,
    required: [true, 'Title is required'],
    trim: true,
    maxlength: [100, 'Title cannot exceed 100 characters']
  },
  content: {
    type: String,
    required: [true, 'Content is required'],
    maxlength: [10000, 'Content cannot exceed 10000 characters']
  },
  language: {
    type: String,
    default: 'text',
    enum: ['javascript', 'python', 'java', 'cpp', 'html', 'css', 'text', 'markdown', 'json', 'sql', 'bash', 'go', 'rust']
  },
  tags: [{
    type: String,
    trim: true,
    lowercase: true
  }],
  by:[
    { type: String ,
      required: [true, 'Author is required']

    }
  ],
  description: {
    type: String,
    maxlength: [200, 'Description cannot exceed 200 characters']
  },
  isPublic: {
    type: Boolean,
    default: false
  },
  // REMOVED: favorite field since it's now user-specific
  // Add user reference
  userId: {
    type: String,
    required: [true, 'User ID is required'],
    index: true
  },
  userEmail: {
    type: String,
    required: [true, 'User email is required']
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Favorite Schema (add this new schema)
const favoriteSchema = new mongoose.Schema({
  userId: {
    type: String,
    required: [true, 'User ID is required'],
    index: true
  },
  snippetId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Snippet',
    required: [true, 'Snippet ID is required']
  }
}, {
  timestamps: true
});

// Compound index to ensure a user can't favorite the same snippet multiple times
favoriteSchema.index({ userId: 1, snippetId: 1 }, { unique: true });

// Virtual for favorite count (how many users have favorited this snippet)
snippetSchema.virtual('favoriteCount', {
  ref: 'Favorite',
  localField: '_id',
  foreignField: 'snippetId',
  count: true
});

// Virtual to check if current user has favorited this snippet
snippetSchema.virtual('isFavorited').get(function() {
  // This will be set dynamically when querying
  return this._isFavorited || false;
});

snippetSchema.virtual('isFavorited').set(function(value) {
  this._isFavorited = value;
});

// Index for better query performance
snippetSchema.index({ userId: 1, createdAt: -1 });
snippetSchema.index({ userId: 1, tags: 1 });
snippetSchema.index({ userId: 1, language: 1 });
snippetSchema.index({ isPublic: 1 });

// Index for favorites
favoriteSchema.index({ userId: 1, createdAt: -1 });
favoriteSchema.index({ snippetId: 1 });

// Virtual for snippet preview
snippetSchema.virtual('preview').get(function() {
  return this.content.substring(0, 150) + (this.content.length > 150 ? '...' : '');
});

// Static method to get all tags with counts for a specific user
snippetSchema.statics.getTagsWithCounts = async function(userId) {
  return this.aggregate([
    { $match: { userId: userId } },
    { $unwind: '$tags' },
    { $group: { _id: '$tags', count: { $sum: 1 } } },
    { $sort: { count: -1, _id: 1 } },
    { $project: { _id: 0, name: '$_id', count: 1 } }
  ]);
};

// Static method to get user's favorite snippets
snippetSchema.statics.getUserFavorites = async function(userId, page = 1, limit = 10) {
  const skip = (page - 1) * limit;
  
  const favorites = await Favorite.find({ userId })
    .populate('snippetId')
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit);
  
  // Extract snippets and set isFavorited to true
  const snippets = favorites.map(fav => {
    if (fav.snippetId) {
      const snippet = fav.snippetId.toObject();
      snippet.isFavorited = true;
      return snippet;
    }
    return null;
  }).filter(Boolean);
  
  const total = await Favorite.countDocuments({ userId });
  
  return {
    snippets,
    totalPages: Math.ceil(total / limit),
    currentPage: page,
    totalFavorites: total
  };
};

// Instance method to check if a user has favorited this snippet
snippetSchema.methods.isFavoritedByUser = async function(userId) {
  const favorite = await Favorite.findOne({ 
    userId: userId, 
    snippetId: this._id 
  });
  return !!favorite;
};

// Instance method to add to favorites
snippetSchema.methods.addToFavorites = async function(userId) {
  try {
    const favorite = await Favorite.create({
      userId: userId,
      snippetId: this._id
    });
    return favorite;
  } catch (error) {
    if (error.code === 11000) {
      throw new Error('Snippet is already in favorites');
    }
    throw error;
  }
};

// Instance method to remove from favorites
snippetSchema.methods.removeFromFavorites = async function(userId) {
  const result = await Favorite.deleteOne({
    userId: userId,
    snippetId: this._id
  });
  return result.deletedCount > 0;
};

// Static method to toggle favorite status
snippetSchema.statics.toggleFavorite = async function(snippetId, userId) {
  const snippet = await this.findById(snippetId);
  if (!snippet) {
    throw new Error('Snippet not found');
  }
  
  const existingFavorite = await Favorite.findOne({
    userId: userId,
    snippetId: snippetId
  });
  
  if (existingFavorite) {
    await Favorite.deleteOne({ _id: existingFavorite._id });
    return { favorited: false };
  } else {
    await Favorite.create({
      userId: userId,
      snippetId: snippetId
    });
    return { favorited: true };
  }
};

// Middleware to remove favorites when a snippet is deleted
snippetSchema.pre('deleteOne', { document: true, query: false }, async function(next) {
  await Favorite.deleteMany({ snippetId: this._id });
  next();
});

snippetSchema.pre('deleteMany', async function(next) {
  const conditions = this.getFilter();
  const snippetsToDelete = await this.model.find(conditions);
  const snippetIds = snippetsToDelete.map(snippet => snippet._id);
  
  if (snippetIds.length > 0) {
    await Favorite.deleteMany({ snippetId: { $in: snippetIds } });
  }
  next();
});

const Snippet = mongoose.model('Snippet', snippetSchema);
const Favorite = mongoose.model('Favorite', favoriteSchema);

module.exports = { Snippet, Favorite };