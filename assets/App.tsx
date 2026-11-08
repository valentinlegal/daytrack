import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';

import {
    type Address,
    currentAddress,
    dayAddress,
    followArrow,
    refuseArrow,
    SETTINGS,
    showAddress,
    useBrowserArrows,
    WELCOME,
} from './address';
import { TooltipProvider } from './components/Tooltip';
import { httpCalendarApi } from './day/calendarApi';
import { httpDayApi } from './day/dayApi';
import { type DayConfig, DayScreen } from './day/DayScreen';
import { screenMemory } from './day/screenMemory';
import { FavoriteList } from './favorites/favoriteList';
import { httpFavoritesApi } from './favorites/favoritesApi';
import { tabStorage } from './grid/tabStore';
import { httpJiraApi } from './jira/jiraApi';
import { isTokenRefusal, JiraStatus, type JiraStatusSnapshot } from './jira/jiraStatus';
import { TicketBook } from './jira/ticketBook';
import type { TicketInfo } from './jira/ticketInfo';
import { TicketsProvider } from './jira/TicketsContext';
import { TokenBanner } from './jira/TokenBanner';
import { WelcomeScreen } from './jira/WelcomeScreen';
import { httpSettingsApi } from './settings/settingsApi';
import { SettingsScreen } from './settings/SettingsScreen';
import { LeftOutBanner } from './v1/LeftOutBanner';
import { type OldCompose, OldComposeBanner } from './v1/OldComposeBanner';
import { hasLeftOut, NOTHING_LEFT_OUT, type V1LeftOut } from './v1/v1ImportApi';

/** Ce que le serveur dit à la page (templates/app.html.twig). */
export interface AppConfig {
    /** L'écran de l'adresse : la journée, ou les réglages (/reglages). */
    readonly screen: 'day' | 'settings';
    readonly day: DayConfig;
    readonly jira: JiraStatusSnapshot;
    /** L'ancien fichier de la v1, tant qu'il est là. */
    readonly oldCompose: OldCompose | null;
    readonly v1LeftOut: V1LeftOut;
}

type Screen =
    | { readonly name: 'day'; readonly date: string }
    /**
     * @param back le jour à rouvrir en revenant
     * @param token ouverts par « Mettre à jour le jeton » : le curseur va au jeton
     */
    | { readonly name: 'settings'; readonly back: string; readonly token: boolean };

/**
 * L'application : la bienvenue tant que Jira n'est pas relié, puis la journée du jour
 * de l'adresse, ou la page Réglages. Le bandeau du jeton refusé se pose au-dessus de la
 * journée, tant que Jira refuse le jeton.
 */
