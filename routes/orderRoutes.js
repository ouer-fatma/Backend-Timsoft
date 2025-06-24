const express = require('express');
const router = express.Router();
const orderController = require('../controllers/orderController');
const checkRole = require('../middlewares/checkRole');
const verifyToken = require('../middlewares/verifyToken');
const { updateOrderStatus , getReservationsPourDepot, getReservationsPourMagasinier , getReservationDetails } = require('../controllers/orderController');

// ✅ Appliquer le middleware d'authentification
router.use(verifyToken);

// ✅ Routes spécifiques en premier
router.post('/bl/generate/:nature/:souche/:numero/:indice', orderController.createBonDeLivraisonSansLien);
router.get('/bl', orderController.getBonsDeLivraison);
router.put('/bl/:nature/:souche/:numero/:indice/pret', orderController.marquerBLCommePrepare);
router.get('/test-bl', (req, res) => {
  res.send('Routes BL fonctionnent ✅');
});
router.get(
  '/bl/details/:nature/:souche/:numero/:indice',
  orderController.getBonDeLivraisonDetails
);

// ✅ Routes commandes ensuite
router.get('/', checkRole('admin'), orderController.getAllOrders);
router.get('/commandes/:souche/:numero/depots-disponibles', orderController.getDepotsDisponiblesPourCommande);
router.get('/details/CC/:souche/:numero/:indice', getReservationDetails);


router.get('/commandes/:souche/:numero/depots-disponibles/:article', orderController.getDepotsDisponiblesPourArticleCommande);

router.get('/magasinier/reservations',checkRole('personnel_magasin'), getReservationsPourMagasinier);
router.get('/attente', orderController.getOrdersEnAttente);
router.get('/client/:codeTiers', orderController.getOrdersByCodeTiers);
router.get('/next-numero', orderController.getNextOrderNumero);
router.get('/details/:nature/:souche/:numero/:indice', orderController.getOrderDetails);
router.get('/:nature/:souche/:numero/:indice', orderController.getOrderById);
router.get('/magasinier/reservations/:depot', getReservationsPourDepot);

router.post('/', orderController.createOrder);
router.put('/:nature/:souche/:numero/:indice', orderController.updateOrder);
router.put('/:nature/:souche/:numero/:indice/status', updateOrderStatus);

router.delete('/:nature/:souche/:numero/:indice', orderController.deleteOrder);
router.patch('/:nature/:souche/:numero/:indice/statut', orderController.marquerCommandeCommePrete);

module.exports = router;
