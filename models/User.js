//User.js
class User {
    constructor(nom, email, motDePasse, role = 'user') {
      this.nom = nom;
      this.email = email;
      this.motDePasse = motDePasse;
      this.role = role;
    }
  
    // Méthode pour insérer un utilisateur dans la base de données
    async save() {
      const sql = require('mssql');
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
  
      try {
        await sql.connect(config);
        const request = new sql.Request();
        const query = `
          INSERT INTO Utilisateur (Nom, Email, MotDePasse, Role)
          VALUES (@Nom, @Email, @MotDePasse, @Role)
        `;
        request.input('Nom', sql.NVarChar, this.nom);
        request.input('Email', sql.NVarChar, this.email);
        request.input('MotDePasse', sql.NVarChar, this.motDePasse);
        request.input('Role', sql.NVarChar, this.role);
  
        await request.query(query);
        console.log('Utilisateur enregistré avec succès !');
      } catch (err) {
        console.error('Erreur lors de l\'enregistrement de l\'utilisateur :', err);
        throw err;
      } finally {
        sql.close();
      }
    }
  }
  
  module.exports = User;