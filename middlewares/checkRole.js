const jwt = require('jsonwebtoken');

function checkRole(role) {
  return (req, res, next) => {
    const token = req.headers.authorization?.split(' ')[1]; // Récupérer le token du header

    if (!token) {
      return res.status(401).json({ message: 'Token manquant.' });
    }

    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET); // Vérifier le token
      if (decoded.role !== role) {
        return res.status(403).json({ message: 'Accès interdit. Rôle requis : ' + role });
      }

      req.user = decoded; // Ajouter les informations de l'utilisateur à la requête
      next(); // Passer au contrôleur suivant
    } catch (err) {
      return res.status(401).json({ message: 'Token invalide.' });
    }
  };
}

module.exports = checkRole;