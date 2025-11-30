const express = require('express');
const router = express.Router();
const {
  getSnippets,
  getSnippet,
  createSnippet,
  updateSnippet,
  deleteSnippet,
  getTags,
  toggleFavorite,
  getFavorites,
  checkFavorite
} = require('../controllers/snippets');
const { authenticateFirebase } = require('../middleware/auth');

// Protect all routes
router.use(authenticateFirebase);

router.get('/', getSnippets);
router.get('/tags', getTags);
router.get('/:id', getSnippet);
router.post('/', createSnippet);
router.put('/:id', updateSnippet);
router.delete('/:id', deleteSnippet);
router.get('/favorites', getFavorites);
router.get('/:id/favorite', checkFavorite);
router.patch('/:id/favorite', toggleFavorite);

module.exports = router;