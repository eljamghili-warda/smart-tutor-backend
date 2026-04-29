const jwt = require('jsonwebtoken');
const { pool } = require('../config/db');

// Verify JWT token
const authenticate = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Token manquant' });
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    const result = await pool.query(
      'SELECT id, prenom, nom, email, role, est_bloque FROM utilisateurs WHERE id = $1',
      [decoded.id]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Utilisateur introuvable' });
    }

    const user = result.rows[0];
    if (user.est_bloque) {
      return res.status(403).json({ error: 'Compte bloqué' });
    }

    req.user = user;
    next();
  } catch (err) {
    if (err.name === 'JsonWebTokenError') {
      return res.status(401).json({ error: 'Token invalide' });
    }
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expiré' });
    }
    return res.status(500).json({ error: 'Erreur serveur' });
  }
};

// Role-based access control
const requireRole = (...roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Non authentifié' });
    }
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Accès refusé - rôle insuffisant' });
    }
    next();
  };
};

// Tuteur must be ACTIVE
const requireActiveTuteur = async (req, res, next) => {
  if (req.user.role !== 'tuteur') return next();
  const result = await pool.query(
    'SELECT statut FROM tuteurs WHERE utilisateur_id = $1', [req.user.id]
  );
  if (!result.rows.length || result.rows[0].statut !== 'ACTIVE') {
    return res.status(403).json({ error: 'Compte tuteur non validé' });
  }
  next();
};

module.exports = { authenticate, requireRole, requireActiveTuteur };