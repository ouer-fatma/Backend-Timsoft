const express = require('express');
const router = express.Router();
const stockTransferController = require('../controllers/stockTransferController');

router.post('/transfer', stockTransferController.transferStock);

module.exports = router;
