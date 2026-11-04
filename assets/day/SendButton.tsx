import type { Ref } from 'react';

import { Button } from '../components/Button';
import { CheckIcon, ErrorIcon, RetryIcon, SendIcon } from '../components/icons';
import { Tooltip } from '../components/Tooltip';
import type { SendButtonView } from './sendView';

/**
 * Le bouton Jira, en haut à droite : il porte l'état du jour affiché, et sa pastille,
 * décorative, se dit dans son infobulle et son nom. Il reste net au-dessus du voile
 * pendant l'envoi.
 */
export function SendButton({
    ref,
    view,
    open,
    onClick,
    hidden = false,
}: {
    ref: Ref<HTMLButtonElement>;
    view: SendButtonView;
    /** Tant que la journée se lit : le bouton garde sa place sans dire un état qu'il ne connaît pas encore. */
    hidden?: boolean;
    /** Sa fenêtre est ouverte : il reste enfoncé, et son infobulle se tait. */
    open: boolean;
    onClick: () => void;
}) {
    const button = (
        <Button
            ref={ref}
            variant={view.variant}
            busy={view.busy}
            aria-disabled={view.disabled || undefined}
            aria-label={view.name ?? undefined}
            aria-haspopup={view.opens === null ? undefined : 'dialog'}
            aria-expanded={view.opens === null ? undefined : open}
            data-state={open ? 'open' : 'closed'}
            className={`${hidden ? 'invisible ' : ''}send-button relative ${view.busy ? 'z-(--z-above-veil)' : ''} data-[state=open]:data-[variant=secondary]:border-bg-press data-[state=open]:data-[variant=secondary]:bg-bg-press data-[state=open]:data-[variant=secondary]:text-ink`}
            onClick={view.disabled ? undefined : onClick}
        >
            {view.icon === 'send' && <SendIcon />}
            {view.icon === 'check' && <CheckIcon />}
            {view.icon === 'retry' && <RetryIcon />}
            {view.label}
            {view.badge !== null && (
                <span aria-hidden="true" className="send-badge" data-badge={view.badge}>
                    {view.badge === 'error' && <ErrorIcon />}
                </span>
            )}
        </Button>
    );

    // L'infobulle reste autour du bouton même muette : sans elle, le bouton renaîtrait à
    // chaque changement d'état, et le curseur qu'il porte se perdrait.
    return (
        <Tooltip label={view.tooltip ?? view.label} open={open || view.tooltip === null ? false : undefined}>
            {button}
        </Tooltip>
    );
}
