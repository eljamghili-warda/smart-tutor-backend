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


// ── GET /api/admin/examens ───────────────────────────────────────────────────
const getExamensAdmin = async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        e.id, e.titre, e.description, e.statut, e.note_passage,
        e.duree_minutes, e.created_at, e.published_at,
        s.nom as salle_nom,
        u.prenom as tuteur_prenom, u.nom as tuteur_nom, u.email as tuteur_email,
        COUNT(DISTINCT te.id) as nb_tentatives,
        COUNT(DISTINCT te.id) FILTER (WHERE te.statut='REUSSI') as nb_reussis,
        COUNT(DISTINCT te.id) FILTER (WHERE te.statut='ECHOUE') as nb_echoues,
        COUNT(DISTINCT te.id) FILTER (WHERE te.statut='EN_COURS') as nb_en_cours
      FROM examens e
      JOIN salles s ON e.salle_id = s.id
      JOIN utilisateurs u ON e.tuteur_id = u.id
      LEFT JOIN tentatives_examen te ON te.examen_id = e.id
      GROUP BY e.id, s.nom, u.prenom, u.nom, u.email
      ORDER BY e.created_at DESC
    `);
    res.json(result.rows);
  } catch (err) {
    console.error('getExamensAdmin error:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
};

// ── GET /api/admin/examens/:id/details ──────────────────────────────────────
const getExamenDetails = async (req, res) => {
  try {
    const { id } = req.params;
    const [examen, tentatives] = await Promise.all([
      pool.query(`
        SELECT e.*, s.nom as salle_nom,
               u.prenom as tuteur_prenom, u.nom as tuteur_nom
        FROM examens e
        JOIN salles s ON e.salle_id = s.id
        JOIN utilisateurs u ON e.tuteur_id = u.id
        WHERE e.id=$1
      `, [id]),
      pool.query(`
        SELECT te.id, te.score_obtenu, te.pourcentage, te.statut,
               te.started_at, te.submitted_at,
               u.prenom, u.nom, u.email, u.photo_profil
        FROM tentatives_examen te
        JOIN utilisateurs u ON te.etudiant_id = u.id
        WHERE te.examen_id=$1
        ORDER BY te.submitted_at DESC NULLS LAST
      `, [id]),
    ]);
    if (!examen.rows.length) return res.status(404).json({ error: 'Examen introuvable' });
    res.json({ examen: examen.rows[0], tentatives: tentatives.rows });
  } catch (err) {
    console.error('getExamenDetails error:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
};

// ── GET /api/admin/tuteurs/activite ─────────────────────────────────────────
const getTuteursActivite = async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        u.id, u.prenom, u.nom, u.email, u.photo_profil,
        t.statut, t.note_moyenne, t.specialites,
        COUNT(DISTINCT d.id) as nb_disponibilites,
        COUNT(DISTINCT s.id) as nb_seances,
        COUNT(DISTINCT s.id) FILTER (WHERE s.statut='REALISEE') as nb_realisees,
        CASE WHEN COUNT(DISTINCT d.id) > 0 THEN 'ACTIF' ELSE 'INACTIF' END as activite
      FROM utilisateurs u
      JOIN tuteurs t ON u.id = t.utilisateur_id
      LEFT JOIN disponibilites_tuteur d ON u.id = d.tuteur_id
      LEFT JOIN seances s ON u.id = s.tuteur_id
      WHERE t.statut = 'ACTIVE'
      GROUP BY u.id, u.prenom, u.nom, u.email, u.photo_profil, t.statut, t.note_moyenne, t.specialites
      ORDER BY nb_disponibilites DESC, nb_realisees DESC
    `);
    res.json(result.rows);
  } catch (err) {
    console.error('getTuteursActivite error:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
};

// ── GET /api/admin/seances/stats ─────────────────────────────────────────────
const getSeancesStats = async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        statut,
        COUNT(*) as nb,
        COALESCE(SUM(montant_total), 0) as montant
      FROM seances
      GROUP BY statut
      ORDER BY statut
    `);
    const recent = await pool.query(`
      SELECT s.id, s.titre, s.statut, s.date_debut, s.montant_total, s.statut_paiement,
             u.prenom as tuteur_prenom, u.nom as tuteur_nom,
             sa.nom as salle_nom
      FROM seances s
      LEFT JOIN utilisateurs u ON s.tuteur_id = u.id
      LEFT JOIN salles sa ON s.salle_id = sa.id
      ORDER BY s.date_debut DESC
      LIMIT 10
    `);
    res.json({ parStatut: result.rows, recentes: recent.rows });
  } catch (err) {
    console.error('getSeancesStats error:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
};

// ── GET /api/admin/revenus/details ───────────────────────────────────────────
const getRevenusDetails = async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        -- Total encaissé = tout ce qui a été payé (hors remboursements)
        COALESCE(SUM(montant_total) FILTER (WHERE statut IN ('COMPLETE','EN_ATTENTE_LIBERATION','LIBERE')), 0) as total_encaisse,

        -- En escrow = paiements en attente de libération (séance pas encore réalisée)
        COALESCE(SUM(montant_total) FILTER (WHERE statut='EN_ATTENTE_LIBERATION'), 0) as en_escrow,

        -- Commissions réalisées = 15% des séances LIBERE ou COMPLETE liées à une séance réalisée
        COALESCE(SUM(p.commission_plateforme) FILTER (WHERE p.statut IN ('LIBERE','COMPLETE')
          AND EXISTS (SELECT 1 FROM seances s WHERE s.id=p.seance_id AND s.statut='REALISEE')), 0) as commissions_realisees,

        -- Commissions en attente = 15% des paiements EN_ATTENTE_LIBERATION
        COALESCE(SUM(commission_plateforme) FILTER (WHERE statut='EN_ATTENTE_LIBERATION'), 0) as commissions_en_attente,

        -- Remboursements uniquement sur séances annulées
        COALESCE(SUM(p.montant_total) FILTER (WHERE p.statut='REMBOURSE'
          AND EXISTS (SELECT 1 FROM seances s WHERE s.id=p.seance_id AND s.statut='ANNULEE')), 0) as total_rembourse,

        -- Versé aux tuteurs = 85% des séances réalisées
        COALESCE(SUM(p.gain_tuteur) FILTER (WHERE p.statut IN ('LIBERE','COMPLETE')
          AND EXISTS (SELECT 1 FROM seances s WHERE s.id=p.seance_id AND s.statut='REALISEE')), 0) as total_verse_tuteurs,

        COUNT(*) FILTER (WHERE statut IN ('COMPLETE','EN_ATTENTE_LIBERATION','LIBERE')) as nb_paiements,
        COUNT(*) FILTER (WHERE statut='REMBOURSE') as nb_remboursements
      FROM paiements p
    `);
    res.json(result.rows[0]);
  } catch (err) {
    console.error('getRevenusDetails error:', err);
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
  getExamensAdmin,
  getExamenDetails,
  getTuteursActivite,
  getSeancesStats,
  getRevenusDetails,
};