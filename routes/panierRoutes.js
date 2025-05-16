const express = require('express');
const router = express.Router();
const panierController = require('../controllers/panierController');

router.post('/init', panierController.initPanier);
router.post('/ajouter', panierController.ajouterAuPanier);
router.get('/:codeTiers', panierController.getPanier);
router.delete('/retirer', panierController.retirerDuPanier);



module.exports = router;
