const express = require('express');
const router = express.Router();

let notifications = []; // 🛑 Remplace ça par ta base réelle si besoin

// Récupérer les notifs par codeTiers
router.get('/:codeTiers', (req, res) => {
  const { codeTiers } = req.params;
  const userNotifs = notifications.filter(n => n.codeTiers === codeTiers);
  res.status(200).json(userNotifs);
});

// Ajouter une notif (facultatif pour test manuel)
router.post('/', (req, res) => {
  const { codeTiers, title, message } = req.body;
  const notif = {
    codeTiers,
    title,
    message,
    date: new Date()
  };
  notifications.push(notif);
  res.status(201).json({ message: 'Notification enregistrée.', notif });
});

module.exports = router;
