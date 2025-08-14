//authController
const bcrypt = require('bcrypt');
const User = require('../models/User');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { sendNotificationEmail } = require('../utils/emailService');
const { OAuth2Client } = require('google-auth-library');
const { v4: uuidv4 } = require('uuid');
const { sql, poolPromise } = require('../db');
const admin = require('firebase-admin');
const serviceAccount = require('../firebase-service-account.json'); // mets le bon chemin

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
}






const registerUser = async (req, res) => {
  const { nom, prenom, email, motDePasse, role } = req.body;

  if (!nom || !prenom || !email || !motDePasse || !role) {
    return res.status(400).json({ message: 'Tous les champs sont obligatoires.' });
  }

  if (role !== 'client') {
    return res.status(403).json({ message: 'Seuls les clients peuvent s’inscrire via cette route.' });
  }

  try {
    const pool = await poolPromise;

    // Vérifie si le client existe déjà
    const existing = await pool.request()
      .input('email', sql.NVarChar, email)
      .query('SELECT 1 FROM TIERS WHERE T_EMAIL = @email');

    if (existing.recordset.length > 0) {
      return res.status(409).json({ message: 'Cet e-mail est déjà utilisé.' });
    }

    // Vérifie si un token non expiré existe déjà
    const recentToken = await pool.request()
      .input('email', sql.NVarChar, email)
      .query(`
        SELECT 1 FROM EMAIL_VERIFICATIONS 
        WHERE EMAIL = @email AND IS_USED = 0
          AND DATEDIFF(HOUR, CREATED_AT, GETDATE()) <= 24
      `);

    if (recentToken.recordset.length > 0) {
      return res.status(429).json({ message: 'Un e-mail de vérification vous a déjà été envoyé récemment.' });
    }

    // Génération et enregistrement du token
    const token = crypto.randomBytes(32).toString('hex');

    await pool.request()
      .input('EMAIL', sql.NVarChar, email)
      .input('TOKEN', sql.NVarChar, token)
      .input('PASSWORD', sql.NVarChar, motDePasse) // 
      .input('CREATED_AT', sql.DateTime, new Date())
      .query(`
          INSERT INTO EMAIL_VERIFICATIONS (EMAIL, TOKEN, PASSWORD, CREATED_AT)
  VALUES (@EMAIL, @TOKEN, @PASSWORD, @CREATED_AT)
      `);

    // Envoi de l'e-mail
    await sendNotificationEmail({
      to: email,
      subject: '🔐 Vérifiez votre adresse e-mail',
      text: `Bonjour ${prenom},

Merci pour votre inscription.

Veuillez cliquer sur ce lien pour activer votre compte :
http://localhost:3000/auth/verify-email?token=${token}

Ce lien est valable 24 heures.`
    });

    return res.status(200).json({
      message: 'Un e-mail de vérification a été envoyé. Veuillez vérifier votre boîte de réception.'
    });

  } catch (err) {
    console.error('❌ Erreur registerUser:', err);
    return res.status(500).json({ message: 'Erreur serveur lors de l\'inscription.' });
  }
};




