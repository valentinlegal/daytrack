<?php

namespace App\Tests\Dev\Jira;

use App\Dev\Jira\Catalog;
use App\Dev\Jira\SimulatedGateway;
use PHPUnit\Framework\TestCase;
use Symfony\Component\HttpClient\MockHttpClient;
use Symfony\Component\HttpClient\Response\MockResponse;

/**
 * La passerelle du développement : la vraie pour tout site, le Jira simulé pour le sien.
 */
final class SimulatedGatewayTest extends TestCase
{
    public function testLaPasserelleDuSiteSimuleMeneAuJiraSimule(): void
    {
        self::assertSame(
            'https://jira/ex/jira/'.Catalog::CLOUD_ID.'/rest/api/3/myself',
            $this->sentTo('https://api.atlassian.com/ex/jira/'.Catalog::CLOUD_ID.'/rest/api/3/myself'),
        );
    }

    public function testUnVraiSiteGardeLaVraiePasserelle(): void
    {
        foreach ([
            'https://api.atlassian.com/ex/jira/0b7e4f1c-3a52-4d9e-8f61-7c2d9a4e5b30/rest/api/3/myself',
            'https://exemple.atlassian.net/rest/api/3/myself',
            'https://exemple.atlassian.net/_edge/tenant_info',
        ] as $url) {
            self::assertSame($url, $this->sentTo($url));
        }
    }

    private function sentTo(string $url): string
    {
        $sent = null;
        $client = new SimulatedGateway(new MockHttpClient(static function (string $method, string $url) use (&$sent): MockResponse {
            $sent = $url;

            return new MockResponse('{}');
        }), 'https://api.atlassian.com/');

        $client->request('GET', $url)->getStatusCode();
        self::assertIsString($sent);

        return $sent;
    }
}
