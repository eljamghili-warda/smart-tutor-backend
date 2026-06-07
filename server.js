require('dotenv').config();
const emailService = require('./services/email.service');
const express    = require('express');
const http       = require('http');
const { Server } = require('socket.io');
const cors       = require('cors');
const fileUpload = require('express-fileupload');
const bodyParser = require('body-parser');
const path       = require('path');
const fs         = require('fs');
const { pool }   = require('./config/db');

const routes      = require('./routes/index');
const setupSocket = require('./socket/index');
const { expireInvitations }  = require('./controllers/invitation.controller');
const { verifierSeancesExpirees, annulerSeancesNonPayees } = require('./controllers/seance.controller');

const app    = express();
const server = http.createServer(app);

// ─── Socket.IO ───────────────────────────────────────────────────────────────
const io = new Server(server, {
  cors: {
    origin:      process.env.FRONTEND_URL || 'http://localhost:5173',
    methods:     ['GET', 'POST'],
    credentials: true,
  },
});

// ─── Middleware ───────────────────────────────────────────────────────────────

// ⚠️  Webhook Chargily : capturer rawBody AVANT express.json() global
app.use('/api/paiements/webhook', bodyParser.json({
  verify: (req, _res, buf) => { req.rawBody = buf; },
}));

app.use(cors({
  origin:      process.env.FRONTEND_URL || 'http://localhost:5173',
  credentials: true,
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(fileUpload({
  limits:       { fileSize: parseInt(process.env.MAX_FILE_SIZE) || 10 * 1024 * 1024 },
  abortOnLimit: true,
}));

// ─── Uploads ─────────────────────────────────────────────────────────────────
const uploadDir = './uploads';
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// ─── Routes ──────────────────────────────────────────────────────────────────
app.use('/api', routes);

// ─── Health check ─────────────────────────────────────────────────────────────
app.get('/health', (_req, res) =>
  res.json({ status: 'ok', timestamp: new Date().toISOString() })
);

// ─── 404 ─────────────────────────────────────────────────────────────────────
app.use((_req, res) => res.status(404).json({ error: 'Route introuvable' }));

// ─── Error handler ───────────────────────────────────────────────────────────
app.use((err, _req, res, _next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Erreur interne du serveur' });
});

// ─── Socket ──────────────────────────────────────────────────────────────────
setupSocket(io);

// ─── Crons ───────────────────────────────────────────────────────────────────

// 1. Expirer les invitations — toutes les heures
setInterval(expireInvitations, 60 * 60 * 1000);

// 2. Règle 5 min appel vidéo : CONFIRMEE → EN_COURS/ANNULEE/REALISEE
//    Toutes les 5 minutes
setInterval(verifierSeancesExpirees, 5 * 60 * 1000);
verifierSeancesExpirees(); // exécution immédiate au démarrage

// 3. Workflow étape 7 : annuler les séances EN_ATTENTE_PAIEMENT après 24h
//    Toutes les heures
setInterval(annulerSeancesNonPayees, 60 * 60 * 1000);
annulerSeancesNonPayees(); // exécution immédiate au démarrage

// ─── Démarrage ───────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`🚀 SmartTutor server running on port ${PORT}`);
  console.log(`📡 WebSocket ready`);
  console.log(`🔁 Crons : invitations · séances expirées · non-paiement 24h · emails résultats`);

  // 4. Cron : envoyer les emails de résultats différés — toutes les 5 minutes
  const envoyerEmailsResultatsDifferes = async () => {
    try {
      // Ajouter colonne si elle n'existe pas encore + corriger les NULL
      await pool.query(`
        ALTER TABLE tentatives_examen 
        ADD COLUMN IF NOT EXISTS email_envoye BOOLEAN DEFAULT FALSE
      `).catch(() => {});
      // Mettre FALSE là où c'est NULL (tentatives créées avant l'ajout de la colonne)
      await pool.query(`
        UPDATE tentatives_examen SET email_envoye = FALSE WHERE email_envoye IS NULL
      `).catch(() => {});

      // Trouver toutes les tentatives dont l'email n'a pas été envoyé
      // ET dont la date d'affichage des résultats est passée (ou nulle)
      const res = await pool.query(`
        SELECT 
          t.id, t.etudiant_id, t.examen_id, t.statut,
          t.score_obtenu, t.pourcentage,
          e.titre as examen_titre, e.note_passage,
          e.date_affichage_resultats,
          s.nom as salle_nom,
          ue.email as etudiant_email, ue.prenom as etudiant_prenom, ue.nom as etudiant_nom,
          ut.email as tuteur_email, ut.prenom as tuteur_prenom, ut.nom as tuteur_nom,
          c.numero_certificat, c.id as certificat_id
        FROM tentatives_examen t
        JOIN examens e ON t.examen_id = e.id
        JOIN salles s ON e.salle_id = s.id
        JOIN utilisateurs ue ON t.etudiant_id = ue.id
        JOIN utilisateurs ut ON e.tuteur_id = ut.id
        LEFT JOIN certificats c ON c.examen_id = t.examen_id AND c.etudiant_id = t.etudiant_id
        WHERE (t.email_envoye = FALSE OR t.email_envoye IS NULL)
          AND t.statut IN ('REUSSI', 'ECHOUE')
          AND t.submitted_at IS NOT NULL
          AND (
            e.date_affichage_resultats IS NULL
            OR e.date_affichage_resultats <= NOW()
          )
      `);

      if (res.rows.length > 0) {
        console.log(`📧 Cron emails : ${res.rows.length} email(s) à envoyer`);
        res.rows.forEach(r => console.log(`  → tentative ${r.id} | ${r.statut} | etudiant: ${r.etudiant_email} | date_affichage: ${r.date_affichage_resultats}`));
      } else {
        // Log discret pour savoir que le cron tourne
        const check = await pool.query(
          `SELECT COUNT(*) as total,
                  COUNT(*) FILTER (WHERE email_envoye = TRUE) as envoyes,
                  COUNT(*) FILTER (WHERE email_envoye = FALSE OR email_envoye IS NULL) as non_envoyes
           FROM tentatives_examen WHERE statut IN ('REUSSI','ECHOUE')`
        );
        const { total, envoyes, non_envoyes } = check.rows[0];
        console.log(`📧 Cron emails : 0 à envoyer maintenant (total: ${total}, envoyés: ${envoyes}, en attente: ${non_envoyes})`);
      }

      for (const row of res.rows) {
        try {
          if (row.statut === 'REUSSI') {
            // Créer le certificat s'il n'existe pas encore
            let numeroCert = row.numero_certificat;
            if (!numeroCert) {
              const year = new Date().getFullYear();
              const ts   = Date.now().toString().slice(-6);
              const rand = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
              numeroCert = `CERT-${year}-${ts}${rand}`;
              await pool.query(
                `INSERT INTO certificats (etudiant_id, examen_id, tentative_id, numero_certificat, score_obtenu)
                 VALUES ($1,$2,$3,$4,$5)
                 ON CONFLICT (etudiant_id, examen_id) DO UPDATE SET score_obtenu=EXCLUDED.score_obtenu`,
                [row.etudiant_id, row.examen_id, row.id, numeroCert, row.pourcentage]
              );
              // Récupérer le vrai numéro (en cas de conflict)
              const certRow = await pool.query(
                `SELECT numero_certificat FROM certificats WHERE etudiant_id=$1 AND examen_id=$2`,
                [row.etudiant_id, row.examen_id]
              );
              numeroCert = certRow.rows[0]?.numero_certificat || numeroCert;
            }

            // Email certificat à l'étudiant
            await emailService.sendCertificatEmail({
              to:          row.etudiant_email,
              nom:         `${row.etudiant_prenom} ${row.etudiant_nom}`,
              examenTitre: row.examen_titre,
              sallenom:    row.salle_nom,
              numeroCert,
              score:       parseFloat(row.pourcentage).toFixed(1),
              tuteurNom:   `${row.tuteur_prenom} ${row.tuteur_nom}`,
            });
            // Notif tuteur
            await emailService.sendNotifTuteurCertificat({
              to:          row.tuteur_email,
              tuteurNom:   `${row.tuteur_prenom} ${row.tuteur_nom}`,
              etudiantNom: `${row.etudiant_prenom} ${row.etudiant_nom}`,
              examenTitre: row.examen_titre,
              score:       parseFloat(row.pourcentage).toFixed(1),
              numeroCert,
            });
          }
          // Pour ECHOUE → pas d'email (pas de certificat à envoyer)

          // Marquer comme envoyé
          await pool.query(
            `UPDATE tentatives_examen SET email_envoye = TRUE WHERE id = $1`,
            [row.id]
          );
          console.log(`✅ Email envoyé pour tentative ${row.id} (${row.statut})`);

        } catch (emailErr) {
          console.error(`❌ Erreur email tentative ${row.id}:`, emailErr.message);
          // Ne pas marquer comme envoyé → sera retenté au prochain cron
        }
      }
    } catch (err) {
      console.error('Cron emails résultats error:', err.message);
    }
  };

  // Lancer immédiatement au démarrage puis toutes les 1 minute
  envoyerEmailsResultatsDifferes();
  setInterval(envoyerEmailsResultatsDifferes, 1 * 60 * 1000);
});