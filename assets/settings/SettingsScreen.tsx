import { type RefObject, useEffect, useEffectEvent, useMemo, useRef, useState, useSyncExternalStore } from 'react';

import { ExternalLink } from '../components/ExternalLink';
import { BackIcon } from '../components/icons';
import { LogoLink } from '../components/LogoLink';
import type { CheckResult, JiraApi, JiraConnection } from '../jira/jiraApi';
import { type JiraOutcome, type JiraPending, JiraSection } from '../jira/JiraSection';
import { REPOSITORY } from '../version/versionApi';
import { AppearanceSection } from './AppearanceSection';
import { DaySection, type ObjectiveField } from './DaySection';
import type { SettingsApi } from './settingsApi';
import { SettingsEditor } from './settingsEditor';
import { TypesSection } from './TypesSection';

/** L'année de la première version publiée de DayTrack 2. */
const FIRST_YEAR = 2026;

/**
 * La page Réglages : la barre reste en haut, avec « Retour à la journée » ; Échap fait de
 * même. On revient sur le jour qui était affiché, une fois enregistré tout ce qu'on a
 * changé : une durée refusée, ou qui n'a pas pu s'enregistrer, retient sur la page, son
 * message sous le champ, comme une section Jira modifiée, qui le dit à sa place.
 */
