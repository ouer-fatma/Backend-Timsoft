require('dotenv').config();
const sql = require('mssql');

const config = {
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  server: process.env.DB_SERVER,
  database: process.env.DB_DATABASE,
  port: isNaN(parseInt(process.env.DB_PORT, 10)) ? 1433 : parseInt(process.env.DB_PORT, 10),
  options: {
    encrypt: false, // à adapter selon l'environnement
    trustServerCertificate: true,
  },
  connectionTimeout: 30000, // 30 secondes pour se connecter
  requestTimeout: 120000, // 120 secondes pour exécuter une requête
};

console.log('🔄 Tentative de connexion à la base de données...');

const poolPromise = new sql.ConnectionPool(config)
  .connect()
  .then(pool => {
    console.log('✅ Connexion réussie à la base de données.');
    return pool;
  })
  .catch(err => {
    console.error('❌ Erreur lors de la connexion à la base de données:', err);
    process.exit(1); // Stoppe le serveur si la connexion échoue
  });

module.exports = { sql, poolPromise };