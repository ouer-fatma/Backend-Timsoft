//authController
const bcrypt = require('bcrypt');
const sql = require('mssql');
const User = require('../models/User');
const jwt = require('jsonwebtoken');
const { OAuth2Client } = require('google-auth-library');

// Contrôleur pour l'inscription
const registerUser = async (req, res) => {
  const { nom, email, motDePasse, role } = req.body;

  if (!nom || !email || !motDePasse || !role) {
    return res.status(400).json({ message: 'Tous les champs sont obligatoires.' });
  }

  try {
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(motDePasse, salt);

    const { DB_USER, DB_PASSWORD, DB_SERVER, DB_DATABASE, DB_PORT } = process.env;
    const config = {
      user: DB_USER,
      password: DB_PASSWORD,
      server: DB_SERVER,
      database: DB_DATABASE,
      port: parseInt(DB_PORT),
      options: { encrypt: true, trustServerCertificate: true }
    };

    await sql.connect(config);

    // ❗ Étape 0 : Vérifier si l'email existe déjà
    const checkEmailRequest = new sql.Request();
    checkEmailRequest.input('Email', sql.VarChar, email);
    const existingUser = await checkEmailRequest.query('SELECT 1 FROM Utilisateur WHERE Email = @Email');

    if (existingUser.recordset.length > 0) {
      return res.status(409).json({ message: 'Cet e-mail est déjà utilisé.' });
    }

    // Étape 1 : Générer un nouveau CodeTiers
    const requestGetCode = new sql.Request();
    const resultLastCode = await requestGetCode.query(`
      SELECT TOP 1 T_TIERS 
      FROM TIERS 
      WHERE T_TIERS LIKE 'TR%' 
      ORDER BY TRY_CAST(SUBSTRING(T_TIERS, 3, LEN(T_TIERS)) AS INT) DESC
    `);

    let newCodeTiers = 'TR001';
    if (resultLastCode.recordset.length > 0) {
      const lastCode = resultLastCode.recordset[0].T_TIERS;
      const numericPart = parseInt(lastCode.slice(2)) + 1;
      newCodeTiers = 'TR' + numericPart.toString().padStart(3, '0');
    }

    // Étape 2 : Insertion dans la table TIERS
    const requestInsertTiers = new sql.Request();
    requestInsertTiers.input('T_TIERS', sql.VarChar, newCodeTiers);
    await requestInsertTiers.query(`INSERT INTO TIERS (T_TIERS) VALUES (@T_TIERS)`);

    // Étape 3 : Insertion dans la table Utilisateur
    const requestUser = new sql.Request();
    requestUser.input('Nom', sql.VarChar, nom);
    requestUser.input('Email', sql.VarChar, email);
    requestUser.input('MotDePasse', sql.VarChar, hashedPassword);
    requestUser.input('Role', sql.VarChar, role);
    requestUser.input('CodeTiers', sql.VarChar, newCodeTiers);

    await requestUser.query(`
      INSERT INTO Utilisateur (Nom, Email, MotDePasse, Role, CodeTiers)
      VALUES (@Nom, @Email, @MotDePasse, @Role, @CodeTiers)
    `);

    res.status(201).json({ message: 'Utilisateur enregistré avec succès !' });

  } catch (err) {
    console.error('Erreur lors de l\'inscription :', err);
    res.status(500).json({ message: 'Erreur lors de l\'inscription.' });
  } finally {
    await sql.close();
  }
};


// Contrôleur pour la connexion
const loginUser = async (req, res) => {
  const { email, motDePasse } = req.body;

  if (!email || !motDePasse) {
    return res.status(400).json({ message: 'Email et mot de passe sont obligatoires.' });
  }

  try {
    const { DB_USER, DB_PASSWORD, DB_SERVER, DB_DATABASE, DB_PORT } = process.env;
    const config = {
      user: DB_USER,
      password: DB_PASSWORD,
      server: DB_SERVER,
      database: DB_DATABASE,
      port: parseInt(DB_PORT),
      options: { encrypt: true, trustServerCertificate: true }
    };

    await sql.connect(config);
    const request = new sql.Request();
    request.input('Email', sql.VarChar, email);
    
    const result = await request.query('SELECT * FROM Utilisateur WHERE Email = @Email');
    const utilisateur = result.recordset[0];

    if (!utilisateur) {
      return res.status(404).json({ message: 'Utilisateur non trouvé.' });
    }

    const passwordMatch = await bcrypt.compare(motDePasse, utilisateur.MotDePasse);
    if (!passwordMatch) {
      return res.status(401).json({ message: 'Mot de passe incorrect.' });
    }

    const token = jwt.sign(
      { id: utilisateur.ID_Utilisateur, nom: utilisateur.Nom, email: utilisateur.Email, role: utilisateur.Role },
      process.env.JWT_SECRET,
      { expiresIn: '1h' }
    );

    console.log("Email reçu:", email);
    console.log("Utilisateur trouvé:", utilisateur);
    console.log("Mot de passe correct:", passwordMatch);

    res.status(200).json({ message: 'Connexion réussie !', token });

  } catch (err) {
    console.error('Erreur lors de la connexion :', err);
    res.status(500).json({ message: 'Erreur lors de la connexion.' });
  } finally {
    await sql.close();
  }
};


