const jwt = require('jsonwebtoken');
const { pool } = require('../config/db');
const { v4: uuidv4 } = require('uuid');

const setupSocket = (io) => {
  // Auth middleware
  io.use(async (socket, next) => {
    const token = socket.handshake.auth.token;
    if (!token) return next(new Error('Token manquant'));
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const result = await pool.query(
        'SELECT id, prenom, nom, email, role FROM utilisateurs WHERE id=$1',
        [decoded.id]
      );
      if (!result.rows.length) return next(new Error('Utilisateur introuvable'));
      socket.user = result.rows[0];
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

      // NOUVEAU: Vérifier s'il y a un appel actif → notifier l'arrivant
      // Seulement si l'appel est vraiment actif (actif = TRUE explicitement)
      try {
        const activeCall = await pool.query(
          `SELECT sa.id, sa.initiateur_id, u.prenom || ' ' || u.nom AS initiateur_nom
           FROM sessions_appel sa
           JOIN utilisateurs u ON sa.initiateur_id = u.id
           WHERE sa.salle_id = $1
             AND sa.actif = TRUE
             AND sa.date_fin IS NULL
           LIMIT 1`,
          [salleId]
        );

        if (activeCall.rows.length > 0) {
          const sess = activeCall.rows[0];
          // Ne pas notifier l'initiateur lui-même
          if (String(sess.initiateur_id) !== String(socket.user.id)) {
            console.log(`📢 Appel actif dans salle ${salleId} → notifier user ${socket.user.id}`);
            socket.emit('call:active', {
              sessionId: sess.id,
              initiateurNom: sess.initiateur_nom,
              salleId,
            });
          }
        }
      } catch (err) {
        console.error('check active call on join error:', err);
      }
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
      const tb = await pool.query(
        'SELECT ecriture_bloquee FROM tableaux_blancs WHERE salle_id=$1', [salleId]
      );
      if (tb.rows[0]?.ecriture_bloquee && socket.user.role !== 'tuteur') {
        socket.emit('whiteboard:blocked', { message: 'Tableau bloqué par le tuteur' });
        return;
      }
      socket.to(`salle:${salleId}`).emit('whiteboard:draw', { userId: socket.user.id, donnees });
      await pool.query(
        'UPDATE tableaux_blancs SET etat_dessin=$1 WHERE salle_id=$2',
        [JSON.stringify(donnees), salleId]
      );
    });

    socket.on('whiteboard:clear', async ({ salleId }) => {
      if (socket.user.role !== 'tuteur') return;
      await pool.query("UPDATE tableaux_blancs SET etat_dessin='{}' WHERE salle_id=$1", [salleId]);
      io.to(`salle:${salleId}`).emit('whiteboard:cleared');
    });

    socket.on('whiteboard:block', async ({ salleId, bloquer }) => {
      if (socket.user.role !== 'tuteur') return;
      await pool.query(
        'UPDATE tableaux_blancs SET ecriture_bloquee=$1 WHERE salle_id=$2', [bloquer, salleId]
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

    // ─── APPEL AUDIO ──────────────────────────────────────
    // NOUVEAU: Détection automatique de séance dans fenêtre ±5min
    // Si pas de séance → appel libre (seanceId = null), ça marche quand même
    socket.on('call:start', async ({ salleId, seanceId }) => {
      const sessionId = uuidv4();
      try {
        // Si seanceId non fourni → chercher automatiquement une séance ±5min
        let resolvedSeanceId = seanceId || null;
        if (!resolvedSeanceId) {
          const seanceMatch = await pool.query(
            `SELECT id FROM seances
             WHERE salle_id = $1
               AND statut = 'PLANIFIEE'
               AND date_debut BETWEEN NOW() - INTERVAL '5 minutes'
                                AND NOW() + INTERVAL '5 minutes'
             ORDER BY ABS(EXTRACT(EPOCH FROM (date_debut - NOW())))
             LIMIT 1`,
            [salleId]
          );
          if (seanceMatch.rows.length > 0) {
            resolvedSeanceId = seanceMatch.rows[0].id;
            console.log(`📅 Séance auto-détectée: ${resolvedSeanceId}`);
          }
        }

        await pool.query(
          `INSERT INTO sessions_appel (id, salle_id, seance_id, initiateur_id)
           VALUES ($1, $2, $3, $4)`,
          [sessionId, salleId, resolvedSeanceId, socket.user.id]
        );

        // Si une séance est liée → la passer EN_COURS
        if (resolvedSeanceId) {
          await pool.query(
            `UPDATE seances SET statut='EN_COURS', session_appel_id=$1
             WHERE id=$2 AND statut='PLANIFIEE'`,
            [sessionId, resolvedSeanceId]
          );
          io.to(`salle:${salleId}`).emit('seance:updated', {
            seanceId: resolvedSeanceId,
            statut: 'EN_COURS',
          });
        }

        io.to(`salle:${salleId}`).emit('call:started', {
          sessionId,
          salleId,
          initiateur: socket.user.id,
          initiateurNom: `${socket.user.prenom} ${socket.user.nom}`,
          initiateurRole: socket.roleSalle,
        });

        console.log(`📞 Appel démarré: ${sessionId} | salle:${salleId} | séance:${resolvedSeanceId || 'libre'}`);
      } catch (err) {
        console.error('Call start error:', err);
        socket.emit('error', { message: "Impossible de démarrer l'appel" });
      }
    });

    // Seul l'initiateur / tuteur / admin peut terminer l'appel pour tout le monde
    socket.on('call:end', async ({ salleId, sessionId }) => {
      const session = await pool.query(
        'SELECT initiateur_id, seance_id FROM sessions_appel WHERE id=$1', [sessionId]
      );
      if (!session.rows.length) return;

      const isInitiateur = String(session.rows[0].initiateur_id) === String(socket.user.id);
      const isTuteur = socket.roleSalle === 'CO_ADMIN' && socket.user.role === 'tuteur';
      const isAdmin  = socket.roleSalle === 'ADMIN';

      if (!isInitiateur && !isTuteur && !isAdmin) {
        // Pas autorisé → juste quitter localement
        socket.emit('call:you-left');
        return;
      }

      await pool.query(
        'UPDATE sessions_appel SET actif=FALSE, date_fin=NOW() WHERE id=$1', [sessionId]
      );

      // NOUVEAU: Si lié à une séance → la marquer REALISEE
      const seanceId = session.rows[0].seance_id;
      if (seanceId) {
        await pool.query(
          `UPDATE seances SET statut='REALISEE' WHERE id=$1 AND statut='EN_COURS'`,
          [seanceId]
        );
        io.to(`salle:${salleId}`).emit('seance:updated', {
          seanceId,
          statut: 'REALISEE',
        });
        console.log(`✅ Séance ${seanceId} → REALISEE`);
      }

      io.to(`salle:${salleId}`).emit('call:ended', { sessionId });
      console.log(`📵 Appel terminé: ${sessionId}`);
    });

    // Quitter l'appel localement (l'appel continue pour les autres)
    socket.on('call:leave', ({ sessionId }) => {
      socket.leave(`call:${sessionId}`);
      socket.emit('call:you-left');
      // Nettoyer WebRTC côté pairs
      socket.to(`call:${sessionId}`).emit('call:user-disconnected', { userId: socket.user.id });
      console.log(`🚪 User ${socket.user.id} quitté appel ${sessionId} (appel continue)`);
    });

    // Membre accepte l'appel → notifier les autres pour WebRTC
    socket.on('call:joined', ({ salleId, sessionId, userId }) => {
      socket.join(`call:${sessionId}`);
      socket.to(`call:${sessionId}`).emit('call:user-joined', { userId });
      socket.to(`salle:${salleId}`).emit('call:user-joined', { userId });
    });

    socket.on('call:refused', ({ sessionId, userId }) => {
      console.log(`❌ User ${userId} refusé appel ${sessionId}`);
    });

    // WebRTC signaling
    socket.on('call:offer', ({ targetUserId, offer, sessionId }) => {
      io.to(`user:${targetUserId}`).emit('call:offer', {
        fromUserId: socket.user.id, offer, sessionId,
      });
    });

    socket.on('call:answer', ({ targetUserId, answer, sessionId }) => {
      io.to(`user:${targetUserId}`).emit('call:answer', {
        fromUserId: socket.user.id, answer, sessionId,
      });
    });

    socket.on('call:ice-candidate', ({ targetUserId, candidate }) => {
      io.to(`user:${targetUserId}`).emit('call:ice-candidate', {
        fromUserId: socket.user.id, candidate,
      });
    });

    socket.on('call:join', ({ salleId, sessionId }) => {
      socket.join(`call:${sessionId}`);
      socket.to(`call:${sessionId}`).emit('call:user-joined', { userId: socket.user.id });
    });

    socket.on('call:mute', ({ sessionId, muted }) => {
      socket.to(`call:${sessionId}`).emit('call:user-muted', {
        userId: socket.user.id, muted,
      });
    });

    // ─── USER ROOM ────────────────────────────────────────
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