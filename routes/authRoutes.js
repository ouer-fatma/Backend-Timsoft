const express = require('express');
const router = express.Router();

const {
  registerUser,
  verifyEmail,
  forgotPassword,
  resetPassword,
  loginUser,
  googleSignIn,
  adminDashboard,
  magasinDashboard,
  clientDashboard,
  getDepotsDisponibles,
  getBLPourMagasinier // ✅ garder UNE SEULE fois ici
} = require('../controllers/authController');
const validateRegister = require('../middlewares/validateRegister');
const checkRole = require('../middlewares/checkRole');

// Routes
router.post('/register', validateRegister, registerUser);
router.post('/forgot-password', forgotPassword);
router.post('/reset-password', resetPassword);
router.post('/login', loginUser);
router.post('/google', googleSignIn);


router.get('/verify-email', verifyEmail); 
router.get('/admin', checkRole('admin'), adminDashboard);
router.get('/magasin', checkRole('personnel_magasin'), magasinDashboard);
router.get('/client', checkRole('client'), clientDashboard);
router.get('/depots', checkRole('admin'), getDepotsDisponibles);

// ✅ Route pour récupérer les BLs à traiter
router.get('/magasin/bl-a-traiter', checkRole('personnel_magasin'), getBLPourMagasinier);

module.exports = router;