const googleSignIn = async (req, res) => {
  const token = req.body.token;
  const username = req.body.username;
  console.log("🟢 Token reçu :", token);
  console.log("🔵 GOOGLE_CLIENT_ID_WEB:", process.env.GOOGLE_CLIENT_ID_WEB);
  console.log("🟠 GOOGLE_CLIENT_ID_ANDROID:", process.env.GOOGLE_CLIENT_ID_ANDROID);  
  const client = new OAuth2Client([
    process.env.GOOGLE_CLIENT_ID_WEB,
    process.env.GOOGLE_CLIENT_ID_ANDROID
  ]);
  
  try {
    const ticket = await client.verifyIdToken({
      idToken: token,
       audience: [
        process.env.GOOGLE_CLIENT_ID_WEB,
        process.env.GOOGLE_CLIENT_ID_ANDROID
      ],
    });

    const payload = ticket.getPayload();
    const email = payload.email;
    const nom = username || payload.name || email.split('@')[0];

    const config = {
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      server: process.env.DB_SERVER,
      database: process.env.DB_DATABASE,
      port: parseInt(process.env.DB_PORT),
      options: { encrypt: true, trustServerCertificate: true }
    };

    await sql.connect(config);

    const request = new sql.Request();
    request.input('Email', sql.NVarChar, email);
    const result = await request.query('SELECT * FROM Utilisateur WHERE Email = @Email');

    let utilisateur = result.recordset[0];

    if (!utilisateur) {
      const insertRequest = new sql.Request();
      insertRequest.input('Nom', sql.NVarChar, nom);
      insertRequest.input('Preom', sql.NVarChar, prenom);
      insertRequest.input('Email', sql.NVarChar, email);
      insertRequest.input('MotDePasse', sql.NVarChar, bcrypt.hashSync('0000', 10));
      insertRequest.input('Role', sql.NVarChar, 'client');
      await insertRequest.query(`
        INSERT INTO Utilisateur (Nom, Prenom, Email, MotDePasse, Role)
        VALUES (@Nom, @Prenom @Email, @MotDePasse, @Role)
      `);

      const fetch = new sql.Request();
      fetch.input('Email', sql.NVarChar, email);
      const newResult = await fetch.query('SELECT * FROM Utilisateur WHERE Email = @Email');
      utilisateur = newResult.recordset[0];
    }

    const jwtToken = jwt.sign(
      { id: utilisateur.ID_Utilisateur, email: utilisateur.Email, role: utilisateur.Role },
      process.env.JWT_SECRET,
      { expiresIn: '1h' }
    );

    res.status(200).json({
      message: 'Connexion Google réussie !',
      token: jwtToken,
      user: {
        nom: utilisateur.Nom,
        email: utilisateur.Email,
        role: utilisateur.Role,
      }
    });

  } catch (error) {
    console.error('❌ Erreur Google Sign-In:', error);
    res.status(401).json({ message: 'Échec de la vérification Google.', error: error.message });
  } finally {
    sql.close();
  }
};



// Contrôleurs pour les routes protégées
const adminDashboard = (req, res) => res.json({ message: 'Bienvenue, Admin !' });
const magasinDashboard = (req, res) => res.json({ message: 'Bienvenue, Personnel du Magasin !' });
const clientDashboard = (req, res) => res.json({ message: 'Bienvenue, Client !' });

module.exports = {
  registerUser,
  loginUser,
  adminDashboard,
  magasinDashboard,
  clientDashboard
};
module.exports.googleSignIn = googleSignIn;
