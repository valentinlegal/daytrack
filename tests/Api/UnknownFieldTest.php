<?php

namespace App\Tests\Api;

use App\Tests\Support\DayApi;
use Symfony\Bundle\FrameworkBundle\Test\WebTestCase;
use Symfony\Component\HttpKernel\Attribute\MapRequestPayload;
use Symfony\Component\Routing\RouterInterface;

/**
 * Chaque route qui lit son corps refuse un champ qu'elle ne connaît pas : « commentaire »
 * pour « comment » se refuse sous son nom, au lieu de disparaître sans erreur. Une route
 * nouvelle, ou une qui écarterait la règle commune, échoue ici sans qu'on la nomme.
 */
final class UnknownFieldTest extends WebTestCase
{
    use DayApi;

    /** De quoi remplir l'adresse de chaque route : une route qui demande autre chose doit l'ajouter ici. */
    private const array PLACEHOLDERS = [
        'date' => self::TODAY,
        'day' => '1',
        'id' => '0199a3c4-5b6d-7e8f-9a0b-1c2d3e4f5a6b',
        'key' => 'SHOP-482',
    ];

    public function testChaqueRouteQuiLitSonCorpsRefuseUnChampInconnu(): void
    {
        $routes = $this->payloadRoutes();
        self::assertNotEmpty($routes, 'Aucune route ne lit son corps : la recherche ne les trouve plus.');

        $accepted = [];
        foreach ($routes as $name => [$method, $uri]) {
            [$status, $body] = $this->send($method, $uri, ['champInconnu' => 1]);
            $violations = 422 === $status ? self::at($body, 'violations') : [];

            if (!\is_array($violations) || !\in_array(['field' => 'champInconnu', 'message' => 'Valeur invalide.'], $violations, true)) {
                $accepted[] = \sprintf('%s (%s %s) : %d', $name, $method, $uri, $status);
            }
        }

        self::assertSame([], $accepted, 'Ces routes laissent passer un champ inconnu.');
    }

    /**
     * Les routes dont le contrôleur lit le corps de la requête, avec de quoi les appeler.
     *
     * @return array<string, array{string, string}>
     */
    private function payloadRoutes(): array
    {
        $router = self::getContainer()->get(RouterInterface::class);
        $routes = [];

        foreach ($router->getRouteCollection()->all() as $name => $route) {
            $controller = $route->getDefault('_controller');
            if (!\is_string($controller) || !str_contains($controller, '::')) {
                continue;
            }
            [$class, $method] = explode('::', $controller, 2);
            if (!class_exists($class) || !method_exists($class, $method)) {
                continue;
            }

            $reads = false;
            foreach (new \ReflectionMethod($class, $method)->getParameters() as $parameter) {
                $reads = $reads || [] !== $parameter->getAttributes(MapRequestPayload::class, \ReflectionAttribute::IS_INSTANCEOF);
            }
            if (!$reads) {
                continue;
            }

            $variables = array_values(array_filter($route->compile()->getPathVariables(), is_string(...)));
            $missing = array_diff($variables, array_keys(self::PLACEHOLDERS));
            self::assertSame([], $missing, \sprintf('La route %s demande %s : ajoutez un exemple à PLACEHOLDERS.', $name, implode(', ', $missing)));

            $routes[$name] = [$route->getMethods()[0] ?? 'POST', $router->generate($name, array_intersect_key(self::PLACEHOLDERS, array_flip($variables)))];
        }

        return $routes;
    }
}
