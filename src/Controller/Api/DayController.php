<?php

namespace App\Controller\Api;

use App\Api\Input\ObjectiveInput;
use App\Api\Input\SendInput;
use App\Api\Input\SlotsInput;
use App\Day\DayReader;
use App\Day\DayWriter;
use App\Day\NonWorkingDay;
use App\Day\StaleDay;
use App\Day\UserCalendar;
use App\Sending\AlreadySending;
use App\Sending\DaySender;
use App\Sending\NothingToSend;
use App\Sending\NotLinked;
use Symfony\Bundle\FrameworkBundle\Controller\AbstractController;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\HttpKernel\Attribute\MapRequestPayload;
use Symfony\Component\HttpKernel\Exception\UnprocessableEntityHttpException;
use Symfony\Component\Routing\Attribute\Route;
use Symfony\Component\Serializer\Normalizer\AbstractNormalizer;
use Symfony\Component\Serializer\Normalizer\DenormalizerInterface;
use Symfony\Component\Validator\Constraints\IsTrue;
use Symfony\Component\Validator\ConstraintViolation;
use Symfony\Component\Validator\ConstraintViolationList;
use Symfony\Component\Validator\Exception\ValidationFailedException;

/**
 * Une journée : la lire, y poser un geste, changer son objectif, l'envoyer sur Jira.
 *
 * Une écriture porte la version de la journée qu'elle a vue. Si la journée a changé
 * depuis, dans un autre onglet, rien n'est écrit : la réponse 409 rend la journée à
 * jour, pour que l'écran se remette dessus.
 */
#[Route('/api/days/{date}', requirements: ['date' => '\d{4}-\d{2}-\d{2}'], format: 'json')]
final class DayController extends AbstractController
{
    /** Un champ inconnu est refusé comme une valeur de travers, champ par champ. */
    private const array STRICT = [
        AbstractNormalizer::ALLOW_EXTRA_ATTRIBUTES => false,
        DenormalizerInterface::COLLECT_EXTRA_ATTRIBUTES_ERRORS => true,
    ];

    public function __construct(
        private readonly DayReader $reader,
        private readonly DayWriter $writer,
        private readonly DaySender $sender,
        private readonly UserCalendar $calendar,
    ) {
    }

    #[Route('', name: 'api_day_show', methods: ['GET'])]
    public function show(string $date): JsonResponse
    {
        return $this->json($this->reader->view($this->open($date))->toArray());
    }

    #[Route('/slots', name: 'api_day_slots', methods: ['PATCH'])]
    public function changeSlots(string $date, #[MapRequestPayload(acceptFormat: 'json', serializationContext: self::STRICT)] SlotsInput $input): JsonResponse
    {
        $day = $this->open($date);

        try {
            $written = $this->writer->changeSlots($day, $input->version, $input->quarters());
        } catch (StaleDay) {
            return $this->stale($day);
        }

        return $this->json((null === $written ? $this->reader->view($day) : $this->reader->viewOf($written))->toArray());
    }

    #[Route('/objective', name: 'api_day_objective', methods: ['PUT'])]
    public function setObjective(string $date, #[MapRequestPayload(acceptFormat: 'json', serializationContext: self::STRICT)] ObjectiveInput $input): JsonResponse
    {
        $day = $this->open($date);

        try {
            $written = $this->writer->setObjective($day, $input->version, $input->objective);
        } catch (StaleDay) {
            return $this->stale($day);
        } catch (NonWorkingDay) {
            // Sous le champ, comme les autres refus de l'objectif.
            $constraint = new IsTrue(message: 'Ce jour n\'est pas travaillé : il n\'a pas d\'objectif.');
            $violation = new ConstraintViolation($constraint->message, $constraint->message, [], $input, 'objective', $input->objective, constraint: $constraint);

            throw new UnprocessableEntityHttpException(previous: new ValidationFailedException($input, new ConstraintViolationList([$violation])));
        }

        return $this->json($this->reader->viewOf($written)->toArray());
    }

    /**
     * Envoie la journée sur Jira, telle que la confirmation l'a montrée, et la rend avec
     * ce que l'envoi a donné. Un envoi déjà en cours, ou une journée qui n'a rien à
     * envoyer, la rendent telle qu'elle est, sans rien écrire.
     */
    #[Route('/send', name: 'api_day_send', methods: ['POST'])]
    public function send(string $date, #[MapRequestPayload(acceptFormat: 'json', serializationContext: self::STRICT)] SendInput $input): JsonResponse
    {
        $day = $this->open($date);

        // L'envoi va jusqu'au bout et se garde, même si l'onglet se ferme : il en
        // resterait sinon des heures dans Jira que la journée ne connaîtrait pas. Le
        // serveur garde l'application en mémoire d'une requête à l'autre : les deux
        // réglages reviennent ensuite à ce qu'ils étaient.
        $ignoredAbort = ignore_user_abort(true);
        $timeLimit = (int) ini_get('max_execution_time');
        set_time_limit(DaySender::TIME_LIMIT);

        try {
            $this->sender->send($day, $input->version);
        } catch (StaleDay) {
            return $this->stale($day);
        } catch (AlreadySending) {
            return $this->json(['error' => 'sending', 'day' => $this->reader->view($day)->toArray()], Response::HTTP_CONFLICT);
        } catch (NothingToSend) {
            return $this->json(['error' => 'nothing', 'day' => $this->reader->view($day)->toArray()], Response::HTTP_CONFLICT);
        } catch (NotLinked) {
            return $this->json(['error' => 'unlinked'], Response::HTTP_CONFLICT);
        } finally {
            ignore_user_abort((bool) $ignoredAbort);
            set_time_limit($timeLimit);
        }

        return $this->json($this->reader->view($day)->toArray());
    }

    /** Le jour de l'adresse, s'il existe au calendrier et ne tombe pas trop loin devant. */
    private function open(string $date): \DateTimeImmutable
    {
        $day = UserCalendar::date($date);
        if (null === $day || !$this->calendar->isOpen($day)) {
            throw $this->createNotFoundException();
        }

        return $day;
    }

    private function stale(\DateTimeImmutable $date): JsonResponse
    {
        return $this->json(['error' => 'stale', 'day' => $this->reader->view($date)->toArray()], Response::HTTP_CONFLICT);
    }
}
