<?php

namespace App\Tests\Support;

use App\Dev\Jira\Catalog;
use App\Dev\Jira\FakeJira;
use App\Dev\Jira\FakeJiraRequest;
use PHPUnit\Framework\Assert;

/**
 * Relier DayTrack au Jira simulé comme le fait la page, et régler ce Jira : un jeton
 * qui ne passe plus, une panne. S'ajoute à DayApi ou FavoriteApi, dont il reprend le
 * navigateur.
 */
trait JiraApi
{
    /** Relie DayTrack au Jira simulé, par la route de « Commencer ». */
    protected function linkJira(string $token = Catalog::API_TOKEN, string $site = 'https://jira', string $email = Catalog::ACCOUNT_EMAIL): void
    {
        $this->browser->request('PUT', '/api/jira', server: ['CONTENT_TYPE' => 'application/json', 'HTTP_SEC_FETCH_SITE' => 'same-origin'], content: json_encode(['site' => $site, 'email' => $email, 'token' => $token], \JSON_THROW_ON_ERROR));
        Assert::assertSame(200, $this->browser->getResponse()->getStatusCode(), (string) $this->browser->getResponse()->getContent());
    }

    protected function fakeJira(): FakeJira
    {
        // Il n'existe que dans le conteneur des tests, que l'analyse ne lit pas.
        $jira = static::getContainer()->get(FakeJira::class); // @phpstan-ignore symfonyContainer.serviceNotFound
        Assert::assertInstanceOf(FakeJira::class, $jira);

        return $jira;
    }

    /**
     * @param array<string, mixed> $body
     */
    protected function simulate(string $path, array $body = []): void
    {
        $status = $this->fakeJira()->handle(new FakeJiraRequest('POST', '/_simulation/'.$path, body: json_encode($body, \JSON_THROW_ON_ERROR)))->status;
        Assert::assertSame(204, $status);
    }

    /**
     * Ce que le Jira simulé a reçu.
     *
     * @return array<mixed>
     */
    protected function jiraState(): array
    {
        return (array) $this->fakeJira()->handle(new FakeJiraRequest('GET', '/_simulation'))->body;
    }
}
