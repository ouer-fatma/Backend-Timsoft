require("dotenv").config();
const express = require("express");
const { connectDB } = require("./db");
const authRoutes = require('./routes/authRoutes'); // Modification ici : chemin vers le fichier de routes
const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());

// Connexion à la base de données
connectDB();

// Utilisation des routes
app.use('/auth', authRoutes); // Plus besoin d'appliquer validateRegister ici

app.listen(port, () => {
  console.log(`🚀 Serveur démarré sur http://localhost:${port}`);
});