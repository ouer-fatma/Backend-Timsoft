require("dotenv").config();
const express = require("express");
const authRoutes = require('./routes/authRoutes');
const articleRoutes = require('./routes/articleRoutes');

const { poolPromise } = require('./db');

const { connectDB } = require("./db");
const authRoutes = require('./routes/authRoutes'); // Modification ici : chemin vers le fichier de routes
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
// Utilisation des routes
app.use('/auth', authRoutes); // Plus besoin d'appliquer validateRegister ici
app.listen(port, () => {
  console.log(`🚀 Serveur démarré sur http://localhost:${port}`);
});
