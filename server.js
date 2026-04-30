require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const fileUpload = require('express-fileupload');
const path = require('path');
const fs = require('fs');

const routes = require('./routes/index');
const setupSocket = require('./socket/index');
const { expireInvitations } = require('./controllers/invitation.controller');
const { verifierSeancesExpirees } = require('./controllers/seance.controller');

const app = express();
const server = http.createServer(app);

// Socket.io
const io = new Server(server, {
  cors: {
    origin: process.env.FRONTEND_URL || 'http://localhost:5173',
    methods: ['GET', 'POST'],
    credentials: true,
  },
});

// Middleware
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:5173',
  credentials: true,
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(fileUpload({
  limits: { fileSize: parseInt(process.env.MAX_FILE_SIZE) || 10 * 1024 * 1024 },
  abortOnLimit: true,
}));

// Uploads directory
const uploadDir = './uploads';
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Routes
app.use('/api', routes);

// Health check
app.get('/health', (req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }));

// 404
app.use((req, res) => res.status(404).json({ error: 'Route introuvable' }));

// Error handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Erreur interne du serveur' });
});

// Socket setup
setupSocket(io);

// Expire invitations every hour
setInterval(expireInvitations, 60 * 60 * 1000);

// Vérifier séances non lancées toutes les 5 minutes
// Règle: séance PLANIFIEE dont la fin est dépassée sans appel => ANNULEE
setInterval(verifierSeancesExpirees, 5 * 60 * 1000);
verifierSeancesExpirees(); // vérification au démarrage

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`🚀 SmartTutor server running on port ${PORT}`);
  console.log(`📡 WebSocket ready`);
});