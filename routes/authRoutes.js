//authRoutes.js
const express = require('express');
const { googleSignIn } = require('../controllers/authController');
const router = express.Router();
const { 
  registerUser, 
  loginUser, 
  adminDashboard, 
  magasinDashboard, 
  clientDashboard 
} = require('../controllers/authController');
const validateRegister = require('../middlewares/validateRegister');
const checkRole = require('../middlewares/checkRole');

// Routes
router.post('/register', validateRegister, registerUser);
router.post('/login', loginUser);
router.post('/google', googleSignIn);
router.get('/admin', checkRole('admin'), adminDashboard);
router.get('/magasin', checkRole('personnel_magasin'), magasinDashboard);
router.get('/client', checkRole('client'), clientDashboard);

module.exports = router;
