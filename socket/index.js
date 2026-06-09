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
    // Seul le tuteur (CO_ADMIN) ou l'admin-sans-tuteur peut démarrer un appel
    socket.on('call:start', async ({ salleId, seanceId }) => {
      // Vérifier le rôle dans la salle
      const isTuteurRole = socket.roleSalle === 'CO_ADMIN' && socket.user.role === 'tuteur'
      const isAdminRole  = socket.roleSalle === 'ADMIN'

      if (!isTuteurRole && !isAdminRole) {
        socket.emit('error', { message: 'Seul le tuteur ou l\'administrateur peut démarrer un appel.' })
        return
      }

      // Si admin → vérifier qu'il n'y a pas de tuteur dans la salle
      if (isAdminRole && !isTuteurRole) {
        const hasTuteur = await pool.query(
          `SELECT 1 FROM participations p
           JOIN utilisateurs u ON p.utilisateur_id = u.id
           WHERE p.salle_id = $1 AND p.role = 'CO_ADMIN' AND u.role = 'tuteur'
           LIMIT 1`,
          [salleId]
        )
        if (hasTuteur.rows.length > 0) {
          socket.emit('error', { message: 'Un tuteur est présent dans la salle. Seul lui peut démarrer l\'appel.' })
          return
        }
      }
      const sessionId = uuidv4();
      try {
        // Si seanceId non fourni → chercher automatiquement une séance dans la fenêtre 15%
        let resolvedSeanceId = seanceId || null;
        if (!resolvedSeanceId) {
          const seanceMatch = await pool.query(
            `SELECT id, date_debut, duree FROM seances
             WHERE salle_id = $1
               AND statut IN ('EN_ATTENTE_PAIEMENT', 'CONFIRMEE')
               AND NOW() BETWEEN
                 date_debut - (duree * 0.15 * INTERVAL '1 minute')
               AND
                 date_debut + (duree * INTERVAL '1 minute') + (duree * 0.15 * INTERVAL '1 minute')
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

        // Si une séance est liée → vérifier la fenêtre de démarrage et passer EN_COURS
        if (resolvedSeanceId) {
          const seanceInfo = await pool.query(
            `SELECT date_debut, duree FROM seances WHERE id=$1`,
            [resolvedSeanceId]
          );
          if (seanceInfo.rows.length > 0) {
            const { date_debut, duree } = seanceInfo.rows[0];
            const dateDebut   = new Date(date_debut);
            const dateFin     = new Date(dateDebut.getTime() + duree * 60 * 1000);
            const now         = new Date();
            // 15% de la durée de la séance
            const fenetreDebutMs = duree * 0.15 * 60 * 1000;
            const fenetreFinMs   = duree * 0.15 * 60 * 1000;

            // L'appel doit être lancé dans les 15% du début
            const debutValide = now >= new Date(dateDebut.getTime() - fenetreDebutMs)
                             && now <= new Date(dateDebut.getTime() + fenetreDebutMs);
            // ET avant la fin + 15%
            const finValide   = now <= new Date(dateFin.getTime() + fenetreFinMs);

            if (!debutValide || !finValide) {
              await pool.query(
                `UPDATE seances SET statut='ANNULEE'
                 WHERE id=$1 AND statut IN ('EN_ATTENTE_PAIEMENT', 'CONFIRMEE')`,
                [resolvedSeanceId]
              );
              await pool.query(
                `UPDATE sessions_appel SET actif=FALSE, date_fin=NOW(), duree_reelle_minutes=0
                 WHERE id=$1`,
                [sessionId]
              );
              io.to(`salle:${salleId}`).emit('seance:updated', {
                seanceId: resolvedSeanceId, statut: 'ANNULEE',
              });
              const fenetre15 = Math.round(duree * 0.15);
              const raison = !debutValide
                ? `L'appel doit être lancé dans les ${fenetre15} minutes autour du début de la séance`
                : `La séance est déjà terminée (plus de ${fenetre15} min après la fin)`;
              socket.emit('error', { message: `Séance annulée : ${raison}.` });
              io.to(`salle:${salleId}`).emit('call:started', {
                sessionId, salleId,
                initiateur: socket.user.id,
                initiateurNom: `${socket.user.prenom} ${socket.user.nom}`,
                initiateurRole: socket.roleSalle,
                seanceAnnulee: true,
              });
              console.log(`⚠️ Séance ${resolvedSeanceId} ANNULEE — appel hors fenêtre 15%`);
              return;
            }
          }

         await pool.query(
          `UPDATE seances SET statut='EN_COURS', session_appel_id=$1
           WHERE id=$2 AND statut IN ('EN_ATTENTE_PAIEMENT', 'CONFIRMEE')`,
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

      // Calculer la durée réelle de l'appel et clôturer la session
      const closeResult = await pool.query(
        `UPDATE sessions_appel
         SET actif=FALSE,
             date_fin=NOW(),
             duree_reelle_minutes = ROUND(EXTRACT(EPOCH FROM (NOW() - date_debut)) / 60)
         WHERE id=$1
         RETURNING date_debut, duree_reelle_minutes`,
        [sessionId]
      );

      // Décider REALISEE ou ANNULEE selon les règles métier de la séance liée
      const seanceId = session.rows[0].seance_id;
      if (seanceId) {
        // Récupérer les infos de la séance pour appliquer la règle des 5 minutes
        const seanceInfo = await pool.query(
          `SELECT date_debut, duree FROM seances WHERE id=$1`,
          [seanceId]
        );

        let statutFinal = 'REALISEE'; // par défaut

        if (seanceInfo.rows.length > 0) {
          const { date_debut, duree } = seanceInfo.rows[0];
          const dateDebutSeance = new Date(date_debut);
          const dateFinSeance   = new Date(dateDebutSeance.getTime() + duree * 60 * 1000);
          const now             = new Date();
          // 15% de la durée = fenêtre acceptable de fin anticipée
          const fenetreFinMs    = duree * 0.15 * 60 * 1000;

          // ANNULEE si l'appel se termine AVANT (fin_seance - 15% de la durée)
          const termineTropTot = now < new Date(dateFinSeance.getTime() - fenetreFinMs);

          if (termineTropTot) {
            statutFinal = 'ANNULEE';
            const minutesManquantes = Math.round((dateFinSeance - now) / 60000);
            const fenetre15 = Math.round(duree * 0.15);
            console.log(`⚠️ Séance ${seanceId} ANNULEE — appel terminé ${minutesManquantes} min trop tôt (fenêtre: ${fenetre15} min)`);
          } else {
            console.log(`✅ Séance ${seanceId} → REALISEE`);
          }
        }

        const updatedSeance = await pool.query(
  `UPDATE seances SET statut=$1
   WHERE id=$2 AND statut IN ('EN_COURS', 'CONFIRMEE')
   RETURNING id`,
  [statutFinal, seanceId]
);

        if (updatedSeance.rows.length > 0) {
          io.to(`salle:${salleId}`).emit('seance:updated', {
            seanceId,
            statut: statutFinal,
          });

          // Libérer les fonds et envoyer les emails si séance réalisée
          if (statutFinal === 'REALISEE') {
            try {
              const { libererFonds } = require('../controllers/paiement.controller');
              await pool.query(
                `UPDATE paiements SET statut='EN_ATTENTE_LIBERATION' WHERE seance_id=$1 AND statut IN ('COMPLETE','EN_ATTENTE_LIBERATION')`,
                [seanceId]
              );
              const result = await libererFonds(seanceId);
              if (result) {
                console.log(`[SOCKET] Fonds libérés + emails envoyés pour séance ${seanceId}`);
              } else {
                console.warn(`[SOCKET] libererFonds retourné null pour séance ${seanceId} (pas de paiement ?)`);
              }
            } catch (libErr) {
              console.error(`[SOCKET] libererFonds error pour séance ${seanceId}:`, libErr);
            }

          } else if (statutFinal === 'ANNULEE') {
            try {
              const emailService = require('../services/email.service');
              // Récupérer le paiement s'il existe
              const paiRes = await pool.query(
                `SELECT p.id, p.montant_total, p.reference,
                        u.email  as payeur_email, u.prenom as payeur_prenom, u.nom as payeur_nom,
                        s.titre  as seance_titre, s.date_debut,
                        ut.email as tuteur_email, ut.prenom as tuteur_prenom, ut.nom as tuteur_nom
                 FROM paiements p
                 JOIN seances s ON p.seance_id = s.id
                 JOIN utilisateurs u ON p.payeur_id = u.id
                 LEFT JOIN utilisateurs ut ON p.tuteur_id = ut.id
                 WHERE p.seance_id=$1 AND p.statut IN ('COMPLETE','EN_ATTENTE_LIBERATION')
                 LIMIT 1`,
                [seanceId]
              );

              if (paiRes.rows.length) {
                const p = paiRes.rows[0];
                // Rembourser
                await pool.query(
                  `UPDATE paiements SET statut='REMBOURSE', date_remboursement=NOW() WHERE id=$1`, [p.id]
                );
                await pool.query(
                  `UPDATE seances SET statut_paiement='REMBOURSE' WHERE id=$1`, [seanceId]
                );
                // Email remboursement → admin salle
                if (p.payeur_email) {
                  emailService.sendConfirmationRemboursement({
                    to:  p.payeur_email,
                    nom: `${p.payeur_prenom} ${p.payeur_nom}`,
                    seance:   { titre: p.seance_titre, date_debut: p.date_debut },
                    paiement: { montant_total: p.montant_total, reference: p.reference },
                  }).catch(console.error);
                }
                // Email annulation → tuteur
                if (p.tuteur_email) {
                  emailService.sendAnnulationTuteur({
                    to:  p.tuteur_email,
                    nom: `${p.tuteur_prenom} ${p.tuteur_nom}`,
                    seance: { titre: p.seance_titre, date_debut: p.date_debut },
                    motif: `L'appel a été terminé trop tôt.`,
                  }).catch(console.error);
                }
                console.log(`[SOCKET] Remboursement + emails annulation envoyés pour séance ${seanceId}`);

              } else {
                // Séance sans paiement — email annulation tuteur + admin quand même
                const infoRes = await pool.query(
                  `SELECT s.titre, s.date_debut,
                          ut.email as tuteur_email, ut.prenom as tuteur_prenom, ut.nom as tuteur_nom,
                          ua.email as admin_email, ua.prenom as admin_prenom, ua.nom as admin_nom
                   FROM seances s
                   LEFT JOIN utilisateurs ut ON s.tuteur_id = ut.id
                   JOIN participations pr ON pr.salle_id=s.salle_id AND pr.role='ADMIN'
                   JOIN utilisateurs ua ON ua.id=pr.utilisateur_id
                   WHERE s.id=$1`, [seanceId]
                );
                if (infoRes.rows.length) {
                  const r = infoRes.rows[0];
                  if (r.tuteur_email) emailService.sendAnnulationTuteur({
                    to: r.tuteur_email, nom: `${r.tuteur_prenom} ${r.tuteur_nom}`,
                    seance: { titre: r.titre, date_debut: r.date_debut },
                    motif: `L'appel a été terminé trop tôt.`,
                  }).catch(console.error);
                }
                console.log(`[SOCKET] Email annulation (sans paiement) pour séance ${seanceId}`);
              }
            } catch (annulErr) {
              console.error(`[SOCKET] Erreur traitement annulation séance ${seanceId}:`, annulErr);
            }
          }
        }
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

    // Membre accepte l'appel → rejoindre la room + notifier l'initiateur via WebRTC
    socket.on('call:joined', async ({ salleId, sessionId, userId }) => {
      socket.join(`call:${sessionId}`);
      // Notifier TOUTE la salle que ce user a rejoint l'appel (pour le panneau visuel)
      io.to(`salle:${salleId}`).emit('call:user-joined', { userId: socket.user.id });
      // Enregistrer dans participations_appel
      try {
        await pool.query(
          `INSERT INTO participations_appel (session_id, utilisateur_id, a_rejoint, date_rejoint)
           VALUES ($1, $2, TRUE, NOW())
           ON CONFLICT (session_id, utilisateur_id)
           DO UPDATE SET a_rejoint=TRUE, date_rejoint=NOW()`,
          [sessionId, socket.user.id]
        );
      } catch(err) { console.error('participations_appel insert error:', err); }
      console.log(`✅ User ${socket.user.id} a rejoint l'appel ${sessionId}`);
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

    // Initiateur rejoint sa propre room d'appel + s'enregistre dans participations_appel
    socket.on('call:join', async ({ salleId, sessionId }) => {
      socket.join(`call:${sessionId}`);
      // Notifier la salle que l'initiateur est dans l'appel (pour le panneau visuel)
      io.to(`salle:${salleId}`).emit('call:user-joined', { userId: socket.user.id });
      try {
        await pool.query(
          `INSERT INTO participations_appel (session_id, utilisateur_id, a_rejoint, date_rejoint)
           VALUES ($1, $2, TRUE, NOW())
           ON CONFLICT (session_id, utilisateur_id)
           DO UPDATE SET a_rejoint=TRUE, date_rejoint=NOW()`,
          [sessionId, socket.user.id]
        );
      } catch(err) { console.error('participations_appel insert error (initiateur):', err); }
    });

    socket.on('call:mute', async ({ sessionId, muted }) => {
      // Diffuser le changement de micro à tous les participants de l'appel dans la salle
      io.to(`call:${sessionId}`).emit('call:user-muted', {
        userId: socket.user.id, muted,
      });
      // Persister dans participations_appel
      try {
        await pool.query(
          `UPDATE participations_appel SET micro_coupe=$1
           WHERE session_id=$2 AND utilisateur_id=$3`,
          [muted, sessionId, socket.user.id]
        );
      } catch(err) { console.error('participations_appel mute error:', err); }
    });

    // ─── PARTAGE D'ÉCRAN ──────────────────────────────────
    // Seul le tuteur peut démarrer un partage d'écran

    socket.on('screen:start', ({ salleId }) => {
      // Vérifier que c'est bien le tuteur
      const isTuteur = socket.roleSalle === 'CO_ADMIN' && socket.user.role === 'tuteur'
      const isAdmin  = socket.roleSalle === 'ADMIN'
      if (!isTuteur && !isAdmin) {
        socket.emit('error', { message: 'Seul le tuteur peut partager son écran.' })
        return
      }
      // Notifier toute la salle qu'un partage commence
      socket.to(`salle:${salleId}`).emit('screen:started', {
        sharerId: socket.user.id,
        sharerNom: `${socket.user.prenom} ${socket.user.nom}`,
      })
      socket.screenSalleId = salleId
      console.log(`🖥️ Partage d'écran démarré par ${socket.user.id} dans salle ${salleId}`)
    })

    socket.on('screen:stop', ({ salleId }) => {
      socket.to(`salle:${salleId}`).emit('screen:stopped', {
        sharerId: socket.user.id,
      })
      socket.screenSalleId = null
      console.log(`🖥️ Partage d'écran arrêté par ${socket.user.id}`)
    })

    // Signaling WebRTC pour le partage d'écran (offre du tuteur → chaque étudiant)
    socket.on('screen:offer', ({ targetUserId, offer }) => {
      io.to(`user:${targetUserId}`).emit('screen:offer', {
        fromUserId: socket.user.id,
        offer,
      })
    })

    socket.on('screen:answer', ({ targetUserId, answer }) => {
      io.to(`user:${targetUserId}`).emit('screen:answer', {
        fromUserId: socket.user.id,
        answer,
      })
    })

    socket.on('screen:ice', ({ targetUserId, candidate }) => {
      io.to(`user:${targetUserId}`).emit('screen:ice', {
        fromUserId: socket.user.id,
        candidate,
      })
    })

    // ─── USER ROOM ────────────────────────────────────────
    socket.on('register', () => {
      socket.join(`user:${socket.user.id}`);
    });

    // ─── SEANCE events ────────────────────────────────────
    socket.on('seance:planned', ({ salleId, seance }) => {
      io.to(`salle:${salleId}`).emit('seance:planned', { seance });
    });

    // ─── DISCONNECT ───────────────────────────────────────
    socket.on('disconnect', async () => {
      if (socket.salleId) {
        io.to(`salle:${socket.salleId}`).emit('salle:user-left', { userId: socket.user.id });
      }
      console.log(`🔌 User ${socket.user.id} disconnected`);

      // Si cet utilisateur était l'initiateur d'un appel actif → clôturer l'appel
      try {
        const activeCall = await pool.query(
          `SELECT id, salle_id FROM sessions_appel
           WHERE initiateur_id = $1 AND actif = TRUE AND date_fin IS NULL
           LIMIT 1`,
          [socket.user.id]
        );
        if (activeCall.rows.length > 0) {
          const sess = activeCall.rows[0];
          await pool.query(
            `UPDATE sessions_appel SET actif=FALSE, date_fin=NOW()
             WHERE id=$1`,
            [sess.id]
          );
          // Notifier tous les participants que l'appel est terminé
          io.to(`salle:${sess.salle_id}`).emit('call:ended', { sessionId: sess.id });
          console.log(`📵 Appel ${sess.id} clôturé automatiquement (initiateur déconnecté)`);
        }
      } catch (err) {
        console.error('auto-close call on disconnect error:', err);
      }
    });
  });
};

module.exports = setupSocket;