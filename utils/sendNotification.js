//sendNotification.js
const admin = require('firebase-admin');
const { saveNotificationToFile } = require('./notificationStore');

/**
 * Envoie une notification FCM à un topic donné
 * et la stocke localement dans le fichier JSON
 */
const sendNotification = async (title, body, topic = 'promotions') => {
  const message = {
    notification: {
      title,
      body,
    },
    topic,
  };

  try {
    const response = await admin.messaging().send(message);
    console.log('✅ Notification envoyée avec succès:', response);

    // Stocker dans le fichier local
    saveNotificationToFile({
      title,
      message: body,
      topic,
      date: new Date().toISOString(),
    });

  } catch (error) {
    console.error('❌ Erreur lors de l’envoi de la notification:', error);
  }
};

module.exports = sendNotification;
