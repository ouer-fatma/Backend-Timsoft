const sql = require('mssql');
require('dotenv').config();

class User {
  constructor(nom, prenom, email, motDePasse) {
    this.nom = nom;
    this.prenom = prenom;
    this.email = email;
    this.motDePasse = motDePasse;
    this.codeTiers = null; // à générer si nécessaire
  }

  async generateCodeTiersIfNeeded(pool) {
    if (this.codeTiers) return;

    const result = await pool.request().query(`
      SELECT TOP 1 T_TIERS FROM TIERS 
      WHERE T_TIERS LIKE 'TR%' 
      ORDER BY TRY_CAST(SUBSTRING(T_TIERS, 3, LEN(T_TIERS)) AS INT) DESC
    `);

    let newCode = 'TR001';
    if (result.recordset.length > 0) {
      const lastCode = result.recordset[0].T_TIERS;
      const numeric = parseInt(lastCode.slice(2)) + 1;
      newCode = 'TR' + numeric.toString().padStart(3, '0');
    }

    this.codeTiers = newCode;
  }

  async save() {
    const { DB_USER, DB_PASSWORD, DB_SERVER, DB_DATABASE, DB_PORT } = process.env;

    const config = {
      user: DB_USER,
      password: DB_PASSWORD,
      server: DB_SERVER,
      database: DB_DATABASE,
      port: parseInt(DB_PORT, 10),
      options: {
        encrypt: false,
        trustServerCertificate: true,
      },
    };

    let pool;

    try {
      pool = await sql.connect(config);

      // Générer un code T_TIERS si non défini
      await this.generateCodeTiersIfNeeded(pool);

      const request = pool.request();

      request.input('T_TIERS', sql.NVarChar, this.codeTiers);
      request.input('T_LIBELLE', sql.NVarChar, this.nom); // Nouveau champ
      request.input('T_PRENOM', sql.NVarChar, this.prenom);
      request.input('T_EMAIL', sql.NVarChar, this.email);
      request.input('T_PASSWINTERNET', sql.NVarChar, this.motDePasse);

      await request.query(`
        INSERT INTO TIERS (T_TIERS, T_LIBELLE, T_PRENOM, T_EMAIL, T_PASSWINTERNET)
        VALUES (@T_TIERS, @T_LIBELLE, @T_PRENOM, @T_EMAIL, @T_PASSWINTERNET)
      `);

      console.log('✅ Client enregistré avec succès dans TIERS !');

    } catch (err) {
      console.error('❌ Erreur enregistrement TIERS :', err);
      throw err;
    } finally {
      if (pool) await sql.close();
    }
  }
}

module.exports = User;
