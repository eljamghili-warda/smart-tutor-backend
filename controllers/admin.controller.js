const { pool } = require('../config/db');

// ── GET /api/admin/stats ─────────────────────────────────────────────────────
// Dashboard admin : stats globales incluant les finances
const getStats = async (req, res) => {
  try {
    const [users, salles, seances, tuteursPending, finances, seancesParStatut] = await Promise.all([

      // Utilisateurs
      pool.query(`
        SELECT
          COUNT(*)                               as total,
          COUNT(*) FILTER (WHERE role='etudiant') as etudiants,
          COUNT(*) FILTER (WHERE role='tuteur')   as tuteurs,
          COUNT(*) FILTER (WHERE est_bloque=TRUE) as bloques
        FROM utilisateurs
      `),

      // Salles
      pool.query(`
        SELECT
          COUNT(*)                                              as total,
          COUNT(*) FILTER (WHERE statut != 'FERMEE')           as actives,
          COUNT(*) FILTER (WHERE statut = 'ACTIVE_AVEC_TUTEUR') as avec_tuteur,
          COUNT(*) FILTER (WHERE statut = 'FERMEE')             as fermees
        FROM salles
      `),

      // Séances
      pool.query(`
        SELECT COUNT(*) as total FROM seances
      `),

      // Tuteurs en attente de validation
      pool.query(`
        SELECT COUNT(*) as total FROM tuteurs WHERE statut='PENDING'
      `),

      // Finances
      pool.query(`
        SELECT
          COALESCE(SUM(montant_total)         FILTER (WHERE statut='COMPLETE'), 0) as total_volume,
          COALESCE(SUM(commission_plateforme) FILTER (WHERE statut='COMPLETE'), 0) as total_commissions,
          COALESCE(SUM(gain_tuteur)           FILTER (WHERE statut='COMPLETE'), 0) as total_tuteurs,
          COUNT(*)                            FILTER (WHERE statut='COMPLETE')     as nb_paiements,
          COUNT(*)                            FILTER (WHERE statut='REMBOURSE')    as nb_remboursements
        FROM paiements
      `),

      // Séances par statut
      pool.query(`
        SELECT statut, COUNT(*) as nb FROM seances GROUP BY statut
      `),

    ]);

    // Formater séances par statut en objet
    const seancesStatut = {};
    seancesParStatut.rows.forEach(r => { seancesStatut[r.statut] = parseInt(r.nb); });

    res.json({
      utilisateurs:       users.rows[0],
      salles:             salles.rows[0],
      seances: {
        total: parseInt(seances.rows[0].total),
        parStatut: seancesStatut,
      },
      tuteursPending:     parseInt(tuteursPending.rows[0].total),
      finances:           finances.rows[0],
    });
  } catch (err) {
    console.error('getStats error:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
};

// ── GET /api/admin/utilisateurs ──────────────────────────────────────────────
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
    if (role)   { params.push(role);        query += ` AND u.role=$${params.length}`; }
    if (search) { params.push(`%${search}%`); query += ` AND (u.prenom ILIKE $${params.length} OR u.nom ILIKE $${params.length} OR u.email ILIKE $${params.length})`; }
    query += ' ORDER BY u.date_inscription DESC';
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
};

// ── GET /api/admin/tuteurs/pending ───────────────────────────────────────────
// ⚠️  Cette route doit être déclarée AVANT /admin/tuteurs/:id dans routes/index.js
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

// ── PUT /api/admin/tuteurs/:id/valider ───────────────────────────────────────
const validerTuteur = async (req, res) => {
  try {
    const { id } = req.params;
    const { accepte, motif } = req.body;
    const newStatut = accepte ? 'ACTIVE' : 'REJECTED';

    const result = await pool.query(
      `UPDATE tuteurs SET statut=$1 WHERE utilisateur_id=$2 RETURNING *`,
      [newStatut, id]
    );
    if (!result.rows.length)
      return res.status(404).json({ error: 'Tuteur introuvable' });

    res.json({ message: `Tuteur ${accepte ? 'validé ✅' : 'refusé ❌'}`, statut: newStatut, motif });
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
};

// ── PUT /api/admin/utilisateurs/:id/bloquer ──────────────────────────────────
const bloquerUtilisateur = async (req, res) => {
  try {
    const { bloquer } = req.body;
    await pool.query('UPDATE utilisateurs SET est_bloque=$1 WHERE id=$2', [bloquer, req.params.id]);
    res.json({ message: `Utilisateur ${bloquer ? 'bloqué' : 'débloqué'}` });
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
};

// ── DELETE /api/admin/utilisateurs/:id ──────────────────────────────────────
const supprimerUtilisateur = async (req, res) => {
  try {
    await pool.query('DELETE FROM utilisateurs WHERE id=$1', [req.params.id]);
    res.json({ message: 'Utilisateur supprimé' });
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
};

// ── GET /api/admin/salles ────────────────────────────────────────────────────
const getSallesAdmin = async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT s.*,
             u.prenom || ' ' || u.nom as createur_nom,
             (SELECT COUNT(*) FROM participations WHERE salle_id=s.id) as nb_participants,
             (SELECT COUNT(*) FROM seances WHERE salle_id=s.id AND statut='REALISEE') as nb_seances_realisees
      FROM salles s
      LEFT JOIN utilisateurs u ON s.createur_id = u.id
      ORDER BY s.date_creation DESC
    `);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
};

// ── PUT /api/admin/salles/:id/fermer ─────────────────────────────────────────
const fermerSalle = async (req, res) => {
  try {
    await pool.query(`UPDATE salles SET statut='FERMEE' WHERE id=$1`, [req.params.id]);
    res.json({ message: 'Salle fermée' });
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
};

// ── GET /api/admin/seances ───────────────────────────────────────────────────
const getSeancesAdmin = async (req, res) => {
  try {
    const { statut } = req.query;
    let query = `
      SELECT s.*,
             sa.nom as salle_nom,
             u.prenom || ' ' || u.nom as tuteur_nom,
             p.montant_total as montant_paye,
             p.methode       as methode_paiement,
             p.reference     as paiement_reference
      FROM seances s
      JOIN salles sa ON s.salle_id = sa.id
      LEFT JOIN utilisateurs u ON s.tuteur_id = u.id
      LEFT JOIN paiements p ON p.seance_id = s.id AND p.statut = 'COMPLETE'
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
  getStats,
  getUtilisateurs,
  getTuteursPending,
  validerTuteur,
  bloquerUtilisateur,
  supprimerUtilisateur,
  getSallesAdmin,
  fermerSalle,
  getSeancesAdmin,
};