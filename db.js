require('dotenv').config(); // Charger les variables d'environnement
const sql = require('mssql'); // Importer mssql

// Configuration de la connexion
const config = {
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD || '',
  server: process.env.DB_SERVER,
  database: process.env.DB_DATABASE,
  port: parseInt(process.env.DB_PORT, 10),
  options: {
    encrypt: false, // Désactiver SSL (utile pour éviter certains bugs)
    trustServerCertificate: true // Nécessaire pour les connexions locales
  }
};

// Fonction pour tester la connexion
async function connectDB() {
  try {
    await sql.connect(config);
    console.log("✅ Connexion réussie à la base de données !");
    const result = await sql.query("SELECT GETDATE() AS date_now"); // Test avec une requête simple
    console.log("📅 Date actuelle du serveur SQL :", result.recordset[0].date_now);
  } catch (err) {
    console.error("❌ Erreur de connexion :", err);
  } finally {
    sql.close(); // Fermer la connexion après usage
  }
}


// Exporter la fonction pour pouvoir l'utiliser ailleurs
module.exports = { connectDB };
