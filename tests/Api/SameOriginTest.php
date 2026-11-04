<?php

namespace App\Tests\Api;

use App\Tests\Support\DayApi;
use Symfony\Bundle\FrameworkBundle\Test\WebTestCase;

/**
 * Une autre page ouverte dans le navigateur ne peut pas faire écrire DayTrack.
 */
final class SameOriginTest extends WebTestCase
{
    use DayApi;

    public function testUneAutrePageNeFaitRienEcrire(): void
    {
        $hostile = [
            'un autre site' => ['HTTP_SEC_FETCH_SITE' => 'cross-site', 'HTTP_ORIGIN' => 'https://evil.example'],
            'un sous-domaine voisin' => ['HTTP_SEC_FETCH_SITE' => 'same-site', 'HTTP_ORIGIN' => 'https://evil.localhost'],
            'un lien ouvert à la main' => ['HTTP_SEC_FETCH_SITE' => 'none'],
            'une origine qui ment, le navigateur ne ment pas' => ['HTTP_SEC_FETCH_SITE' => 'cross-site', 'HTTP_ORIGIN' => 'http://localhost'],
            'un navigateur sans Sec-Fetch, d\'un autre site' => ['HTTP_ORIGIN' => 'https://evil.example'],
            'un navigateur sans Sec-Fetch, d\'une autre adresse du poste' => ['HTTP_ORIGIN' => 'http://localhost:8080'],
            'une origine opaque' => ['HTTP_ORIGIN' => 'null'],
            'rien pour dire d\'où vient la requête' => [],
        ];

        foreach ($hostile as $case => $server) {
            [$status, $body] = $this->patchSlots(0, [self::work('09:00', '10:00', 'SHOP-482')], server: $server);
            self::assertSame(403, $status, $case);
            self::assertSame('cross_origin', $body['error'], $case);

            [$status] = $this->send('PUT', '/api/days/'.self::TODAY.'/objective', ['version' => 0, 'objective' => 0], $server);
            self::assertSame(403, $status, $case);
        }

        self::assertSame(0, $this->dayRows());
    }

    public function testUneEcritureEstDuJson(): void
    {
        // Ce qu'un formulaire d'une autre page sait envoyer sans rien demander au navigateur.
        foreach (['application/x-www-form-urlencoded', 'multipart/form-data; boundary=x', 'text/plain', ''] as $contentType) {
            [$status, $body] = $this->send('PATCH', '/api/days/'.self::TODAY.'/slots', ['version' => 0, 'changes' => [self::work('09:00', '10:00', 'SHOP-482')]], contentType: $contentType);
            self::assertSame(415, $status, $contentType);
            self::assertSame('unsupported_media_type', $body['error']);
        }

        self::assertSame(0, $this->dayRows());
    }

    public function testLaPageDeDayTrackEcrit(): void
    {
        $this->write(0, [self::work('09:00', '10:00', 'SHOP-482')]);

        // Un navigateur qui ne connaît pas Sec-Fetch-Site, mais joint son origine.
        [$status] = $this->patchSlots(1, [self::work('10:00', '11:00', 'OPS-7')], server: ['HTTP_ORIGIN' => 'http://localhost']);
        self::assertSame(200, $status);

        self::assertCount(8, $this->rows());
    }

    public function testLireResteOuvert(): void
    {
        $this->browser->request('GET', '/api/days/'.self::TODAY, server: ['HTTP_SEC_FETCH_SITE' => 'cross-site']);

        // Le navigateur ne laisse pas l'autre page lire la réponse : sans en-tête CORS,
        // elle reste au navigateur.
        self::assertResponseIsSuccessful();
        self::assertFalse($this->browser->getResponse()->headers->has('Access-Control-Allow-Origin'));
    }
}
