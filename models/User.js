// User.js
const sql = require('mssql');
const crypto = require('crypto');

class User {
  constructor(nom, prenom, email, motDePasse, role = 'client') {
    this.nom = nom;
    this.prenom = prenom;
    this.email = email;
    this.motDePasse = motDePasse;
    this.role = role;
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

    const hashedPassword = crypto.createHash('sha256').update(this.motDePasse).digest('hex').substring(0, 20);

    try {
      await sql.connect(config);
      const request = new sql.Request();

      if (this.role === 'client') {
        const codeClient = 'CLI' + Date.now().toString().slice(-6);

        request.input('code', sql.NVarChar, codeClient);
        request.input('nom', sql.NVarChar, this.nom);
        request.input('prenom', sql.NVarChar, this.prenom);
        request.input('email', sql.NVarChar, this.email);
        request.input('password', sql.NVarChar, hashedPassword);
        request.input('nature', sql.NVarChar, 'CLI');

        await request.query(`
          INSERT INTO TIERS 
          (T_TIERS, T_LIBELLE, T_PRENOM, T_EMAIL, T_PASSWINTERNET, T_NATUREAUXI)
          VALUES 
          (@code, @nom, @prenom, @email, @password, @nature)
        `);
        console.log('✅ Client enregistré avec succès.');

      } else if (this.role === 'admin') {
        const codeAdmin = 'U' + Date.now().toString().slice(-6);

        request.input('util', sql.NVarChar, codeAdmin);
        request.input('email', sql.NVarChar, this.email);
        request.input('nom', sql.NVarChar, this.nom);
        request.input('pass', sql.NVarChar, hashedPassword);
        request.input('fonction', sql.NVarChar, 'Administrateur');
        request.input('groupe', sql.NVarChar, 'ADM');
        request.input('superviseur', sql.NChar(1), 'X');

        await request.query(`
          INSERT INTO UTILISAT 
          (US_UTILISATEUR, US_EMAIL, US_NOM, US_PASSWORD, US_FONCTION, US_GROUPE, US_SUPERVISEUR)
          VALUES 
          (@util, @email, @nom, @pass, @fonction, @groupe, @superviseur)
        `);
        console.log('✅ Admin enregistré avec succès.');

      } else if (this.role === 'magasinier') {
        const codeUser = 'U' + Date.now().toString().slice(-6);
        const codeCommercial = 'VEN' + Date.now().toString().slice(-5);

        // Insert in UTILISAT
        await new sql.Request()
          .input('util', sql.NVarChar, codeUser)
          .input('email', sql.NVarChar, this.email)
          .input('nom', sql.NVarChar, this.nom)
          .input('pass', sql.NVarChar, hashedPassword)
          .input('fonction', sql.NVarChar, 'Magasinier')
          .input('groupe', sql.NVarChar, 'VEN')
          .input('superviseur', sql.NChar(1), '')
          .query(`
            INSERT INTO UTILISAT 
            (US_UTILISATEUR, US_EMAIL, US_NOM, US_PASSWORD, US_FONCTION, US_GROUPE, US_SUPERVISEUR)
            VALUES 
            (@util, @email, @nom, @pass, @fonction, @groupe, @superviseur)
          `);

        // Insert in COMMERCIAL
        await new sql.Request()
          .input('code', sql.NVarChar, codeCommercial)
          .input('libelle', sql.NVarChar, this.nom)
          .input('utilAssocie', sql.NVarChar, codeUser)
          .query(`
            INSERT INTO COMMERCIAL 
            (GCL_COMMERCIAL, GCL_LIBELLE, GCL_VENDEUR, GCL_UTILASSOCIE)
            VALUES 
            (@code, @libelle, 'X', @utilAssocie)
          `);

        console.log('✅ Magasinier enregistré avec succès.');
      } else {
        throw new Error('❌ Rôle non reconnu.');
      }

    } catch (err) {
      console.error('❌ Erreur lors de l\'enregistrement de l\'utilisateur :', err);
      throw err;
    } finally {
      sql.close();
    }
  }
}

module.exports = User;