const verifyEmail = async (req, res) => {
  const { token } = req.query;
  if (!token) {
    return res.status(400).json({ message: 'Token manquant.' });
  }

  try {
    const pool = await poolPromise;

    // Vérifie la validité du token
    const result = await pool.request()
      .input('token', sql.NVarChar, token)
      .query(`
        SELECT * FROM EMAIL_VERIFICATIONS 
        WHERE TOKEN = @token 
          AND IS_USED = 0 
          AND DATEDIFF(HOUR, CREATED_AT, GETDATE()) <= 24
      `);

    const record = result.recordset[0];
    if (!record) {
      return res.status(400).json({ message: 'Lien invalide ou expiré.' });
    }

    const email = record.EMAIL;

    // Vérifie si le compte existe déjà
    const exists = await pool.request()
      .input('email', sql.NVarChar, email)
      .query('SELECT 1 FROM TIERS WHERE T_EMAIL = @email');

    if (exists.recordset.length > 0) {
      return res.status(409).json({ message: 'Compte déjà activé.' });
    }

    // Génère le code T_TIERS
    const tiersResult = await pool.request().query(`
      SELECT TOP 1 T_TIERS FROM TIERS 
      WHERE T_TIERS LIKE 'TR%' 
      ORDER BY TRY_CAST(SUBSTRING(T_TIERS, 3, LEN(T_TIERS)) AS INT) DESC
    `);

    let newCode = 'TR001';
    if (tiersResult.recordset.length > 0) {
      const lastCode = tiersResult.recordset[0].T_TIERS;
      const numeric = parseInt(lastCode.slice(2)) + 1;
      newCode = 'TR' + numeric.toString().padStart(3, '0');
    }

    const plainPassword = record.PASSWORD;

// Insertion dans TIERS
const hashedPassword = crypto.createHash('sha256').update(plainPassword).digest('hex').substring(0, 40);

await pool.request()
  .input('T_TIERS', sql.NVarChar, newCode)
  .input('T_AUXILIAIRE', sql.NVarChar, newCode)
  .input('T_LIBELLE', sql.NVarChar, 'Client')
  .input('T_EMAIL', sql.NVarChar, email)
  .input('T_PASSWINTERNET', sql.NVarChar(40), hashedPassword)
  .query(`
    INSERT INTO TIERS (T_TIERS, T_AUXILIAIRE, T_LIBELLE, T_EMAIL, T_PASSWINTERNET)
    VALUES (@T_TIERS, @T_AUXILIAIRE, @T_LIBELLE, @T_EMAIL, @T_PASSWINTERNET)
  `);

    // Génère un numéro de panier
    const resultNumero = await pool.request().query(`
      SELECT MAX(CAST(GP_NUMERO AS INT)) + 1 AS newNumero 
      FROM PIECE WHERE ISNUMERIC(GP_NUMERO) = 1
    `);

    const newNumero = resultNumero.recordset[0].newNumero || 1;

    await pool.request()
      .input('nature', sql.NVarChar, 'PAN')
      .input('souche', sql.NVarChar, 'PAN001')
      .input('numero', sql.Int, newNumero)
      .input('indice', sql.Int, 0)
      .input('tiers', sql.NVarChar, newCode)
      .query(`
        INSERT INTO PIECE (GP_NATUREPIECEG, GP_SOUCHE, GP_NUMERO, GP_INDICEG, GP_TIERS, GP_DATEPIECE)
        VALUES (@nature, @souche, @numero, @indice, @tiers, GETDATE())
      `);

    // Marque le token comme utilisé
    await pool.request()
      .input('token', sql.NVarChar, token)
      .query('UPDATE EMAIL_VERIFICATIONS SET IS_USED = 1 WHERE TOKEN = @token');

    return res.status(200).json({ message: '✅ Compte activé avec succès ! Vous pouvez maintenant vous connecter.' });

  } catch (err) {
    console.error('❌ Erreur verifyEmail:', err);
    return res.status(500).json({ message: 'Erreur serveur lors de la vérification.', error: err.message });
  }
};


const forgotPassword = async (req, res) => {
  const { email } = req.body;

  if (!email) return res.status(400).json({ message: 'Email requis.' });

  try {
    const pool = await poolPromise;

    const result = await pool.request()
      .input('email', sql.NVarChar, email)
      .query('SELECT T_TIERS, T_PRENOM FROM TIERS WHERE T_EMAIL = @email');

    const user = result.recordset[0];

    if (!user) {
      return res.status(404).json({ message: 'Aucun compte trouvé avec cet email.' });
    }

    const token = crypto.randomBytes(32).toString('hex');
    const expire = new Date(Date.now() + 30 * 60 * 1000); // 30 minutes

    await pool.request()
      .input('token', sql.NVarChar, token)
      .input('expire', sql.DateTime, expire)
      .input('email', sql.NVarChar, email)
      .query(`
        UPDATE TIERS 
        SET resetToken = @token, resetTokenExpire = @expire 
        WHERE T_EMAIL = @email
      `);

    await sendNotificationEmail({
      to: email,
      subject: '🔐 Réinitialisation de mot de passe',
      text: `Bonjour ${user.T_PRENOM || ''},

Vous avez demandé à réinitialiser votre mot de passe.

Cliquez sur le lien suivant pour choisir un nouveau mot de passe :
http://localhost:55241/?token=${token}


Ce lien expirera dans 30 minutes.`,
    });

    return res.status(200).json({ message: 'E-mail envoyé avec succès.' });

  } catch (err) {
    console.error('❌ Erreur forgotPassword:', err);
    return res.status(500).json({ message: 'Erreur serveur.' });
  }
};


