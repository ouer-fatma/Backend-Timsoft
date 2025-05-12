//userRoutes.js
const express = require('express');
const router = express.Router();
const userController = require('../controllers/userController');
const checkRole = require('../middlewares/checkRole');

// Middleware to protect ALL routes below (admin-only access)
router.use(checkRole('admin'));

// CRUD operations (Admin only)
router.get('/', userController.getAllUsers);
router.get('/:id', userController.getUserById);
router.post('/', userController.addUser); // ← Add new user route
router.put('/:id', userController.updateUser);
router.delete('/:id', userController.deleteUser);

module.exports = router;
