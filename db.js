require('dotenv').config();
const sql = require('mssql');

const config = {
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  server: process.env.DB_SERVER,
  database: process.env.DB_DATABASE, // 👉 DEMO_20 depuis .env
  port: parseInt(process.env.DB_PORT, 10) || 1433,
  options: {
    encrypt: false, // ⚠️ Adapter selon ton environnement SQL Server
    trustServerCertificate: true,
  },
  connectionTimeout: 30000,
  requestTimeout: 120000,
};

console.log('🔄 Tentative de connexion à la base de données...');

const poolPromise = new sql.ConnectionPool(config)
  .connect()
  .then(pool => {
    console.log(`✅ Connecté à la base : ${process.env.DB_DATABASE}`);
    return pool;
  })
  .catch(err => {
    console.error('❌ Erreur de connexion à la base de données :', err);
    process.exit(1);
  });

module.exports = { sql, poolPromise };
