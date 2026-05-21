-- SmartTutor Database Schema

-- Enums
CREATE TYPE statut_tuteur AS ENUM ('PENDING', 'ACTIVE', 'REJECTED', 'SUSPENDED');
CREATE TYPE type_salle AS ENUM ('PUBLIQUE', 'PRIVEE');
CREATE TYPE statut_salle AS ENUM ('ACTIVE_AVEC_TUTEUR', 'ACTIVE_SANS_TUTEUR', 'HORS_LIGNE', 'FERMEE');
CREATE TYPE role_salle AS ENUM ('ADMIN', 'CO_ADMIN', 'MEMBRE');
CREATE TYPE statut_invitation AS ENUM ('EN_ATTENTE', 'ACCEPTEE', 'REFUSEE', 'EXPIREE');
CREATE TYPE type_invitation AS ENUM ('VERS_ETUDIANT', 'VERS_TUTEUR');
CREATE TYPE statut_seance AS ENUM ('PLANIFIEE', 'EN_COURS', 'REALISEE', 'ANNULEE');

-- Table Utilisateur (base)
CREATE TABLE utilisateurs (
  id BIGSERIAL PRIMARY KEY,
  prenom VARCHAR(100) NOT NULL,
  nom VARCHAR(100) NOT NULL,
  email VARCHAR(255) UNIQUE NOT NULL,
  mot_de_passe VARCHAR(255) NOT NULL,
  photo_profil VARCHAR(500),
  date_inscription TIMESTAMP DEFAULT NOW(),
  derniere_connexion TIMESTAMP,
  est_bloque BOOLEAN DEFAULT FALSE,
  tentatives_connexion INT DEFAULT 0,
  role VARCHAR(20) NOT NULL CHECK (role IN ('etudiant', 'tuteur', 'admin'))
);

-- Table Etudiant (extension)
CREATE TABLE etudiants (
  utilisateur_id BIGINT PRIMARY KEY REFERENCES utilisateurs(id) ON DELETE CASCADE,
  niveau_etude VARCHAR(100),
  filiere VARCHAR(150),
  etablissement VARCHAR(200)
);

-- Table Tuteur (extension)
CREATE TABLE tuteurs (
  utilisateur_id BIGINT PRIMARY KEY REFERENCES utilisateurs(id) ON DELETE CASCADE,
  specialites TEXT[], -- array of strings
  biographie TEXT,
  cv_url VARCHAR(500),
  note_moyenne FLOAT DEFAULT 0,
  statut statut_tuteur DEFAULT 'PENDING'
);

-- Table Salle
CREATE TABLE salles (
  id BIGSERIAL PRIMARY KEY,
  nom VARCHAR(200) NOT NULL,
  description TEXT,
  type type_salle NOT NULL DEFAULT 'PUBLIQUE',
  statut statut_salle DEFAULT 'ACTIVE_SANS_TUTEUR',
  capacite_max INT DEFAULT 50,
  matiere VARCHAR(150),
  date_creation TIMESTAMP DEFAULT NOW(),
  createur_id BIGINT REFERENCES utilisateurs(id) ON DELETE SET NULL
);

-- Table Participation (utilisateur <-> salle)
CREATE TABLE participations (
  id BIGSERIAL PRIMARY KEY,
  utilisateur_id BIGINT REFERENCES utilisateurs(id) ON DELETE CASCADE,
  salle_id BIGINT REFERENCES salles(id) ON DELETE CASCADE,
  role role_salle DEFAULT 'MEMBRE',
  date_join TIMESTAMP DEFAULT NOW(),
  UNIQUE(utilisateur_id, salle_id)
);

-- Table TableauBlanc
CREATE TABLE tableaux_blancs (
  id BIGSERIAL PRIMARY KEY,
  salle_id BIGINT UNIQUE REFERENCES salles(id) ON DELETE CASCADE,
  etat_dessin TEXT DEFAULT '{}',
  ecriture_bloquee BOOLEAN DEFAULT FALSE
);

-- Table Message
CREATE TABLE messages (
  id BIGSERIAL PRIMARY KEY,
  salle_id BIGINT REFERENCES salles(id) ON DELETE CASCADE,
  expediteur_id BIGINT REFERENCES utilisateurs(id) ON DELETE SET NULL,
  contenu TEXT NOT NULL,
  horodatage TIMESTAMP DEFAULT NOW()
);

