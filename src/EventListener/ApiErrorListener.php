<?php

namespace App\EventListener;

use App\Api\ApiError;
use Symfony\Component\EventDispatcher\Attribute\AsEventListener;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpKernel\Event\ExceptionEvent;
use Symfony\Component\HttpKernel\Exception\HttpExceptionInterface;
use Symfony\Component\HttpKernel\KernelEvents;
use Symfony\Component\Validator\ConstraintViolationInterface;
use Symfony\Component\Validator\Exception\ValidationFailedException;

/**
 * Les refus de l'API, en JSON : un code, et pour une saisie refusée, un message par
 * champ, à afficher sous lui.
 *
 * Seuls les refus prévus passent ici. Une erreur du serveur garde la page d'erreur
 * de Symfony, qui ne dit rien de ce qu'elle contient hors du développement.
 */
#[AsEventListener(event: KernelEvents::EXCEPTION)]
final readonly class ApiErrorListener
{
    public function __invoke(ExceptionEvent $event): void
    {
        $exception = $event->getThrowable();
        if (!$exception instanceof HttpExceptionInterface || !str_starts_with($event->getRequest()->getPathInfo(), '/api/')) {
            return;
        }

        $status = $exception->getStatusCode();
        $body = ['error' => ApiError::ofStatus($status)->value ?? 'http_'.$status];

        $previous = $exception->getPrevious();
        if ($previous instanceof ValidationFailedException) {
            $body['violations'] = array_map(static fn (ConstraintViolationInterface $violation): array => [
                'field' => $violation->getPropertyPath(),
                // Sans contrainte, c'est le JSON lui-même qui n'a pas la bonne forme :
                // un nombre attendu, un champ inconnu. Seul un appelant hostile ou
                // buggé l'envoie, il n'a pas besoin de plus.
                'message' => null === $violation->getConstraint() ? 'Valeur invalide.' : (string) $violation->getMessage(),
            ], iterator_to_array($previous->getViolations(), false));
        }

        $event->setResponse(new JsonResponse($body, $status, $exception->getHeaders()));
    }
}
