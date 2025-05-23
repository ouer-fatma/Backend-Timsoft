//orderRoutes.js
const express = require('express');
const router = express.Router();
const orderController = require('../controllers/orderController');
const checkRole = require('../middlewares/checkRole');

// Protection
router.use(checkRole('admin'));

// Routes
router.get('/', orderController.getAllOrders); 
router.get('/details/:nature/:souche/:numero/:indice', orderController.getOrderDetails);
router.get('/:nature/:souche/:numero/:indice', orderController.getOrderById);
router.post('/', orderController.createOrder);
router.put('/:nature/:souche/:numero/:indice', orderController.updateOrder);
router.delete('/:nature/:souche/:numero/:indice', orderController.deleteOrder);
router.get('/attente', orderController.getOrdersEnAttente);
router.patch('/:nature/:souche/:numero/:indice/statut', orderController.marquerCommandeCommePrete);

module.exports = router;
