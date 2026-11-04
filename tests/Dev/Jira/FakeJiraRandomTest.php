<?php

namespace App\Tests\Dev\Jira;

use App\Dev\Jira\Catalog;
use App\Dev\Jira\FakeJira;
use App\Dev\Jira\FakeJiraHttpClient;
use App\Dev\Jira\FakeJiraRequest;
use App\Dev\Jira\MemoryStore;
use App\Tests\Support\RandomSuite;
use App\Tests\Support\ReadsJson;
use PHPUnit\Framework\TestCase;

/**
 * Le patron des suites de gestes tirées au hasard, joué sur le Jira simulé : des
 * centaines d'ajouts et de suppressions mêlés, puis ce que Jira montre doit être
 * exactement ce qu'un modèle tenu à côté attend, au quart d'heure près.
 */
final class FakeJiraRandomTest extends TestCase
{
    use RandomSuite;
    use ReadsJson;

    private const array ISSUES = ['SHOP-482', 'SHOP-498', 'OPS-7'];

    public function testDesAjoutsEtDesSuppressionsMelesLaissentExactementCeQuOnAttend(): void
    {
        $random = $this->randomizer();
        $client = FakeJiraHttpClient::create(new FakeJira(new MemoryStore()));
        $auth = ['Authorization' => FakeJiraRequest::basic(Catalog::ACCOUNT_EMAIL, Catalog::API_TOKEN)];

        /** @var array<string, array<string, int>> $expected les secondes attendues, par ticket et par saisie */
        $expected = array_fill_keys(self::ISSUES, []);

        for ($step = 0; $step < 300; ++$step) {
            $key = self::ISSUES[$random->getInt(0, \count(self::ISSUES) - 1)];

            if ([] !== $expected[$key] && 0 === $random->getInt(0, 2)) {
                $ids = array_keys($expected[$key]);
                $id = $ids[$random->getInt(0, \count($ids) - 1)];
                self::assertSame(204, $client->request('DELETE', '/rest/api/3/issue/'.$key.'/worklog/'.$id, ['headers' => $auth])->getStatusCode());
                unset($expected[$key][$id]);

                continue;
            }

            $quarters = $random->getInt(1, 16);
            $started = \sprintf('2026-10-%02dT%02d:%02d:00.000+0200', $random->getInt(1, 31), $random->getInt(7, 19), 15 * $random->getInt(0, 3));
            $response = $client->request('POST', '/rest/api/3/issue/'.$key.'/worklog', ['headers' => $auth, 'json' => ['started' => $started, 'timeSpentSeconds' => 900 * $quarters]]);
            $expected[$key][self::stringAt($response->toArray(), 'id')] = 900 * $quarters;
        }

        foreach (self::ISSUES as $key) {
            $actual = [];
            foreach (self::listAt($client->request('GET', '/rest/api/3/issue/'.$key.'/worklog', ['headers' => $auth])->toArray(), 'worklogs') as $worklog) {
                if (Catalog::ACCOUNT_ID === self::at($worklog, 'author', 'accountId')) {
                    $actual[self::stringAt($worklog, 'id')] = self::at($worklog, 'timeSpentSeconds');
                }
            }

            ksort($actual);
            ksort($expected[$key]);
            self::assertSame($expected[$key], $actual, $key);
        }
    }
}
