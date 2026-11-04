import type { ReactNode, Ref } from 'react';

import { Button } from './Button';
import { ErrorIcon } from './icons';

/**
 * Le bandeau tout en haut de la fenêtre, sur toute sa largeur : ce qui touche toute
 * l'application. Il tient sur une ligne : sous 1280 px, sa seconde phrase s'efface.
 */
export function AlertBanner({
    children,
    detail,
    action,
    actionRef,
    expanded,
    onAction,
}: {
    children: ReactNode;
    detail?: ReactNode;
    action: string;
    actionRef?: Ref<HTMLButtonElement>;
    /** L'action ouvre une fenêtre : l'état de cette fenêtre. */
    expanded?: boolean;
    onAction: () => void;
}) {
    return (
        <div
            role="alert"
            className="flex h-7 flex-none items-center gap-3 border-b border-inc-line bg-inc-bg pr-3 pl-5 text-md leading-(--lh) text-ink"
        >
            <ErrorIcon />
            <span className="min-w-0 truncate">
                {children}
                {detail !== undefined && <span className="max-lg:hidden"> {detail}</span>}
            </span>
            <Button
                ref={actionRef}
                size="sm"
                className="ml-auto"
                aria-haspopup={expanded === undefined ? undefined : 'dialog'}
                aria-expanded={expanded}
                onClick={onAction}
            >
                {action}
            </Button>
        </div>
    );
}
