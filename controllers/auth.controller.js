const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { pool } = require('../config/db');

const generateToken = (user) => {
  return jwt.sign(
    { id: user.id, email: user.email, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRE }
  );
};

// POST /api/auth/register
const register = async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { prenom, nom, email, motDePasse, role, niveauEtude, filiere, etablissement, specialites, biographie } = req.body;

    if (!prenom || !nom || !email || !motDePasse || !role) {
      return res.status(400).json({ error: 'Champs obligatoires manquants' });
    }
    if (!['etudiant', 'tuteur'].includes(role)) {
      return res.status(400).json({ error: 'Rôle invalide' });
    }

    const existing = await client.query('SELECT id FROM utilisateurs WHERE email = $1', [email]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'Email déjà utilisé' });
    }

    const hash = await bcrypt.hash(motDePasse, 10);
    const userResult = await client.query(
      `INSERT INTO utilisateurs (prenom, nom, email, mot_de_passe, role)
       VALUES ($1, $2, $3, $4, $5) RETURNING id, prenom, nom, email, role`,
      [prenom, nom, email, hash, role]
    );
    const user = userResult.rows[0];

    if (role === 'etudiant') {
      await client.query(
        `INSERT INTO etudiants (utilisateur_id, niveau_etude, filiere, etablissement) VALUES ($1,$2,$3,$4)`,
        [user.id, niveauEtude || null, filiere || null, etablissement || null]
      );
    } else if (role === 'tuteur') {
      await client.query(
        `INSERT INTO tuteurs (utilisateur_id, specialites, biographie, statut) VALUES ($1,$2,$3,'PENDING')`,
        [user.id, specialites || [], biographie || null]
      );
    }

    await client.query('COMMIT');
    const token = generateToken(user);
    res.status(201).json({ message: 'Compte créé avec succès', user, token });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  } finally {
    client.release();
  }
};

// POST /api/auth/login
const login = async (req, res) => {
  try {
    const { email, motDePasse } = req.body;
    if (!email || !motDePasse) {
      return res.status(400).json({ error: 'Email et mot de passe requis' });
    }

    const result = await pool.query(
      'SELECT * FROM utilisateurs WHERE email = $1', [email]
    );
    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Identifiants invalides' });
    }

    const user = result.rows[0];

    if (user.est_bloque) {
      return res.status(403).json({ error: 'Compte bloqué. Contactez un administrateur.' });
    }

    const validPass = await bcrypt.compare(motDePasse, user.mot_de_passe);
    if (!validPass) {
      await pool.query(
        'UPDATE utilisateurs SET tentatives_connexion = tentatives_connexion + 1 WHERE id = $1',
        [user.id]
      );
      return res.status(401).json({ error: 'Identifiants invalides' });
    }

    // Check tuteur status
    if (user.role === 'tuteur') {
      const tuteurRes = await pool.query('SELECT statut FROM tuteurs WHERE utilisateur_id = $1', [user.id]);
      if (tuteurRes.rows[0]?.statut === 'PENDING') {
        return res.status(403).json({ error: 'Votre compte tuteur est en attente de validation.' });
      }
      if (tuteurRes.rows[0]?.statut === 'REJECTED') {
        return res.status(403).json({ error: 'Votre demande de tuteur a été refusée.' });
      }
    }

    await pool.query(
      'UPDATE utilisateurs SET derniere_connexion = NOW(), tentatives_connexion = 0 WHERE id = $1',
      [user.id]
    );

    const token = generateToken(user);
    const { mot_de_passe: _, ...safeUser } = user;
    res.json({ message: 'Connexion réussie', user: safeUser, token });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
};

// GET /api/auth/me
const getMe = async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT u.id, u.prenom, u.nom, u.email, u.photo_profil, u.role, u.date_inscription,
              e.niveau_etude, e.filiere, e.etablissement,
              t.specialites, t.biographie, t.note_moyenne, t.statut as statut_tuteur
       FROM utilisateurs u
       LEFT JOIN etudiants e ON u.id = e.utilisateur_id
       LEFT JOIN tuteurs t ON u.id = t.utilisateur_id
       WHERE u.id = $1`, [req.user.id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
};

// PUT /api/auth/profile
const updateProfile = async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { prenom, nom, photoProfil, niveauEtude, filiere, etablissement, specialites, biographie } = req.body;

    await client.query(
      'UPDATE utilisateurs SET prenom=$1, nom=$2, photo_profil=$3 WHERE id=$4',
      [prenom, nom, photoProfil, req.user.id]
    );

    if (req.user.role === 'etudiant') {
      await client.query(
        'UPDATE etudiants SET niveau_etude=$1, filiere=$2, etablissement=$3 WHERE utilisateur_id=$4',
        [niveauEtude, filiere, etablissement, req.user.id]
      );
    } else if (req.user.role === 'tuteur') {
      await client.query(
        'UPDATE tuteurs SET specialites=$1, biographie=$2 WHERE utilisateur_id=$3',
        [specialites, biographie, req.user.id]
      );
    }

    await client.query('COMMIT');
    res.json({ message: 'Profil mis à jour' });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: 'Erreur serveur' });
  } finally {
    client.release();
  }
};

module.exports = { register, login, getMe, updateProfile };