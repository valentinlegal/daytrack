<?php

namespace App\Tests\Api;

use App\Favorite\NotAlreadyFavoriteValidator;
use App\Tests\Support\FavoriteApi;
use Symfony\Bundle\FrameworkBundle\Test\WebTestCase;
use Symfony\Component\Validator\Constraint;
use Symfony\Component\Validator\ConstraintValidator;

/**
 * L'API des favoris, comme l'appelle la page de DayTrack, et comme pourraient
 * l'appeler un onglet en retard, un double envoi ou un appelant hostile.
 */
final class FavoriteApiTest extends WebTestCase
{
    use FavoriteApi;

    public function testUneListeVideSeLitSansRienEcrire(): void
    {
        self::assertSame([], $this->favorites());
        self::assertSame([], $this->rows());
    }

    public function testUnFavoriAjouteVaEnTeteAvecSonTicketReecrit(): void
    {
        $this->added('SHOP-482');
        [$status, $body] = $this->add(['ticket' => " ops-12\u{a0}"]);

        self::assertSame(201, $status);
        self::assertSame(['OPS-12', 'SHOP-482'], self::tickets(self::listAt($body, 'favorites')));
        self::assertSame(['0 OPS-12', '1 SHOP-482'], $this->rows());
        self::assertNull(self::at($body, 'favorites', 0, 'name'));
    }

    public function testUnFavoriSeRemetALaPlaceDemandee(): void
    {
        $this->added('SHOP-482');
        $this->added('OPS-12');
        $this->added('SHOP-519', 1);
        $this->added('OPS-7', 99);
        [$status] = $this->add(['ticket' => 'SHOP-377', 'name' => 'Revue', 'position' => 2]);

        self::assertSame(201, $status);
        self::assertSame(['0 OPS-12', '1 SHOP-519', '2 SHOP-377', '3 SHOP-482', '4 OPS-7'], $this->rows(), 'Au-delà de la fin, il va en bas.');
        self::assertSame('Revue', self::at($this->favorites(), 2, 'name'), 'Un favori remis à sa place garde son nom.');
    }

    public function testUnTicketDejaEnFavoriEstRefuseSousSonChamp(): void
    {
        $this->added('SHOP-482');

        foreach (['SHOP-482', 'shop-482', ' SHOP-482 '] as $ticket) {
            [$status, $body] = $this->add(['ticket' => $ticket]);
            self::assertSame(422, $status, $ticket);
            self::assertSame([['field' => 'ticket', 'message' => 'SHOP-482 est déjà dans vos favoris.']], $body['violations'], $ticket);
        }

        self::assertSame(['0 SHOP-482'], $this->rows(), 'Un double envoi n\'ajoute qu\'une fois.');
    }

    public function testUnDoublonEcritEntreLaValidationEtLEcritureSeRefuseDeMeme(): void
    {
        // Un autre onglet l'ajoute entre la validation et l'écriture : la validation n'en
        // voit rien, l'écriture le trouve sous le verrou.
        static::getContainer()->set(NotAlreadyFavoriteValidator::class, new class extends ConstraintValidator {
            public function validate(mixed $value, Constraint $constraint): void
            {
            }
        });
        $this->added('SHOP-482');

        [$status, $body] = $this->add(['ticket' => 'shop-482']);

        self::assertSame(422, $status);
        self::assertSame([['field' => 'ticket', 'message' => 'SHOP-482 est déjà dans vos favoris.']], $body['violations']);
        self::assertSame(['0 SHOP-482'], $this->rows());
    }

