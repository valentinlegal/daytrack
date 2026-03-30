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
- Copy/paste entre créneaux
- Navigation entre les jours (J-30 à J+30)
- Indicateur "maintenant" (ligne rouge) positionné à l'heure exacte dans le créneau courant, mis à jour à la minute, uniquement sur le jour en cours

### Récapitulatif
- Objectif journalier / total travaillé / solde (dans cet ordre)
- Objectif journalier éditable inline (formats : `7h30`, `7:30`, `7.5`, `8`)
- Heure de fin estimée : basée sur l'heure actuelle (floor au quart d'heure inférieur) + minutes restantes ; tient compte des créneaux déjà saisis dont la fin dépasse l'heure actuelle ; affichée uniquement pour le jour en cours et si solde négatif ; affiche `> 23:59` si dépassement minuit ; mise à jour automatique au quart d'heure

### Synchronisation JIRA (JIRA Cloud REST API v3)

**Comportement :**
- Bouton "Sync JIRA" dans le récapitulatif (caché si JIRA non configuré)
- Modal de confirmation avant sync (avertit que les worklogs JIRA du jour seront écrasés)
- Groupement des entrées par `(ticketKey, commentaire)` — les entrées fragmentées sont fusionnées
- Filtrage des commentaires identiques au titre du ticket JIRA (sans valeur ajoutée)
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

**Indicateur de statut :**
- `jiraSyncedAt` sur `WorkDay` → vert "Synchronisé à HH:mm"
- Reset à `null` à chaque modification d'entrée → orange "Non synchronisé"

**Configuration (variables d'env) :**
- `JIRA_BASE_URL` — ex: `https://monentreprise.atlassian.net`
- `JIRA_USER_EMAIL` — email du compte Atlassian
- `JIRA_API_TOKEN` — token généré sur id.atlassian.com → Security → API tokens

### Production
- Image Docker multi-stage avec assets npm compilés
- Volume Docker `db_data` pour persister la SQLite
- Migrations jouées automatiquement au démarrage (`docker-entrypoint.sh`)
- Ports configurables via `.env.local` (`HTTP_PORT`, `HTTPS_PORT`)
- TLS automatique via Let's Encrypt (Caddy)

## Évolutions possibles (post-V1)

- Auto-complétion des tickets JIRA
- Gestion des tickets favoris
- Statistiques hebdomadaires
- Export des données