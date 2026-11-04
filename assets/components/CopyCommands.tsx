import { useEffect, useState } from 'react';

import { Button } from './Button';
import { CheckIcon, CopyIcon } from './icons';

const COPIED_DURATION = 2000;
const COPIED = 'Commandes copiées';
const REFUSED = 'Copie impossible\u{a0}: sélectionnez les commandes à la main.';
const LAYER = 'col-start-1 row-start-1 inline-flex items-center justify-center gap-2';

export type CopyState = 'none' | 'copied' | 'refused';

/** Copier des commandes : « copiées » s'efface tout seul, deux secondes plus tard. */
export function useCopyCommands(commands: string): {
    copy: CopyState;
    run: () => void;
    reset: () => void;
} {
    const [copy, setCopy] = useState<CopyState>('none');

    useEffect(() => {
        if (copy !== 'copied') {
            return;
        }
        const timer = window.setTimeout(() => {
            setCopy('none');
        }, COPIED_DURATION);

        return () => {
            window.clearTimeout(timer);
        };
    }, [copy]);

    return {
        copy,
        run: () => {
            void copyToClipboard(commands).then(setCopy);
        },
        reset: () => {
            setCopy('none');
        },
    };
}

export function CopyCommandsButton({ copy, onCopy }: { copy: CopyState; onCopy: () => void }) {
    return (
        <Button size="sm" variant="primary" onClick={onCopy}>
            {/* Les deux contenus occupent la même place, chacun centré : le bouton ne
                bouge pas sous le pointeur, et la coche reste contre son texte. */}
            <span className="grid">
                <span className={`${LAYER} ${copy === 'copied' ? 'invisible' : ''}`}>
                    <CopyIcon />
                    Copier les commandes
                </span>
                <span className={`${LAYER} ${copy === 'copied' ? '' : 'invisible'}`}>
                    <CheckIcon onPrimary />
                    {COPIED}
                </span>
            </span>
        </Button>
    );
}

/** Une seule région, là dès l'ouverture : c'est ce qui se dit quand elle change. */
export function CopyCommandsStatus({ copy }: { copy: CopyState }) {
    return (
        <p aria-live="polite" className={copy === 'refused' ? 'text-sm text-inc' : 'sr-only'}>
            {copy === 'copied' ? COPIED : copy === 'refused' ? REFUSED : ''}
        </p>
    );
}

/** Un navigateur peut refuser, et ne propose rien hors HTTPS : les commandes restent là, à sélectionner. */
async function copyToClipboard(commands: string): Promise<CopyState> {
    try {
        await navigator.clipboard.writeText(commands);

        return 'copied';
    } catch {
        return 'refused';
    }
}
