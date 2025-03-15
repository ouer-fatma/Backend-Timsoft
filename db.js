require('dotenv').config();
const sql = require('mssql');

const config = {
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  server: process.env.DB_SERVER,
  database: process.env.DB_DATABASE,
  port: parseInt(process.env.DB_PORT, 10),
  options: {
    encrypt: false,
    trustServerCertificate: true,
  },
};

const poolPromise = new sql.ConnectionPool(config)
  .connect()
  .then(pool => {
    console.log('✅ Connexion réussie à la base de données.');
    return pool;
  })
  .catch(err => {
    console.error('❌ Erreur lors de la connexion à la base de données:', err);
    process.exit(1);
  });

module.exports = { sql, poolPromise };