    public function testUnTicketAbsentOuMalFormeEstRefuseSousSonChamp(): void
    {
        $cases = [
            'Indiquez un ticket.' => [[], ['ticket' => null], ['ticket' => ''], ['ticket' => "  \u{200b}"]],
            'Un identifiant de ticket s\'écrit comme SHOP-482.' => [['ticket' => 'SHOP'], ['ticket' => 'SHOP 482'], ['ticket' => 'SHOP-0'], ['ticket' => '482-SHOP'], ['ticket' => 'SHOP-482;DROP']],
            'Un identifiant de ticket tient en 50 caractères.' => [['ticket' => 'SHOP-'.str_repeat('1', 46)]],
        ];

        foreach ($cases as $message => $bodies) {
            foreach ($bodies as $body) {
                [$status, $refusal] = $this->add($body);
                $case = json_encode($body, \JSON_THROW_ON_ERROR);
                self::assertSame(422, $status, $case);
                self::assertContains(['field' => 'ticket', 'message' => $message], self::listAt($refusal, 'violations'), $case);
            }
        }

        self::assertSame([], $this->rows());
    }

    public function testRenommerChangeLeNomEtUnNomVideRendLeTitre(): void
    {
        $id = $this->added('SHOP-482');

        [$status, $body] = $this->send('PATCH', '/api/favorites/'.$id, ['name' => "  Export\u{a0}\u{a0}CSV \n"]);
        self::assertSame(200, $status);
        self::assertSame('Export CSV', self::at($body, 'favorites', 0, 'name'));

        foreach ([['name' => ''], ['name' => null], []] as $empty) {
            $this->send('PATCH', '/api/favorites/'.$id, ['name' => 'Export']);
            [$status, $body] = $this->send('PATCH', '/api/favorites/'.$id, $empty);
            self::assertSame(200, $status);
            self::assertNull(self::at($body, 'favorites', 0, 'name'), json_encode($empty, \JSON_THROW_ON_ERROR));
        }
    }

    public function testUnNomTropLongOuSurPlusieursLignesEstRefuse(): void
    {
        $id = $this->added('SHOP-482');
        $this->send('PATCH', '/api/favorites/'.$id, ['name' => 'Export']);

        foreach ([
            'Le nom tient en 255 caractères.' => str_repeat('é', 256),
            'Le nom tient sur une ligne.' => "Export\nCSV",
        ] as $message => $name) {
            [$status, $body] = $this->send('PATCH', '/api/favorites/'.$id, ['name' => $name]);
            self::assertSame(422, $status, $message);
            self::assertSame([['field' => 'name', 'message' => $message]], $body['violations']);

            [$status] = $this->add(['ticket' => 'OPS-12', 'name' => $name]);
            self::assertSame(422, $status, 'Le même refus à l\'ajout : '.$message);
        }

        self::assertSame('Export', self::at($this->favorites(), 0, 'name'));
        self::assertSame(['0 SHOP-482'], $this->rows());
    }

    public function testRetirerUnFavoriResserreLaListe(): void
    {
        $this->added('SHOP-482');
        $middle = $this->added('OPS-12');
        $this->added('SHOP-519');

        [$status, $body] = $this->send('DELETE', '/api/favorites/'.$middle);

        self::assertSame(200, $status);
        self::assertSame(['SHOP-519', 'SHOP-482'], self::tickets(self::listAt($body, 'favorites')));
        self::assertSame(['0 SHOP-519', '1 SHOP-482'], $this->rows(), 'Ni trou ni double dans les places.');
    }

    public function testUnFavoriRetireAilleursRendLaListeAJour(): void
    {
        $gone = $this->added('SHOP-482');
        $this->added('OPS-12');
        $this->send('DELETE', '/api/favorites/'.$gone);

        // L'onglet resté ouvert le croit encore là.
        foreach ([['DELETE', null], ['PATCH', ['name' => 'Export']]] as [$method, $body]) {
            [$status, $refusal] = $this->send($method, '/api/favorites/'.$gone, $body);
            self::assertSame(404, $status, $method);
            self::assertSame('not_found', $refusal['error'], $method);
            self::assertSame(['OPS-12'], self::tickets(self::listAt($refusal, 'favorites')), $method);
        }

        self::assertSame(['0 OPS-12'], $this->rows());
    }