const resetPassword = async (req, res) => {
  const { token, nouveauMotDePasse } = req.body;

  if (!token || !nouveauMotDePasse) {
    return res.status(400).json({ message: 'Token et mot de passe requis.' });
  }

  try {
    const pool = await poolPromise;

    const result = await pool.request()
      .input('token', sql.NVarChar, token)
      .query(`
        SELECT T_TIERS FROM TIERS 
        WHERE resetToken = @token AND resetTokenExpire > GETDATE()
      `);

    const user = result.recordset[0];

    if (!user) {
      return res.status(400).json({ message: 'Lien invalide ou expiré.' });
    }

    const hashedPassword = crypto
      .createHash('sha256')
      .update(nouveauMotDePasse)
      .digest('hex')
      .substring(0, 40);

    await pool.request()
      .input('password', sql.NVarChar(40), hashedPassword)
      .input('token', sql.NVarChar, token)
      .query(`
        UPDATE TIERS 
        SET T_PASSWINTERNET = @password, resetToken = NULL, resetTokenExpire = NULL 
        WHERE resetToken = @token
      `);

    return res.status(200).json({ message: 'Mot de passe réinitialisé avec succès.' });

  } catch (err) {
    console.error('❌ Erreur resetPassword:', err);
    return res.status(500).json({ message: 'Erreur serveur.' });
  }
};




const getDepotsDisponibles = async (req, res) => {
  try {
    const pool = await poolPromise;
    const result = await pool.request().query(`
      SELECT DISTINCT GCL_ETABLISSEMENT
      FROM Commercial
      ORDER BY GCL_ETABLISSEMENT
    `);

    res.status(200).json(result.recordset);
  } catch (err) {
    console.error('Erreur récupération dépôts :', err);
    res.status(500).json({ message: 'Erreur serveur.' });
  }
};
const getBLPourMagasinier = async (req, res) => {
  const { codeCommercial } = req.user;

  if (!codeCommercial) {
    return res.status(403).json({ message: 'CodeCommercial manquant.' });
  }

  try {
    const pool = await poolPromise;

    const etabRes = await pool.request()
      .input('CodeCommercial', sql.VarChar, codeCommercial)
      .query(`
        SELECT GCL_ETABLISSEMENT 
        FROM Commercial 
        WHERE GCL_COMMERCIAL = @CodeCommercial
      `);

    if (etabRes.recordset.length === 0) {
      return res.status(404).json({ message: 'Commercial introuvable.' });
    }

    const etablissement = etabRes.recordset[0].GCL_ETABLISSEMENT;

    const blRes = await pool.request()
      .input('Etablissement', sql.VarChar, etablissement)
      .query(`
        SELECT 
          P.GP_NUMERO,
          P.GP_DATEPIECE,
          P.GP_TIERS,
          P.GP_DEPOT,
          P.GP_STATUTPIECE
        FROM PIECE P
        WHERE P.GP_NATUREPIECEG = 'BL'
          AND P.GP_DEPOT = @Etablissement
          AND P.GP_STATUTPIECE = 'EXP' -- 🔥 Commandes prêtes à expédier
        ORDER BY P.GP_DATEPIECE DESC
      `);

    res.status(200).json(blRes.recordset);

  } catch (err) {
    console.error("Erreur récupération BL:", err);
    res.status(500).json({ message: "Erreur serveur." });
  }
};



