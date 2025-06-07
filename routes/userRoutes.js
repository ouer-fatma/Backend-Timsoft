const express = require('express');
const router = express.Router();
const userController = require('../controllers/userController');
const checkRole = require('../middlewares/checkRole');

// ✅ Toutes les routes sont protégées (admin requis)
router.use(checkRole('admin'));


// --- 🔹 ADMINISTRATEURS ---
router.get('/admins', userController.getAllAdmins);
router.post('/admins', userController.addAdmin);
router.put('/admins/:id', userController.updateAdmin);
router.delete('/admins/:id', userController.deleteAdmin);
router.get('/admins/search', userController.searchAdmins);


// --- 🔹 CLIENTS ---
router.get('/clients', userController.getAllClients);
router.post('/clients', userController.addClient);
router.put('/clients/:id', userController.updateClient);
router.delete('/clients/:id', userController.deleteClient);
router.get('/clients/search', userController.searchClients);


// --- 🔹 MAGASINIERS ---
router.get('/magasiniers', userController.getAllMagasiniers);
router.post('/magasiniers', userController.addMagasinier);
router.put('/magasiniers/:id', userController.updateMagasinier);
router.delete('/magasiniers/:id', userController.deleteMagasinier);
router.get('/magasiniers/search', userController.searchMagasiniers);


module.exports = router;
