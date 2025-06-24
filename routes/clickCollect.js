//clickCollect.js
const express = require('express');
const router = express.Router();
const clickCollectController = require('../controllers/clickCollectController');

// 🔍 Voir stock par article
router.get('/stock/:articleCode', clickCollectController.getStockByArticle);
// GET /depots - Liste des dépôts disponibles pour le retrait
router.get('/depots', clickCollectController.getDepots);


// 🛒 Réserver un article
router.post('/', clickCollectController.confirmClickCollect);

// ✅ Confirmer retrait par un employé
router.post('/confirmer-retrait', clickCollectController.confirmerRetraitClient);



/*const retourCtrl = require('../controllers/retourClient');

router.post('/click-collect/retour-client', retourCtrl.retourClient);*/

module.exports = router;