// Contrôleur pour la connexion
const loginUser = async (req, res) => {
  const { email, motDePasse } = req.body;

  if (!email || !motDePasse) {
    return res.status(400).json({ message: 'Email et mot de passe sont obligatoires.' });
  }

  try {
    const pool = await poolPromise;
    let utilisateur = null;
    let role = null;
    let codeTiers = null;
    let nom = null;
    let prenom = null;
    let id = null; // <- clé primaire selon le rôle

    // 🔍 Cas UTILISAT : admin ou magasinier
    const userResult = await pool.request()
      .input('email', sql.NVarChar, email)
      .query(`
        SELECT US_UTILISATEUR, US_EMAIL, US_PASSWORD, US_FONCTION, US_SUPERVISEUR, US_GROUPE
        FROM UTILISAT
        WHERE US_EMAIL = @email
      `);

    if (userResult.recordset.length > 0) {
      const user = userResult.recordset[0];

      if (motDePasse.trim() !== user.US_PASSWORD?.trim()) {
        return res.status(401).json({ message: 'Mot de passe incorrect.' });
      }

      utilisateur = user;
      id = user.US_UTILISATEUR?.trim(); // ✅ ID pour admin/magasinier
      codeTiers = user.US_UTILISATEUR?.trim();

      role = (user.US_GROUPE === 'ADM' ||
              (user.US_SUPERVISEUR === 'X' && user.US_GROUPE === 'ADM') ||
              (user.US_FONCTION && user.US_FONCTION.toLowerCase().includes('admin')))
              ? 'admin'
              : 'personnel_magasin';
    }

    // 🔍 Cas client : table TIERS
    if (!utilisateur) {
      const clientResult = await pool.request()
        .input('email', sql.NVarChar, email)
        .query(`
          SELECT T_TIERS, T_AUXILIAIRE, T_EMAIL, T_PASSWINTERNET, T_LIBELLE, T_PRENOM 
          FROM TIERS 
          WHERE T_EMAIL = @email
        `);

      if (clientResult.recordset.length > 0) {
        const client = clientResult.recordset[0];

const hashedInputPassword = crypto.createHash('sha256').update(motDePasse).digest('hex').substring(0, 40);

if (hashedInputPassword !== client.T_PASSWINTERNET?.trim()) {
  return res.status(401).json({ message: 'Mot de passe incorrect.' });
}



        utilisateur = client;
        id = client.T_AUXILIAIRE; // ✅ ID pour client
        codeTiers = client.T_TIERS;
        nom = client.T_LIBELLE;
        prenom = client.T_PRENOM;
        role = 'client';
      }
    }

    if (!utilisateur) {
      return res.status(404).json({ message: 'Utilisateur non trouvé.' });
    }

 const tokenPayload = {
  id,         // Identifiant de l'utilisateur
  email,      // Email de connexion
  role,       // Rôle (client, personnel_magasin, admin)
  codeTiers,  // Code utilisateur (TIERS ou COMMERCIAL)
};

// Ajouter des infos spécifiques selon le rôle
if (role === 'client') {
  tokenPayload.nom = nom;
  tokenPayload.prenom = prenom;
}

if (role === 'personnel_magasin') {
  tokenPayload.codeCommercial = codeTiers; // ✅ C’est ce que req.user attend ensuite
}

// Générer le JWT
const token = jwt.sign(tokenPayload, process.env.JWT_SECRET, { expiresIn: '1h' });

// Construire la réponse à renvoyer
const response = {
  message: 'Connexion réussie !',
  token,
  role,
  codeTiers,
  email,
};

// Ajouter les infos du commercial si rôle = magasinier
if (role === 'personnel_magasin') {
  const commercialRes = await pool.request()
    .input('code', sql.NVarChar, codeTiers)
    .query(`SELECT * FROM COMMERCIAL WHERE GCL_COMMERCIAL = @code`);

  response.commercial = commercialRes.recordset[0] || null;
}

return res.status(200).json(response);


    return res.status(200).json(response);

  } catch (err) {
    console.error('❌ Erreur de connexion :', err);
    return res.status(500).json({ message: 'Erreur serveur pendant la connexion.' });
  }
};



