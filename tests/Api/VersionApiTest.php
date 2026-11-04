<?php

namespace App\Tests\Api;

use App\Tests\Support\JiraApi;
use Symfony\Bundle\FrameworkBundle\KernelBrowser;
use Symfony\Bundle\FrameworkBundle\Test\WebTestCase;

/**
 * La version à installer, telle que le pied de colonne la lit : la plus récente des images
 * publiées, jamais la nôtre ni une plus ancienne, et rien quand le registre ne répond pas.
 */
final class VersionApiTest extends WebTestCase
{
    use JiraApi;

    private KernelBrowser $browser;

    protected function setUp(): void
    {
        $this->browser = self::createClient();
    }

    public function testRienATelechargerTantQuAucuneVersionPlusRecenteNEstPubliee(): void
    {
        self::assertNull($this->available());
    }

    public function testUneVersionPlusRecenteSAnnonce(): void
    {
        $this->simulate('images', ['tags' => ['1.1.0', '99.0.0', 'latest']]);

        self::assertSame('99.0.0', $this->available());
    }

    public function testLaPlusRecenteGagneQuelQueSoitLOrdreEtPasParOrdreAlphabetique(): void
    {
        $this->simulate('images', ['tags' => ['99.9.0', '99.10.0', '99.2.0']]);

        self::assertSame('99.10.0', $this->available());
    }

    public function testLaVersionInstalleeEtLesPlusAnciennesNeSAnnoncentPas(): void
    {
        $installed = trim((string) file_get_contents(\dirname(__DIR__, 2).'/version.txt'));
        $this->simulate('images', ['tags' => [$installed, '0.0.1']]);

        self::assertNull($this->available());
    }

    public function testCeQuiNEstPasUnNumeroEntierNeSAnnoncePas(): void
    {
        $this->simulate('images', ['tags' => ['latest', 'develop', '99', '99.0', 'v99.0.0', '99.0.0-rc1', "99.0.0\n", '99.0.0/../..', '<b>99.0.0</b>']]);

        self::assertNull($this->available());
    }

    public function testUnRegistreEnPanneNeSeVoitPas(): void
    {
        $this->simulate('images', ['tags' => ['99.0.0']]);
        $this->simulate('panne', ['panne' => true]);

        self::assertNull($this->available());
    }

    public function testLaRouteNEcritRien(): void
    {
        $this->browser->request('POST', '/api/version', server: ['CONTENT_TYPE' => 'application/json', 'HTTP_SEC_FETCH_SITE' => 'same-origin'], content: '{}');

        self::assertSame(405, $this->browser->getResponse()->getStatusCode());
    }

    private function available(): ?string
    {
        $this->browser->request('GET', '/api/version');
        self::assertResponseIsSuccessful();

        $json = json_decode((string) $this->browser->getResponse()->getContent(), true);
        self::assertIsArray($json);
        self::assertArrayHasKey('available', $json);
        self::assertTrue(null === $json['available'] || \is_string($json['available']));

        return $json['available'];
    }
}
