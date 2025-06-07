const express = require('express');
const router = express.Router();
const {
  registerUser,
  loginUser,
  googleSignIn,
  adminDashboard,
  magasinDashboard,
  clientDashboard
} = require('../controllers/authController');

const validateRegister = require('../middlewares/validateRegister');
const checkRole = require('../middlewares/checkRole');

// 📌 Auth routes
router.post('/register', validateRegister, registerUser);
router.post('/login', loginUser);
router.post('/google', googleSignIn);

// 📌 Routes protégées par rôle
router.get('/admin', checkRole('admin'), adminDashboard);
router.get('/magasin', checkRole('personnel_magasin'), magasinDashboard);
router.get('/client', checkRole('client'), clientDashboard);

module.exports = router;
