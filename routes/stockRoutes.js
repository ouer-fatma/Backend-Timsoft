//stockRoutes.js
const express = require('express');
const router = express.Router();
const stockController = require('../controllers/stockController');

// Exemple : /api/stocks/ART001
router.get('/stocks/:codeArticle', stockController.getStockByArticle);

module.exports = router;
