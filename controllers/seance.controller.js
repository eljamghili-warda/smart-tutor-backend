const { pool } = require('../config/db');
const { v4: uuidv4 } = require('uuid');

// GET /api/seances?salleId=&tuteurId=
const getSeances = async (req, res) => {
  try {
    const { salleId, tuteurId } = req.query;
    let query = `
      SELECT s.*, 
        sa.nom as salle_nom,
        u.prenom || ' ' || u.nom as tuteur_nom
      FROM seances s
      JOIN salles sa ON s.salle_id = sa.id
      LEFT JOIN utilisateurs u ON s.tuteur_id = u.id
      WHERE 1=1
    `;
    const params = [];
    if (salleId) { params.push(salleId); query += ` AND s.salle_id=$${params.length}`; }
    if (tuteurId) { params.push(tuteurId); query += ` AND s.tuteur_id=$${params.length}`; }
    query += ' ORDER BY s.date_debut ASC';

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
};

// GET /api/seances/emploi-du-temps - Vue hebdomadaire
const getEmploiDuTemps = async (req, res) => {
  try {
    const { debut, fin } = req.query;
    // Récupérer toutes les séances des salles où l'utilisateur est membre
    const result = await pool.query(`
      SELECT s.*, sa.nom as salle_nom, u.prenom || ' ' || u.nom as tuteur_nom
      FROM seances s
      JOIN salles sa ON s.salle_id = sa.id
      LEFT JOIN utilisateurs u ON s.tuteur_id = u.id
      WHERE s.salle_id IN (
        SELECT salle_id FROM participations WHERE utilisateur_id=$1
      )
      AND s.statut IN ('PLANIFIEE','EN_COURS','REALISEE','ANNULEE')
      AND ($2::timestamp IS NULL OR s.date_debut >= $2::timestamp)
      AND ($3::timestamp IS NULL OR s.date_debut <= $3::timestamp)
      ORDER BY s.date_debut
    `, [req.user.id, debut || null, fin || null]);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
};

// POST /api/seances - Planifier une séance (tuteur only)
const createSeance = async (req, res) => {
  try {
    const { salleId, titre, description, matiere, dateDebut, duree } = req.body;
    if (!salleId || !titre || !dateDebut || !duree) {
      return res.status(400).json({ error: 'Champs obligatoires manquants' });
    }

    // Vérifier que l'utilisateur est tuteur CO_ADMIN dans la salle
    const check = await pool.query(
      `SELECT id FROM participations WHERE utilisateur_id=$1 AND salle_id=$2 AND role='CO_ADMIN'`,
      [req.user.id, salleId]
    );
    if (!check.rows.length) {
      return res.status(403).json({ error: 'Seul le tuteur de la salle peut planifier une séance' });
    }

    // Vérifier conflits de l'utilisateur tuteur
    const conflict = await pool.query(`
      SELECT id FROM seances
      WHERE tuteur_id=$1 AND statut IN ('PLANIFIEE','EN_COURS')
        AND daterange(date_debut::date, (date_debut + duree * interval '1 minute')::date, '[]')
           && daterange($2::date, ($2::timestamp + $3 * interval '1 minute')::date, '[]')
    `, [req.user.id, dateDebut, duree]);
    // Simple overlap check via timestamps
    const conflictSimple = await pool.query(`
      SELECT id FROM seances
      WHERE tuteur_id=$1 AND statut IN ('PLANIFIEE','EN_COURS')
        AND $2::timestamp < date_debut + ($3 * interval '1 minute')
        AND $2::timestamp + ($3 * interval '1 minute') > date_debut
    `, [req.user.id, dateDebut, duree]);

    if (conflictSimple.rows.length) {
      return res.status(409).json({ error: 'Conflit de planning: vous avez déjà une séance à ce créneau' });
    }

    const result = await pool.query(
      `INSERT INTO seances (salle_id, tuteur_id, titre, description, matiere, date_debut, duree)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [salleId, req.user.id, titre, description, matiere, dateDebut, duree]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
};

// POST /api/seances/:id/lancer - Lancer l'appel (tuteur)
const lancerSeance = async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { id } = req.params;

    const seanceRes = await client.query(
      `SELECT * FROM seances WHERE id=$1 AND tuteur_id=$2 AND statut='PLANIFIEE'`,
      [id, req.user.id]
    );
    if (!seanceRes.rows.length) {
      return res.status(404).json({ error: 'Séance introuvable ou déjà lancée' });
    }
    const seance = seanceRes.rows[0];

    // Créer la session appel
    const sessionId = uuidv4();
    await client.query(
      `INSERT INTO sessions_appel (id, salle_id, seance_id, initiateur_id)
       VALUES ($1,$2,$3,$4)`,
      [sessionId, seance.salle_id, seance.id, req.user.id]
    );

    // Lier la séance à la session et changer son statut
    await client.query(
      `UPDATE seances SET statut='EN_COURS', session_appel_id=$1 WHERE id=$2`,
      [sessionId, id]
    );

    await client.query('COMMIT');
    res.json({ message: 'Séance lancée', sessionId, seanceId: id });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  } finally {
    client.release();
  }
};

// POST /api/seances/:id/terminer - Terminer l'appel (tuteur)
const terminerSeance = async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { id } = req.params;

    const seanceRes = await client.query(
      `SELECT * FROM seances WHERE id=$1 AND tuteur_id=$2 AND statut='EN_COURS'`,
      [id, req.user.id]
    );
    if (!seanceRes.rows.length) {
      return res.status(404).json({ error: 'Séance introuvable ou non en cours' });
    }
    const seance = seanceRes.rows[0];

    // Terminer la session d'appel
    if (seance.session_appel_id) {
      await client.query(
        `UPDATE sessions_appel SET actif=FALSE, date_fin=NOW() WHERE id=$1`,
        [seance.session_appel_id]
      );
    }

    // Mettre à jour le statut de la séance
    await client.query(
      `UPDATE seances SET statut='REALISEE' WHERE id=$1`, [id]
    );

    await client.query('COMMIT');
    res.json({ message: 'Séance terminée', seanceId: id });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: 'Erreur serveur' });
  } finally {
    client.release();
  }
};

// PUT /api/seances/:id/annuler
const annulerSeance = async (req, res) => {
  try {
    const result = await pool.query(
      `UPDATE seances SET statut='ANNULEE' WHERE id=$1 AND tuteur_id=$2 AND statut='PLANIFIEE' RETURNING *`,
      [req.params.id, req.user.id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Séance introuvable' });
    res.json({ message: 'Séance annulée' });
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
};

// GET /api/seances/disponibilites?tuteurId=&date=
const getDisponibilites = async (req, res) => {
  try {
    const { tuteurId, date } = req.query;
    const result = await pool.query(
      `SELECT * FROM disponibilites_tuteur WHERE tuteur_id=$1 ORDER BY jour_semaine, heure_debut`,
      [tuteurId]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
};

// POST /api/seances/disponibilites
const setDisponibilite = async (req, res) => {
  try {
    const { jourSemaine, heureDebut, heureFin } = req.body;
    const result = await pool.query(
      `INSERT INTO disponibilites_tuteur (tuteur_id, jour_semaine, heure_debut, heure_fin)
       VALUES ($1,$2,$3,$4) RETURNING *`,
      [req.user.id, jourSemaine, heureDebut, heureFin]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
};


// ─── CRON: vérifier et annuler automatiquement les séances non lancées ─────
// Règle : si date_debut + duree est dépassée ET aucun appel lancé => ANNULEE
const verifierSeancesExpirees = async () => {
  try {
    const result = await pool.query(`
      UPDATE seances
      SET statut = 'ANNULEE'
      WHERE statut = 'PLANIFIEE'
        AND (date_debut + (duree * interval '1 minute')) < NOW()
        AND session_appel_id IS NULL
      RETURNING id, titre, salle_id
    `);
    if (result.rows.length > 0) {
      console.log(`🔄 Auto-annulation: ${result.rows.length} séance(s) annulée(s) (non lancées)`);
    }
  } catch (err) {
    console.error('verifierSeancesExpirees error:', err);
  }
};

module.exports = {
  getSeances, getEmploiDuTemps, createSeance,
  lancerSeance, terminerSeance, annulerSeance,
  getDisponibilites, setDisponibilite,
  verifierSeancesExpirees
};