const jwt = require('jsonwebtoken');

function checkRole(requiredRole) {
  return (req, res, next) => {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ message: 'Token manquant ou mal formé.' });
    }

    const token = authHeader.split(' ')[1];

    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);

      req.user = decoded; // ✅ toujours injecter l'utilisateur, même si le rôle est faux

      if (decoded.role !== requiredRole) {
        return res.status(403).json({ message: `Accès interdit. Rôle requis : ${requiredRole}` });
      }

      next(); // ✅ rôle OK, on continue
    } catch (err) {
      return res.status(401).json({ message: 'Token invalide.' });
    }
  };
}

module.exports = checkRole;
