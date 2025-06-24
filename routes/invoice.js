const express = require('express');
const router = express.Router();
const invoiceController = require('../controllers/invoiceController');
const { downloadExistingBonLivraison } = require('../controllers/invoiceController');

// 📥 Télécharger une facture
// Final URL: GET /api/invoice/download/:nature/:souche/:numero/:indice
router.get('/download/:nature/:souche/:numero/:indice', invoiceController.generateAndDownloadInvoice);

// 📥 Télécharger un bon de livraison
// Final URL: GET /api/invoice/bl/download/:nature/:souche/:numero/:indice
router.get('/bl/download/:nature/:souche/:numero/:indice', invoiceController.generateBonLivraison);
router.get('/bl/existing/:nature/:souche/:numero/:indice', downloadExistingBonLivraison);

router.put('/bl/expedier/:nature/:souche/:numero/:indice', invoiceController.marquerBLCommeExpedie);

// 📧 Envoyer une facture par email
// Final URL: POST /api/invoice/send
router.post('/send', invoiceController.sendInvoiceByEmail);
// Remplace la route GET
router.post('/bl/download/:nature/:souche/:numero/:indice', invoiceController.generateBonLivraison);


module.exports = router;
