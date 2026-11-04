import { ExternalIcon } from './icons';

/**
 * Un lien vers une autre page que DayTrack, dans un nouvel onglet : son nom le dit, et
 * l'icône le montre. En --ink dans une phrase, en --ink-2 parmi un texte discret — le
 * pied d'une aide, celui des réglages.
 */
export function ExternalLink({ href, label, muted = false }: { href: string; label: string; muted?: boolean }) {
    return (
        <a
            href={href}
            target="_blank"
            rel="noopener"
            aria-label={`${label}, dans un nouvel onglet`}
            className={`font-medium underline decoration-line-strong underline-offset-(--s-1) transition-colors hover:decoration-current ${muted ? 'text-ink-2' : 'text-ink'}`}
        >
            {label}
            <ExternalIcon />
        </a>
    );
}
