//authController
const bcrypt = require('bcrypt');
const sql = require('mssql');
const User = require('../models/User');
const jwt = require('jsonwebtoken');
const { OAuth2Client } = require('google-auth-library');

// Contrôleur pour l'inscription
const registerUser = async (req, res) => {
  const { nom, prenom, email, motDePasse } = req.body;

  if (!nom || !prenom || !email || !motDePasse) {
    return res.status(400).json({ message: 'Tous les champs sont obligatoires.' });
  }

  try {
    // Hash du mot de passe
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(motDePasse, salt);
    const user = new User(nom, prenom, email, hashedPassword);
    await user.save();
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
