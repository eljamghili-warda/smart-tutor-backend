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
-- ══════════════════════════════════════════════
-- MIGRATION FINALE SmartTutor (exécuter UNE fois)
-- ══════════════════════════════════════════════

-- Nouveaux statuts séance (si pas encore fait)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'EN_ATTENTE_PAIEMENT' AND enumtypid = 'statut_seance'::regtype) THEN
    ALTER TYPE statut_seance ADD VALUE 'EN_ATTENTE_PAIEMENT';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'CONFIRMEE' AND enumtypid = 'statut_seance'::regtype) THEN
    ALTER TYPE statut_seance ADD VALUE 'CONFIRMEE';
  END IF;
END $$;

-- Colonnes manquantes sur seances
ALTER TABLE seances
  ADD COLUMN IF NOT EXISTS montant_total    DECIMAL(10,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS statut_paiement  VARCHAR(20)   DEFAULT 'EN_ATTENTE'
    CHECK (statut_paiement IN ('EN_ATTENTE','PAYE','REMBOURSE','GRATUIT')),
  ADD COLUMN IF NOT EXISTS created_at       TIMESTAMP DEFAULT NOW();

-- Colonne durée réelle sur sessions_appel
ALTER TABLE sessions_appel
  ADD COLUMN IF NOT EXISTS duree_reelle_minutes INT DEFAULT 0;

-- Table tarifs tuteur
CREATE TABLE IF NOT EXISTS tuteur_tarifs (
  id            BIGSERIAL PRIMARY KEY,
  tuteur_id     BIGINT NOT NULL REFERENCES utilisateurs(id) ON DELETE CASCADE,
  matiere       VARCHAR(150) NOT NULL,
  tarif_heure   DECIMAL(10,2) NOT NULL CHECK (tarif_heure > 0),
  date_creation TIMESTAMP DEFAULT NOW(),
  UNIQUE(tuteur_id, matiere)
);
CREATE INDEX IF NOT EXISTS idx_tarifs_tuteur ON tuteur_tarifs(tuteur_id);

-- Table paiements
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
  donnees_carte         JSONB,
  date_paiement         TIMESTAMP DEFAULT NOW(),
  date_remboursement    TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_paiements_seance ON paiements(seance_id);
CREATE INDEX IF NOT EXISTS idx_paiements_payeur ON paiements(payeur_id);
CREATE INDEX IF NOT EXISTS idx_paiements_tuteur ON paiements(tuteur_id);

-- Table config plateforme
CREATE TABLE IF NOT EXISTS config_plateforme (
  cle    VARCHAR(100) PRIMARY KEY,
  valeur VARCHAR(255) NOT NULL
);
INSERT INTO config_plateforme (cle, valeur) VALUES
  ('commission_taux', '0.15'),
  ('commission_min',  '10')
ON CONFLICT (cle) DO NOTHING;
-- ═══════════════════════════════════════════════════════
-- MIGRATION : RIB tuteur pour virement automatique
-- Exécuter UNE SEULE FOIS sur votre base PostgreSQL
-- ═══════════════════════════════════════════════════════
ALTER TABLE tuteurs
  ADD COLUMN IF NOT EXISTS rib        VARCHAR(34),
  ADD COLUMN IF NOT EXISTS nom_banque VARCHAR(100);
  -- ═══════════════════════════════════════════════════════════════════════
-- MODULE EXAMENS & CERTIFICATS (à ajouter à ton schéma)
-- ═══════════════════════════════════════════════════════════════════════

-- 1. Table des examens
CREATE TABLE IF NOT EXISTS examens (
  id              BIGSERIAL PRIMARY KEY,
  salle_id        BIGINT NOT NULL REFERENCES salles(id) ON DELETE CASCADE,
  tuteur_id       BIGINT NOT NULL REFERENCES utilisateurs(id) ON DELETE CASCADE,
  titre           VARCHAR(255) NOT NULL,
  description     TEXT,
  note_passage    DECIMAL(5,2) NOT NULL DEFAULT 70.00 CHECK (note_passage BETWEEN 0 AND 100),
  duree_minutes   INT NOT NULL DEFAULT 30 CHECK (duree_minutes BETWEEN 5 AND 180),
  max_tentatives  INT DEFAULT NULL,  -- NULL = illimité
  statut          VARCHAR(20) DEFAULT 'BROUILLON' CHECK (statut IN ('BROUILLON','PUBLIE','ARCHIVE')),
  created_at      TIMESTAMP DEFAULT NOW(),
  published_at    TIMESTAMP
);

-- 2. Table des questions d'examen
CREATE TABLE IF NOT EXISTS questions_examen (
  id          BIGSERIAL PRIMARY KEY,
  examen_id   BIGINT NOT NULL REFERENCES examens(id) ON DELETE CASCADE,
  texte       TEXT NOT NULL,
  type        VARCHAR(20) NOT NULL DEFAULT 'QCM' CHECK (type IN ('QCM','VRAI_FAUX')),
  points      DECIMAL(5,2) NOT NULL DEFAULT 1.00 CHECK (points > 0),
  ordre       INT NOT NULL DEFAULT 1
);

-- 3. Table des réponses possibles par question
CREATE TABLE IF NOT EXISTS reponses_question (
  id           BIGSERIAL PRIMARY KEY,
  question_id  BIGINT NOT NULL REFERENCES questions_examen(id) ON DELETE CASCADE,
  texte        TEXT NOT NULL,
  est_correcte BOOLEAN NOT NULL DEFAULT false,
  ordre        INT NOT NULL DEFAULT 1
);

-- 4. Table des tentatives des étudiants
CREATE TABLE IF NOT EXISTS tentatives_examen (
  id              BIGSERIAL PRIMARY KEY,
  examen_id       BIGINT NOT NULL REFERENCES examens(id) ON DELETE CASCADE,
  etudiant_id     BIGINT NOT NULL REFERENCES utilisateurs(id) ON DELETE CASCADE,
  score_obtenu    DECIMAL(10,2) DEFAULT 0,
  score_max       DECIMAL(10,2) DEFAULT 0,
  pourcentage     DECIMAL(5,2)  DEFAULT 0,
  statut          VARCHAR(20) DEFAULT 'EN_COURS' CHECK (statut IN ('EN_COURS','REUSSI','ECHOUE')),
  started_at      TIMESTAMP DEFAULT NOW(),
  submitted_at    TIMESTAMP,
  expires_at      TIMESTAMP NOT NULL
);

-- 5. Table des réponses données par l'étudiant
CREATE TABLE IF NOT EXISTS reponses_etudiant (
  id            BIGSERIAL PRIMARY KEY,
  tentative_id  BIGINT NOT NULL REFERENCES tentatives_examen(id) ON DELETE CASCADE,
  question_id   BIGINT NOT NULL REFERENCES questions_examen(id)  ON DELETE CASCADE,
  reponse_id    BIGINT REFERENCES reponses_question(id) ON DELETE SET NULL,
  est_correcte  BOOLEAN DEFAULT false
);

-- 6. Table des certificats (table principale)
CREATE TABLE IF NOT EXISTS certificats (
  id                VARCHAR(36) PRIMARY KEY DEFAULT gen_random_uuid()::text,
  etudiant_id       BIGINT NOT NULL REFERENCES utilisateurs(id) ON DELETE CASCADE,
  examen_id         BIGINT NOT NULL REFERENCES examens(id) ON DELETE CASCADE,
  tentative_id      BIGINT NOT NULL REFERENCES tentatives_examen(id) ON DELETE CASCADE,
  numero_certificat VARCHAR(30) UNIQUE NOT NULL,
  score_obtenu      DECIMAL(5,2) NOT NULL,
  url_pdf           VARCHAR(500),
  est_valide        BOOLEAN NOT NULL DEFAULT true,
  date_emission     TIMESTAMP DEFAULT NOW(),
  UNIQUE(etudiant_id, examen_id)
);

-- ═══════════════════════════════════════════════════════════════════════
-- INDEXES (optimisation des performances)
-- ═══════════════════════════════════════════════════════════════════════

CREATE INDEX IF NOT EXISTS idx_examens_salle   ON examens(salle_id);
CREATE INDEX IF NOT EXISTS idx_examens_tuteur  ON examens(tuteur_id);
CREATE INDEX IF NOT EXISTS idx_examens_statut  ON examens(statut);

CREATE INDEX IF NOT EXISTS idx_questions_examen ON questions_examen(examen_id);
CREATE INDEX IF NOT EXISTS idx_reponses_question ON reponses_question(question_id);

CREATE INDEX IF NOT EXISTS idx_tentatives_examen   ON tentatives_examen(examen_id);
CREATE INDEX IF NOT EXISTS idx_tentatives_etudiant ON tentatives_examen(etudiant_id);
CREATE INDEX IF NOT EXISTS idx_tentatives_statut   ON tentatives_examen(statut);

CREATE INDEX IF NOT EXISTS idx_rep_etudiant_tentative ON reponses_etudiant(tentative_id);
CREATE INDEX IF NOT EXISTS idx_rep_etudiant_question  ON reponses_etudiant(question_id);

CREATE INDEX IF NOT EXISTS idx_certificats_etudiant ON certificats(etudiant_id);
CREATE INDEX IF NOT EXISTS idx_certificats_examen   ON certificats(examen_id);
CREATE INDEX IF NOT EXISTS idx_certificats_numero   ON certificats(numero_certificat);
CREATE INDEX IF NOT EXISTS idx_certificats_valide   ON certificats(est_valide);
-- ═══════════════════════════════════════════════════════════════
-- MIGRATION v2 — Module Examens complet
-- Ajoute les champs manquants + PDF certificat
-- ═══════════════════════════════════════════════════════════════

-- 1. Nouveaux champs sur la table examens
ALTER TABLE examens
  ADD COLUMN IF NOT EXISTS date_debut             TIMESTAMP,
  ADD COLUMN IF NOT EXISTS date_limite            TIMESTAMP,
  ADD COLUMN IF NOT EXISTS date_affichage_resultats TIMESTAMP,
  ADD COLUMN IF NOT EXISTS mode_affichage         VARCHAR(20) DEFAULT 'UNE_PAR_UNE' CHECK (mode_affichage IN ('UNE_PAR_UNE','LISTE_COMPLETE')),
  ADD COLUMN IF NOT EXISTS melanger_questions     BOOLEAN DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS melanger_reponses      BOOLEAN DEFAULT TRUE;

-- 2. Ajouter statut SOUMIS dans tentatives_examen
ALTER TABLE tentatives_examen
  DROP CONSTRAINT IF EXISTS tentatives_examen_statut_check;
ALTER TABLE tentatives_examen
  ADD CONSTRAINT tentatives_examen_statut_check
  CHECK (statut IN ('EN_COURS','SOUMIS','REUSSI','ECHOUE'));

-- 3. url_pdf déjà dans certificats — s'assurer qu'elle existe
ALTER TABLE certificats
  ADD COLUMN IF NOT EXISTS url_pdf VARCHAR(500);

-- 4. Index supplémentaires
CREATE INDEX IF NOT EXISTS idx_examens_date_debut  ON examens(date_debut);
CREATE INDEX IF NOT EXISTS idx_examens_date_limite ON examens(date_limite);
CREATE INDEX IF NOT EXISTS idx_tentatives_statut2  ON tentatives_examen(etudiant_id, statut);
-- Migration: ajouter date_specifique sur disponibilites_tuteur
ALTER TABLE disponibilites_tuteur
  ADD COLUMN IF NOT EXISTS date_specifique DATE;

-- Index pour les requêtes par date
CREATE INDEX IF NOT EXISTS idx_dispos_date ON disponibilites_tuteur(date_specifique);
CREATE INDEX IF NOT EXISTS idx_dispos_tuteur_date ON disponibilites_tuteur(tuteur_id, date_specifique);
-- 1. Nouveaux statuts pour la table paiements
ALTER TABLE paiements
  DROP CONSTRAINT IF EXISTS paiements_statut_check;
ALTER TABLE paiements
  ADD CONSTRAINT paiements_statut_check
  CHECK (statut IN ('COMPLETE','REMBOURSE','EN_ATTENTE_LIBERATION','LIBERE'));

-- 2. Nouveaux statuts_paiement pour la table seances
ALTER TABLE seances
  DROP CONSTRAINT IF EXISTS seances_statut_paiement_check;
ALTER TABLE seances
  ADD CONSTRAINT seances_statut_paiement_check
  CHECK (statut_paiement IN ('EN_ATTENTE','PAYE','REMBOURSE','EN_ATTENTE_LIBERATION','LIBERE'));
  ALTER TABLE seances
  ALTER COLUMN statut_paiement TYPE VARCHAR(30);
-- Colonne pour tracker si l'email a été envoyé (pour les tentatives REUSSI et ECHOUE)
ALTER TABLE tentatives_examen
  ADD COLUMN IF NOT EXISTS email_envoye BOOLEAN NOT NULL DEFAULT FALSE;
  -- ok
  ALTER TABLE paiements 
ALTER COLUMN statut TYPE VARCHAR(30);
ALTER TABLE seances 
ALTER COLUMN statut_paiement TYPE VARCHAR(30);

-- Colonne pour tracker si l'email certificat a été envoyé
ALTER TABLE certificats
  ADD COLUMN IF NOT EXISTS email_envoye BOOLEAN NOT NULL DEFAULT FALSE;
-- Admin account initial
INSERT INTO utilisateurs (prenom, nom, email, mot_de_passe, role)
VALUES ('Admin', 'General', 'admin@smarttutor.com', 'admin123', 'admin');
-- Password: password (bcrypt hash)