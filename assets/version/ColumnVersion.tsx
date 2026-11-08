import { type RefObject, useEffect, useEffectEvent, useRef, useState } from 'react';

import { Button } from '../components/Button';
import { CopyCommandsButton, CopyCommandsStatus, useCopyCommands } from '../components/CopyCommands';
import { ExternalLink } from '../components/ExternalLink';
import { DownloadIcon } from '../components/icons';
import { Popover } from '../components/Popover';
import { tokenPixels } from '../components/tokenPixels';
import { useReturns } from '../useReturns';
import { httpVersionApi, notesUrl, type VersionApi } from './versionApi';

const COMMANDS = 'docker compose pull\ndocker compose up -d';
const defaultApi = httpVersionApi();

/**
 * Le numéro de version du pied de colonne, et le bouton « Nouvelle version » quand il y
 * en a une. Elle se cherche à l'ouverture et au retour sur la page, sans rien dire quand
 * le serveur ne répond pas : c'est un avis.
 */
export function ColumnVersion({
    api = defaultApi,
    beforeOpen,
}: {
    api?: VersionApi;
    /** Ce qui doit se régler avant d'ouvrir la fenêtre : elle ne s'ouvre pas à côté d'une fenêtre de ticket refusée. */
    beforeOpen: () => Promise<boolean>;
}) {
    const [available, setAvailable] = useState<string | null>(null);
    const [open, setOpen] = useState(false);
    const buttonRef = useRef<HTMLButtonElement>(null);
    // Un appui sur le bouton, fenêtre ouverte, compte comme un clic à côté et la ferme : le
    // clic qui suit ne doit pas la rouvrir.
    const closedByPressRef = useRef(false);

    const onAnswer = useEffectEvent((version: string | null) => {
        // La fenêtre part avec son bouton, et ne revient pas toute seule avec lui. Le curseur
        // qui s'y trouvait va au voisin du bouton, l'engrenage : il ne se perd pas avec eux.
        if (version === null && open) {
            const neighbour = buttonRef.current?.nextElementSibling;
            if (neighbour instanceof HTMLElement) {
                neighbour.focus();
            }
            setOpen(false);
        }
        setAvailable(version);
    });
    const check = useEffectEvent(() => {
        api.available().then(onAnswer, () => undefined);
    });
    const returns = useReturns();
    useEffect(() => {
        check();
    }, [returns]);

    return (
        <>
            <span
                className="column-version min-w-0 overflow-hidden font-mono text-xs text-ink-3"
                data-crowded={available === null ? undefined : ''}
            >
                v{DAYTRACK_VERSION}
            </span>
            {available !== null && (
                <>
                    <button
                        ref={buttonRef}
                        type="button"
                        aria-haspopup="dialog"
                        aria-expanded={open}
                        aria-label={`Nouvelle version disponible, ${available}`}
                        className="inline-flex h-pill flex-none cursor-pointer items-center gap-1 rounded-pill border border-line-strong bg-bg-raise px-2 text-xs font-semibold whitespace-nowrap text-ink transition-colors hover:bg-bg-hover aria-expanded:border-bg-press aria-expanded:bg-bg-press"
                        onPointerDown={() => {
                            closedByPressRef.current = open;
                        }}
                        onClick={(event) => {
                            // Au clavier, il n'y a pas eu d'appui.
                            if (open) {
                                setOpen(false);
                            } else if (event.detail === 0 || !closedByPressRef.current) {
                                void beforeOpen().then(setOpen);
                            }
                            closedByPressRef.current = false;
                        }}
                    >
                        <DownloadIcon />
                        Nouvelle version
                    </button>
                    <UpdateWindow
                        open={open}
                        version={available}
                        anchor={buttonRef}
                        onClose={() => {
                            setOpen(false);
                        }}
                    />
                </>
            )}
        </>
    );
}

/** La fenêtre de la nouvelle version : ce qu'il faut lancer, et ce qu'elle apporte. */
function UpdateWindow({
    open,
    version,
    anchor,
    onClose,
}: {
    open: boolean;
    version: string;
    anchor: RefObject<HTMLButtonElement | null>;
    onClose: () => void;
}) {
    const { copy, run, reset } = useCopyCommands(COMMANDS);
    const laterRef = useRef<HTMLButtonElement>(null);

    const close = () => {
        reset();
        onClose();
    };

    return (
        <Popover
            open={open}
            anchor={anchor}
            side="top"
            align="start"
            sideOffset={tokenPixels('--s-2')}
            width="pop-md"
            title={`DayTrack ${version} est disponible`}
            onCancel={close}
            onOutside={close}
            initialFocus={laterRef}
            returnFocus={() => anchor.current?.focus()}
            footerEnd={
                <>
                    <Button ref={laterRef} size="sm" onClick={close}>
                        Plus tard
                    </Button>
                    <CopyCommandsButton copy={copy} onCopy={run} />
                </>
            }
        >
            <p className="text-sm text-ink-2">
                Pour mettre à jour, lancez ces deux commandes dans le dossier de DayTrack, sur la machine qui
                l&apos;héberge. Rechargez ensuite cette page.
            </p>
            <pre className="rounded-2 border border-line bg-bg-sel p-3 font-mono text-sm text-ink select-all">
                {COMMANDS}
            </pre>
            <CopyCommandsStatus copy={copy} />
            <span className="update-notes text-sm">
                <ExternalLink href={notesUrl(version)} label={`Voir les nouveautés de la ${version}`} />
            </span>
        </Popover>
    );
}
