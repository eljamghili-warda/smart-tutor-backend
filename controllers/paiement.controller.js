const { pool } = require('../config/db');
const { v4: uuidv4 } = require('uuid');
const emailService = require('../services/email.service');

const COMMISSION_TAUX = parseFloat(process.env.COMMISSION_TAUX || '0.15');

const genReference = () => {
  const ts  = Date.now().toString(36).toUpperCase();
  const uid = uuidv4().split('-')[0].toUpperCase();
  return `ST-${ts}-${uid}`;
};

// ── GET /api/paiements/seance/:seanceId ──────────────────────────────────────
// ÉTAPE 6 : l'admin salle ouvre la page de paiement
// Retourne : détails séance + montant calculé + tuteur
const getPaiementSeance = async (req, res) => {
  try {
    const { seanceId } = req.params;

    const seanceRes = await pool.query(
      `SELECT s.*,
              sa.nom   as salle_nom,
              u.prenom as tuteur_prenom,
              u.nom    as tuteur_nom,
              u.email  as tuteur_email,
              t.rib         as tuteur_rib,
              t.nom_banque  as tuteur_nom_banque
       FROM seances s
       JOIN salles sa ON s.salle_id = sa.id
       LEFT JOIN utilisateurs u ON s.tuteur_id = u.id
       LEFT JOIN tuteurs t ON u.id = t.utilisateur_id
       WHERE s.id=$1`,
      [seanceId]
    );
    if (!seanceRes.rows.length)
      return res.status(404).json({ error: 'Séance introuvable' });

    const s = seanceRes.rows[0];

    // Vérifier que l'utilisateur est membre de la salle
    const partRes = await pool.query(
      `SELECT role FROM participations WHERE utilisateur_id=$1 AND salle_id=$2`,
      [req.user.id, s.salle_id]
    );
    if (!partRes.rows.length)
      return res.status(403).json({ error: 'Non autorisé' });

    // Récupérer le tarif du tuteur pour cette matière
    let tarifHeure = 0;
    if (s.tuteur_id && s.matiere) {
      const tarifRes = await pool.query(
        `SELECT tarif_heure FROM tuteur_tarifs WHERE tuteur_id=$1 AND matiere=$2`,
        [s.tuteur_id, s.matiere]
      );
      tarifHeure = parseFloat(tarifRes.rows[0]?.tarif_heure || 0);
    }

    const dureeHeures  = s.duree / 60;
    const montantTotal = parseFloat((tarifHeure * dureeHeures).toFixed(2));
    const gainTuteur   = parseFloat((montantTotal * (1 - COMMISSION_TAUX)).toFixed(2));
    const commission   = parseFloat((montantTotal * COMMISSION_TAUX).toFixed(2));

    // Paiement existant ?
    const paiementExistant = await pool.query(
      `SELECT * FROM paiements WHERE seance_id=$1 LIMIT 1`, [seanceId]
    );

    res.json({
      seance:    s,
      tarif:     { tarifHeure, dureeHeures, montantTotal, gainTuteur, commission, commissionTaux: COMMISSION_TAUX },
      paiement:  paiementExistant.rows[0] || null,
      roleSalle: partRes.rows[0].role,
    });
  } catch (err) {
    console.error('getPaiementSeance error:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
};

// ── POST /api/paiements ───────────────────────────────────────────────────────
// ÉTAPE 6 du workflow : l'admin salle paie la séance
// Avant : séance EN_ATTENTE_PAIEMENT
// Après : séance PLANIFIEE (payée, prête) + emails automatiques tuteur + admin salle
const payerSeance = async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { seanceId, methode, donneesCartePartielle } = req.body;

    if (!seanceId || !methode)
      return res.status(400).json({ error: 'seanceId et methode sont requis' });

    if (!['CIH', 'ATTIJARIWAFA', 'PAYPAL'].includes(methode))
      return res.status(400).json({ error: 'Méthode invalide. Choisir : CIH, ATTIJARIWAFA, PAYPAL' });

    // Récupérer la séance avec infos tuteur et salle
    const seanceRes = await client.query(
      `SELECT s.*,
              sa.nom   as salle_nom,
              sa.id    as salle_id,
              u.prenom as tuteur_prenom,
              u.nom    as tuteur_nom,
              u.email  as tuteur_email,
              t.rib         as tuteur_rib,
              t.nom_banque  as tuteur_nom_banque
       FROM seances s
       JOIN salles sa ON s.salle_id = sa.id
       LEFT JOIN utilisateurs u ON s.tuteur_id = u.id
       LEFT JOIN tuteurs t ON u.id = t.utilisateur_id
       WHERE s.id=$1`,
      [seanceId]
    );
    if (!seanceRes.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Séance introuvable' });
    }

    const seance = seanceRes.rows[0];

    // La séance doit être EN_ATTENTE_PAIEMENT
    if (seance.statut !== 'EN_ATTENTE_PAIEMENT') {
      await client.query('ROLLBACK');
      return res.status(400).json({
        error: `Impossible de payer : séance en statut "${seance.statut}". Statut attendu : EN_ATTENTE_PAIEMENT`,
      });
    }

    if (seance.statut_paiement === 'PAYE') {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Cette séance est déjà payée' });
    }

    // Seul l'ADMIN de la salle peut payer (l'étudiant créateur de la salle)
    const partRes = await client.query(
      `SELECT role FROM participations WHERE utilisateur_id=$1 AND salle_id=$2`,
      [req.user.id, seance.salle_id]
    );
    if (!partRes.rows.length || partRes.rows[0].role !== 'ADMIN') {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: "Seul l'administrateur de la salle peut payer" });
    }

    // Calculer le montant : tarif/h × durée(h)
    let tarifHeure = 0;
    if (seance.tuteur_id && seance.matiere) {
      const tarifRes = await client.query(
        `SELECT tarif_heure FROM tuteur_tarifs WHERE tuteur_id=$1 AND matiere=$2`,
        [seance.tuteur_id, seance.matiere]
      );
      tarifHeure = parseFloat(tarifRes.rows[0]?.tarif_heure || 0);
    }

    const dureeHeures  = seance.duree / 60;
    const montantTotal = parseFloat((tarifHeure * dureeHeures).toFixed(2));
    const gainTuteur   = parseFloat((montantTotal * (1 - COMMISSION_TAUX)).toFixed(2));
    const commission   = parseFloat((montantTotal * COMMISSION_TAUX).toFixed(2));
    const reference    = genReference();

    // Créer l'enregistrement de paiement
    const paiementRes = await client.query(
      `INSERT INTO paiements
         (seance_id, payeur_id, tuteur_id, montant_total, gain_tuteur,
          commission_plateforme, methode, reference, donnees_carte)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       RETURNING *`,
      [
        seanceId, req.user.id, seance.tuteur_id,
        montantTotal, gainTuteur, commission,
        methode, reference,
        donneesCartePartielle ? JSON.stringify(donneesCartePartielle) : null,
      ]
    );

    // ✅ Séance payée → PLANIFIEE (prête à démarrer)
    await client.query(
      `UPDATE seances
       SET statut          = 'PLANIFIEE',
           statut_paiement = 'PAYE',
           montant_total   = $1
       WHERE id=$2`,
      [montantTotal, seanceId]
    );

    await client.query('COMMIT');

    const paiement = paiementRes.rows[0];

    // ── VIREMENT AUTOMATIQUE SIMULÉ AU TUTEUR (85%) ──────────────────────────
    // En production : appel API bancaire (Chargily, virement RIB, etc.)
    // Ici on log le virement et on le marque comme effectué
    if (seance.tuteur_rib) {
      console.log(`[VIREMENT] ${gainTuteur} DH → RIB ${seance.tuteur_rib} (${seance.tuteur_prenom} ${seance.tuteur_nom} / ${seance.tuteur_nom_banque || 'banque inconnue'})`);
      // En production : await virementBancaire({ rib: seance.tuteur_rib, montant: gainTuteur, reference })
    } else {
      console.warn(`[VIREMENT] Tuteur ${seance.tuteur_id} n'a pas de RIB configuré — virement en attente`);
    }

    // Emails automatiques (asynchrones — ne bloquent pas la réponse)
    const payeurRes = await pool.query(
      `SELECT prenom, nom, email FROM utilisateurs WHERE id=$1`, [req.user.id]
    );
    const payeur = payeurRes.rows[0];

    // Email à l'admin salle (confirmation de paiement)
    if (payeur?.email) {
      emailService.sendConfirmationPaiementAdminSalle({
        to:     payeur.email,
        nom:    `${payeur.prenom} ${payeur.nom}`,
        seance,
        salle:  { nom: seance.salle_nom },
        tuteur: { prenom: seance.tuteur_prenom, nom: seance.tuteur_nom },
        paiement,
      }).catch(console.error);
    }

    // Email au tuteur (notification séance confirmée + montant reçu)
    if (seance.tuteur_email) {
      emailService.sendNotificationTuteur({
        to:     seance.tuteur_email,
        nom:    `${seance.tuteur_prenom} ${seance.tuteur_nom}`,
        seance,
        salle:  { nom: seance.salle_nom },
        payeur: { prenom: payeur?.prenom, nom: payeur?.nom },
        paiement,
        gainTuteur,
        rib: seance.tuteur_rib,
      }).catch(console.error);
    }

    // Email à l'admin plateforme (notification paiement reçu)
    const adminEmail = process.env.ADMIN_EMAIL || process.env.SMTP_USER;
    if (adminEmail) {
      emailService.sendNotificationAdminPlateforme({
        to:     adminEmail,
        seance,
        salle:  { nom: seance.salle_nom },
        tuteur: { prenom: seance.tuteur_prenom, nom: seance.tuteur_nom, email: seance.tuteur_email },
        payeur: { prenom: payeur?.prenom, nom: payeur?.nom, email: payeur?.email },
        paiement,
      }).catch(console.error);
    }

    res.status(201).json({
      message:      '✅ Paiement effectué — séance confirmée',
      paiement,
      reference,
      seanceStatut: 'PLANIFIEE',
      montantTotal,
      gainTuteur,
      commission,
      tuteur: {
        prenom:    seance.tuteur_prenom,
        nom:       seance.tuteur_nom,
        rib:       seance.tuteur_rib,
        nomBanque: seance.tuteur_nom_banque,
        virementEffectue: !!seance.tuteur_rib,
      },
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('payerSeance error:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  } finally {
    client.release();
  }
};

// ── POST /api/paiements/:id/rembourser ──────────────────────────────────────
// ÉTAPE 10 : remboursement si tuteur annule après paiement
// Règle : remboursement possible uniquement si séance ≥ 24h dans le futur
// Exception : admin plateforme peut rembourser sans restriction
const rembourserPaiement = async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const paiementRes = await client.query(
      `SELECT p.*,
              s.date_debut, s.titre as seance_titre, s.salle_id,
              u.email  as payeur_email,
              u.prenom as payeur_prenom,
              u.nom    as payeur_nom
       FROM paiements p
       JOIN seances s ON p.seance_id = s.id
       JOIN utilisateurs u ON p.payeur_id = u.id
       WHERE p.id=$1`,
      [req.params.id]
    );
    if (!paiementRes.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Paiement introuvable' });
    }

    const p = paiementRes.rows[0];

    // Vérifier autorisation : admin plateforme OU admin salle
    const isAdminPlateforme = req.user.role === 'admin';
    let isAdminSalle = false;
    if (!isAdminPlateforme) {
      const partRes = await client.query(
        `SELECT role FROM participations WHERE utilisateur_id=$1 AND salle_id=$2`,
        [req.user.id, p.salle_id]
      );
      isAdminSalle = partRes.rows[0]?.role === 'ADMIN';
    }
    if (!isAdminPlateforme && !isAdminSalle) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'Non autorisé' });
    }

    if (p.statut === 'REMBOURSE') {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Déjà remboursé' });
    }

    // Règle 24h (pas appliquée pour admin plateforme)
    const diffH = (new Date(p.date_debut) - new Date()) / (1000 * 60 * 60);
    if (!isAdminPlateforme && diffH < 24) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        error: `Remboursement impossible : séance dans ${Math.round(diffH)}h. Minimum requis : 24h.`,
      });
    }

    // Effectuer le remboursement
    await client.query(
      `UPDATE paiements SET statut='REMBOURSE', date_remboursement=NOW() WHERE id=$1`, [p.id]
    );
    await client.query(
      `UPDATE seances SET statut_paiement='REMBOURSE', statut='ANNULEE' WHERE id=$1`, [p.seance_id]
    );

    await client.query('COMMIT');

    // Email remboursement
    emailService.sendConfirmationRemboursement({
      to:  p.payeur_email,
      nom: `${p.payeur_prenom} ${p.payeur_nom}`,
      seance:  { titre: p.seance_titre, date_debut: p.date_debut },
      paiement: p,
    }).catch(console.error);

    res.json({ message: '✅ Remboursement effectué', montant: p.montant_total });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('rembourserPaiement error:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  } finally {
    client.release();
  }
};