export function App({ config }: { config: AppConfig }) {
    const jiraApi = useMemo(() => httpJiraApi(), []);
    const settingsApi = useMemo(() => httpSettingsApi(), []);
    const readHabitual = useCallback(
        () => settingsApi.read().then((settings) => settings.habitualObjective),
        [settingsApi],
    );
    const status = useMemo(() => new JiraStatus(jiraApi, config.jira), [jiraApi, config.jira]);
    const book = useMemo(() => new TicketBook(jiraApi, status), [jiraApi, status]);
    const learn = useCallback(
        (tickets: Record<string, TicketInfo>) => {
            book.learn(tickets);
        },
        [book],
    );
    const api = useMemo(() => httpDayApi(undefined, learn), [learn]);
    const calendarApi = useMemo(() => httpCalendarApi(), []);
    const storage = useMemo(() => tabStorage(window), []);
    const memory = useMemo(() => screenMemory(storage), [storage]);
    const favorites = useMemo(() => new FavoriteList(httpFavoritesApi(undefined, learn)), [learn]);
    const subscribe = useCallback((listener: () => void) => status.subscribe(listener), [status]);
    const jira = useSyncExternalStore(subscribe, () => status.current());
    const [screen, setScreen] = useState<Screen>(() =>
        config.screen === 'settings'
            ? { name: 'settings', back: memory.settingsBack() ?? config.day.date, token: false }
            : { name: 'day', date: config.day.date },
    );
    // La bienvenue a son adresse : l'adresse ne dit jamais un jour qu'on ne voit pas.
    // Relié, on retrouve le jour qu'elle disait, sans rien ajouter à l'historique.
    const welcoming = jira.state === 'unlinked';
    useEffect(() => {
        const here = currentAddress().screen;
        if (welcoming && here !== 'welcome') {
            showAddress(WELCOME, 'replace');
        } else if (!welcoming && here === 'welcome') {
            showAddress(dayAddress(config.day.date), 'replace');
        }
    }, [welcoming, config.day.date]);

    const [v1LeftOut, setV1LeftOut] = useState(config.v1LeftOut);
    // Un envoi part de la journée : le bandeau passe sous le voile avec elle.
    const [sendingDay, setSendingDay] = useState(false);
    // Ce qui enregistre les fenêtres ouvertes de la journée avant de la quitter.
    const leaveDayRef = useRef<() => Promise<boolean>>(() => Promise.resolve(true));
    // Ce que la journée fait des flèches du navigateur, tant qu'elle est affichée.
    const dayArrowsRef = useRef<((address: Address) => void) | null>(null);
    // Ce qui enregistre les réglages avant de revenir à la journée par la flèche du navigateur.
    const leaveSettingsRef = useRef<() => Promise<boolean>>(() => Promise.resolve(true));

    // À l'ouverture, le jeton enregistré passe-t-il toujours ? La réponse règle le bandeau.
    // Les réglages le vérifient eux-mêmes, pour leur ligne d'état.
    const checkOnOpen = config.screen === 'day';
    useEffect(() => {
        if (checkOnOpen) {
            void status.check();
        }
    }, [status, checkOnOpen]);

    /** Les réglages s'ouvrent sur le jour qu'on quitte, où les ramène « Retour à la journée ». */
    const showSettings = (back: string, token: boolean) => {
        memory.setSettingsBack(back);
        setScreen({ name: 'settings', back, token });
    };

    /**
     * Le bouton Réglages, ou « Mettre à jour le jeton » : les réglages s'ouvrent sur le jour
     * affiché, que l'adresse dit toujours. Les fenêtres ouvertes s'enregistrent d'abord,
     * comme avant de changer de jour : refusée, une fenêtre reste ouverte avec son message,
     * et la journée aussi. La flèche du navigateur fait de même (useDayNavigation).
     */
    const openSettings = (token: boolean) => {
        void leaveDayRef.current().then((left) => {
            if (!left) {
                return;
            }
            const here = currentAddress();
            showAddress(SETTINGS);
            showSettings(here.screen === 'day' ? here.date : config.day.date, token);
        });
    };

    const backToDay = (date: string) => {
        showAddress(dayAddress(date));
        setScreen({ name: 'day', date });
    };

    // Les flèches du navigateur. Vers un jour, depuis les réglages : la journée se lit une
    // fois les réglages enregistrés, pour qu'un jour vide montre le nouvel objectif ;
    // refusés, ils restent, et l'historique reste tel qu'il était. Depuis la journée, c'est
    // elle qui décide (useDayNavigation).
    useBrowserArrows((address) => {
        if (screen.name !== 'settings') {
            dayArrowsRef.current?.(address);

            return;
        }
        if (address.screen !== 'day') {
            return;
        }
        void leaveSettingsRef.current().then((left) => {
            // Revenu entre-temps aux réglages, par la flèche « Suivant » : on y reste.
            const here = currentAddress();
            if (here.screen !== 'day' || here.date !== address.date) {
                return;
            }
            if (left) {
                followArrow();
                setScreen({ name: 'day', date: address.date });
            } else {
                refuseArrow(SETTINGS);
            }
        });
    });

    return (
        <TooltipProvider>
            <TicketsProvider book={book} state={jira.state}>
                {jira.state === 'unlinked' ? (
                    <WelcomeScreen
                        api={jiraApi}
                        onLinked={(connection) => {
                            // Commencer ouvre la journée, même depuis l'adresse des réglages.
                            setScreen({ name: 'day', date: config.day.date });
                            status.linked(connection);
                        }}
                    />
                ) : screen.name === 'settings' ? (
                    <SettingsScreen
                        jiraApi={jiraApi}
                        settingsApi={settingsApi}
                        backDate={screen.back}
                        focusToken={screen.token}
                        leaveRef={leaveSettingsRef}
                        onChecked={(result) => {
                            status.checked(result);
                        }}
                        onLinked={(connection) => {
                            status.linked(connection);
                        }}
                        onBack={() => {
                            backToDay(screen.back);
                        }}
                    />
                ) : (
                    <div className="flex h-screen flex-col">
                        <div inert={sendingDay} className="contents">
                            {/* Un seul bandeau à la fois. L'ancien fichier passe en dernier : il reste
                                tant que le fichier n'est pas remplacé, et cacherait la liste pour toujours. */}
                            {isTokenRefusal(jira.state) ? (
                                <TokenBanner
                                    status={jira}
                                    onUpdate={() => {
                                        openSettings(true);
                                    }}
                                />
                            ) : hasLeftOut(v1LeftOut) ? (
                                <LeftOutBanner
                                    leftOut={v1LeftOut}
                                    onSeen={() => {
                                        setV1LeftOut(NOTHING_LEFT_OUT);
                                    }}
                                />
                            ) : (
                                config.oldCompose !== null && <OldComposeBanner kind={config.oldCompose} />
                            )}
                        </div>
                        <div className="min-h-0 flex-1">
                            <DayScreen
                                key={screen.date}
                                config={{ ...config.day, date: screen.date }}
                                api={api}
                                calendarApi={calendarApi}
                                storage={storage}
                                favorites={favorites}
                                leaveRef={leaveDayRef}
                                arrowsRef={dayArrowsRef}
                                readHabitual={readHabitual}
                                onSettings={() => {
                                    openSettings(false);
                                }}
                                onSettingsArrow={(back) => {
                                    followArrow();
                                    showSettings(back, false);
                                }}
                                onUpdateToken={() => {
                                    openSettings(true);
                                }}
                                onJiraRefusal={(refusal) => {
                                    status.learn(refusal);
                                }}
                                onSendingChange={setSendingDay}
                            />
                        </div>
                    </div>
                )}
            </TicketsProvider>
        </TooltipProvider>
    );
}
