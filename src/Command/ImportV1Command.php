<?php

namespace App\Command;

use App\V1\V1Importer;
use App\V1\V1ImportResult;
use App\V1\V1Jira;
use Symfony\Component\Console\Attribute\AsCommand;
use Symfony\Component\Console\Command\Command;
use Symfony\Component\Console\Input\InputInterface;
use Symfony\Component\Console\Output\OutputInterface;

/**
 * Lancée à chaque démarrage de l'image, après les migrations (frankenphp/docker-entrypoint.sh).
 *
 * Le jeton de l'ancien fichier se lit ici, et seulement ici : le point d'entrée le retire
 * ensuite de ce que reçoit l'application qui sert les pages. Une erreur arrête le
 * démarrage : mieux vaut ne rien servir qu'une application vide, qui ferait croire les
 * journées perdues. L'erreur ne porte jamais le jeton.
 */
#[AsCommand(name: 'daytrack:import-v1', description: 'Reprend les données de la v1, une seule fois')]
final class ImportV1Command extends Command
{
    public function __construct(private readonly V1Importer $importer)
    {
        parent::__construct();
    }

    protected function execute(InputInterface $input, OutputInterface $output): int
    {
        try {
            $result = $this->importer->import(V1Jira::of(self::env('JIRA_BASE_URL'), self::env('JIRA_USER_EMAIL'), self::env('JIRA_API_TOKEN')));
        } catch (\Throwable $exception) {
            $output->writeln(\sprintf('<error>La reprise de la v1 a échoué, rien n\'a été écrit, et l\'ancienne base est intacte : %s</error>', $exception->getMessage()));
            $output->writeln('Pour revenir à la v1 : image ghcr.io/valentinlegal/daytrack:1.1.0.');

            return Command::FAILURE;
        }

        $output->writeln(match ($result) {
            V1ImportResult::Done => 'Les données de la v1 sont reprises. L\'ancienne base reste en place, sans changement.',
            V1ImportResult::V1ChangedSince => 'L\'ancienne base a changé depuis la reprise, qui ne se refait pas : ce qui a été saisi dans la v1 entre-temps n\'est pas repris.',
            V1ImportResult::V2InUse => 'Une base de la v1 existe, mais cette installation a déjà ses données : rien n\'est repris.',
            V1ImportResult::NoV1Base, V1ImportResult::AlreadyDone => 'Rien à reprendre de la v1.',
        });

        return Command::SUCCESS;
    }

    private static function env(string $name): ?string
    {
        $value = getenv($name);

        return false === $value ? null : $value;
    }
}
