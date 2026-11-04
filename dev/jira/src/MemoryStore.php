<?php

namespace App\Dev\Jira;

final class MemoryStore implements StateStore
{
    private State $state;

    public function __construct()
    {
        $this->state = new State();
    }

    public function update(callable $change): mixed
    {
        return $change($this->state);
    }

    public function reset(): void
    {
        $this->state = new State();
    }
}