-- Table Seance
CREATE TABLE seances (
  id BIGSERIAL PRIMARY KEY,
  salle_id BIGINT REFERENCES salles(id) ON DELETE CASCADE,
  tuteur_id BIGINT REFERENCES utilisateurs(id) ON DELETE SET NULL,
  titre VARCHAR(200) NOT NULL,
  description TEXT,
  matiere VARCHAR(150),
  date_debut TIMESTAMP NOT NULL,
  duree INT NOT NULL, -- minutes
  statut statut_seance DEFAULT 'PLANIFIEE',
  session_appel_id UUID
);

-- Table SessionAppel
CREATE TABLE sessions_appel (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  salle_id BIGINT REFERENCES salles(id) ON DELETE CASCADE,
  seance_id BIGINT REFERENCES seances(id) ON DELETE SET NULL,
  initiateur_id BIGINT REFERENCES utilisateurs(id) ON DELETE SET NULL,
  date_debut TIMESTAMP DEFAULT NOW(),
  date_fin TIMESTAMP,
  actif BOOLEAN DEFAULT TRUE
);

-- Lier seance -> session_appel (FK)
ALTER TABLE seances ADD CONSTRAINT fk_seance_session 
  FOREIGN KEY (session_appel_id) REFERENCES sessions_appel(id) ON DELETE SET NULL;

-- Table ParticipationAppel
CREATE TABLE participations_appel (
  id BIGSERIAL PRIMARY KEY,
  session_id UUID REFERENCES sessions_appel(id) ON DELETE CASCADE,
  utilisateur_id BIGINT REFERENCES utilisateurs(id) ON DELETE CASCADE,
  micro_coupe BOOLEAN DEFAULT FALSE,
  a_rejoint BOOLEAN DEFAULT FALSE,
  date_rejoint TIMESTAMP,
  UNIQUE(session_id, utilisateur_id)
);

-- Table Invitation
CREATE TABLE invitations (
  id BIGSERIAL PRIMARY KEY,
  salle_id BIGINT REFERENCES salles(id) ON DELETE CASCADE,
  expediteur_id BIGINT REFERENCES utilisateurs(id) ON DELETE SET NULL,
  destinataire_id BIGINT REFERENCES utilisateurs(id) ON DELETE CASCADE,
  date_envoi TIMESTAMP DEFAULT NOW(),
  date_reponse TIMESTAMP,
  statut statut_invitation DEFAULT 'EN_ATTENTE',
  type_invitation type_invitation NOT NULL,
  date_expiration TIMESTAMP DEFAULT (NOW() + INTERVAL '48 hours')
);

-- Table Evaluation
CREATE TABLE evaluations (
  id BIGSERIAL PRIMARY KEY,
  etudiant_id BIGINT REFERENCES utilisateurs(id) ON DELETE CASCADE,
  tuteur_id BIGINT REFERENCES utilisateurs(id) ON DELETE CASCADE,
  seance_id BIGINT REFERENCES seances(id) ON DELETE SET NULL,
  note INT NOT NULL CHECK (note >= 1 AND note <= 5),
  commentaire TEXT,
  date_evaluation TIMESTAMP DEFAULT NOW()
);

-- Table DisponibiliteTuteur
CREATE TABLE disponibilites_tuteur (
  id BIGSERIAL PRIMARY KEY,
  tuteur_id BIGINT REFERENCES utilisateurs(id) ON DELETE CASCADE,
  jour_semaine INT NOT NULL CHECK (jour_semaine >= 1 AND jour_semaine <= 7),
  heure_debut TIME NOT NULL,
  heure_fin TIME NOT NULL
);

-- Table FichierPartage
CREATE TABLE fichiers_partages (
  id BIGSERIAL PRIMARY KEY,
  salle_id BIGINT REFERENCES salles(id) ON DELETE CASCADE,
  uploader_id BIGINT REFERENCES utilisateurs(id) ON DELETE SET NULL,
  nom_fichier VARCHAR(255) NOT NULL,
  url_telechargement VARCHAR(500) NOT NULL,
  taille BIGINT,
  type_mime VARCHAR(100),
  date_upload TIMESTAMP DEFAULT NOW()
);
-- ═══════════════════════════════════════════════════════════
-- MIGRATION : Système de Paiement SmartTutor
-- ═══════════════════════════════════════════════════════════

