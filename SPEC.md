# Spécification — DayTrack

## Objectif

Webapp locale (via Docker) pour gérer le suivi du temps de travail quotidien, avec une granularité de 15 minutes. Remplace un tableur devenu trop contraignant.

## Fonctionnalités cibles

- Saisir les temps passés sur des tickets (type Jira)
- Visualiser l'avancement de la journée en temps réel
- Vérifier si le temps cible journalier est atteint
- Gérer les dépassements ou manques d'heures (report d'un jour à l'autre)
- Distinguer les temps de travail des pauses (non comptabilisées)
- Générer un récapitulatif clair de la journée
- À terme : synchroniser les temps avec Jira via API

## Philosophie

- Remplacer un tableur par une vraie UI métier
- Objectif de saisie : < 2 minutes par jour
- Garder de la flexibilité (comme Excel) sans la complexité
- Centraliser toute la logique dans une app simple et maintenable

## Stack technique

**Backend**
- Symfony 8 + Doctrine ORM + SQLite (local, sans dépendance externe)
- API REST (préfixe `/api/`)

**Frontend**
- React 19 + Tailwind CSS v4
- SPA intégrée dans Symfony via Webpack Encore
- Servi par Symfony — pas de serveur séparé

**Infrastructure**
- Docker Compose + FrankenPHP (Caddy + PHP 8.5)
- Monorepo unique Symfony

## Architecture frontend

- `assets/app.jsx` → point d'entrée React
- `templates/base.html.twig` → shell HTML avec `<div id="app">`
- `public/build/` → assets compilés
- React gère toute l'UI, consomme l'API Symfony

## Cœur de l'application

**Timeline journalière interactive** découpée en blocs de 15 minutes :
- Assignation rapide de tickets à des blocs (clic ou drag)
- Marquage des pauses (non comptabilisées dans le temps de travail)
- Visualisation de l'avancement en temps réel

## Plan MVP

### 1. Backend — Modèle de données
- Entité `WorkDay` : date, objectif heures, report de la veille
- Entité `TimeEntry` : référence ticket, début, fin, type (travail | pause)

### 2. Backend — API REST
- `GET/POST /api/days/{date}` — récupérer ou créer une journée
- `GET/POST /api/days/{date}/entries` — lister / créer des entrées
- `PUT/DELETE /api/days/{date}/entries/{id}` — modifier / supprimer

**Règles métier :**
- Interdire la création d'une journée au-delà de J+1 (le lendemain est autorisé, pas au-delà)

### 3. Frontend — Timeline
- Grille journalière en blocs de 15 min
- Assignation d'un ticket par bloc
- Marquage des pauses
- Indicateur visuel d'avancement (heures cibles atteintes ou non)

### 4. Frontend — Récapitulatif
- Total travaillé / objectif / delta
- Liste des tickets avec temps cumulé

## Évolutions prévues (post-MVP)

- Synchronisation automatique avec Jira (API)
- Gestion des tickets favoris
- Auto-complétion des tickets
- Statistiques hebdomadaires
- Export des données