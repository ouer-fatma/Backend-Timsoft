// utils/emailService.js
const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.NOTIF_EMAIL,
    pass: process.env.NOTIF_EMAIL_PASSWORD,
  },
});

const sendNotificationEmail = async ({ to, subject, text }) => {
  await transporter.sendMail({
    from: process.env.NOTIF_EMAIL,
    to,
    subject,
    text,
  });
};

module.exports = { sendNotificationEmail };
