<?php

namespace App\Api;

use Symfony\Component\HttpKernel\Attribute\MapRequestPayload;
use Symfony\Component\Serializer\Normalizer\AbstractNormalizer;
use Symfony\Component\Serializer\Normalizer\DenormalizerInterface;

/**
 * Le corps JSON d'une requête, lu en saisie : un champ inconnu — « commentaire » pour
 * « comment » — se refuse sous son nom, comme une valeur de travers, au lieu de
 * disparaître sans erreur.
 *
 * Toute route qui lit son corps passe par lui (tests/Api/UnknownFieldTest.php). Pas par
 * le contexte par défaut du sérialiseur : il vaut aussi pour les réponses, dont il
 * viderait les objets sans propriétés déclarées.
 */
#[\Attribute(\Attribute::TARGET_PARAMETER)]
final class JsonPayload extends MapRequestPayload
{
    public function __construct()
    {
        parent::__construct(acceptFormat: 'json', serializationContext: [
            AbstractNormalizer::ALLOW_EXTRA_ATTRIBUTES => false,
            DenormalizerInterface::COLLECT_EXTRA_ATTRIBUTES_ERRORS => true,
        ]);
    }
}
