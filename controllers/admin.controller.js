const { pool } = require('../config/db');

// GET /api/admin/stats
const getStats = async (req, res) => {
  try {
    const [users, salles, seances, tuteursPending] = await Promise.all([
      pool.query('SELECT COUNT(*) FROM utilisateurs'),
      pool.query("SELECT COUNT(*) FROM salles WHERE statut != 'FERMEE'"),
      pool.query('SELECT COUNT(*) FROM seances'),
      pool.query("SELECT COUNT(*) FROM tuteurs WHERE statut='PENDING'"),
    ]);
    res.json({
      totalUtilisateurs: parseInt(users.rows[0].count),
      sallesActives: parseInt(salles.rows[0].count),
      totalSeances: parseInt(seances.rows[0].count),
      tuteursPendingCount: parseInt(tuteursPending.rows[0].count),
    });
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
};

// GET /api/admin/utilisateurs
const getUtilisateurs = async (req, res) => {
  try {
    const { role, search } = req.query;
    let query = `
      SELECT u.id, u.prenom, u.nom, u.email, u.role, u.est_bloque, u.date_inscription,
             t.statut as statut_tuteur, t.note_moyenne, t.specialites
      FROM utilisateurs u
      LEFT JOIN tuteurs t ON u.id = t.utilisateur_id
      WHERE 1=1
    `;
    const params = [];
    if (role) { params.push(role); query += ` AND u.role=$${params.length}`; }
    if (search) { params.push(`%${search}%`); query += ` AND (u.prenom ILIKE $${params.length} OR u.nom ILIKE $${params.length} OR u.email ILIKE $${params.length})`; }
    query += ' ORDER BY u.date_inscription DESC';
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
};

// GET /api/admin/tuteurs/pending
const getTuteursPending = async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT u.id, u.prenom, u.nom, u.email, u.photo_profil, u.date_inscription,
             t.specialites, t.biographie, t.cv_url, t.statut
      FROM tuteurs t
      JOIN utilisateurs u ON t.utilisateur_id = u.id
      WHERE t.statut = 'PENDING'
      ORDER BY u.date_inscription ASC
    `);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
};

// PUT /api/admin/tuteurs/:id/valider
const validerTuteur = async (req, res) => {
  try {
    const { id } = req.params;
    const { accepte, motif } = req.body;
    const newStatut = accepte ? 'ACTIVE' : 'REJECTED';

    const result = await pool.query(
      `UPDATE tuteurs SET statut=$1 WHERE utilisateur_id=$2 RETURNING *`,
      [newStatut, id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Tuteur introuvable' });

    // TODO: envoyer notification/email au tuteur
    res.json({ message: `Tuteur ${accepte ? 'validé' : 'refusé'}`, statut: newStatut });
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
};

// PUT /api/admin/utilisateurs/:id/bloquer
const bloquerUtilisateur = async (req, res) => {
  try {
    const { id } = req.params;
    const { bloquer } = req.body;
    await pool.query(
      'UPDATE utilisateurs SET est_bloque=$1 WHERE id=$2',
      [bloquer, id]
    );
    res.json({ message: `Utilisateur ${bloquer ? 'bloqué' : 'débloqué'}` });
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
};

// DELETE /api/admin/utilisateurs/:id
const supprimerUtilisateur = async (req, res) => {
  try {
    await pool.query('DELETE FROM utilisateurs WHERE id=$1', [req.params.id]);
    res.json({ message: 'Utilisateur supprimé' });
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
};

// GET /api/admin/salles
const getSallesAdmin = async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT s.*, u.prenom || ' ' || u.nom as createur_nom,
        (SELECT COUNT(*) FROM participations WHERE salle_id = s.id) as nb_participants
      FROM salles s
      LEFT JOIN utilisateurs u ON s.createur_id = u.id
      ORDER BY s.date_creation DESC
    `);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
};

// PUT /api/admin/salles/:id/fermer
const fermerSalle = async (req, res) => {
  try {
    await pool.query(`UPDATE salles SET statut='FERMEE' WHERE id=$1`, [req.params.id]);
    res.json({ message: 'Salle fermée' });
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
};

// GET /api/admin/seances
const getSeancesAdmin = async (req, res) => {
  try {
    const { statut } = req.query;
    let query = `
      SELECT s.*, sa.nom as salle_nom, u.prenom || ' ' || u.nom as tuteur_nom
      FROM seances s
      JOIN salles sa ON s.salle_id = sa.id
      LEFT JOIN utilisateurs u ON s.tuteur_id = u.id
      WHERE 1=1
    `;
    const params = [];
    if (statut) { params.push(statut); query += ` AND s.statut=$${params.length}`; }
    query += ' ORDER BY s.date_debut DESC';
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
};

module.exports = {
  getStats, getUtilisateurs, getTuteursPending, validerTuteur,
  bloquerUtilisateur, supprimerUtilisateur, getSallesAdmin, fermerSalle, getSeancesAdmin
};