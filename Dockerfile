# syntax=docker/dockerfile:1

# Étage commun : FrankenPHP et PHP 8.5, rien d'autre.
#
# Toutes les extensions dont DayTrack a besoin y sont déjà — pdo_sqlite, sodium,
# mbstring, ctype, iconv, OPcache — : la production n'en installe aucune, et pèse
# ce que pèse cette base.
#
# Épinglée par empreinte, et non par l'étiquette mouvante « 1.13.4-php8.5-alpine » :
# deux constructions à un mois d'écart donnent alors exactement le même PHP. Cette
# empreinte se remonte volontairement, par un commit comme un autre. Elle est celle
# de la liste multi-architecture : les deux architectures tirent la même version.
FROM dunglas/frankenphp@sha256:974e767f7694964fdb23ead3172dd0a12cedefbd929fbe0db7f69a680663295d AS base

WORKDIR /app

COPY --link frankenphp/Caddyfile /etc/frankenphp/Caddyfile
COPY --link frankenphp/conf.d/10-app.ini $PHP_INI_DIR/conf.d/


# Étage de développement : l'étage commun, plus le confort qui n'a rien à faire en
# production. Le code est monté depuis le poste au lieu d'être copié.
FROM base AS dev

# « bash » : l'image est Alpine, et « docker compose exec app bash » — la première
# chose qu'on tape pour aller voir — échoue sans lui.
RUN apk add --no-cache bash \
 && install-php-extensions @composer \
 && mv "$PHP_INI_DIR/php.ini-development" "$PHP_INI_DIR/php.ini"

# Composer tourne en administrateur dans ce conteneur, et c'est voulu : le code
# appartient au poste, monté tel quel.
ENV COMPOSER_ALLOW_SUPERUSER=1

# La ligne de commande a droit à 1 Go, contre 128 Mo par défaut : c'est là que
# tournent l'analyse statique et les tests, et l'analyse plante dès que son cache
# est froid. « php-cli.ini » et non « conf.d » : PHP ne lit ce fichier que pour la
# ligne de commande, et les pages gardent 128 Mo, comme en production, pour qu'une
# page trop gourmande casse ici avant de casser chez un utilisateur. Il remplace
# « php.ini » pour la ligne de commande : ce qu'il ne redit pas reprend la valeur
# par défaut de PHP, pas celle du développement.
RUN cp "$PHP_INI_DIR/php.ini" "$PHP_INI_DIR/php-cli.ini" \
 && printf '\nmemory_limit = 1G\n' >> "$PHP_INI_DIR/php-cli.ini"


# Les dépendances PHP de production et le cache de Symfony, construits à part :
# Composer sert ici et ne va pas plus loin.
FROM base AS vendor

RUN install-php-extensions @composer

ENV APP_ENV=prod \
    APP_DEBUG=0

# Les dépendances d'abord : cette couche n'est reconstruite que si
# composer.json ou composer.lock changent.
COPY --link composer.json composer.lock symfony.lock .env ./
RUN composer install --no-dev --no-scripts --no-autoloader \
        --prefer-dist --no-progress --no-interaction

# Puis le code, dossier par dossier : seul ce qui sert à faire tourner l'application
# entre. Les sources du navigateur restent dehors, seule leur compilation entre plus
# bas. Le Jira simulé, les tests et l'outillage sont en plus écartés par
# .dockerignore : deux barrières plutôt qu'une.
COPY --link bin/console bin/
COPY --link config/ config/
COPY --link migrations/ migrations/
COPY --link public/ public/
COPY --link src/ src/
COPY --link templates/ templates/
COPY --link version.txt LICENSE ./

RUN composer dump-autoload --classmap-authoritative --no-dev \
 && composer dump-env prod \
 && php bin/console cache:warmup --no-interaction


# Les fichiers du navigateur, compilés à part : Node sert ici et ne va pas plus loin.
# Debian plutôt qu'Alpine : c'est la même image que le développement, et les
# modules natifs de la compilation (Tailwind, Lightning CSS) y sont les mêmes.
FROM node@sha256:54f84b4cf8432b21aaffd5d3ce8d41e12cea0d10d33c09d2f3c9879d49d6b446 AS assets

WORKDIR /app

COPY --link package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY --link webpack.config.js tsconfig.json postcss.config.js version.txt ./
COPY --link assets/ assets/
RUN npm run build


# L'image publiée : l'étage commun, le code, ses dépendances de production et les
# fichiers du navigateur déjà compilés. Ni Composer, ni Node, ni outil de test.
FROM base AS prod

ENV APP_ENV=prod \
    APP_DEBUG=0

RUN mv "$PHP_INI_DIR/php.ini-production" "$PHP_INI_DIR/php.ini"

# L'utilisateur 33 est celui qui écrivait la base de la v1 : sa base vit dans le
# même volume, et la v2 doit pouvoir y écrire sans qu'on touche à ses droits. Il ne
# porte pas de nom ici, et n'en a pas besoin. Il ouvre les ports 80 et 443 sans être
# administrateur : l'image de FrankenPHP a déjà donné cette seule capacité au
# programme. La redonner ici recopierait ses 54 Mo dans une couche de plus.
#
# Le code reste au superutilisateur, en lecture seule pour l'application : seuls
# var/ (le cache) et db/ (la base) lui appartiennent.
COPY --link --from=vendor /app /app
COPY --link --from=assets /app/public/build /app/public/build
COPY --link --chmod=755 frankenphp/docker-entrypoint.sh /usr/local/bin/daytrack-entrypoint

RUN mkdir -p /app/db /data/caddy /config/caddy \
 && chown -R 33:33 /app/var /app/db /data /config

USER 33:33

# La base, et l'autorité locale qui signe le certificat : une installation qui ne
# monterait pas /data en refabriquerait une à chaque mise à jour, et le navigateur
# redemanderait d'approuver le certificat.
VOLUME /app/db /data
EXPOSE 80 443

# La base à jour avant de servir : les migrations, puis la reprise de la v1. Changer
# le point d'entrée oublie la commande de l'étage commun : elle se redit, telle quelle.
ENTRYPOINT ["daytrack-entrypoint"]
CMD ["--config", "/etc/frankenphp/Caddyfile", "--adapter", "caddyfile"]
