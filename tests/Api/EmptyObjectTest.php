<?php

namespace App\Tests\Api;

use App\Tests\Support\DayApi;
use App\Tests\Support\JiraApi;
use Symfony\Bundle\FrameworkBundle\Test\WebTestCase;

/**
 * Ce que le navigateur lit par clé — les tickets d'une journée ou des favoris, ce qu'un
 * envoi a donné ticket par ticket — arrive en objet même vide : {}, jamais []. Une liste
 * vide, elle, reste une liste. Le navigateur ne compense plus : un écran nouveau qui lirait
 * un tableau ne s'afficherait plus sur la journée la plus banale.
 */
final class EmptyObjectTest extends WebTestCase
{
    use DayApi;
    use JiraApi;

    public function testUneJourneeVideRendSesTicketsEtSonEnvoiEnObjets(): void
    {
        $this->day();

        self::assertEquals(new \stdClass(), $this->answered('tickets'), 'Un objet, même vide.');
        self::assertEquals(new \stdClass(), $this->answered('send', 'outcomes'));
        self::assertEquals(new \stdClass(), $this->answered('send', 'inJira'));
        self::assertSame([], $this->answered('blocks'), 'Une liste vide reste une liste.');
        self::assertSame([], $this->answered('send', 'removed'));
        self::assertSame([], $this->answered('send', 'vanished'));
    }

    public function testUneJourneeQuiAChangeAilleursRendSesTicketsEnObjet(): void
    {
        [$status] = $this->patchSlots(5, [self::work('09:00', '09:15', 'SHOP-482')]);

        self::assertSame(409, $status);
        self::assertEquals(new \stdClass(), $this->answered('day', 'tickets'));
    }

    public function testUnEnvoiSansEchecRendSesIssuesEnObjets(): void
    {
        $this->linkJira();
        $day = $this->write(0, [self::work('09:00', '09:30', 'SHOP-482')]);

        [$status, $sent] = $this->send('POST', '/api/days/'.self::TODAY.'/send', ['version' => self::intAt($day, 'version')]);

        self::assertSame(200, $status, (string) json_encode($sent));
        self::assertSame('sent', self::at($sent, 'send', 'state'));
        self::assertEquals(new \stdClass(), $this->answered('send', 'outcomes'), 'Rien n\'a échoué.');
        self::assertEquals(new \stdClass(), $this->answered('send', 'inJira'), 'Jira a tout gardé tel quel.');
    }

    public function testDesFavorisSansTicketConnuRendentLeursTicketsEnObjet(): void
    {
        $this->browser->request('GET', '/api/favorites');

        self::assertEquals(new \stdClass(), $this->answered('tickets'));
        self::assertSame([], $this->answered('favorites'), 'Une liste vide reste une liste.');
    }

    public function testUneRelectureDeTicketsInconnusRendUnObjet(): void
    {
        [$status] = $this->send('POST', '/api/tickets/refresh', ['tickets' => []]);

        self::assertSame(200, $status);
        self::assertEquals(new \stdClass(), $this->answered('tickets'));

        $this->send('POST', '/api/tickets/refresh', ['tickets' => ['SHOP-482']]);

        self::assertEquals(new \stdClass(), $this->answered('tickets'), 'Sans Jira relié, rien n\'est décrit.');
    }

    /**
     * Ce que la dernière réponse porte à ce chemin, lu sans confondre {} et [] : un objet
     * JSON devient un stdClass, une liste un tableau.
     */
    private function answered(string ...$path): mixed
    {
        $content = (string) $this->browser->getResponse()->getContent();
        $value = json_decode($content, flags: \JSON_THROW_ON_ERROR);
        foreach ($path as $key) {
            self::assertInstanceOf(\stdClass::class, $value, $content);
            self::assertObjectHasProperty($key, $value, $content);
            $value = $value->{$key};
        }

        return $value;
    }
}
