const jwt = require('jsonwebtoken');

function verifyToken(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];

  if (!token) {
    return res.status(401).json({ message: 'Token manquant.' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded; // 👈 injecte les infos utilisateur
    next();
  } catch (err) {
    return res.status(401).json({ message: 'Token invalide.' });
  }
}

module.exports = verifyToken;
