const express = require('express');
const router = express.Router();
const clickCollectController = require('../controllers/clickCollectController');

// 🔍 Stock par article
router.get('/stock/:articleCode', clickCollectController.getStockByArticle);

// 🛒 Valider commande click & collect
router.post('/', clickCollectController.confirmClickCollect);

module.exports = router;
