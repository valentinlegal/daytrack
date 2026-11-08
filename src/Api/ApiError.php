<?php

namespace App\Api;

use Symfony\Component\HttpFoundation\Response;

/**
 * Les codes des refus de l'API, tels que le navigateur les lit dans « error ».
 */
enum ApiError: string
{
    case BadRequest = 'bad_request';
    case NotFound = 'not_found';
    case MethodNotAllowed = 'method_not_allowed';
    case UnsupportedMediaType = 'unsupported_media_type';
    /** Une saisie refusée : chaque message se dit sous son champ. */
    case Invalid = 'invalid';
    /** Une autre page que celle de DayTrack a voulu le faire écrire. */
    case CrossOrigin = 'cross_origin';
    /** Ce que l'écran a vu a changé depuis, dans un autre onglet : rien n'est écrit. */
    case Stale = 'stale';
    /** Un envoi de la journée est déjà en cours. */
    case Sending = 'sending';
    /** La journée n'a rien à envoyer. */
    case Nothing = 'nothing';
    /** DayTrack n'est pas relié à Jira. */
    case Unlinked = 'unlinked';

    /** Le code d'un refus levé par Symfony, d'après son statut ; null pour un statut sans code à lui. */
    public static function ofStatus(int $status): ?self
    {
        return match ($status) {
            Response::HTTP_BAD_REQUEST => self::BadRequest,
            Response::HTTP_NOT_FOUND => self::NotFound,
            Response::HTTP_METHOD_NOT_ALLOWED => self::MethodNotAllowed,
            Response::HTTP_UNSUPPORTED_MEDIA_TYPE => self::UnsupportedMediaType,
            Response::HTTP_UNPROCESSABLE_ENTITY => self::Invalid,
            default => null,
        };
    }

    /**
     * Le début de la réponse qui le dit.
     *
     * @return array{error: string}
     */
    public function body(): array
    {
        return ['error' => $this->value];
    }
}
