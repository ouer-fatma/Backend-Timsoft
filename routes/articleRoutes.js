const express = require('express');
const router = express.Router();
const articleController = require('../controllers/articleController');

// Routes
router.get('/', articleController.getAllArticles);
router.get('/:gaArticle', articleController.getArticleByGA); // identifiant GA_ARTICLE (VARCHAR)
router.post('/', articleController.createArticle);
router.put('/:id', articleController.updateArticle);
router.delete('/:id', articleController.deleteArticle);

module.exports = router;

