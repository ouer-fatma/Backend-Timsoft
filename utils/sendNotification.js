// utils/sendNotification.js
const admin = require('firebase-admin');

/**
 * Envoie une notification FCM à un topic donné
 * @param {string} title - Titre de la notification
 * @param {string} body - Contenu de la notification
 * @param {string} topic - Nom du topic (ex: "promotions")
 */
const sendNotification = async (title, body, topic = 'promotions') => {
  const message = {
    notification: {
      title,
      body,
    },
    topic, // tous les utilisateurs abonnés à ce topic reçoivent la notif
  };

  try {
    const response = await admin.messaging().send(message);
    console.log('✅ Notification envoyée avec succès:', response);
  } catch (error) {
    console.error('❌ Erreur lors de l’envoi de la notification:', error);
  }
};

module.exports = sendNotification;