    public function testChangerLOrdreRangeLaListeEntiere(): void
    {
        $a = $this->added('SHOP-482');
        $b = $this->added('OPS-12');
        $c = $this->added('SHOP-519');

        [$status, $body] = $this->send('PUT', '/api/favorites/order', ['ids' => [$a, $c, $b]]);

        self::assertSame(200, $status);
        self::assertSame(['SHOP-482', 'SHOP-519', 'OPS-12'], self::tickets(self::listAt($body, 'favorites')));
        self::assertSame(['0 SHOP-482', '1 SHOP-519', '2 OPS-12'], $this->rows());
    }

    public function testUnOrdreQuiNeNommePlusLaListeNEcritRien(): void
    {
        $a = $this->added('SHOP-482');
        $b = $this->added('OPS-12');
        $c = $this->added('SHOP-519');
        $unknown = '0199a3c4-5b6d-7e8f-9a0b-1c2d3e4f5a6b';

        $stale = [
            'un favori ajouté ailleurs manque' => [$a, $b],
            'un favori retiré ailleurs est encore là' => [$a, $b, $c, $unknown],
            'un inconnu à la place d\'un favori' => [$a, $b, $unknown],
            'le même favori deux fois' => [$a, $b, $b],
            'rien' => [],
        ];
        foreach ($stale as $case => $ids) {
            [$status, $body] = $this->send('PUT', '/api/favorites/order', ['ids' => $ids]);
            self::assertSame(409, $status, $case);
            self::assertSame('stale', $body['error'], $case);
            self::assertSame(['SHOP-519', 'OPS-12', 'SHOP-482'], self::tickets(self::listAt($body, 'favorites')), $case);
        }

        self::assertSame(['0 SHOP-519', '1 OPS-12', '2 SHOP-482'], $this->rows());
    }

    public function testUnAppelantDeTraversEstRefuse(): void
    {
        $id = $this->added('SHOP-482');

        foreach ([
            ['PATCH', '/api/favorites/pas-un-identifiant', ['name' => 'X'], 404],
            ['DELETE', '/api/favorites/1', null, 404],
            ['PUT', '/api/favorites/order', ['ids' => ['pas-un-identifiant']], 422],
            ['PUT', '/api/favorites/order', ['ids' => 'SHOP-482'], 422],
            ['POST', '/api/favorites', ['ticket' => 'OPS-12', 'color' => 'rouge'], 422],
            ['POST', '/api/favorites', ['ticket' => 'OPS-12', 'position' => -1], 422],
            ['POST', '/api/favorites', ['ticket' => 482], 422],
            ['PATCH', '/api/favorites/'.$id, ['name' => 'X', 'ticket' => 'OPS-12'], 422],
            ['POST', '/api/favorites', '{"ticket":', 400],
        ] as [$method, $uri, $body, $expected]) {
            [$status] = $this->send($method, $uri, $body);
            self::assertSame($expected, $status, $method.' '.$uri.' '.json_encode($body, \JSON_THROW_ON_ERROR));
        }

        self::assertSame(['0 SHOP-482'], $this->rows());
        self::assertNull(self::at($this->favorites(), 0, 'name'));
    }

    public function testUneAutrePageNeFaitRienEcrire(): void
    {
        $id = $this->added('SHOP-482');

        foreach ([
            'un autre site' => ['HTTP_SEC_FETCH_SITE' => 'cross-site', 'HTTP_ORIGIN' => 'https://evil.example'],
            'rien pour dire d\'où vient la requête' => [],
        ] as $case => $server) {
            foreach ([
                ['POST', '/api/favorites', ['ticket' => 'OPS-12']],
                ['PATCH', '/api/favorites/'.$id, ['name' => 'X']],
                ['DELETE', '/api/favorites/'.$id, null],
                ['PUT', '/api/favorites/order', ['ids' => [$id]]],
            ] as [$method, $uri, $body]) {
                [$status, $refusal] = $this->send($method, $uri, $body, $server);
                self::assertSame(403, $status, $case.', '.$method);
                self::assertSame('cross_origin', $refusal['error'], $case.', '.$method);
            }
        }

        self::assertSame(['0 SHOP-482'], $this->rows());
        self::assertNull(self::at($this->favorites(), 0, 'name'));
    }
}
