//notificationStore.js
const fs = require('fs');
const path = require('path');

const NOTIF_FILE = path.join(__dirname, '../data/notifications.json');

function saveNotificationToFile(notif) {
  const fileExists = fs.existsSync(NOTIF_FILE);
  let notifs = [];

  if (fileExists) {
    const raw = fs.readFileSync(NOTIF_FILE);
    notifs = JSON.parse(raw);
  }

  notifs.unshift(notif); // Ajoute en haut
  fs.writeFileSync(NOTIF_FILE, JSON.stringify(notifs, null, 2));
}

function getNotificationsFromFile() {
  if (!fs.existsSync(NOTIF_FILE)) return [];
  const raw = fs.readFileSync(NOTIF_FILE);
  return JSON.parse(raw);
}

module.exports = { saveNotificationToFile, getNotificationsFromFile };
