# DayTrack

Une webapp pour suivre facilement son temps de travail au quotidien, avec intégration Jira.

## Installation (auto-hébergement)

> Usage **personnel** — à déployer sur votre propre machine, **non exposée au public**.

### Prérequis

- Docker Engine 24+ avec le plugin Compose v2

### Démarrer

```bash
curl -O https://raw.githubusercontent.com/valentinlegal/daytrack/main/docker-compose.yml
docker compose up -d
```

L'application est accessible sur **https://daytrack.localhost**.

Pour utiliser un domaine personnalisé, éditer `docker-compose.yml` et remplacer `daytrack.localhost` par votre domaine. Caddy gère automatiquement le certificat TLS via Let's Encrypt (ports 80 et 443 doivent être accessibles depuis Internet).

### Configuration de l'intégration Jira (optionnel)

L'intégration Jira permet de synchroniser automatiquement vos entrées de temps sous forme de *worklogs* dans Jira.

#### Jeton avec périmètres (recommandé)

Les jetons avec périmètres limitent l'accès à ce dont DayTrack a strictement besoin, contrairement aux jetons classiques qui ont les mêmes droits que votre compte.

**Périmètres requis :** `read:jira-work` et `write:jira-work`

**Étapes :**

1. Rendez-vous sur **https://id.atlassian.com/manage-profile/security/api-tokens**
2. Cliquez sur **"Create API token with scopes"** (et non "Create API token")
3. Donnez un nom au jeton (ex : `DayTrack`) et choisissez une date d'expiration
4. Sélectionnez l'application **Jira**
5. Cochez les périmètres **`read:jira-work`** et **`write:jira-work`**
6. Cliquez sur **Create** et copiez le jeton immédiatement (il ne sera plus affiché)

**Trouver votre Cloud ID** (nécessaire pour les jetons avec périmètres) :

```bash
curl https://monentreprise.atlassian.net/_edge/tenant_info
```

**Variables d'environnement à configurer** dans `docker-compose.yml` (ou `.env`) :

```yaml
environment:
  JIRA_BASE_URL: https://api.atlassian.com/ex/jira/<CLOUD_ID>
  JIRA_USER_EMAIL: prenom.nom@monentreprise.com
  JIRA_API_TOKEN: <JETON>
  JIRA_TICKET_TYPES: Story:green,Bug:red,Epic:purple,Task:blue # optionnel
```

#### Jeton classique (périmètre total)

Si vous préférez utiliser un jeton classique (droits complets), la configuration est la même mais l'URL de base est différente :

```yaml
environment:
  JIRA_BASE_URL: https://monentreprise.atlassian.net
  JIRA_USER_EMAIL: prenom.nom@monentreprise.com
  JIRA_API_TOKEN: <JETON>
```

---

### Mise à jour

```bash
docker compose pull
docker compose up -d
```

### Données et sauvegardes

La base de données SQLite est stockée dans le volume Docker `db_data`, géré automatiquement.

```bash
# Sauvegarder
docker compose cp daytrack:/app/db/data_prod.db ./backup-$(date +%Y%m%d).db

# Restaurer
docker compose down
docker compose run --rm -v "$(pwd)/backup-20260101.db:/tmp/restore.db" daytrack cp /tmp/restore.db /app/db/data_prod.db
docker compose up -d
```

### Commandes utiles

```bash
# Voir les logs
docker compose logs -f

# Lancer une commande Symfony
docker compose exec daytrack php bin/console <commande>

# Ouvrir un shell
docker compose exec daytrack sh

# Arrêter
docker compose down
```

---

## Mode développement

Ce projet est basé sur le template [symfony-docker](https://github.com/dunglas/symfony-docker) de [Kévin Dunglas](https://dunglas.dev).

```bash
docker compose build --pull --no-cache
docker compose up --wait
```

L'application est accessible sur **https://daytrack.localhost**.

Pour faire confiance au certificat TLS auto-signé généré par Caddy :

```bash
# Linux
docker cp $(docker compose ps -q php):/data/caddy/pki/authorities/local/root.crt /usr/local/share/ca-certificates/root.crt && sudo update-ca-certificates

# Mac
docker cp $(docker compose ps -q php):/data/caddy/pki/authorities/local/root.crt /tmp/root.crt && sudo security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain /tmp/root.crt

# Windows
docker compose cp php:/data/caddy/pki/authorities/local/root.crt %TEMP%/root.crt && certutil -addstore -f "ROOT" %TEMP%/root.crt
```
