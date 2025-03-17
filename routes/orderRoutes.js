const express = require('express');
const router = express.Router();
const orderController = require('../controllers/orderController');
const checkRole = require('../middlewares/checkRole');

// Protection admin/personnel_magasin
router.use(checkRole('user')); // ou checkRole('personnel_magasin') selon vos besoins

router.get('/', orderController.getAllOrders);
router.get('/:id', orderController.getOrderById);
router.post('/', orderController.createOrder);
router.put('/:id', orderController.updateOrder);
router.delete('/:id', orderController.deleteOrder);
/*router.get('/latest', orderController.getLatestOrder);*/


module.exports = router;