-- 1. Tarifs tuteur par matière
CREATE TABLE IF NOT EXISTS tuteur_tarifs (
  id          BIGSERIAL PRIMARY KEY,
  tuteur_id   BIGINT NOT NULL REFERENCES utilisateurs(id) ON DELETE CASCADE,
  matiere     VARCHAR(150) NOT NULL,
  tarif_heure DECIMAL(10,2) NOT NULL CHECK (tarif_heure > 0),
  date_creation TIMESTAMP DEFAULT NOW(),
  UNIQUE(tuteur_id, matiere)
);

-- 2. Ajouter champ statut_paiement et montant aux séances
ALTER TABLE seances
  ADD COLUMN IF NOT EXISTS montant_total    DECIMAL(10,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS statut_paiement  VARCHAR(20)   DEFAULT 'EN_ATTENTE'
    CHECK (statut_paiement IN ('EN_ATTENTE','PAYE','REMBOURSE','GRATUIT'));

-- 3. Table Paiements
CREATE TABLE IF NOT EXISTS paiements (
  id                    BIGSERIAL PRIMARY KEY,
  seance_id             BIGINT REFERENCES seances(id) ON DELETE CASCADE,
  payeur_id             BIGINT REFERENCES utilisateurs(id) ON DELETE SET NULL,
  tuteur_id             BIGINT REFERENCES utilisateurs(id) ON DELETE SET NULL,
  montant_total         DECIMAL(10,2) NOT NULL,
  gain_tuteur           DECIMAL(10,2) NOT NULL,
  commission_plateforme DECIMAL(10,2) NOT NULL,
  methode               VARCHAR(50)   NOT NULL CHECK (methode IN ('CIH','ATTIJARIWAFA','PAYPAL')),
  statut                VARCHAR(20)   DEFAULT 'COMPLETE' CHECK (statut IN ('COMPLETE','REMBOURSE')),
  reference             VARCHAR(100)  UNIQUE,
  donnees_carte         JSONB,        -- derniers 4 chiffres seulement (pas données sensibles)
  date_paiement         TIMESTAMP DEFAULT NOW(),
  date_remboursement    TIMESTAMP
);

-- 4. Indexes
CREATE INDEX IF NOT EXISTS idx_paiements_seance  ON paiements(seance_id);
CREATE INDEX IF NOT EXISTS idx_paiements_payeur  ON paiements(payeur_id);
CREATE INDEX IF NOT EXISTS idx_paiements_tuteur  ON paiements(tuteur_id);
CREATE INDEX IF NOT EXISTS idx_tarifs_tuteur     ON tuteur_tarifs(tuteur_id);

-- 5. Taux de commission plateforme (configurable)
CREATE TABLE IF NOT EXISTS config_plateforme (
  cle   VARCHAR(100) PRIMARY KEY,
  valeur VARCHAR(255) NOT NULL
);

INSERT INTO config_plateforme (cle, valeur) VALUES
  ('commission_taux', '0.15'),
  ('commission_min',  '10')
ON CONFLICT (cle) DO NOTHING;
-- ═══════════════════════════════════════════════════════════════════
-- MIGRATION COMPLÉMENTAIRE SmartTutor
-- À exécuter en plus de ta migration paiement déjà faite
-- ═══════════════════════════════════════════════════════════════════

-- 1. Nouveaux statuts de séance (CONFIRMEE + EN_ATTENTE_PAIEMENT)
--    Le ALTER TYPE ne supporte pas IF NOT EXISTS → on utilise DO $$ ... $$
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumlabel = 'CONFIRMEE'
      AND enumtypid = 'statut_seance'::regtype
  ) THEN
    ALTER TYPE statut_seance ADD VALUE 'CONFIRMEE';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumlabel = 'EN_ATTENTE_PAIEMENT'
      AND enumtypid = 'statut_seance'::regtype
  ) THEN
    ALTER TYPE statut_seance ADD VALUE 'EN_ATTENTE_PAIEMENT';
  END IF;
