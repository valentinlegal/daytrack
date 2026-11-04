import type { ReactNode, RefObject } from 'react';

import { Button } from '../components/Button';
import { Tooltip } from '../components/Tooltip';
import * as Quarter from '../grid/quarter';
import type { FiguresLine } from './figuresLine';
import { duration, signedDuration } from './format';
import { CheckIcon, ChevronLeft, ChevronRight, PanelIcon, PencilIcon } from '../components/icons';
import { LogoLink } from '../components/LogoLink';

/**
 * La barre du haut : le logo, la navigation entre les jours, la date et sa ligne des
 * chiffres, le bouton Jira, puis l'icône du récapitulatif quand il ne la porte pas
 * lui-même.
 *
 * Pendant un envoi, seul le bouton Jira reste atteignable : le reste de la barre est
 * inerte, sous le voile.
 */
export function DayBar({
    title,
    figures,
    previousTip,
    nextTip,
    canGoNext,
    recapOpen,
    recapToggleRef,
    titleRef,
    objectiveRef,
    objectiveOpen,
    onObjective,
    onToday,
    onPrevious,
    onNext,
    onToggleRecap,
    sendButton,
    sending,
}: {
    title: string;
    /** null tant que la journée n'est pas lue. */
    figures: FiguresLine | null;
    /**
     * Les infobulles des flèches : le jour où elles mènent, « Vendredi 23 octobre ».
     * « Jour suivant » éteint n'en a pas : les jours grisés du calendrier le disent déjà.
     */
    previousTip: string;
    nextTip: string;
    canGoNext: boolean;
    recapOpen: boolean;
    /** Le bouton du récapitulatif, qui reprend le focus quand le panneau se ferme. */
    recapToggleRef: RefObject<HTMLButtonElement | null>;
    /** La date : la fenêtre Objectif du jour s'aligne sur son bord gauche. */
    titleRef: RefObject<HTMLHeadingElement | null>;
    /** Le bouton de l'objectif, où s'accroche sa fenêtre. */
    objectiveRef: RefObject<HTMLButtonElement | null>;
    objectiveOpen: boolean;
    onObjective: () => void;
    onToday: () => void;
    onPrevious: () => void;
    onNext: () => void;
    onToggleRecap: () => void;
    /** Le bouton Jira, toujours au même endroit. */
    sendButton: ReactNode;
    /** Un envoi part : la barre est sous le voile, hormis le bouton Jira. */
    sending: boolean;
}) {
    const recapLabel = recapOpen ? 'Masquer le récapitulatif' : 'Afficher le récapitulatif';

    return (
        <header className="flex h-bar flex-none items-center border-b border-line">
            <div
                inert={sending}
                className="flex w-col flex-none items-center gap-3 self-stretch px-5 text-lg font-bold"
            >
                <LogoLink onOpen={onToday} />
            </div>
            <nav inert={sending} aria-label="Changer de jour" className="flex flex-none items-center gap-2 pl-5">
                <Button onClick={onToday}>{"Aujourd'hui"}</Button>
                <div className="flex gap-1">
                    <Tooltip label={previousTip}>
                        <Button variant="ghost" iconOnly aria-label="Jour précédent" onClick={onPrevious}>
                            <ChevronLeft />
                        </Button>
                    </Tooltip>
                    <Tooltip label={nextTip} open={canGoNext ? undefined : false}>
                        <Button
                            variant="ghost"
                            iconOnly
                            aria-label="Jour suivant"
                            aria-disabled={!canGoNext}
                            onClick={canGoNext ? onNext : undefined}
                        >
                            <ChevronRight />
                        </Button>
                    </Tooltip>
                </div>
            </nav>
            <div inert={sending} className="ml-3 flex min-w-0 flex-col gap-1">
                <h1 ref={titleRef} className="text-xl leading-(--lh) font-semibold whitespace-nowrap">
                    {title}
                </h1>
                <FiguresSummary
                    figures={figures}
                    objectiveRef={objectiveRef}
                    objectiveOpen={objectiveOpen}
                    onObjective={onObjective}
                />
            </div>
            <div className="ml-auto flex items-center gap-3 pr-3">
                {sendButton}
                <span inert={sending} className="hidden items-center gap-3 group-data-[recap=closed]:flex max-lg:flex">
                    <span aria-hidden="true" className="mx-1 h-5 w-px bg-line" />
                    <Tooltip label={recapLabel}>
                        <Button
                            ref={recapToggleRef}
                            variant="ghost"
                            size="sm"
                            iconOnly
                            className="aria-expanded:border-bg-press aria-expanded:bg-bg-press aria-expanded:text-ink"
                            aria-expanded={recapOpen}
                            aria-controls="recap"
                            aria-label={recapLabel}
                            onClick={onToggleRecap}
                        >
                            <PanelIcon />
                        </Button>
                    </Tooltip>
                </span>
            </div>
        </header>
    );
}

