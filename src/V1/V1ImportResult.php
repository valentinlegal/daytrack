<?php

namespace App\V1;

/**
 * Ce que le démarrage a trouvé, pour le dire dans le journal du conteneur.
 */
enum V1ImportResult
{
    /** Pas de base de la v1 : une installation neuve. */
    case NoV1Base;
    /** La reprise a déjà eu lieu : seuls les réglages font foi désormais. */
    case AlreadyDone;
    /** Elle a déjà eu lieu, mais la v1 a écrit dans sa base depuis : cela ne se reprend pas. */
    case V1ChangedSince;
    /** La v2 a déjà des données à elle, jamais reprises : rien ne s'y mêle. */
    case V2InUse;
    case Done;
}
