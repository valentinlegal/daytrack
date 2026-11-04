<?php

namespace App\Jira;

/**
 * Un ticket tel que Jira le décrit : son titre, et le type qui lui donne sa teinte.
 *
 * Une sous-tâche prend le type de son ticket parent, comme dans la v1 : une
 * sous-tâche d'un bug est du travail sur ce bug.
 */
final readonly class JiraIssue
{
    public function __construct(
        public string $key,
        public string $title,
        public JiraIssueType $type,
    ) {
    }
}