/**
 * La ligne des chiffres : travaillé sur objectif, la barre de progression, puis ce
 * que figuresLine choisit d'en dire. « Reste » s'efface quand la place manque : sous
 * 1440 px avec le récapitulatif ouvert, et toujours sous 1280 px.
 */
function FiguresSummary({
    figures,
    objectiveRef,
    objectiveOpen,
    onObjective,
}: {
    figures: FiguresLine | null;
    objectiveRef: RefObject<HTMLButtonElement | null>;
    objectiveOpen: boolean;
    onObjective: () => void;
}) {
    if (figures === null) {
        // La hauteur de la ligne reste réservée : la date ne bouge pas à l'arrivée des chiffres.
        return <div className="h-5" />;
    }
    const { tail } = figures;
    if (!figures.working) {
        return (
            <div
                role="group"
                aria-label="Chiffres du jour"
                className="flex h-5 items-center gap-3 text-md leading-(--lh) whitespace-nowrap text-ink-3"
            >
                {figures.worked === 0 || tail.kind !== 'balance' ? (
                    <span className="text-ink-2">Jour non travaillé</span>
                ) : (
                    <>
                        <Value>{duration(figures.worked)}</Value>
                        <span>
                            Solde <Value>{signedDuration(tail.balance)}</Value>
                        </span>
                    </>
                )}
            </div>
        );
    }

    return (
        <div
            role="group"
            aria-label="Chiffres du jour"
            className="flex h-5 items-center gap-3 text-md leading-(--lh) whitespace-nowrap text-ink-3"
        >
            <span className="inline-flex items-baseline gap-1">
                <Value>{duration(figures.worked)}</Value>
                <span>/</span>
                {/* L'objectif s'ouvre d'un clic, pour ce jour-là ; le slash reste hors du bouton.
                    Son infobulle se tait tant que sa fenêtre est ouverte, sous lui. */}
                <Tooltip label="Modifier l'objectif du jour" open={objectiveOpen ? false : undefined}>
                    <button
                        ref={objectiveRef}
                        type="button"
                        aria-haspopup="dialog"
                        aria-expanded={objectiveOpen}
                        aria-label={`Objectif du jour, ${duration(figures.objective)}. Modifier`}
                        className="-ml-1 inline-flex h-5 cursor-pointer items-baseline gap-1 rounded-1 border-none bg-transparent px-1 font-medium text-ink-3 tabular-nums hover:bg-bg-hover aria-expanded:bg-bg-press aria-expanded:text-ink"
                        onClick={onObjective}
                    >
                        {duration(figures.objective)}
                        <PencilIcon />
                    </button>
                </Tooltip>
            </span>
            {/* Mis à 0h00, le jour n'avance vers rien : l'objectif reste, pour le défaire. */}
            {!figures.declaredOff && (
                <progress
                    className={`mini-progress ${figures.reached ? 'text-ok' : 'text-ink'}`}
                    aria-label="Avancement vers l'objectif"
                    max={100}
                    value={Math.round(figures.progress * 100)}
                />
            )}
            {tail.kind === 'off' && <span className="text-ink-2">Jour non travaillé</span>}
            {tail.kind === 'remaining' && (
                <>
                    <span className="max-lg:hidden max-xl:group-data-[recap=open]:hidden">
                        Reste <Value>{duration(tail.remaining)}</Value>
                    </span>
                    {tail.projectedEnd !== null && (
                        <span>
                            Fin prévue à <Value>{Quarter.format(tail.projectedEnd)}</Value>
                        </span>
                    )}
                </>
            )}
            {tail.kind === 'reached' && (
                <span className="inline-flex items-center gap-1 font-semibold text-ink">
                    <CheckIcon />
                    Objectif atteint
                </span>
            )}
            {tail.kind === 'balance' && (
                <span>
                    Solde <Value>{signedDuration(tail.balance)}</Value>
                </span>
            )}
        </div>
    );
}

function Value({ children }: { children: string }) {
    return <b className="font-semibold text-ink tabular-nums">{children}</b>;
}
