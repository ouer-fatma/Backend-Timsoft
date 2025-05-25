//orderRoutes.js
const express = require('express');
const router = express.Router();
const orderController = require('../controllers/orderController');
const checkRole = require('../middlewares/checkRole');
const verifyToken = require('../middlewares/verifyToken');

// ✅ Appliquer à toutes les routes (si tu veux sécuriser toutes)
router.use(verifyToken);

    
// Routes
router.get('/', checkRole('admin'), orderController.getAllOrders); // admin seulement
router.get('/details/:nature/:souche/:numero/:indice', orderController.getOrderDetails);
router.get('/:nature/:souche/:numero/:indice', orderController.getOrderById);
router.get('/client/:codeTiers', orderController.getOrdersByCodeTiers);
router.get('/next-numero', orderController.getNextOrderNumero);



router.post('/', orderController.createOrder);
router.put('/:nature/:souche/:numero/:indice', orderController.updateOrder);
router.delete('/:nature/:souche/:numero/:indice', orderController.deleteOrder);
router.get('/attente', orderController.getOrdersEnAttente);
router.patch('/:nature/:souche/:numero/:indice/statut', orderController.marquerCommandeCommePrete);

module.exports = router;
