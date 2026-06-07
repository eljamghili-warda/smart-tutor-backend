const { pool } = require('../config/db');
const { libererFonds } = require('./paiement.controller');
const emailService = require('../services/email.service');

// ── GET /api/seances?salleId=&tuteurId= ──────────────────────────────────────
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

// ── GET /api/seances/emploi-du-temps ────────────────────────────────────────
const getEmploiDuTemps = async (req, res) => {
  try {
    const { debut, fin } = req.query;

    // ── 1. Séances ────────────────────────────────────────────────────────────
    const seancesRes = await pool.query(`
      SELECT s.*, sa.nom as salle_nom, u.prenom || ' ' || u.nom as tuteur_nom,
             'seance' as type_evenement
      FROM seances s
      JOIN salles sa ON s.salle_id = sa.id
      LEFT JOIN utilisateurs u ON s.tuteur_id = u.id
      WHERE s.salle_id IN (
        SELECT salle_id FROM participations WHERE utilisateur_id=$1
      )
      AND s.statut IN ('EN_ATTENTE_PAIEMENT','PLANIFIEE','CONFIRMEE','EN_COURS','REALISEE','ANNULEE')
      AND ($2::timestamp IS NULL OR s.date_debut >= $2::timestamp)
      AND ($3::timestamp IS NULL OR s.date_debut <= $3::timestamp)
      ORDER BY s.date_debut
    `, [req.user.id, debut || null, fin || null]);

    // ── 2. Examens publiés des salles où l'user est membre ───────────────────
    const examensRes = await pool.query(`
      SELECT e.id, e.titre, e.date_debut, e.date_limite as date_fin,
             e.duree_minutes as duree, e.statut,
             sa.nom as salle_nom,
             u.prenom || ' ' || u.nom as tuteur_nom,
             e.salle_id,
             'examen' as type_evenement
      FROM examens e
      JOIN salles sa ON e.salle_id = sa.id
      JOIN utilisateurs u ON e.tuteur_id = u.id
      WHERE e.salle_id IN (
        SELECT salle_id FROM participations WHERE utilisateur_id=$1
      )
      AND e.statut IN ('PUBLIE','ARCHIVE')
      AND e.date_debut IS NOT NULL
      AND ($2::timestamp IS NULL OR e.date_debut >= $2::timestamp)
      AND ($3::timestamp IS NULL OR e.date_debut <= $3::timestamp)
      ORDER BY e.date_debut
    `, [req.user.id, debut || null, fin || null]);

    res.json({
      seances: seancesRes.rows,
      examens: examensRes.rows,
    });
  } catch (err) {
    console.error('getEmploiDuTemps error:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
};

// ── GET /api/seances/creneaux?tuteurId=X&duree=60 ────────────────────────────
// Retourne les créneaux libres sur 14 jours
// = disponibilités tuteur MOINS les séances déjà réservées
const getCreneauxDisponibles = async (req, res) => {
  try {
    const { tuteurId, duree = 60 } = req.query;
    if (!tuteurId) return res.status(400).json({ error: 'tuteurId requis' });

    const dureeMin = parseInt(duree);
    if (isNaN(dureeMin) || dureeMin < 30 || dureeMin > 480)
      return res.status(400).json({ error: 'duree invalide (30–480 min)' });

    // 1. Plages de disponibilité du tuteur
    const dispos = await pool.query(
      `SELECT jour_semaine, heure_debut, heure_fin
       FROM disponibilites_tuteur WHERE tuteur_id=$1
       ORDER BY jour_semaine, heure_debut`,
      [tuteurId]
    );

    if (!dispos.rows.length)
      return res.json({ creneaux: [], message: "Ce tuteur n'a pas encore défini ses disponibilités" });

    // 2. Séances déjà réservées sur 14 jours (bloquent des créneaux)
    const seancesExistantes = await pool.query(
      `SELECT date_debut, duree FROM seances
       WHERE tuteur_id=$1
         AND statut IN ('EN_ATTENTE_PAIEMENT','PLANIFIEE','CONFIRMEE','EN_COURS')
         AND date_debut BETWEEN NOW() AND NOW() + INTERVAL '14 days'`,
      [tuteurId]
    );

    // 3. Générer les créneaux libres jour par jour
    const creneaux = [];
    const maintenant = new Date();

    for (let i = 0; i < 14; i++) {
      const jour = new Date(maintenant);
      jour.setDate(maintenant.getDate() + i);
      jour.setHours(0, 0, 0, 0);

      // ISO: 1=Lundi ... 7=Dimanche
      const jourISO = jour.getDay() === 0 ? 7 : jour.getDay();
      const disposJour = dispos.rows.filter(d => d.jour_semaine === jourISO);

      for (const dispo of disposJour) {
        const [hDebut, mDebut] = dispo.heure_debut.split(':').map(Number);
        const [hFin,   mFin  ] = dispo.heure_fin.split(':').map(Number);

        let cursor = new Date(jour);
        cursor.setHours(hDebut, mDebut, 0, 0);
        const finDispo = new Date(jour);
        finDispo.setHours(hFin, mFin, 0, 0);

        while (new Date(cursor.getTime() + dureeMin * 60_000) <= finDispo) {
          const debut = new Date(cursor);
          const fin   = new Date(cursor.getTime() + dureeMin * 60_000);

          // Ignorer les créneaux passés
          if (debut <= new Date(maintenant.getTime() + 15 * 60_000)) {
            cursor.setMinutes(cursor.getMinutes() + dureeMin);
            continue;
          }

          // Vérifier collision
          const conflit = seancesExistantes.rows.some(s => {
            const sd = new Date(s.date_debut);
            const sf = new Date(sd.getTime() + s.duree * 60_000);
            return debut < sf && fin > sd;
          });

          if (!conflit) {
            creneaux.push({
              date_debut: debut.toISOString(),
              date_fin:   fin.toISOString(),
              duree:      dureeMin,
              jour:       jour.toISOString().split('T')[0],
              disponible: true,
            });
          }
          cursor.setMinutes(cursor.getMinutes() + dureeMin);
        }
      }
    }

    res.json({ creneaux, total: creneaux.length });
  } catch (err) {
    console.error('getCreneauxDisponibles error:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
};

// ── POST /api/seances ─────────────────────────────────────────────────────────
// ÉTAPE 5 du workflow : tuteur planifie une séance
// → créée en EN_ATTENTE_PAIEMENT avec montant calculé automatiquement
// → l'admin salle doit ensuite payer pour confirmer
const createSeance = async (req, res) => {
  try {
    const { salleId, titre, description, matiere, dateDebut, duree } = req.body;

    if (!salleId || !titre || !dateDebut || !duree)
      return res.status(400).json({ error: 'Champs obligatoires manquants' });

    // Vérifier que le demandeur est tuteur CO_ADMIN dans la salle
    const check = await pool.query(
      `SELECT id FROM participations WHERE utilisateur_id=$1 AND salle_id=$2 AND role='CO_ADMIN'`,
      [req.user.id, salleId]
    );
    if (!check.rows.length)
      return res.status(403).json({ error: 'Seul le tuteur de la salle peut planifier une séance' });

    // Vérifier que le créneau est dans les disponibilités du tuteur
    const dateObj  = new Date(dateDebut);
    const jourISO  = dateObj.getDay() === 0 ? 7 : dateObj.getDay();
    const heureStr = dateObj.toTimeString().slice(0, 5);
    const finStr   = new Date(dateObj.getTime() + parseInt(duree) * 60_000).toTimeString().slice(0, 5);

    const dispoCheck = await pool.query(
      `SELECT id FROM disponibilites_tuteur
       WHERE tuteur_id=$1 AND jour_semaine=$2
         AND heure_debut <= $3::time AND heure_fin >= $4::time`,
      [req.user.id, jourISO, heureStr, finStr]
    );
    if (!dispoCheck.rows.length)
      return res.status(400).json({ error: "Ce créneau n'est pas dans vos disponibilités" });

    // Vérifier conflit de planning (EN_ATTENTE_PAIEMENT et CONFIRMEE bloquent aussi)
    const conflict = await pool.query(`
      SELECT id FROM seances
      WHERE tuteur_id=$1
        AND statut IN ('EN_ATTENTE_PAIEMENT','PLANIFIEE','CONFIRMEE','EN_COURS')
        AND $2::timestamp < date_debut + ($3 * interval '1 minute')
        AND $2::timestamp + ($3 * interval '1 minute') > date_debut
    `, [req.user.id, dateDebut, duree]);
    if (conflict.rows.length)
      return res.status(409).json({ error: 'Conflit de planning : vous avez déjà une séance à ce créneau' });

    // Calcul automatique du montant = tarif/h × (durée/60)
    let montantTotal = 0;
    if (matiere) {
      const tarifRes = await pool.query(
        `SELECT tarif_heure FROM tuteur_tarifs WHERE tuteur_id=$1 AND matiere=$2`,
        [req.user.id, matiere]
      );
      if (tarifRes.rows.length) {
        montantTotal = parseFloat(
          (parseFloat(tarifRes.rows[0].tarif_heure) * (parseInt(duree) / 60)).toFixed(2)
        );
      }
    }

    // ✅ STATUT INITIAL : EN_ATTENTE_PAIEMENT (pas PLANIFIEE)
    const result = await pool.query(
      `INSERT INTO seances
         (salle_id, tuteur_id, titre, description, matiere, date_debut, duree,
          statut, statut_paiement, montant_total)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'EN_ATTENTE_PAIEMENT','EN_ATTENTE',$8)
       RETURNING *`,
      [salleId, req.user.id, titre, description, matiere, dateDebut, duree, montantTotal]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('createSeance error:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
};

// ── PUT /api/seances/:id/annuler ──────────────────────────────────────────────
// ÉTAPE 10 du workflow : tuteur annule une séance
// Si déjà payée (PLANIFIEE avec statut_paiement=PAYE) → remboursement automatique
const annulerSeance = async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const seanceRes = await client.query(
      `SELECT s.*,
              sa.nom as salle_nom,
              p.id            as paiement_id,
              p.montant_total as montant_paye,
              p.reference     as paiement_ref,
              pay.email  as payeur_email,
              pay.prenom as payeur_prenom,
              pay.nom    as payeur_nom
       FROM seances s
       JOIN salles sa ON s.salle_id = sa.id
       LEFT JOIN paiements p   ON p.seance_id = s.id AND p.statut = 'COMPLETE'
       LEFT JOIN utilisateurs pay ON pay.id = p.payeur_id
       WHERE s.id=$1 AND s.tuteur_id=$2`,
      [req.params.id, req.user.id]
    );

    if (!seanceRes.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Séance introuvable ou non autorisée' });
    }

    const seance = seanceRes.rows[0];

    if (!['EN_ATTENTE_PAIEMENT', 'PLANIFIEE', 'CONFIRMEE'].includes(seance.statut)) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: `Impossible d'annuler une séance en statut : ${seance.statut}` });
    }

    // Annuler la séance
    await client.query(`UPDATE seances SET statut='ANNULEE' WHERE id=$1`, [req.params.id]);

    let remboursement = false;

    // Si payée (PLANIFIEE + statut_paiement=PAYE) → rembourser automatiquement
    if (seance.paiement_id && ['PAYE','EN_ATTENTE_LIBERATION'].includes(seance.statut_paiement)) {
      await client.query(
        `UPDATE paiements SET statut='REMBOURSE', date_remboursement=NOW() WHERE id=$1`,
        [seance.paiement_id]
      );
      await client.query(
        `UPDATE seances SET statut_paiement='REMBOURSE' WHERE id=$1`,
        [req.params.id]
      );
      remboursement = true;

      // Email remboursement au payeur (admin salle)
      if (seance.payeur_email) {
        emailService.sendConfirmationRemboursement({
          to:  seance.payeur_email,
          nom: `${seance.payeur_prenom} ${seance.payeur_nom}`,
          seance:   { titre: seance.titre, date_debut: seance.date_debut },
          paiement: { montant_total: seance.montant_paye, reference: seance.paiement_ref },
        }).catch(console.error);
      }
    }

    await client.query('COMMIT');

    res.json({
      message:       remboursement
        ? 'Séance annulée — remboursement initié automatiquement'
        : 'Séance annulée — créneau libéré',
      remboursement,
      montant:       remboursement ? seance.montant_paye : 0,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('annulerSeance error:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  } finally {
    client.release();
  }
};

// ── GET /api/seances/disponibilites ──────────────────────────────────────────
const getDisponibilites = async (req, res) => {
  try {
    const { tuteurId } = req.query;
    const result = await pool.query(
      `SELECT * FROM disponibilites_tuteur WHERE tuteur_id=$1 ORDER BY date_specifique NULLS LAST, heure_debut`,
      [tuteurId || req.user.id]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
};

// ── POST /api/seances/disponibilites ─────────────────────────────────────────
const setDisponibilite = async (req, res) => {
  try {
    const { dateSpecifique, heureDebut, heureFin } = req.body;

    if (!dateSpecifique || !heureDebut || !heureFin)
      return res.status(400).json({ error: 'dateSpecifique, heureDebut et heureFin sont requis.' });
    if (heureDebut >= heureFin)
      return res.status(400).json({ error: "L'heure de fin doit être après l'heure de début." });

    // Calculer jour_semaine depuis la date (1=Lundi ... 7=Dimanche)
    const [y, m, d] = dateSpecifique.split('-').map(Number);
    const dateObj   = new Date(y, m - 1, d);
    const jourSemaine = dateObj.getDay() === 0 ? 7 : dateObj.getDay();

    // Vérifier chevauchement sur EXACTEMENT la même date
    const overlap = await pool.query(
      `SELECT id FROM disponibilites_tuteur
       WHERE tuteur_id = $1
         AND date_specifique = $2
         AND heure_debut < $4
         AND heure_fin   > $3`,
      [req.user.id, dateSpecifique, heureDebut, heureFin]
    );
    if (overlap.rows.length)
      return res.status(400).json({ error: 'Chevauchement avec une plage existante sur cette date.' });

    // Ajouter la colonne date_specifique si elle n'existe pas encore
    await pool.query(`
      ALTER TABLE disponibilites_tuteur
        ADD COLUMN IF NOT EXISTS date_specifique DATE
    `).catch(() => {});

    const result = await pool.query(
      `INSERT INTO disponibilites_tuteur
         (tuteur_id, date_specifique, jour_semaine, heure_debut, heure_fin)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [req.user.id, dateSpecifique, jourSemaine, heureDebut, heureFin]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('setDisponibilite error:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
};

// ── DELETE /api/seances/disponibilites/:id ───────────────────────────────────
const deleteDisponibilite = async (req, res) => {
  try {
    const result = await pool.query(
      `DELETE FROM disponibilites_tuteur WHERE id=$1 AND tuteur_id=$2 RETURNING id`,
      [req.params.id, req.user.id]
    );
    if (!result.rows.length)
      return res.status(404).json({ error: 'Disponibilité introuvable' });
    res.json({ message: 'Disponibilité supprimée' });
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
};

// ── CRON : annuler les séances EN_ATTENTE_PAIEMENT après 24h sans paiement ──
// ÉTAPE 7 du workflow : délai dépassé → ANNULEE + notif participants
const annulerSeancesNonPayees = async () => {
  try {
    const result = await pool.query(
      `UPDATE seances
       SET statut = 'ANNULEE'
       WHERE statut = 'EN_ATTENTE_PAIEMENT'
         AND statut_paiement = 'EN_ATTENTE'
         AND NOT EXISTS (
           SELECT 1 FROM paiements WHERE seance_id = seances.id AND statut = 'COMPLETE'
         )
         AND NOW() > date_debut - INTERVAL '23 hours'
       RETURNING id, titre, salle_id, tuteur_id, date_debut`
    );
    if (result.rows.length > 0)
      console.log(`🕐 Non-paiement : ${result.rows.length} séance(s) annulée(s) automatiquement`);
  } catch (err) {
    console.error('annulerSeancesNonPayees error:', err);
  }
};

// ── CRON : règle des 5 minutes (appel vidéo) ─────────────────────────────────
// ÉTAPE 8 → EN_COURS quand appel lancé
// ÉTAPE 9 → REALISEE si appel terminé dans la fenêtre, ANNULEE si trop tôt
const FENETRE_MINUTES = 15;

const verifierSeancesExpirees = async () => {
  try {
    // 1. Séances PLANIFIEE sans appel lancé 15 min après le début → ANNULEE + remboursement
    const annulees = await pool.query(
      `UPDATE seances SET statut='ANNULEE'
       WHERE statut='PLANIFIEE'
         AND session_appel_id IS NULL
         AND NOW() > date_debut + INTERVAL '15 minutes'
       RETURNING id, titre, salle_id, tuteur_id, date_debut, statut_paiement`
    );

    for (const seance of annulees.rows) {
      console.log(`🔄 Séance ${seance.id} "${seance.titre}" non lancée +15min → ANNULEE`);

      // Si la séance était payée → rembourser automatiquement + email
      if (['PAYE', 'EN_ATTENTE_LIBERATION'].includes(seance.statut_paiement)) {
        try {
          const paiementRes = await pool.query(
            `SELECT p.id, p.montant_total, p.reference,
                    u.email as payeur_email, u.prenom as payeur_prenom, u.nom as payeur_nom
             FROM paiements p
             JOIN utilisateurs u ON p.payeur_id = u.id
             WHERE p.seance_id=$1 AND p.statut IN ('COMPLETE','EN_ATTENTE_LIBERATION')
             LIMIT 1`,
            [seance.id]
          );
          if (paiementRes.rows.length) {
            const p = paiementRes.rows[0];
            await pool.query(
              `UPDATE paiements SET statut='REMBOURSE', date_remboursement=NOW() WHERE id=$1`, [p.id]
            );
            await pool.query(
              `UPDATE seances SET statut_paiement='REMBOURSE' WHERE id=$1`, [seance.id]
            );
            emailService.sendConfirmationRemboursement({
              to:  p.payeur_email,
              nom: `${p.payeur_prenom} ${p.payeur_nom}`,
              seance:   { titre: seance.titre, date_debut: seance.date_debut },
              paiement: { montant_total: p.montant_total, reference: p.reference },
            }).catch(console.error);
            console.log(`💸 Remboursement automatique déclenché pour séance ${seance.id}`);
          }
        } catch (refundErr) {
          console.error(`Erreur remboursement auto séance ${seance.id}:`, refundErr);
        }
      }
    }

    // 2. Séances EN_COURS dont l'appel est terminé → REALISEE ou ANNULEE
    const sesTerminees = await pool.query(
      `SELECT s.id AS seance_id, s.date_debut, s.duree, sa.date_fin
       FROM seances s
       JOIN sessions_appel sa ON s.session_appel_id = sa.id
       WHERE s.statut = 'EN_COURS'
         AND sa.actif = FALSE AND sa.date_fin IS NOT NULL`
    );

    for (const row of sesTerminees.rows) {
      const dateFinPrevue  = new Date(new Date(row.date_debut).getTime() + row.duree * 60_000);
      const dateFinAppel   = new Date(row.date_fin);
      const termineTropTot = dateFinAppel < new Date(dateFinPrevue.getTime() - FENETRE_MINUTES * 60_000);
      const statut         = termineTropTot ? 'ANNULEE' : 'REALISEE';

      await pool.query(
        `UPDATE seances SET statut=$1 WHERE id=$2 AND statut='EN_COURS'`,
        [statut, row.seance_id]
      );
      console.log(`${termineTropTot ? '⚠️' : '✅'} Séance ${row.seance_id} → ${statut}`);

      if (statut === 'REALISEE') {
        libererFonds(row.seance_id).catch(console.error);
      }
    }
  } catch (err) {
    console.error('verifierSeancesExpirees error:', err);
  }
};

module.exports = {
  getSeances,
  getEmploiDuTemps,
  getCreneauxDisponibles,
  createSeance,
  annulerSeance,
  getDisponibilites,
  setDisponibilite,
  deleteDisponibilite,
  annulerSeancesNonPayees,
  verifierSeancesExpirees,
};