export function SettingsScreen({
    jiraApi,
    settingsApi,
    backDate,
    focusToken,
    leaveRef,
    onChecked,
    onLinked,
    onBack,
}: {
    jiraApi: JiraApi;
    settingsApi: SettingsApi;
    /** Le jour où ramène « Retour à la journée ». */
    backDate: string;
    /** Ouverte par « Mettre à jour le jeton » : le curseur va au champ du jeton. */
    focusToken: boolean;
    /**
     * Ce qui enregistre la page avant qu'on la quitte autrement que par elle — la flèche
     * du navigateur : la journée ne se lit qu'ensuite. Faux si la page doit rester.
     */
    leaveRef: RefObject<() => Promise<boolean>>;
    /** Ce que la vérification du jeton enregistré a donné : le bandeau le suit aussi. */
    onChecked: (result: CheckResult) => void;
    onLinked: (connection: JiraConnection) => void;
    onBack: () => void;
}) {
    const editor = useMemo(() => new SettingsEditor(settingsApi), [settingsApi]);
    const snapshot = useSyncExternalStore(
        (listener) => editor.subscribe(listener),
        () => editor.current(),
    );
    useEffect(() => {
        void editor.load();
    }, [editor]);
    // La connexion enregistrée se lit avec les réglages : les sections ne paraissent
    // qu'une fois remplies, une carte qui se remplirait après coup ferait sauter la page.
    // La vérification du jeton, qui attend Jira, ne les retient pas.
    const [stored, setStored] = useState<{ connection: JiraConnection | null; unread: boolean } | null>(null);
    useEffect(() => {
        let current = true;
        jiraApi.connection().then(
            (connection) => {
                if (current) {
                    setStored({ connection, unread: false });
                }
            },
            () => {
                if (current) {
                    setStored({ connection: null, unread: true });
                }
            },
        );

        return () => {
            current = false;
        };
    }, [jiraApi]);
    const ready = stored !== null && (snapshot.settings !== null || snapshot.unread);
    const pendingRef = useRef<ObjectiveField | null>(null);
    const jiraRef = useRef<JiraPending | null>(null);
    const leavingRef = useRef(false);
    // Ce qui part encore attend sa réponse avant que la journée s'ouvre.
    const [leaving, setLeaving] = useState(false);

    const jiraSettled = (): Promise<JiraOutcome> => jiraRef.current?.settled() ?? Promise.resolve('none');

    /** Attend ce qui part encore : vrai si la page peut se quitter, sinon ce qui retient le dit. */
    const settle = (): Promise<boolean> => {
        const committed = pendingRef.current?.commit() !== false;
        leavingRef.current = true;
        setLeaving(true);

        return Promise.all([editor.settled(), jiraSettled()]).then(([, outcome]) => {
            leavingRef.current = false;
            setLeaving(false);
            // L'objectif montré n'a pas pu s'enregistrer, même de nouveau : la journée se
            // lirait avec un autre. Les jours et les teintes, eux, sont revenus à ce que
            // le serveur tient.
            const objectiveKept = committed && editor.current().errors.objective === undefined;
            // Les deux se disent, et le curseur va au premier sur la page, la section Jira.
            if (jiraRef.current?.retain(outcome) === true) {
                return false;
            }
            if (!objectiveKept) {
                pendingRef.current?.focus();
            }

            return objectiveKept;
        });
    };

    /** Quitte les réglages, une fois enregistré ce qui doit l'être : vers la journée, par défaut. */
    const leave = (open: () => void = onBack) => {
        if (leavingRef.current) {
            return;
        }
        void settle().then((left) => {
            if (left) {
                open();
            }
        });
    };

    useEffect(() => {
        leaveRef.current = settle;

        return () => {
            leaveRef.current = () => Promise.resolve(true);
        };
    });

    // Échap ramène à la journée, sauf quand un élément de la page l'a déjà pris : la
    // grille des teintes, l'aide au jeton.
    const onKeyDown = useEffectEvent((event: KeyboardEvent) => {
        if (event.key === 'Escape' && !event.defaultPrevented) {
            event.preventDefault();
            leave();
        }
    });
    // Recharger la page avec une durée tapée l'enregistre, et le navigateur demande s'il
    // faut partir tant que la réponse n'est pas venue. Une section Jira modifiée ne peut
    // pas s'enregistrer ainsi, sans son test : il le demande aussi.
    const onBeforeUnload = useEffectEvent((event: BeforeUnloadEvent) => {
        pendingRef.current?.commit();
        if (!editor.idle() || jiraRef.current?.modified() === true) {
            event.preventDefault();
        }
    });
    useEffect(() => {
        const keyListener = (event: KeyboardEvent) => {
            onKeyDown(event);
        };
        const unloadListener = (event: BeforeUnloadEvent) => {
            onBeforeUnload(event);
        };
        window.addEventListener('keydown', keyListener);
        window.addEventListener('beforeunload', unloadListener);

        return () => {
            window.removeEventListener('keydown', keyListener);
            window.removeEventListener('beforeunload', unloadListener);
        };
    }, []);

    return (
        <div className="min-h-screen bg-bg-side text-ink">
            <header className="sticky top-0 z-(--z-sel) flex h-bar items-center border-b border-line bg-bg">
                <div className="flex w-side flex-none items-center gap-3 self-stretch px-5 text-lg font-bold max-lg:w-side-narrow">
                    <LogoLink
                        onOpen={() => {
                            leave(() => {
                                window.location.assign('/');
                            });
                        }}
                    />
                </div>
                <nav aria-label="Navigation" className="flex items-center gap-2 pl-5">
                    <a
                        href={`/${backDate}`}
                        aria-busy={leaving || undefined}
                        className="inline-flex h-ctl items-center gap-2 rounded-2 px-3 text-md font-medium text-ink-2 transition-colors hover:bg-bg-hover hover:text-ink aria-busy:cursor-progress"
                        onClick={(event) => {
                            event.preventDefault();
                            leave();
                        }}
                    >
                        <BackIcon />
                        Retour à la journée
                    </a>
                </nav>
            </header>
            <main aria-busy={!ready || undefined} className="settings-column mx-auto pt-5 pb-7">
                {/* Tout paraît d'un coup, titre compris : une barre de défilement qui
                    viendrait avec les sections décalerait la colonne. */}
                {ready && (
                    <>
                        <h1 className="mt-3 mb-5 text-xl font-bold">Réglages</h1>
                        <JiraSection
                            api={jiraApi}
                            stored={stored.connection}
                            unread={stored.unread}
                            focusToken={focusToken}
                            pendingRef={jiraRef}
                            onChecked={onChecked}
                            onLinked={onLinked}
                        />
                        <DaySection editor={editor} snapshot={snapshot} pendingRef={pendingRef} />
                        <TypesSection editor={editor} snapshot={snapshot} />
                        <AppearanceSection />
                        <footer className="flex items-center gap-4 border-t border-line pt-5 text-sm text-ink-3">
                            <span>DayTrack {DAYTRACK_VERSION}</span>
                            <ExternalLink href={REPOSITORY} label="GitHub" muted />
                            <span className="ml-auto">
                                © {copyrightYears(FIRST_YEAR, DAYTRACK_BUILD_YEAR)} Valentin Le Gal
                            </span>
                        </footer>
                    </>
                )}
            </main>
        </div>
    );
}

/** « 2026 », puis « 2026-2027 » quand une version sort une autre année. */
export function copyrightYears(first: number, built: number): string {
    return built > first ? `${String(first)}-${String(built)}` : String(first);
}
