const jwt = require('jsonwebtoken');
const { pool } = require('../config/db');
const { v4: uuidv4 } = require('uuid');

const setupSocket = (io) => {
  // Auth middleware for sockets
  io.use((socket, next) => {
    const token = socket.handshake.auth.token;
    if (!token) return next(new Error('Token manquant'));
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      socket.user = decoded;
      next();
    } catch {
      next(new Error('Token invalide'));
    }
  });

  io.on('connection', (socket) => {
    console.log(`🔌 User ${socket.user.id} connected`);

    // ─── REJOINDRE UNE SALLE ──────────────────────────────
    socket.on('join:salle', async ({ salleId }) => {
  if (!salleId) {
    socket.emit('error', { message: 'salleId manquant' });
    return;
  }

  const membership = await pool.query(
    'SELECT role FROM participations WHERE utilisateur_id=$1 AND salle_id=$2',
    [socket.user.id, salleId]
  );

  if (!membership.rows.length) {
    socket.emit('error', { message: 'Non autorisé dans cette salle' });
    return;
  }

  socket.join(`salle:${salleId}`);
  socket.salleId = salleId;
  socket.roleSalle = membership.rows[0].role;

  io.to(`salle:${salleId}`).emit('salle:user-joined', {
    userId: socket.user.id,
    prenom: socket.user.prenom,
    nom: socket.user.nom,
  });

  socket.emit('salle:joined', { salleId, role: socket.roleSalle });
});

    // ─── QUITTER UNE SALLE ────────────────────────────────
    socket.on('leave:salle', ({ salleId }) => {
      socket.leave(`salle:${salleId}`);
      io.to(`salle:${salleId}`).emit('salle:user-left', { userId: socket.user.id });
    });

    // ─── CHAT ─────────────────────────────────────────────
    socket.on('chat:message', async ({ salleId, contenu }) => {
      if (!contenu?.trim()) return;
      try {
        const result = await pool.query(
          `INSERT INTO messages (salle_id, expediteur_id, contenu)
           VALUES ($1,$2,$3) RETURNING id, contenu, horodatage`,
          [salleId, socket.user.id, contenu.trim()]
        );
        const message = result.rows[0];
        io.to(`salle:${salleId}`).emit('chat:message', {
          ...message,
          expediteur_id: socket.user.id,
          expediteur_nom: `${socket.user.prenom} ${socket.user.nom}`,
        });
      } catch (err) {
        console.error('Chat error:', err);
      }
    });

    // ─── TABLEAU BLANC ────────────────────────────────────
    socket.on('whiteboard:draw', async ({ salleId, donnees }) => {
      // Vérifier si l'écriture est bloquée
      const tb = await pool.query(
        'SELECT ecriture_bloquee FROM tableaux_blancs WHERE salle_id=$1', [salleId]
      );
      if (tb.rows[0]?.ecriture_bloquee && socket.user.role !== 'tuteur') {
        socket.emit('whiteboard:blocked', { message: 'Tableau bloqué par le tuteur' });
        return;
      }
      // Broadcaster aux autres membres
      socket.to(`salle:${salleId}`).emit('whiteboard:draw', { userId: socket.user.id, donnees });

      // Sauvegarder l'état
      await pool.query(
        'UPDATE tableaux_blancs SET etat_dessin=$1 WHERE salle_id=$2',
        [JSON.stringify(donnees), salleId]
      );
    });

    socket.on('whiteboard:clear', async ({ salleId }) => {
      if (socket.user.role !== 'tuteur') return;
      await pool.query(
        "UPDATE tableaux_blancs SET etat_dessin='{}' WHERE salle_id=$1", [salleId]
      );
      io.to(`salle:${salleId}`).emit('whiteboard:cleared');
    });

    socket.on('whiteboard:block', async ({ salleId, bloquer }) => {
      if (socket.user.role !== 'tuteur') return;
      await pool.query(
        'UPDATE tableaux_blancs SET ecriture_bloquee=$1 WHERE salle_id=$2',
        [bloquer, salleId]
      );
      io.to(`salle:${salleId}`).emit('whiteboard:block-status', { bloquer });
    });

    socket.on('whiteboard:sync', async ({ salleId }) => {
      const tb = await pool.query(
        'SELECT etat_dessin, ecriture_bloquee FROM tableaux_blancs WHERE salle_id=$1', [salleId]
      );
      if (tb.rows.length) {
        socket.emit('whiteboard:state', {
          etatDessin: tb.rows[0].etat_dessin,
          ecritureBloquee: tb.rows[0].ecriture_bloquee,
        });
      }
    });

    // ─── APPEL AUDIO (WebRTC signaling) ───────────────────
    socket.on('call:start', async ({ salleId, seanceId }) => {
      const sessionId = uuidv4();
      try {
        await pool.query(
          `INSERT INTO sessions_appel (id, salle_id, seance_id, initiateur_id)
           VALUES ($1,$2,$3,$4)`,
          [sessionId, salleId, seanceId || null, socket.user.id]
        );
        io.to(`salle:${salleId}`).emit('call:started', {
          sessionId,
          initiateur: socket.user.id,
        });
      } catch (err) {
        console.error('Call start error:', err);
      }
    });

    socket.on('call:end', async ({ salleId, sessionId }) => {
      await pool.query(
        'UPDATE sessions_appel SET actif=FALSE, date_fin=NOW() WHERE id=$1', [sessionId]
      );
      io.to(`salle:${salleId}`).emit('call:ended', { sessionId });
    });

    // WebRTC signaling
    socket.on('call:offer', ({ targetUserId, offer, sessionId }) => {
      io.to(`user:${targetUserId}`).emit('call:offer', {
        fromUserId: socket.user.id,
        offer,
        sessionId,
      });
    });

    socket.on('call:answer', ({ targetUserId, answer, sessionId }) => {
      io.to(`user:${targetUserId}`).emit('call:answer', {
        fromUserId: socket.user.id,
        answer,
        sessionId,
      });
    });

    socket.on('call:ice-candidate', ({ targetUserId, candidate }) => {
      io.to(`user:${targetUserId}`).emit('call:ice-candidate', {
        fromUserId: socket.user.id,
        candidate,
      });
    });

    socket.on('call:join', ({ salleId, sessionId }) => {
      socket.join(`call:${sessionId}`);
      socket.to(`call:${sessionId}`).emit('call:user-joined', { userId: socket.user.id });
    });

    socket.on('call:mute', ({ sessionId, muted }) => {
      socket.to(`call:${sessionId}`).emit('call:user-muted', {
        userId: socket.user.id,
        muted,
      });
    });

    // ─── USER ROOM (for direct notifications) ─────────────
    socket.on('register', () => {
      socket.join(`user:${socket.user.id}`);
    });

    // ─── SEANCE events ────────────────────────────────────
    socket.on('seance:planned', ({ salleId, seance }) => {
      io.to(`salle:${salleId}`).emit('seance:planned', { seance });
    });

    // ─── DISCONNECT ───────────────────────────────────────
    socket.on('disconnect', () => {
      if (socket.salleId) {
        io.to(`salle:${socket.salleId}`).emit('salle:user-left', { userId: socket.user.id });
      }
      console.log(`🔌 User ${socket.user.id} disconnected`);
    });
  });
};

module.exports = setupSocket;