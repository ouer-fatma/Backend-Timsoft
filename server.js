//server.js
require("dotenv").config();
const express = require("express");
const cors = require("cors");
const path = require("path");

const authRoutes = require('./routes/authRoutes');
const articleRoutes = require('./routes/articleRoutes');
const userRoutes = require('./routes/userRoutes');
const orderRoutes = require('./routes/orderRoutes');
const panierRoutes = require('./routes/panierRoutes');

const { poolPromise } = require('./db');

const clickCollectRoutes = require('./routes/clickCollect');
const stockRoutes = require('./routes/stockRoutes');
const invoiceRoutes = require('./routes/invoice');
const stockTransferRoutes = require('./routes/stockTransferRoutes');
const retourRoutes = require('./routes/retour'); // 👉 nouveau fichier de routes



const app = express();
const port = process.env.PORT || 3000;

// ✅ Activer CORS
app.use(cors());

// ✅ Permet le parsing du JSON
app.use(express.json());

// ✅ Vérifie la connexion à la base de données
poolPromise
  .then(() => {
    console.log("✅ Connexion à la base de données établie !");
  })
  .catch((err) => {
    console.error("❌ Échec de la connexion à la base de données :", err);
    process.exit(1);
  });

// ✅ Définir les routes
app.use('/auth', authRoutes);
app.use('/articles', articleRoutes);

app.use('/users', userRoutes);
app.use('/orders', orderRoutes);
app.use('/panier', panierRoutes);
app.use('/api', stockRoutes);
app.use('/api/invoice', invoiceRoutes);
app.use('/api/stock-transfer', stockTransferRoutes);
app.use('/click-collect', clickCollectRoutes);
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use('/api', retourRoutes); // 👉 Route ajoutée pour les retours

// ✅ Route de test
app.get('/test', (req, res) => {
  res.status(200).json({ message: 'Route test fonctionne parfaitement !' });
});

// ✅ Démarrer le serveur
app.listen(port, () => {
  console.log(`🚀 Serveur démarré sur http://localhost:${port}`);
});