END $$;

-- 2. Gamification — table points par utilisateur
CREATE TABLE IF NOT EXISTS points_utilisateur (
  id             BIGSERIAL PRIMARY KEY,
  utilisateur_id BIGINT NOT NULL REFERENCES utilisateurs(id) ON DELETE CASCADE,
  points         INT DEFAULT 0,
  niveau         INT DEFAULT 1,
  seances_total  INT DEFAULT 0,
  UNIQUE(utilisateur_id)
);

-- 3. Gamification — historique des points gagnés
CREATE TABLE IF NOT EXISTS historique_points (
  id             BIGSERIAL PRIMARY KEY,
  utilisateur_id BIGINT REFERENCES utilisateurs(id) ON DELETE CASCADE,
  seance_id      BIGINT REFERENCES seances(id) ON DELETE SET NULL,
  points_gagnes  INT NOT NULL,
  raison         VARCHAR(200),
  date_action    TIMESTAMP DEFAULT NOW()
);

-- Index utiles
CREATE INDEX IF NOT EXISTS idx_points_user    ON points_utilisateur(utilisateur_id);
CREATE INDEX IF NOT EXISTS idx_hpoints_user   ON historique_points(utilisateur_id);
CREATE INDEX IF NOT EXISTS idx_hpoints_seance ON historique_points(seance_id);

-- Indexes
CREATE INDEX idx_participations_salle ON participations(salle_id);
CREATE INDEX idx_participations_user ON participations(utilisateur_id);
CREATE INDEX idx_messages_salle ON messages(salle_id);
CREATE INDEX idx_seances_salle ON seances(salle_id);
CREATE INDEX idx_invitations_destinataire ON invitations(destinataire_id);
CREATE INDEX idx_invitations_salle ON invitations(salle_id);
-- ═══════════════════════════════════════════════════════════════════
-- MIGRATION FINALE SmartTutor
-- À exécuter UNE SEULE FOIS sur ta base existante
-- ═══════════════════════════════════════════════════════════════════

-- ─── 1. Nouveaux statuts séance ─────────────────────────────────────────────
-- Ton enum actuel : PLANIFIEE, EN_COURS, REALISEE, ANNULEE
-- On ajoute : EN_ATTENTE_PAIEMENT + CONFIRMEE
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumlabel = 'EN_ATTENTE_PAIEMENT'
      AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'statut_seance')
  ) THEN
    ALTER TYPE statut_seance ADD VALUE 'EN_ATTENTE_PAIEMENT';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumlabel = 'CONFIRMEE'
      AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'statut_seance')
  ) THEN
    ALTER TYPE statut_seance ADD VALUE 'CONFIRMEE';
  END IF;
END $$;

-- ─── 2. Colonne created_at sur seances ──────────────────────────────────────
-- Utilisée par le cron annulerSeancesNonPayees pour calculer les 24h
ALTER TABLE seances
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT NOW();

-- ─── 3. Colonne duree_reelle_minutes sur sessions_appel ─────────────────────
-- Utilisée par call:end dans le socket pour sauvegarder la durée réelle
ALTER TABLE sessions_appel
  ADD COLUMN IF NOT EXISTS duree_reelle_minutes INT DEFAULT 0;

-- ─── 4. C'est tout. ─────────────────────────────────────────────────────────
-- Ces tables existent déjà dans ton schema (tu les as déjà créées) :
--   ✅ tuteur_tarifs          (ta migration paiement)
--   ✅ paiements              (ta migration paiement)
--   ✅ config_plateforme      (ta migration paiement)
--   ✅ disponibilites_tuteur  (ton schema original)
--   ✅ statut_paiement        (ta migration paiement ALTER TABLE seances)
--   ✅ montant_total          (ta migration paiement ALTER TABLE seances)
--   ✅ indexes paiements      (ta migration paiement)

-- Admin account initial
INSERT INTO utilisateurs (prenom, nom, email, mot_de_passe, role)
VALUES ('Admin', 'General', 'admin@smarttutor.com', 'admin123', 'admin');
-- Password: password (bcrypt hash)