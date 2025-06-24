//notificationsRoutes.js
const express = require('express');
const router = express.Router();
const { getNotificationsFromFile } = require('../utils/notificationStore');
const fs = require('fs');
const path = require('path');

// 🔐 Emplacement du fichier pour stocker les tokens web (optionnel pour test)
const TOKENS_FILE = path.join(__dirname, '../data/web_tokens.json');

// ✅ Obtenir toutes les notifications (non filtrées)
router.get('/all', (req, res) => {
  try {
    const allNotifs = getNotificationsFromFile();
    res.status(200).json(allNotifs);
  } catch (err) {
    console.error('❌ Erreur lecture notifications:', err);
    res.status(500).json({ error: 'Erreur lors de la lecture des notifications.' });
  }
});

// ✅ Obtenir les notifications filtrées par codeTiers
router.get('/:codeTiers', (req, res) => {
  const { codeTiers } = req.params;

  if (!codeTiers) {
    return res.status(400).json({ error: 'CodeTiers requis.' });
  }

  try {
    const allNotifs = getNotificationsFromFile();
    const userNotifs = allNotifs.filter(
      (n) => n.codeTiers === codeTiers || !n.codeTiers // ✅ Notifs globales ou ciblées
    );
    res.status(200).json(userNotifs);
  } catch (err) {
    console.error('❌ Erreur lecture notifications utilisateur:', err);
    res.status(500).json({ error: 'Erreur lors de la lecture des notifications utilisateur.' });
  }
});

// ✅ Enregistrement d’un token FCM Web (depuis Flutter Web)
router.post('/subscribe', (req, res) => {
  const { token } = req.body;
  if (!token) {
    return res.status(400).json({ error: 'Token manquant' });
  }

  let tokens = [];
  if (fs.existsSync(TOKENS_FILE)) {
    tokens = JSON.parse(fs.readFileSync(TOKENS_FILE, 'utf-8'));
  }

  if (!tokens.includes(token)) {
    tokens.push(token);
    fs.writeFileSync(TOKENS_FILE, JSON.stringify(tokens, null, 2));
    console.log('📥 Nouveau token Web enregistré');
  }

  res.status(200).json({ message: 'Token enregistré avec succès' });
});

module.exports = router;
