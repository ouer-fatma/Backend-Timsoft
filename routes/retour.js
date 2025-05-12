const express = require('express');
const router = express.Router();
const retourController = require('../controllers/retourController');

// 📦 Route pour effectuer un retour
router.post('/retour', retourController.processRetour);

// 🔍 (Optionnel) Voir les retours
router.get('/retours', retourController.getAllRetours);

router.get('/retour/pdf/:numeroRetour', retourController.generateReturnReceipt);
module.exports = router;