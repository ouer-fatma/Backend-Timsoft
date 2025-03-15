const express = require('express');
const router = express.Router();
const articleController = require('../controllers/articleController');

// GET all articles
router.get('/', articleController.getAllArticles);


// GET article by code
router.get('/:codeArticle', articleController.getArticleByCode);

// Create new article
router.post('/', articleController.createArticle);

// Update an article
router.put('/:codeArticle', articleController.updateArticle);

// Delete an article
router.delete('/:codeArticle', articleController.deleteArticle);

module.exports = router;
