# DayTrack

chec

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

---

## Déploiement en production (auto-hébergé)

### Prérequis

- Docker Engine 24+ avec le plugin Compose v2
- Git

### Installation initiale

**1. Cloner le dépôt**

```bash
git clone <url-du-repo> daytrack
cd daytrack
```

**2. Créer le fichier de configuration**

```bash
cp .env .env.local
```

Éditer `.env.local` et renseigner les valeurs suivantes :

```dotenv
# Clé secrète Symfony — générer avec : openssl rand -hex 32
APP_SECRET=remplacer_par_une_vraie_cle_secrete

# URL publique de l'application
SERVER_NAME=daytrack.mondomaine.com

# JIRA (optionnel — laisser vide si non utilisé)
JIRA_BASE_URL=https://monentreprise.atlassian.net
JIRA_USER_EMAIL=prenom.nom@monentreprise.com
JIRA_API_TOKEN=mon_token_api_jira
```

Pour générer un `APP_SECRET` sécurisé :

```bash
openssl rand -hex 32
```

**3. Builder et démarrer**

```bash
docker compose -f compose.yaml -f compose.prod.yaml build --pull --no-cache
docker compose -f compose.yaml -f compose.prod.yaml up -d --wait
```

Le démarrage exécute automatiquement les migrations Doctrine. L'application est prête quand le healthcheck passe.

**4. Vérifier que tout fonctionne**

```bash
docker compose -f compose.yaml -f compose.prod.yaml ps
docker compose -f compose.yaml -f compose.prod.yaml logs php
```

L'application est accessible sur **https://daytrack.localhost** (ou l'URL définie dans `SERVER_NAME`). Caddy gère automatiquement le certificat TLS via Let's Encrypt.

> **Note** : Le port 80 et 443 doivent être accessibles depuis Internet pour que Let's Encrypt puisse émettre le certificat.

---

### Mise à jour

Pour déployer une nouvelle version :

```bash
git pull
docker compose -f compose.yaml -f compose.prod.yaml build --pull
docker compose -f compose.yaml -f compose.prod.yaml up -d --wait
```

Le conteneur redémarre avec la nouvelle image. Les migrations sont jouées automatiquement au démarrage. La base de données est préservée dans le volume Docker `db_data`.

---

### Données et sauvegardes

La base de données SQLite est stockée dans un volume Docker nommé `db_data`, monté sur `/app/db` dans le conteneur.

Pour sauvegarder :

```bash
docker compose -f compose.yaml -f compose.prod.yaml exec php cp /app/db/data_prod.db /tmp/backup.db
docker compose -f compose.yaml -f compose.prod.yaml cp php:/tmp/backup.db ./backup-$(date +%Y%m%d).db
```

Pour restaurer :

```bash
docker compose -f compose.yaml -f compose.prod.yaml cp ./backup-20260101.db php:/app/db/data_prod.db
docker compose -f compose.yaml -f compose.prod.yaml restart php
```

---

### Commandes utiles en prod

```bash
# Voir les logs en temps réel
docker compose -f compose.yaml -f compose.prod.yaml logs -f php

# Lancer une commande Symfony
docker compose -f compose.yaml -f compose.prod.yaml exec php php bin/console <commande>

# Ouvrir un shell
docker compose -f compose.yaml -f compose.prod.yaml exec php sh

# Arrêter l'application
docker compose -f compose.yaml -f compose.prod.yaml down
```
