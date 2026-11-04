<?php

namespace App\EventListener;

use Symfony\Component\EventDispatcher\Attribute\AsEventListener;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\HttpKernel\Event\RequestEvent;
use Symfony\Component\HttpKernel\KernelEvents;

/**
 * Seule la page de DayTrack peut le faire écrire.
 *
 * Une autre page ouverte dans le navigateur peut lui envoyer une requête, avec ce
 * que le navigateur y joint d'office : c'est le CSRF. Elle ne peut pas falsifier ce
 * que le navigateur déclare de son origine. Une requête qui écrit ne passe donc que
 * si le navigateur la dit partie de DayTrack même (Sec-Fetch-Site), ou, à défaut de
 * cet en-tête, si son origine est celle de DayTrack. Sans l'un ni l'autre, elle ne
 * vient pas d'un navigateur sur la page de DayTrack, et se refuse aussi.
 *
 * Elle doit aussi être du JSON, même sans rien à envoyer. Une autre page ne peut pas
 * en envoyer à DayTrack sans que le navigateur lui en demande d'abord la permission,
 * que DayTrack ne donne jamais : c'est un second filet, qui vaut pour toute route
 * d'écriture à venir.
 *
 * Pas de jeton : sans session, il faudrait un cookie de plus, qui ne protégerait
 * rien que ces en-têtes ne protègent déjà.
 */
#[AsEventListener(event: KernelEvents::REQUEST, priority: 256)]
final readonly class SameOriginGuard
{
    public function __invoke(RequestEvent $event): void
    {
        $request = $event->getRequest();
        if (!$event->isMainRequest() || $request->isMethodSafe()) {
            return;
        }

        if (!self::isSameOrigin($request)) {
            $event->setResponse(new JsonResponse(['error' => 'cross_origin'], Response::HTTP_FORBIDDEN));
        } elseif ('json' !== $request->getContentTypeFormat()) {
            $event->setResponse(new JsonResponse(['error' => 'unsupported_media_type'], Response::HTTP_UNSUPPORTED_MEDIA_TYPE));
        }
    }

    private static function isSameOrigin(Request $request): bool
    {
        $site = $request->headers->get('Sec-Fetch-Site');
        if (null !== $site) {
            return 'same-origin' === $site;
        }

        return $request->headers->get('Origin') === $request->getSchemeAndHttpHost();
    }
}
