const express = require('express');
const router = express.Router();
const orderController = require('../controllers/orderController');
const checkRole = require('../middlewares/checkRole');

// Protection admin/personnel_magasin
router.use(checkRole('user')); // ou checkRole('personnel_magasin') selon vos besoins

router.get('/', orderController.getAllOrders);
router.get('/:nature/:souche/:numero/:indice', orderController.getOrderById);
router.post('/', orderController.createOrder);
router.put('/:nature/:souche/:numero/:indice', orderController.updateOrder);
router.delete('/:nature/:souche/:numero/:indice', orderController.deleteOrder);


module.exports = router;
