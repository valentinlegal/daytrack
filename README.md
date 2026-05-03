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

### Mise à jour

```bash
docker compose pull
docker compose up -d
```

### Données et sauvegardes

La base de données SQLite est stockée dans le dossier `./data/` créé automatiquement à côté du `docker-compose.yml`.

```bash
# Sauvegarder
cp ./data/data_prod.db ./backup-$(date +%Y%m%d).db

# Restaurer
docker compose down
cp ./backup-20260101.db ./data/data_prod.db
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
