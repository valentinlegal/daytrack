<?php

namespace App\Controller\Api;

use App\Api\Input\JiraConnectionInput;
use App\Jira\JiraAcceptsConnection;
use App\Jira\JiraAccount;
use App\Jira\JiraConnected;
use App\Jira\JiraFailure;
use App\Jira\JiraLink;
use App\Jira\JiraLinkRefusal;
use Symfony\Bundle\FrameworkBundle\Controller\AbstractController;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpKernel\Attribute\MapRequestPayload;
use Symfony\Component\HttpKernel\Exception\UnprocessableEntityHttpException;
use Symfony\Component\Routing\Attribute\Route;
use Symfony\Component\Serializer\Normalizer\AbstractNormalizer;
use Symfony\Component\Serializer\Normalizer\DenormalizerInterface;
use Symfony\Component\Validator\ConstraintViolation;
use Symfony\Component\Validator\ConstraintViolationList;
use Symfony\Component\Validator\Exception\ValidationFailedException;

/**
 * La connexion à Jira : la lire, la tester, la garder, savoir si elle tient.
 *
 * Le jeton n'y entre que dans un sens : aucune réponse ne le rend, pas même chiffré, pas
 * même dans un refus. Un refus se dit sous le champ qu'il concerne : le jeton, ou
 * l'adresse quand Jira n'y répond pas.
 */
#[Route('/api/jira', format: 'json')]
final class JiraController extends AbstractController
{
    /** Un champ inconnu est refusé comme une valeur de travers, champ par champ. */
    private const array STRICT = [
        AbstractNormalizer::ALLOW_EXTRA_ATTRIBUTES => false,
        DenormalizerInterface::COLLECT_EXTRA_ATTRIBUTES_ERRORS => true,
    ];

    public function __construct(
        private readonly JiraLink $link,
    ) {
    }

    #[Route('', name: 'api_jira_show', methods: ['GET'])]
    public function show(): JsonResponse
    {
        return $this->state();
    }

    /** « Tester la connexion », sur la page de bienvenue : rien n'est gardé. */
    #[Route('/test', name: 'api_jira_test', methods: ['POST'])]
    public function test(#[MapRequestPayload(acceptFormat: 'json', serializationContext: self::STRICT)] JiraConnectionInput $input): JsonResponse
    {
        $connected = $this->link->test($input->address(), $input->email(), $input->token);

        return $connected instanceof JiraConnected
            ? $this->json(['account' => $connected->account->name])
            : throw $this->refusal($input, $connected);
    }

    /** « Commencer » et « Enregistrer » : la connexion se teste, puis se garde si elle marche. */
    #[Route('', name: 'api_jira_link', methods: ['PUT'])]
    public function link(#[MapRequestPayload(acceptFormat: 'json', serializationContext: self::STRICT)] JiraConnectionInput $input): JsonResponse
    {
        $connected = $this->link->link($input->address(), $input->email(), $input->token);

        return $connected instanceof JiraConnected ? $this->state() : throw $this->refusal($input, $connected);
    }

    /**
     * Le jeton enregistré passe-t-il toujours ? L'écran le demande à son ouverture, et
     * la réponse décide du bandeau.
     */
    #[Route('/check', name: 'api_jira_check', methods: ['POST'])]
    public function check(): JsonResponse
    {
        $outcome = $this->link->check();

        return $this->json([
            'status' => match (true) {
                null === $outcome => 'not_linked',
                $outcome instanceof JiraAccount => 'connected',
                default => $outcome->value,
            },
            'account' => $outcome instanceof JiraAccount ? $outcome->name : null,
            'missingScopes' => $this->link->current()->missingScopes ?? [],
        ]);
    }

    private function state(): JsonResponse
    {
        $connection = $this->link->current();

        return $this->json(null === $connection ? ['linked' => false] : [
            'linked' => true,
            'site' => $connection->site,
            'email' => $connection->email,
            'account' => $connection->accountName,
            'refusal' => $connection->refusal?->value,
            'missingScopes' => $connection->missingScopes,
        ]);
    }

    /** Le refus de la connexion, sous le champ qu'il concerne. */
    private function refusal(JiraConnectionInput $input, JiraFailure|JiraLinkRefusal $refusal): UnprocessableEntityHttpException
    {
        $sameAccount = null === $input->token && $input->email === $this->link->current()?->email;

        [$field, $message] = match ($refusal) {
            JiraLinkRefusal::TokenMissing => ['token', 'Indiquez votre jeton d\'API.'],
            JiraLinkRefusal::TokenStaysHome => ['token', 'Pour une adresse qui n\'est pas celle d\'Atlassian, collez de nouveau le jeton.'],
            JiraFailure::Refused => $sameAccount
                ? ['token', 'Jira refuse le jeton enregistré, il a sans doute expiré. Créez-en un nouveau, puis collez-le ici.']
                : ['token', 'Jira refuse cette adresse e-mail ou ce jeton. Vérifiez-les, ou créez un nouveau jeton.'],
            JiraFailure::MissingScope => ['token', 'Il manque à ce jeton un périmètre dont DayTrack a besoin. Créez-en un nouveau avec read:jira-work, write:jira-work et read:jira-user.'],
            JiraFailure::Unreachable, JiraFailure::NotFound => ['site', 'Jira ne répond pas à cette adresse. Vérifiez-la.'],
        };

        $violation = new ConstraintViolation($message, $message, [], $input, $field, null, constraint: new JiraAcceptsConnection());

        return new UnprocessableEntityHttpException(previous: new ValidationFailedException($input, new ConstraintViolationList([$violation])));
    }
}
