const express = require('express');
const router = express.Router();
const invoiceController = require('../controllers/invoiceController');

// Télécharger une facture
router.get('/download/:nature/:souche/:numero/:indice', invoiceController.generateAndDownloadInvoice);
// Route pour envoyer la facture par email

router.post('/send', invoiceController.sendInvoiceByEmail);

module.exports = router;
