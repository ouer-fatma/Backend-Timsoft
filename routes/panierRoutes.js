//panierRoutes.js
const express = require('express');
const router = express.Router();
const panierController = require('../controllers/panierController');
const verifyToken = require('../middlewares/verifyToken'); // ✅ import

router.use(verifyToken); // ✅ toutes les routes sécurisées

router.post('/init', panierController.initPanier);
router.post('/ajouter', panierController.ajouterAuPanier);
router.post('/valider', panierController.validerCommande);
router.get('/:codeTiers', panierController.getPanier);
router.delete('/retirer', panierController.retirerDuPanier);



module.exports = router;
