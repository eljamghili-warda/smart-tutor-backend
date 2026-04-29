const { pool } = require('../config/db');

// GET /api/invitations - Mes invitations
const getMesInvitations = async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT i.*, 
        s.nom as salle_nom, s.type as salle_type,
        exp.prenom || ' ' || exp.nom as expediteur_nom,
        dest.prenom || ' ' || dest.nom as destinataire_nom
      FROM invitations i
      JOIN salles s ON i.salle_id = s.id
      JOIN utilisateurs exp ON i.expediteur_id = exp.id
      JOIN utilisateurs dest ON i.destinataire_id = dest.id
      WHERE (i.destinataire_id = $1 OR i.expediteur_id = $1)
        AND i.statut = 'EN_ATTENTE'
      ORDER BY i.date_envoi DESC
    `, [req.user.id]);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
};

// POST /api/invitations - Envoyer une invitation (admin salle seulement)
const sendInvitation = async (req, res) => {
  try {
    const { salleId, destinataireId, typeInvitation } = req.body;

    // Vérifier que l'expéditeur est ADMIN de la salle
    const adminCheck = await pool.query(
      `SELECT id FROM participations WHERE utilisateur_id=$1 AND salle_id=$2 AND role='ADMIN'`,
      [req.user.id, salleId]
    );
    if (!adminCheck.rows.length && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Seul l\'admin de la salle peut inviter' });
    }

    // Si invitation VERS_TUTEUR : vérifier si un tuteur existe déjà
    if (typeInvitation === 'VERS_TUTEUR') {
      const tuteurExist = await pool.query(
        `SELECT u.id FROM participations p JOIN utilisateurs u ON p.utilisateur_id = u.id
         WHERE p.salle_id=$1 AND u.role='tuteur' AND p.role='CO_ADMIN'`,
        [salleId]
      );
      if (tuteurExist.rows.length > 0 && tuteurExist.rows[0].id !== parseInt(destinataireId)) {
        // Il y a déjà un tuteur, l'invitation remplacera l'ancien
        // On continue mais on marque l'ancienne invitation comme remplacée
      }
    }

    // Vérifier si une invitation en attente existe déjà
    const existing = await pool.query(
      `SELECT id FROM invitations WHERE salle_id=$1 AND destinataire_id=$2 AND statut='EN_ATTENTE'`,
      [salleId, destinataireId]
    );
    if (existing.rows.length) {
      return res.status(409).json({ error: 'Invitation déjà envoyée' });
    }

    const result = await pool.query(
      `INSERT INTO invitations (salle_id, expediteur_id, destinataire_id, type_invitation)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [salleId, req.user.id, destinataireId, typeInvitation]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
};

// PUT /api/invitations/:id/accepter
const accepterInvitation = async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { id } = req.params;

    const invitRes = await client.query(
      `SELECT * FROM invitations WHERE id=$1 AND destinataire_id=$2 AND statut='EN_ATTENTE'`,
      [id, req.user.id]
    );
    if (!invitRes.rows.length) {
      return res.status(404).json({ error: 'Invitation introuvable ou déjà traitée' });
    }
    const invitation = invitRes.rows[0];

    // Vérifier expiration
    if (new Date() > new Date(invitation.date_expiration)) {
      await client.query(`UPDATE invitations SET statut='EXPIREE' WHERE id=$1`, [id]);
      await client.query('COMMIT');
      return res.status(400).json({ error: 'Invitation expirée' });
    }

    await client.query(
      `UPDATE invitations SET statut='ACCEPTEE', date_reponse=NOW() WHERE id=$1`, [id]
    );

    if (invitation.type_invitation === 'VERS_TUTEUR') {
      // Retirer l'ancien tuteur s'il existe
      const ancienTuteur = await client.query(
        `SELECT p.utilisateur_id FROM participations p
         JOIN utilisateurs u ON p.utilisateur_id = u.id
         WHERE p.salle_id=$1 AND u.role='tuteur' AND p.role='CO_ADMIN'`,
        [invitation.salle_id]
      );
      if (ancienTuteur.rows.length) {
        await client.query(
          `DELETE FROM participations WHERE utilisateur_id=$1 AND salle_id=$2`,
          [ancienTuteur.rows[0].utilisateur_id, invitation.salle_id]
        );
      }
      // Ajouter le nouveau tuteur comme CO_ADMIN
      await client.query(
        `INSERT INTO participations (utilisateur_id, salle_id, role) VALUES ($1, $2, 'CO_ADMIN')
         ON CONFLICT (utilisateur_id, salle_id) DO UPDATE SET role='CO_ADMIN'`,
        [req.user.id, invitation.salle_id]
      );
      await client.query(
        `UPDATE salles SET statut='ACTIVE_AVEC_TUTEUR' WHERE id=$1`, [invitation.salle_id]
      );
    } else {
      // Etudiant rejoint la salle
      await client.query(
        `INSERT INTO participations (utilisateur_id, salle_id, role) VALUES ($1, $2, 'MEMBRE')
         ON CONFLICT (utilisateur_id, salle_id) DO NOTHING`,
        [req.user.id, invitation.salle_id]
      );
    }

    await client.query('COMMIT');
    res.json({ message: 'Invitation acceptée' });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  } finally {
    client.release();
  }
};

// PUT /api/invitations/:id/refuser
const refuserInvitation = async (req, res) => {
  try {
    const result = await pool.query(
      `UPDATE invitations SET statut='REFUSEE', date_reponse=NOW()
       WHERE id=$1 AND destinataire_id=$2 AND statut='EN_ATTENTE' RETURNING *`,
      [req.params.id, req.user.id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Invitation introuvable' });
    res.json({ message: 'Invitation refusée' });
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
};

// Expirer automatiquement les invitations (cron ou appelé périodiquement)
const expireInvitations = async () => {
  await pool.query(
    `UPDATE invitations SET statut='EXPIREE' WHERE statut='EN_ATTENTE' AND date_expiration < NOW()`
  );
};

module.exports = { getMesInvitations, sendInvitation, accepterInvitation, refuserInvitation, expireInvitations };