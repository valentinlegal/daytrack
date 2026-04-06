<?php

declare(strict_types=1);

namespace App\Controller\Api;

use App\Dto\Input\CreateEntryInput;
use App\Dto\Input\UpdateEntryInput;
use App\Dto\Output\WorkDayOutput;
use App\Entity\TimeEntry;
use App\Entity\WorkDay;
use App\Enum\EntryType;
use App\Repository\TimeEntryRepository;
use App\Repository\WorkDayRepository;
use DateTimeImmutable;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Bundle\FrameworkBundle\Controller\AbstractController;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\HttpKernel\Attribute\MapRequestPayload;
use Symfony\Component\Routing\Attribute\Route;
use Symfony\Contracts\Translation\TranslatorInterface;

#[Route('/api/days/{date}/entries')]
class EntryController extends AbstractController
{
    public function __construct(
        private readonly WorkDayRepository $dayRepository,
        private readonly TimeEntryRepository $entryRepository,
        private readonly EntityManagerInterface $em,
        private readonly TranslatorInterface $translator,
    ) {}

    /**
     * Crée une nouvelle entrée de temps pour la journée donnée.
     * Crée la journée automatiquement si elle n'existe pas (dans la limite J+1).
     */
    #[Route('', name: 'api_entries_create', methods: ['POST'])]
    public function create(string $date, #[MapRequestPayload] CreateEntryInput $input): JsonResponse
    {
        $day = $this->resolveDay($date, createIfMissing: true);

        if ($day instanceof JsonResponse) {
            return $day;
        }

        $entry = new TimeEntry(
            workDay: $day,
            startedAt: $this->parseTime($day, $input->startedAt),
            type: EntryType::from($input->type),
        );

        // Les pauses n'ont pas de ticket ni de commentaire associé
        $isBreak = EntryType::BREAK === EntryType::from($input->type);
        $entry->ticketKey = $isBreak ? null : $input->ticketKey;
        $entry->comment = $isBreak ? null : $input->comment;
        $entry->ticketSummary = $isBreak ? null : $input->ticketSummary;
        $entry->ticketType = $isBreak ? null : $input->ticketType;

        if (null !== $input->endedAt) {
            $entry->endedAt = $this->parseTime($day, $input->endedAt);
        }

        $day->addEntry($entry);
        // Toute modification invalide le statut de synchronisation JIRA
        $day->jiraSyncedAt = null;
        $this->em->flush();

        return $this->json(WorkDayOutput::fromEntity($day), Response::HTTP_CREATED);
    }

    /**
     * Met à jour une entrée de temps existante (patch partiel).
     */
    #[Route('/{id}', name: 'api_entries_update', methods: ['PUT'])]
    public function update(string $date, string $id, #[MapRequestPayload] UpdateEntryInput $input): JsonResponse
    {
        $day = $this->resolveDay($date);

        if ($day instanceof JsonResponse) {
            return $day;
        }

        $entry = $this->resolveEntry($id, $day);

        if ($entry instanceof JsonResponse) {
            return $entry;
        }

        if (null !== $input->type) {
            $entry->type = EntryType::from($input->type);
            // Vider le ticket et le commentaire si on passe en pause
            if (EntryType::BREAK === $entry->type) {
                $entry->ticketKey = null;
                $entry->comment = null;
                $entry->ticketSummary = null;
                $entry->ticketType = null;
            }
        }

        if (null !== $input->ticketKey && EntryType::WORK === $entry->type) {
            $entry->ticketKey = $input->ticketKey;
        }

        if (EntryType::WORK === $entry->type) {
            $entry->comment = $input->comment;
            $entry->ticketSummary = $input->ticketSummary;
            $entry->ticketType = $input->ticketType;
        }

        if (null !== $input->startedAt) {
            $entry->startedAt = $this->parseTime($day, $input->startedAt);
        }

        if (null !== $input->endedAt) {
            $entry->endedAt = $this->parseTime($day, $input->endedAt);
        }

        // Toute modification invalide le statut de synchronisation JIRA
        $day->jiraSyncedAt = null;
        $this->em->flush();

        return $this->json(WorkDayOutput::fromEntity($day));
    }

    /**
     * Supprime une entrée de temps.
     */
    #[Route('/{id}', name: 'api_entries_delete', methods: ['DELETE'])]
    public function delete(string $date, string $id): JsonResponse
    {
        $day = $this->resolveDay($date);

        if ($day instanceof JsonResponse) {
            return $day;
        }

        $entry = $this->resolveEntry($id, $day);

        if ($entry instanceof JsonResponse) {
            return $entry;
        }

        $day->removeEntry($entry);
        // Toute modification invalide le statut de synchronisation JIRA
        $day->jiraSyncedAt = null;
        $this->em->flush();

        return $this->json(null, Response::HTTP_NO_CONTENT);
    }

    /**
     * Résout la journée depuis la date en paramètre URL.
     * Retourne une JsonResponse d'erreur si la date est invalide, dans le futur interdit, ou introuvable.
     */
    private function resolveDay(string $date, bool $createIfMissing = false): WorkDay|JsonResponse
    {
        $parsedDate = DateTimeImmutable::createFromFormat('Y-m-d', $date);

        if (false === $parsedDate) {
            return $this->json(
                ['error' => $this->translator->trans('error.invalid_date_format')],
                Response::HTTP_BAD_REQUEST,
            );
        }

        // Comparaison par chaîne pour éviter les décalages liés à la partie heure de createFromFormat
        if ($createIfMissing && $parsedDate->format('Y-m-d') > (new DateTimeImmutable('+30 days'))->format('Y-m-d')) {
            return $this->json(
                ['error' => $this->translator->trans('error.future_day_forbidden')],
                Response::HTTP_UNPROCESSABLE_ENTITY,
            );
        }

        $day = $this->dayRepository->findByDate($parsedDate);

        if (null === $day) {
            if ($createIfMissing) {
                $day = new WorkDay($parsedDate);
                $this->em->persist($day);
            } else {
                return $this->json(
                    ['error' => $this->translator->trans('error.day_not_found')],
                    Response::HTTP_NOT_FOUND,
                );
            }
        }

        return $day;
    }

    /**
     * Résout une entrée en vérifiant qu'elle appartient bien à la journée donnée.
     */
    private function resolveEntry(string $id, WorkDay $day): TimeEntry|JsonResponse
    {
        $entry = $this->entryRepository->find($id);

        if (null === $entry || (string) $entry->workDay->id !== (string) $day->id) {
            return $this->json(
                ['error' => $this->translator->trans('error.entry_not_found')],
                Response::HTTP_NOT_FOUND,
            );
        }

        return $entry;
    }

    /**
     * Combine la date de la journée avec une heure HH:mm pour former un DateTimeImmutable.
     */
    private function parseTime(WorkDay $day, string $time): DateTimeImmutable
    {
        return DateTimeImmutable::createFromFormat('Y-m-d H:i', $day->date->format('Y-m-d').' '.$time);
    }
}