const googleSignIn = async (req, res) => {
  const { token, username } = req.body;

  try {
    const decodedToken = await admin.auth().verifyIdToken(token);
    const email = decodedToken.email;
    const nom = username || decodedToken.name || email.split('@')[0];
    const prenom = ''; // Pas fourni par Google

    const pool = await poolPromise;

    // Vérifie si le client existe déjà
    const result = await pool.request()
      .input('email', sql.NVarChar, email)
      .query(`SELECT * FROM TIERS WHERE T_EMAIL = @email`);

    let user = result.recordset[0];

    // S'il n'existe pas, on le crée
    if (!user) {
      const tiersCodeResult = await pool.request().query(`
        SELECT TOP 1 T_TIERS FROM TIERS 
        WHERE T_TIERS LIKE 'TR%' 
        ORDER BY TRY_CAST(SUBSTRING(T_TIERS, 3, LEN(T_TIERS)) AS INT) DESC
      `);

      let newCode = 'TR001';
      if (tiersCodeResult.recordset.length > 0) {
        const lastCode = tiersCodeResult.recordset[0].T_TIERS;
        const numeric = parseInt(lastCode.slice(2)) + 1;
        newCode = 'TR' + numeric.toString().padStart(3, '0');
      }

      const hashedPassword = '0000'; // Plain fallback (pas de hash)

      await pool.request()
        .input('T_TIERS', sql.NVarChar, newCode)
        .input('T_AUXILIAIRE', sql.NVarChar, newCode) // ✅ requis pour éviter l’erreur d’unicité
        .input('T_LIBELLE', sql.NVarChar, nom)
        .input('T_EMAIL', sql.NVarChar, email)
        .input('T_PASSWINTERNET', sql.NVarChar, hashedPassword)
        .query(`
          INSERT INTO TIERS (T_TIERS, T_AUXILIAIRE, T_LIBELLE, T_EMAIL, T_PASSWINTERNET)
          VALUES (@T_TIERS, @T_AUXILIAIRE, @T_LIBELLE, @T_EMAIL, @T_PASSWINTERNET)
        `);

      // Créer un panier
      const panierResult = await pool.request().query(`
        SELECT MAX(CAST(GP_NUMERO AS INT)) + 1 AS newNumero 
        FROM PIECE WHERE ISNUMERIC(GP_NUMERO) = 1
      `);

      const newNumero = panierResult.recordset[0].newNumero || 1;

      await pool.request()
        .input('nature', sql.NVarChar, 'PAN')
        .input('souche', sql.NVarChar, 'PAN001')
        .input('numero', sql.Int, newNumero)
        .input('indice', sql.Int, 0)
        .input('tiers', sql.NVarChar, newCode)
        .query(`
          INSERT INTO PIECE (GP_NATUREPIECEG, GP_SOUCHE, GP_NUMERO, GP_INDICEG, GP_TIERS, GP_DATEPIECE)
          VALUES (@nature, @souche, @numero, @indice, @tiers, GETDATE())
        `);

      user = {
        T_TIERS: newCode,
        T_LIBELLE: nom,
        T_EMAIL: email
      };
    }

    // Créer le token JWT
 const jwtToken = jwt.sign(
  {
    id: user.T_AUXILIAIRE, // ← ajouté
    codeTiers: user.T_TIERS,
    nom: user.T_LIBELLE,
    email: user.T_EMAIL,
    role: 'client'
  },
  process.env.JWT_SECRET,
  { expiresIn: '1h' }
);


    res.status(200).json({
      message: 'Connexion Google réussie !',
      token: jwtToken,
      user: {
        codeTiers: user.T_TIERS,
        nom: user.T_LIBELLE,
        email: user.T_EMAIL,
        role: 'client'
      }
    });

  } catch (err) {
    console.error('❌ Erreur Google Sign-In:', err.message);
    res.status(401).json({ message: 'Erreur d\'authentification Google.', error: err.message });
  }
};




// Contrôleurs pour les routes protégées
const adminDashboard = (req, res) => res.json({ message: 'Bienvenue, Admin !' });
const magasinDashboard = (req, res) => res.json({ message: 'Bienvenue, Personnel du Magasin !' });
const clientDashboard = (req, res) => res.json({ message: 'Bienvenue, Client !' });

module.exports = {
  registerUser,
  verifyEmail,
  forgotPassword,
  resetPassword,
  getDepotsDisponibles,
  getBLPourMagasinier,
  loginUser,
  googleSignIn,
  adminDashboard,
  magasinDashboard,
  clientDashboard
};

