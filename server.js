require("dotenv").config();
const express = require("express");
const cors = require("cors"); // ✅ ADD THIS LINE
const authRoutes = require('./routes/authRoutes');
const articleRoutes = require('./routes/articleRoutes');
const userRoutes = require('./routes/userRoutes');
const orderRoutes = require('./routes/orderRoutes');
const { poolPromise } = require('./db');

const clickCollectRoutes = require('./routes/clickCollect');
const stockRoutes = require('./routes/stockRoutes');
const invoiceRoutes = require('./routes/invoice');
const stockTransferRoutes = require('./routes/stockTransferRoutes');

const app = express();
const port = process.env.PORT || 3000;
const path = require('path');

// ✅ ENABLE CORS
app.use(cors());

// Enable JSON parsing
app.use(express.json());

// Check DB connection
poolPromise
  .then(() => {
    console.log("✅ Connexion à la base de données établie !");
  })
  .catch((err) => {
    console.error("❌ Échec de la connexion à la base de données :", err);
    process.exit(1);
  });

// Routes
app.use('/auth', authRoutes);
app.use('/articles', articleRoutes);
app.use('/users', userRoutes);
app.use('/orders', orderRoutes);
app.use('/api', stockRoutes);
app.use('/api/invoice', invoiceRoutes);
app.use('/api/stock-transfer', stockTransferRoutes);
app.use('/click-collect', clickCollectRoutes);
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Test route
app.get('/test', (req, res) => {
  res.status(200).json({ message: 'Route test fonctionne parfaitement !' });
});

// Start server
app.listen(port, () => {
  console.log(`🚀 Serveur démarré sur http://localhost:${port}`);
});
