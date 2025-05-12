require("dotenv").config();
const express = require("express");
const authRoutes = require('./routes/authRoutes');
const articleRoutes = require('./routes/articleRoutes');
const userRoutes = require('./routes/userRoutes');
const orderRoutes = require('./routes/orderRoutes');
const { poolPromise } = require('./db');


const clickCollectRoutes = require('./routes/clickCollect');
const stockRoutes = require('./routes/stockRoutes');
const app = express();
const port = process.env.PORT || 3000;

const invoiceRoutes = require('./routes/invoice');

const stockTransferRoutes = require('./routes/stockTransferRoutes');
app.use(express.json());

// Check database connection on startup
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
app.use('/users', userRoutes); // ← Correct and present!
app.use('/orders', orderRoutes);
// Add this explicit temporary route for testing
app.get('/test', (req, res) => {
  res.status(200).json({ message: 'Route test fonctionne parfaitement !' });
});


app.listen(port, () => {
  console.log(`🚀 Serveur démarré sur http://localhost:${port}`);
});

app.use('/api', stockRoutes);


app.use('/api/invoice', invoiceRoutes);

app.use('/api/stock-transfer', stockTransferRoutes);


app.use('/click-collect', clickCollectRoutes);
/*const retourRoutes = require('./routes/retourRoutes');

// Après les autres middlewares
app.use('/api/retours', retourRoutes);*/



const retourRoutes = require('./routes/retour'); // 👉 importe le fichier routes



// 🛣️ Ajouter les routes de retour
app.use('/api', retourRoutes); // ou '/api/retour' si tu veux préfixer