# Spécification — DayTrack

## Objectif

Webapp auto-hébergée (via Docker) pour gérer le suivi du temps de travail quotidien, avec une granularité de 15 minutes. Remplace un tableur devenu trop contraignant.

## Fonctionnalités cibles

- Saisir les temps passés sur des tickets (type Jira)
- Visualiser l'avancement de la journée en temps réel
- Vérifier si le temps cible journalier est atteint
- Gérer les dépassements ou manques d'heures
- Distinguer les temps de travail des pauses (non comptabilisées)
- Générer un récapitulatif clair de la journée
- Synchroniser les temps avec Jira via API

## Philosophie

- Remplacer un tableur par une vraie UI métier
- Objectif de saisie : < 2 minutes par jour
- Garder de la flexibilité (comme Excel) sans la complexité
- Centraliser toute la logique dans une app simple et maintenable

## Stack technique

**Backend**
- Symfony 8 + Doctrine ORM + SQLite (local, sans dépendance externe)
- API REST (préfixe `/api/`)
- `symfony/http-client` pour les appels JIRA

**Frontend**
- React 19 + Tailwind CSS v4
- SPA intégrée dans Symfony (Webpack Encore)
- Servi par Symfony — pas de serveur séparé

**Infrastructure**
- Docker Compose + FrankenPHP (Caddy + PHP 8.5)
- Monorepo unique Symfony
- Build multi-stage (dev / prod) avec assets npm compilés dans l'image

## Architecture frontend dans Symfony

- `/assets/` → code React (point d'entrée : `assets/app.tsx`)
- `/templates/base.html.twig` → shell HTML avec `<div id="app">`
- `/public/build/` → assets compilés par Webpack Encore
- React monte dans `#app` et gère toute l'UI
- Config serveur → frontend via `data-*` attributes sur `#app` (ex: `data-jira-configured`)

## Fonctionnalités implémentées

### Timeline journalière
- Grille en blocs de 15 min (7h–20h)
- Assignation de tickets (format `PROJ-123`)
- Commentaire optionnel par entrée
- Marquage des pauses (non comptabilisées)
- Navigation entre les jours (J-30 à J+30)
- Indicateur "maintenant" (ligne rouge) positionné à l'heure exacte dans le créneau courant, mis à jour à la minute, uniquement sur le jour en cours
- Position de scroll mémorisée par jour en session

### Sélection multi-cellule
- Clic simple : sélectionne une cellule
- Clic-glisser, Shift+clic, Ctrl+clic : sélection étendue
- Touches fléchées (± Shift) pour naviguer et étendre la sélection
- Suppr / Backspace : efface les entrées sélectionnées
- Clic droit sur la sélection : menu contextuel (copier, couper, coller, effacer, convertir en pause)

### Copier / Coller en bloc
- Ctrl+C : copie toute la sélection comme un bloc — les offsets relatifs entre créneaux et les cellules vides explicitement sélectionnées sont préservés
- Ctrl+X : coupe la sélection — copie dans le presse-papier puis efface les entrées sélectionnées
- Ctrl+V avec 1 cellule cible : colle le bloc à partir de cette cellule (débordement tronqué silencieusement) ; une cellule vide copiée efface l'entrée destination
- Ctrl+V avec plusieurs cellules sélectionnées : modal d'avertissement ("sélectionne une seule cellule cible")
- Clic droit → Coller : colle toujours sur la cellule cliquée, sans modal
- Presse-papier stocké en `sessionStorage` (clé `daytrack_clipboard`)

### Undo / Redo
- Ctrl+Z / Ctrl+Shift+Z (ou Ctrl+Y) sur toutes les opérations (création, modification, suppression, coller, effacer, convertir en pause)
- Historique limité à 50 snapshots, persisté en `sessionStorage` par jour

### Récapitulatif
- Objectif journalier / total travaillé / solde (dans cet ordre)
- Objectif journalier éditable inline (formats : `7h30`, `7:30`, `7.5`, `8`)
- Heure de fin estimée : basée sur l'heure actuelle (floor au quart d'heure inférieur) + minutes restantes ; tient compte des créneaux déjà saisis dont la fin dépasse l'heure actuelle ; affichée uniquement pour le jour en cours et si solde négatif ; affiche `> 23:59` si dépassement minuit ; mise à jour automatique au quart d'heure
- **Récap tickets** : liste des tickets travaillés dans la journée, triés par temps passé décroissant — ID coloré par type, titre du ticket, durée totale, commentaires ; la ligne "(sans commentaire)" n'apparaît que si le ticket a aussi des entrées commentées

