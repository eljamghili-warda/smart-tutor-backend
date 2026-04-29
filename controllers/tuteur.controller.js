const { pool } = require('../config/db');

// GET /api/tuteurs - Liste des tuteurs actifs
const getTuteurs = async (req, res) => {
  try {
    const { search, specialite } = req.query;
    let query = `
      SELECT u.id, u.prenom, u.nom, u.email, u.photo_profil,
             t.specialites, t.biographie, t.note_moyenne, t.statut
      FROM utilisateurs u
      JOIN tuteurs t ON u.id = t.utilisateur_id
      WHERE t.statut = 'ACTIVE' AND u.est_bloque = FALSE
    `;
    const params = [];
    if (search) {
      params.push(`%${search}%`);
      query += ` AND (u.prenom ILIKE $${params.length} OR u.nom ILIKE $${params.length} OR t.biographie ILIKE $${params.length})`;
    }
    if (specialite) {
      params.push(specialite);
      query += ` AND $${params.length} = ANY(t.specialites)`;
    }
    query += ' ORDER BY t.note_moyenne DESC';
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
};

// GET /api/tuteurs/:id
const getTuteur = async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT u.id, u.prenom, u.nom, u.email, u.photo_profil, u.date_inscription,
             t.specialites, t.biographie, t.cv_url, t.note_moyenne, t.statut
      FROM utilisateurs u
      JOIN tuteurs t ON u.id = t.utilisateur_id
      WHERE u.id=$1
    `, [req.params.id]);
    if (!result.rows.length) return res.status(404).json({ error: 'Tuteur introuvable' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
};

module.exports = { getTuteurs, getTuteur };