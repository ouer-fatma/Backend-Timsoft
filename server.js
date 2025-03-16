require("dotenv").config();
const express = require("express");
const authRoutes = require('./routes/authRoutes');
const articleRoutes = require('./routes/articleRoutes');
const userRoutes = require('./routes/userRoutes');

const { poolPromise } = require('./db');

const app = express();
const port = process.env.PORT || 3000;

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
// Add this explicit temporary route for testing
app.get('/test', (req, res) => {
  res.status(200).json({ message: 'Route test fonctionne parfaitement !' });
});


app.listen(port, () => {
  console.log(`🚀 Serveur démarré sur http://localhost:${port}`);
});