### Enrichissement des saisies via Jira

- À la saisie d'un ID ticket, le titre (`summary`) et le type sont récupérés via l'API Jira et stockés sur l'entrée (`ticketSummary`, `ticketType`)
- Les sous-tâches remontent le type du ticket parent (ex : Story plutôt que Sub-task)
- Cache 3 couches : `knownTickets` (entrées du jour en mémoire) → `sessionStorage` → appel API
- Mise à jour instantanée de la couleur depuis le cache local à chaque frappe ; appel API au blur ou à la validation (Enter) si le ticket a changé
- Si Jira est configuré et le ticket est introuvable, une erreur est affichée et la sauvegarde est bloquée
- Affichage en mode lecture : layout 2 colonnes (ID | titre + commentaire) si un titre est disponible
- Couleur par type configurable via `JIRA_TICKET_TYPES` dans `.env` (format : `Story:emerald,Bug:orange,...`) ; palette statique dans `assets/config/ticketTypeColors.ts` (contrainte Tailwind v4)
- Le bandeau gauche coloré (4 px) porte l'information de type ; fond neutre pour toutes les entrées WORK

### Synchronisation JIRA (JIRA Cloud REST API v3)

**Comportement :**
- Bouton icône dans le header (caché si JIRA non configuré), avec tooltip d'état
- Modal de confirmation avant sync (avertit que les worklogs JIRA du jour seront écrasés)
- Groupement des entrées par `(ticketKey, commentaire)` — les entrées fragmentées sont fusionnées
- Normalisation des commentaires **avant** le groupement pour fusionner correctement
- Gestion du cas "journée vidée" : nettoyage JIRA même si plus aucune entrée locale (via `jiraSyncedTickets`)
- Date des worklogs = date du jour synchronisé, heure fixée à 12h00 UTC

**Stratégie de déduplication :**
Delete-then-recreate sur les worklogs de l'utilisateur pour la journée. Pas de diff incrémental.

**Optimisation des requêtes :**
3 phases parallèles avec Symfony HttpClient (les requêtes sont firées avant d'être lues) :
1. Batch fetch titres (`/rest/api/3/search/jql`) + GET worklogs par ticket — en parallèle
2. DELETE worklogs existants — en parallèle
3. POST nouveaux worklogs — en parallèle

**Indicateur de statut (dirty detection côté frontend) :**
- Après une sync réussie, un fingerprint des entrées synchronisées est stocké en mémoire (`id:endedAt` de chaque entrée WORK avec ticket, triés et joints)
- Si les entrées n'ont pas changé depuis la dernière sync → icône verte "Synchronisé"
- Si des entrées ont changé depuis la dernière sync → icône orange "Modifié depuis la dernière sync"
- Jamais synchronisé mais des entrées syncables existent → icône orange
- `jiraSyncedAt` sur `WorkDay` persiste l'heure de dernière sync (affiché dans le tooltip)

**Configuration (variables d'env) :**
- `JIRA_BASE_URL` — ex: `https://monentreprise.atlassian.net`
- `JIRA_USER_EMAIL` — email du compte Atlassian
- `JIRA_API_TOKEN` — token généré sur id.atlassian.com → Security → API tokens
- `JIRA_TICKET_TYPES` — mapping type → couleur (ex: `Story:emerald,Bug:red,Epic:purple,Task:indigo`)

### Tickets favoris

- Liste de tickets fréquents dans la sidebar (section collapsible)
- Clic simple : copie le ticket dans le presse-papier interne de la timeline
- Double-clic : renommage inline avec un nom personnalisé (affiché à la place du titre Jira)
- Drag & drop pour réordonner la liste
- Drag vers une cellule de la timeline pour y déposer le ticket directement
- Coloré par type Jira (même palette que la timeline)
- Persisté côté serveur

### Production
- Image Docker multi-stage avec assets npm compilés
- Volume Docker `db_data` pour persister la SQLite
- Migrations jouées automatiquement au démarrage (`docker-entrypoint.sh`)
- Ports configurables via `.env.local` (`HTTP_PORT`, `HTTPS_PORT`)
- TLS automatique via Let's Encrypt (Caddy)

## Évolutions possibles (post-V1)

- Auto-complétion des tickets JIRA
- Statistiques hebdomadaires
- Export des données