require('dotenv').config();
const express    = require('express');
const http       = require('http');
const { Server } = require('socket.io');
const cors       = require('cors');
const fileUpload = require('express-fileupload');
const bodyParser = require('body-parser');
const path       = require('path');
const fs         = require('fs');

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
  console.log(`🔁 Crons : invitations · séances expirées · non-paiement 24h`);
});