// ── GET /api/paiements/mes-paiements ────────────────────────────────────────
const getMesPaiements = async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT p.*,
              s.titre as seance_titre, s.date_debut, s.matiere, s.duree,
              sa.nom  as salle_nom,
              ut.prenom as tuteur_prenom, ut.nom as tuteur_nom
       FROM paiements p
       JOIN seances s  ON p.seance_id = s.id
       JOIN salles  sa ON s.salle_id  = sa.id
       LEFT JOIN utilisateurs ut ON p.tuteur_id = ut.id
       WHERE p.payeur_id=$1
       ORDER BY p.date_paiement DESC`,
      [req.user.id]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
};

// ── GET /api/paiements/mes-revenus ──────────────────────────────────────────
// Pour le tuteur : ses gains + stats
const getMesRevenus = async (req, res) => {
  try {
    if (req.user.role !== 'tuteur')
      return res.status(403).json({ error: 'Réservé aux tuteurs' });

    const paiements = await pool.query(
      `SELECT p.*,
              s.titre as seance_titre, s.date_debut, s.matiere, s.duree,
              sa.nom  as salle_nom,
              up.prenom as payeur_prenom, up.nom as payeur_nom
       FROM paiements p
       JOIN seances s  ON p.seance_id = s.id
       JOIN salles  sa ON s.salle_id  = sa.id
       LEFT JOIN utilisateurs up ON p.payeur_id = up.id
       WHERE p.tuteur_id=$1
       ORDER BY p.date_paiement DESC`,
      [req.user.id]
    );

    const stats = await pool.query(
      `SELECT
         COALESCE(SUM(gain_tuteur) FILTER (WHERE statut='COMPLETE'), 0)  as total_gains,
         COUNT(*)                  FILTER (WHERE statut='COMPLETE')       as nb_paiements,
         COALESCE(SUM(gain_tuteur) FILTER (WHERE statut='REMBOURSE'), 0) as total_rembourse
       FROM paiements WHERE tuteur_id=$1`,
      [req.user.id]
    );

    res.json({ paiements: paiements.rows, stats: stats.rows[0] });
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
};

// ── GET /api/admin/revenus ──────────────────────────────────────────────────
const getAdminRevenus = async (req, res) => {
  try {
    const [totaux, parMois, parMethode, topTuteurs, parMatiere] = await Promise.all([
      pool.query(`
        SELECT
          COALESCE(SUM(montant_total)         FILTER (WHERE statut='COMPLETE'),  0) as total_paiements,
          COALESCE(SUM(commission_plateforme) FILTER (WHERE statut='COMPLETE'),  0) as total_commissions,
          COALESCE(SUM(gain_tuteur)           FILTER (WHERE statut='COMPLETE'),  0) as total_tuteurs,
          COUNT(*)                            FILTER (WHERE statut='COMPLETE')      as nb_paiements,
          COUNT(*)                            FILTER (WHERE statut='REMBOURSE')     as nb_remboursements,
          COALESCE(SUM(montant_total)         FILTER (WHERE statut='REMBOURSE'), 0) as total_rembourse
        FROM paiements
      `),
      pool.query(`
        SELECT TO_CHAR(date_paiement,'YYYY-MM') as mois,
               SUM(commission_plateforme) as commissions,
               SUM(montant_total) as volume, COUNT(*) as nb
        FROM paiements
        WHERE statut='COMPLETE' AND date_paiement >= NOW() - INTERVAL '12 months'
        GROUP BY mois ORDER BY mois
      `),
      pool.query(`
        SELECT methode, COUNT(*) as nb, SUM(montant_total) as volume
        FROM paiements WHERE statut='COMPLETE'
        GROUP BY methode ORDER BY volume DESC
      `),
      pool.query(`
        SELECT u.prenom, u.nom, u.email,
               COUNT(p.id) as nb_seances,
               SUM(p.gain_tuteur)   as total_gains,
               SUM(p.montant_total) as volume_total
        FROM paiements p
        JOIN utilisateurs u ON p.tuteur_id = u.id
        WHERE p.statut='COMPLETE'
        GROUP BY u.id, u.prenom, u.nom, u.email
        ORDER BY total_gains DESC LIMIT 10
      `),
      pool.query(`
        SELECT s.matiere, COUNT(p.id) as nb_seances, SUM(p.montant_total) as volume
        FROM paiements p JOIN seances s ON p.seance_id = s.id
        WHERE p.statut='COMPLETE' AND s.matiere IS NOT NULL
        GROUP BY s.matiere ORDER BY volume DESC LIMIT 10
      `),
    ]);

    res.json({
      totaux:     totaux.rows[0],
      parMois:    parMois.rows,
      parMethode: parMethode.rows,
      topTuteurs: topTuteurs.rows,
      parMatiere: parMatiere.rows,
    });
  } catch (err) {
    console.error('getAdminRevenus error:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
};

// ── GET /api/admin/paiements ─────────────────────────────────────────────────
const getAllPaiements = async (req, res) => {
  try {
    const { statut, methode, limit = 50, offset = 0 } = req.query;
    let query = `
      SELECT p.*,
             s.titre as seance_titre, s.date_debut, s.matiere,
             sa.nom  as salle_nom,
             up.prenom as payeur_prenom, up.nom as payeur_nom, up.email as payeur_email,
             ut.prenom as tuteur_prenom, ut.nom as tuteur_nom
      FROM paiements p
      JOIN seances s  ON p.seance_id  = s.id
      JOIN salles  sa ON s.salle_id   = sa.id
      LEFT JOIN utilisateurs up ON p.payeur_id = up.id
      LEFT JOIN utilisateurs ut ON p.tuteur_id = ut.id
      WHERE 1=1
    `;
    const params = [];
    if (statut)  { params.push(statut);  query += ` AND p.statut=$${params.length}`; }
    if (methode) { params.push(methode); query += ` AND p.methode=$${params.length}`; }
    query += ` ORDER BY p.date_paiement DESC LIMIT $${params.length+1} OFFSET $${params.length+2}`;
    params.push(limit, offset);

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
};

module.exports = {
  getPaiementSeance,
  payerSeance,
  rembourserPaiement,
  getMesPaiements,
  getMesRevenus,
  getAdminRevenus,
  getAllPaiements,
};