#!/bin/sh
#
# Le démarrage de l'image publiée : la base à jour avant de servir la moindre page.
#
#  1. Il reconnaît l'ancien docker-compose.yml de la v1, que la mise à jour ne peut pas
#     remplacer : il est hors de l'image. L'application le dira, tant qu'il est là : tel
#     que fourni (« default »), modifié (« custom ») ou derrière un proxy (« proxy »).
#  2. Il joue les migrations, puis reprend les données de la v1 s'il y en a. Une erreur
#     arrête tout : mieux vaut ne rien servir qu'une application vide, qui ferait croire
#     les journées perdues.
#  3. Il retire le jeton de ce que reçoit l'application qui sert les pages :
#     seule la reprise le lit, une seule fois.
#
set -eu

# Avec des options, l'image de FrankenPHP lance le serveur : c'est ce que fait sa commande
# par défaut. Une autre commande passée au conteneur — un « php bin/console » — ne déclenche rien de tout ça.
case "${1:-}" in
    frankenphp | -*) ;;
    *) exec docker-php-entrypoint "$@" ;;
esac

# Ce que la v1 écrivait dans son fichier, à la lettre.
V1_DEFAULT_SERVER_NAME='daytrack.localhost, php:80'

server_name="${SERVER_NAME:-}"
old_compose=''
case "$server_name" in
    *php:80*) old_compose='custom' ;;
esac
# JIRA_TICKET_TYPES : le fichier de la v1 le remplit toujours, même sans Jira, et le
# nouveau ne l'a pas. C'est ce qui reconnaît un fichier dont on a changé SERVER_NAME.
if [ -n "${JIRA_BASE_URL:-}${JIRA_USER_EMAIL:-}${JIRA_API_TOKEN:-}${JIRA_TICKET_TYPES:-}" ]; then
    old_compose='custom'
fi
if [ -n "$old_compose" ] && [ "$server_name" = "$V1_DEFAULT_SERVER_NAME" ]; then
    old_compose='default'
fi

# « php:80 » servait au fonctionnement interne de la v1. En v2, il ouvrirait un HTTP en
# clair à quiconque joint le port en annonçant ce nom : il se retire. Le reste est le
# choix de l'utilisateur, jusqu'à ce qu'il remplace le fichier.
case "$server_name" in
    *php:80*)
        server_name="$(printf '%s' "$server_name" | sed -E 's/(^|,)[[:space:]]*php:80[[:space:]]*/\1/g; s/,[[:space:]]*,/,/g; s/^[[:space:],]+//; s/[[:space:],]+$//')"
        if [ -n "$server_name" ]; then
            export SERVER_NAME="$server_name"
        else
            unset SERVER_NAME
        fi
        ;;
esac

# « :80 » : la v1 était servie derrière un proxy. Le remplacer par le nouveau fichier lui
# ferait perdre son adresse : on garde ce fichier, et on y change quelques lignes.
if [ -n "$old_compose" ] && [ "${SERVER_NAME:-}" = ':80' ]; then
    old_compose='proxy'
    # Le fichier de la v1 ne pouvait pas dire de croire ce proxy : la variable n'existait
    # pas. Sans elle, une écriture jugée sur son origine — sans Sec-Fetch-Site — se
    # refuserait : DayTrack se croirait en HTTP, et le navigateur en HTTPS.
    if [ -z "${TRUSTED_PROXIES:-}" ]; then
        export TRUSTED_PROXIES='private_ranges'
    fi
fi

php bin/console doctrine:migrations:migrate --no-interaction --allow-no-migration --all-or-nothing
php bin/console daytrack:import-v1

unset JIRA_BASE_URL JIRA_USER_EMAIL JIRA_API_TOKEN JIRA_TICKET_TYPES
export DAYTRACK_OLD_COMPOSE="$old_compose"

exec docker-php-entrypoint "$@"
