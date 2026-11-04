<?php

use App\Dev\Jira\FakeJira;
use App\Dev\Jira\FakeJiraRequest;
use App\Dev\Jira\FileStore;

require dirname(__DIR__, 3).'/vendor/autoload.php';

// Le service HTTP du Jira simulé, en développement. Son état vit dans var/jira/ :
// ce qu'il a reçu se relit sur https://localhost:8444/_simulation.
$jira = new FakeJira(new FileStore(dirname(__DIR__, 3).'/var/jira/state.json'), 'https://jira');

$method = is_string($_SERVER['REQUEST_METHOD'] ?? null) ? $_SERVER['REQUEST_METHOD'] : 'GET';
$uri = is_string($_SERVER['REQUEST_URI'] ?? null) ? $_SERVER['REQUEST_URI'] : '/';
$authorization = is_string($_SERVER['HTTP_AUTHORIZATION'] ?? null) ? $_SERVER['HTTP_AUTHORIZATION'] : null;
$query = array_filter($_GET, static fn (mixed $value, mixed $key): bool => is_string($key) && is_string($value), ARRAY_FILTER_USE_BOTH);
$body = file_get_contents('php://input');

$response = $jira->handle(new FakeJiraRequest($method, (string) parse_url($uri, PHP_URL_PATH), $query, $authorization, false === $body ? '' : $body));

if ($response->delaySeconds > 0) {
    sleep($response->delaySeconds);
}

http_response_code($response->status);
header('Content-Type: application/json; charset=utf-8');
foreach ($response->headers as $name => $value) {
    header($name.': '.$value);
}
echo $response->json();
