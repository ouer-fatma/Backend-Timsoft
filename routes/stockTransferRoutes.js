//stockTransferRoutes.js
const express = require('express');
const router = express.Router();
const stockTransferController = require('../controllers/stockTransferController');
const {getDepotsWithStock} = require('../controllers/stockTransferController');

router.get('/depots-disponibles/:article', getDepotsWithStock);
router.get('/stock-transfer/recents', stockTransferController.getTransfertsRecents);

router.post('/transfer', stockTransferController.transferStock);


module.exports = router;
