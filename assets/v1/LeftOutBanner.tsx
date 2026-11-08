import { useRef, useState } from 'react';

import { AlertBanner } from '../components/AlertBanner';
import { Button } from '../components/Button';
import { Popover } from '../components/Popover';
import { tokenPixels } from '../components/tokenPixels';
import { dayTitle } from '../day/calendar';
import { duration } from '../day/format';
import { httpV1ImportApi, type V1ImportApi, type V1LeftOut } from './v1ImportApi';

const defaultApi = httpV1ImportApi();

/**
 * Ce que la reprise de la v1 n'a pas pu garder tel quel : une saisie que la v2 refuserait
 * n'est jamais arrondie, elle se dit ici. Le bandeau ne compte pas, la liste le fait, et
 * il reste jusqu'à ce qu'elle ait été lue.
 */
export function LeftOutBanner({
    leftOut,
    onSeen,
    api = defaultApi,
}: {
    leftOut: V1LeftOut;
    /** La liste est lue : elle ne revient pas, même au retour des réglages. */
    onSeen: () => void;
    api?: V1ImportApi;
}) {
    const [open, setOpen] = useState(false);
    const [failed, setFailed] = useState(false);
    const buttonRef = useRef<HTMLButtonElement>(null);
    const closeRef = useRef<HTMLButtonElement>(null);

    const close = () => {
        setFailed(false);
        setOpen(false);
    };

    return (
        <>
            <AlertBanner
                action="Voir la liste"
                actionRef={buttonRef}
                expanded={open}
                detail="L'ancienne base reste intacte."
                onAction={() => {
                    setOpen((current) => !current);
                }}
            >
                Une partie de vos données de la v1 n&apos;a pas été reprise telle quelle.
            </AlertBanner>
            <Popover
                open={open}
                anchor={buttonRef}
                side="bottom"
                align="end"
                overRecap
                sideOffset={tokenPixels('--s-2')}
                width="pop-md"
                title="Ce qui n'a pas été repris tel quel"
                onCancel={close}
                onOutside={close}
                initialFocus={closeRef}
                returnFocus={() => buttonRef.current?.focus()}
                footerEnd={
                    <>
                        <Button ref={closeRef} size="sm" onClick={close}>
                            Plus tard
                        </Button>
                        <Button
                            size="sm"
                            variant="primary"
                            onClick={() => {
                                setFailed(false);
                                api.seen().then(
                                    () => {
                                        // Le bouton part avec son bandeau : le curseur va à la grille,
                                        // plutôt que de se perdre.
                                        document
                                            .querySelector<HTMLElement>('[aria-label="Créneaux de la journée"]')
                                            ?.focus();
                                        onSeen();
                                    },
                                    () => {
                                        setFailed(true);
                                    },
                                );
                            }}
                        >
                            Ne plus l&apos;afficher
                        </Button>
                    </>
                }
            >
                {leftOut.entries.length > 0 && (
                    <p className="text-sm text-ink-2">
                        En v2, une saisie commence et finit au quart d&apos;heure, entre 07:00 et 20:00, sans en
                        chevaucher une autre.
                    </p>
                )}
                <ul className="flex max-h-(--w-pop-sm) flex-col gap-1 overflow-y-auto text-sm text-ink">
                    {/* La v1 refusait deux saisies commençant à la même heure. */}
                    {leftOut.entries.map((entry) => (
                        <li key={`${entry.date} ${entry.start}`}>
                            {dayTitle(entry.date)} {hours(entry)}
                            {entry.ticket !== null && (
                                <>
                                    , <Key>{entry.ticket}</Key>
                                </>
                            )}
                        </li>
                    ))}
                    {leftOut.objectives.map((objective) => (
                        <li key={objective.date}>
                            {`${dayTitle(objective.date)}, objectif de\u00a0${duration(objective.from)} ramené à\u00a0${duration(objective.to)}`}
                        </li>
                    ))}
                    {leftOut.favorites.map((favorite) => (
                        <li key={favorite}>
                            Le favori <Key>{favorite}</Key>, qui n&apos;est pas un identifiant de ticket
                        </li>
                    ))}
                </ul>
                {leftOut.entries.length > 0 && (
                    <p className="text-sm text-ink-2">
                        Ces saisies restent dans la base de la v1. Celles déjà envoyées restent aussi dans Jira, tant
                        que vous ne renvoyez pas leur journée.
                    </p>
                )}
                {/* Une région là dès l'ouverture : c'est ce qui se dit quand elle change. */}
                <p aria-live="polite" className={failed ? 'text-sm text-inc' : 'sr-only'}>
                    {failed ? 'Le serveur ne répond pas. Réessayez dans un instant.' : ''}
                </p>
            </Popover>
        </>
    );
}

function Key({ children }: { children: string }) {
    return <b className="font-mono font-semibold">{children}</b>;
}

function hours({ start, end }: V1LeftOut['entries'][number]): string {
    return end === null ? `à ${start}, sans heure de fin` : `de ${start} à ${end}`;
}
