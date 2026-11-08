import { type ReactNode, type RefObject, useCallback, useEffect, useRef, useState } from 'react';

import { Button } from '../components/Button';
import { Field, GeneralError } from '../components/Field';
import { ArrowDownIcon, ArrowUpIcon, GearIcon, GripIcon, PencilIcon, PlusIcon, TrashIcon } from '../components/icons';
import { fromKeyboard } from '../components/keyboardMenu';
import { MenuContent, MenuItem, MenuRoot, MenuSeparator, MenuTrigger } from '../components/Menu';
import { Tooltip } from '../components/Tooltip';
import type { Favorite } from '../favorites/favorites';
import { moved } from '../favorites/favorites';
import { tintOf } from '../jira/ticketInfo';
import { useTickets } from '../jira/TicketsContext';
import { menuShortcut } from './shortcuts';
import { TicketChip } from './TicketChip';
import { ignoreHeldEnter, saveOnEnter, TicketField, useTicketField } from './TicketField';
import type { FavoriteForm, Favorites } from './useFavorites';

/**
 * La colonne de gauche : l'en-tête et son +, le formulaire d'ajout en tête de liste, les
 * favoris, ou la liste vide qui explique les gestes. Sa largeur se règle par son bord
 * droit (ColumnResizer).
 *
 * Pendant un glisser, le favori reste à sa place en pointillé, ou à celle où il
 * tomberait dans la liste, et une carte suit le pointeur. Un bloc glissé hors de la
 * grille a de même sa carte, et montre dans la liste la place qu'il prendrait.
 */
/** La colonne, que son bord désigne (ColumnResizer). */
export const FAVORITES_COLUMN = 'favoris';

export function FavoritesColumn({
    favorites,
    resizer,
    calendar = null,
    version = null,
    onSettings,
}: {
    favorites: Favorites;
    resizer: ReactNode;
    /** Le calendrier du mois, sous la liste : il descend avec elle mais reste toujours entier. */
    calendar?: ReactNode;
    /** Le numéro de version et son avis, au pied de la colonne. */
    version?: ReactNode;
    /** Le bouton Réglages du pied de colonne ; sans lui, pas de pied. */
    onSettings?: (() => void) | undefined;
}) {
    const { snapshot, form, drag, columnRef, listRef, dragCardRef, addButtonRef } = favorites;
    const list = snapshot.favorites;
    const adding = form !== null && form.favorite === null;
    const dragged = drag?.kind === 'favorite' ? drag.favorite : null;
    // La colonne, où les menus des favoris se posent : un lecteur d'écran les trouve
    // dans son repère.
    const [aside, setAside] = useState<HTMLElement | null>(null);
    const asideRef = useCallback(
        (element: HTMLElement | null) => {
            columnRef.current = element;
            setAside(element);
        },
        [columnRef],
    );

    // L'ordre affiché : celui de la liste, le favori glissé à la place où il tomberait.
    const shown =
        list === null
            ? []
            : drag?.kind === 'favorite' && drag.index !== null
              ? (moved(list, drag.favorite.id, drag.index) ?? list)
              : list;
    const placeholder = drag?.kind === 'block' && drag.index !== null ? { ...drag, index: drag.index } : null;
    const rows: ({ favorite: Favorite } | { placeholder: string })[] = shown.map((favorite) => ({ favorite }));
    if (placeholder !== null) {
        rows.splice(Math.min(placeholder.index, rows.length), 0, { placeholder: placeholder.ticket });
    }

    return (
        <aside
            ref={asideRef}
            id={FAVORITES_COLUMN}
            aria-label="Favoris et calendrier"
            className="relative flex min-h-0 w-col flex-none flex-col border-r border-line bg-bg-side"
        >
            <div className="flex h-7 flex-none items-center justify-between pr-3 pl-5">
                <h2 className="text-sm font-semibold text-ink-2">Favoris</h2>
                <Tooltip label="Ajouter un favori" open={adding ? false : undefined}>
                    <Button
                        ref={addButtonRef}
                        variant="ghost"
                        size="sm"
                        iconOnly
                        aria-label="Ajouter un favori"
                        aria-expanded={adding}
                        className="aria-expanded:border-bg-press aria-expanded:bg-bg-press aria-expanded:text-ink"
                        onKeyDown={ignoreHeldEnter}
                        onClick={favorites.openAdd}
                    >
                        <PlusIcon />
                    </Button>
                </Tooltip>
            </div>
            <FadingList listRef={listRef}>
                {adding && (
                    <li>
                        <FavoriteFormFrame form={form} favorites={favorites} />
                    </li>
                )}
                {list !== null && rows.length === 0 && !adding && <EmptyFavorites onAdd={favorites.openAdd} />}
                {rows.map((row) =>
                    'placeholder' in row ? (
                        <li key="placeholder" aria-hidden="true" data-favorite-placeholder>
                            <FavoriteCardBody ticket={row.placeholder} name={null} ghost />
                        </li>
                    ) : form?.favorite?.id === row.favorite.id ? (
                        <li key={row.favorite.id}>
                            <FavoriteFormFrame form={form} favorites={favorites} />
                        </li>
                    ) : (
                        <li key={row.favorite.id}>
                            <FavoriteCard
                                favorite={row.favorite}
                                first={row.favorite.id === list?.[0]?.id}
                                last={row.favorite.id === list?.at(-1)?.id}
                                ghost={row.favorite.id === dragged?.id}
                                dragging={drag !== null}
                                favorites={favorites}
                                container={aside}
                            />
                        </li>
                    ),
                )}
            </FadingList>
            {snapshot.failed && (
                <GeneralError message="Les favoris ne se lisent pas. Rechargez la page." className="px-5" />
            )}
            {calendar}
            {drag !== null && (
                <div ref={dragCardRef} aria-hidden="true" className="favorite-drag w-favorite">
                    <FavoriteCardBody
                        ticket={drag.kind === 'block' ? drag.ticket : drag.favorite.ticket}
                        name={drag.kind === 'block' ? null : drag.favorite.name}
                        lifted
                    />
                </div>
            )}
            {onSettings !== undefined && (
                // Le pied de colonne : la version et son avis, puis l'engrenage des
                // réglages, tout à droite.
                <div className="column-foot mt-auto flex h-foot flex-none items-center gap-2 border-t border-line pr-3 pl-5">
                    {version}
                    <Tooltip label="Réglages">
                        <Button
                            variant="ghost"
                            size="sm"
                            iconOnly
                            aria-label="Réglages"
                            className="ml-auto text-ink-3"
                            onClick={onSettings}
                        >
                            <GearIcon />
                        </Button>
                    </Tooltip>
                </div>
            )}
            {resizer}
        </aside>
    );
}

/**
 * La liste qui défile quand elle déborde, avec un fondu de --s-6 en bas tant qu'il
 * reste à voir.
 */
function FadingList({ listRef, children }: { listRef: RefObject<HTMLUListElement | null>; children: ReactNode }) {
    const [more, setMore] = useState(false);

    useEffect(() => {
        const element = listRef.current;
        if (element === null) {
            return;
        }
        const measure = () => {
            setMore(element.scrollTop + element.clientHeight < element.scrollHeight - 1);
        };
        // La liste et chaque carte se mesurent ; une carte ajoutée ou retirée aussi.
        const sizes = new ResizeObserver(measure);
        const watch = () => {
            sizes.disconnect();
            sizes.observe(element);
            for (const child of element.children) {
                sizes.observe(child);
            }
            measure();
        };
        const cards = new MutationObserver(watch);
        cards.observe(element, { childList: true });
        watch();
        element.addEventListener('scroll', measure, { passive: true });

        return () => {
            sizes.disconnect();
            cards.disconnect();
            element.removeEventListener('scroll', measure);
        };
    }, [listRef]);

    return (
        <ul
            ref={listRef}
            aria-label="Favoris"
            className={`favorites-scroll flex min-h-0 flex-col gap-1 overflow-y-auto px-4 py-1 ${more ? 'favorites-fade' : ''}`}
        >
            {children}
        </ul>
    );
}

/** Un favori : un clic le copie, on le glisse, un double-clic le renomme, le clic droit ouvre son menu. */
function FavoriteCard({
    favorite,
    first,
    last,
    ghost,
    dragging,
    favorites,
    container,
}: {
    favorite: Favorite;
    first: boolean;
    last: boolean;
    /** C'est lui qu'on glisse : il reste en pointillé, à sa place ou à celle où il tomberait. */
    ghost: boolean;
    /** Un glisser est en cours : aucune infobulle ne s'ouvre. */
    dragging: boolean;
    favorites: Favorites;
    /** La colonne, où le menu se pose. */
    container: HTMLElement | null;
}) {
    const title = useTickets().get(favorite.ticket)?.title ?? null;
    const shownName = favorite.name ?? title;
    const label = shownName === null ? favorite.ticket : `${favorite.ticket}, ${shownName}`;
    // « Renommer… » ouvre le formulaire, qui prend le curseur : le menu ne le lui rend pas.
    const renamingRef = useRef(false);
    // Tant que son menu est ouvert, la carte garde l'aspect du survol : c'est d'elle qu'il parle.
    const [menuOpen, setMenuOpen] = useState(false);

    return (
        <MenuRoot modal={false} onOpenChange={setMenuOpen}>
            <Tooltip
                label={`${label}. Cliquez pour le copier, glissez-le sur la grille.`}
                side="right"
                open={dragging ? false : undefined}
            >
                <MenuTrigger asChild>
                    <button
                        type="button"
                        data-favorite={favorite.id}
                        data-menu={menuOpen ? 'open' : undefined}
                        // La place laissée pendant le glisser ne s'active pas : c'est lui qu'on tient.
                        aria-disabled={ghost || undefined}
                        className={`favorite-card group/card w-full cursor-grab rounded-2 text-left select-none focus-visible:outline-(length:--ring) focus-visible:outline-offset-(--ring) focus-visible:outline-focus ${ghost ? 'cursor-grabbing' : ''}`}
                        onMouseDown={(event) => {
                            favorites.onCardMouseDown(event, favorite);
                        }}
                        onClick={(event) => {
                            favorites.onCardClick(event, favorite);
                        }}
                        onDoubleClick={() => {
                            favorites.openRename(favorite);
                        }}
                        onKeyDown={(event) => {
                            favorites.onCardKeyDown(event, favorite);
                        }}
                        onContextMenu={(event) => {
                            // Le menu du clavier est déjà ouvert sous la carte (touche Menu,
                            // Maj+F10) : celui que le navigateur envoie ensuite est ignoré.
                            if (fromKeyboard(event.nativeEvent)) {
                                event.preventDefault();
                            }
                        }}
                    >
                        <FavoriteCardBody ticket={favorite.ticket} name={favorite.name} ghost={ghost} />
                    </button>
                </MenuTrigger>
            </Tooltip>
            <MenuContent
                label={`Actions sur le favori ${favorite.ticket}`}
                header={favorite.ticket}
                container={container}
                onCloseAutoFocus={(event) => {
                    if (renamingRef.current) {
                        renamingRef.current = false;
                        event.preventDefault();
                    }
                }}
            >
                <MenuItem
                    icon={<PencilIcon />}
                    {...menuShortcut('edit', favorites.mac)}
                    onSelect={() => {
                        renamingRef.current = true;
                        favorites.openRename(favorite);
                    }}
                >
                    Renommer…
                </MenuItem>
                <MenuItem
                    icon={<ArrowUpIcon />}
                    {...menuShortcut('moveUp', favorites.mac)}
                    disabled={first}
                    onSelect={() => {
                        favorites.move(favorite, -1);
                    }}
                >
                    Monter
                </MenuItem>
                <MenuItem
                    icon={<ArrowDownIcon />}
                    {...menuShortcut('moveDown', favorites.mac)}
                    disabled={last}
                    onSelect={() => {
                        favorites.move(favorite, 1);
                    }}
                >
                    Descendre
                </MenuItem>
                <MenuSeparator />
                <MenuItem
                    icon={<TrashIcon />}
                    {...menuShortcut('delete', favorites.mac)}
                    danger
                    onSelect={() => {
                        favorites.remove(favorite);
                    }}
                >
                    Retirer des favoris
                </MenuItem>
            </MenuContent>
        </MenuRoot>
    );
}

/**
 * Ce qu'une carte montre : la poignée, la pastille, puis le nom du favori ou le titre
 * venu de Jira, sur une ligne. Tant que Jira ne l'a pas donné, un favori sans nom n'a
 * que sa pastille, à la teinte de son type.
 *
 * @param ghost la place laissée pendant un glisser
 * @param lifted la carte qui suit le pointeur
 */
function FavoriteCardBody({
    ticket,
    name,
    ghost = false,
    lifted = false,
}: {
    ticket: string;
    name: string | null;
    ghost?: boolean;
    lifted?: boolean;
}) {
    const tickets = useTickets();
    const shownName = name ?? tickets.get(ticket)?.title ?? null;

    return (
        <span
            data-color={tintOf(tickets.get(ticket))}
            className={`flex w-full items-center gap-2 rounded-2 border bg-bg-raise py-2 pr-3 pl-2 ${
                lifted
                    ? 'border-line-strong shadow-pop'
                    : ghost
                      ? 'border-dashed border-line opacity-(--o-disabled)'
                      : // Survolée ou son menu ouvert, elle prend une ombre ; celle qui a le
                        // curseur, au clic comme au clavier, le fond d'une sélection,
                        // sans ombre : c'est à elle que Suppr, ⌥↑ et F2 s'adressent.
                        'border-line group-hover/card:border-line-strong group-hover/card:shadow-1 group-focus/card:border-line-strong group-focus/card:bg-bg-press group-data-[menu=open]/card:border-line-strong group-data-[menu=open]/card:shadow-1'
            }`}
        >
            <span className="flex w-3 flex-none text-ink-3" aria-hidden="true">
                <GripIcon />
            </span>
            <span className="flex min-w-0 flex-1 flex-col gap-1">
                <TicketChip ticket={ticket} />
                {shownName !== null && <span className="truncate text-md text-ink-2">{shownName}</span>}
            </span>
        </span>
    );
}

/** Le formulaire en tête de liste, ou à la place du favori qu'on renomme. */
function FavoriteFormFrame({ form, favorites }: { form: FavoriteForm; favorites: Favorites }) {
    const renamed = form.favorite;
    const inputRef = useRef<HTMLInputElement>(null);
    const tickets = useTickets();
    // Renommer : le titre de Jira, que rend un nom vidé, en texte indicatif.
    const title = renamed === null ? null : (tickets.get(renamed.ticket)?.title ?? null);
    // Ajouter : ce que Jira dit du ticket tapé, sous le champ. Échap, d'où que soit le
    // curseur, ferme le formulaire (useGridExits).
    const field = useTicketField(renamed === null ? form.draft : '', '', favorites.formCheckRef);
    const { lookup } = field;

    // Le curseur va au champ à l'ouverture, le nom d'un favori sélectionné pour qu'on le
    // retape.
    useEffect(() => {
        inputRef.current?.focus();
        if (renamed !== null) {
            inputRef.current?.select();
        }
    }, [form.key, renamed]);
    // Un enregistrement refusé le ramène au champ, où est le message.
    useEffect(() => {
        if (form.refused !== 0) {
            inputRef.current?.focus();
        }
    }, [form.refused]);

    return (
        <div
            data-favorite-form
            role="group"
            aria-label={renamed === null ? 'Nouveau favori' : `Renommer le favori ${renamed.ticket}`}
            aria-busy={form.sending}
            // Renommer : la pastille du favori en tête, puis le nom, à
            // --s-3 l'un de l'autre ; l'ajout, plus serré, n'a que son champ.
            className={`flex flex-col rounded-2 border border-line-strong bg-bg-raise p-3 leading-(--lh) ${
                renamed === null ? 'gap-2' : 'gap-3'
            }`}
        >
            {renamed !== null && (
                <div data-color={tintOf(tickets.get(renamed.ticket))} className="flex">
                    <TicketChip ticket={renamed.ticket} />
                </div>
            )}
            {renamed === null ? (
                <TicketField
                    ref={inputRef}
                    label="Nouveau favori"
                    field={field}
                    value={form.draft}
                    refusal={form.error}
                    onTicket={favorites.setDraft}
                    onLeave={favorites.checkDraft}
                    onEnter={favorites.submit}
                />
            ) : (
                // Le nom d'un favori n'est pas un ticket : il se renomme à part.
                <Field
                    ref={inputRef}
                    label="Nom"
                    optional
                    maxLength={255}
                    placeholder={title ?? undefined}
                    value={form.draft}
                    error={form.error}
                    onChange={(event) => {
                        favorites.setDraft(event.target.value);
                    }}
                    onKeyDown={saveOnEnter(favorites.submit)}
                />
            )}
            {lookup.status === 'found' && (
                <div
                    data-color={tintOf(lookup.info)}
                    className="flex flex-col items-start gap-1 text-sm leading-(--lh) text-ink-2"
                >
                    <TicketChip ticket={lookup.ticket} />
                    {lookup.info.title !== null && <span>{lookup.info.title}</span>}
                </div>
            )}
            {/* Quand les deux boutons ne tiennent pas sur une ligne — renommer, à 224 px —, le
                pied passe sur deux, l'action principale à droite, comme dans une fenêtre. */}
            <div className="flex flex-wrap justify-end gap-2">
                <Button size="sm" onClick={favorites.cancel}>
                    Annuler
                </Button>
                <Button variant="primary" size="sm" busy={form.sending} onClick={favorites.submit}>
                    {renamed === null ? 'Ajouter' : 'Enregistrer'}
                </Button>
            </div>
        </div>
    );
}

/** La liste vide : le seul endroit où les gestes sont écrits en entier. */
function EmptyFavorites({ onAdd }: { onAdd: () => void }) {
    return (
        <li className="flex flex-col items-start gap-2 rounded-2 border-(length:--b-mid) border-dashed border-line-strong p-4 text-sm leading-(--lh) text-ink-2">
            <b className="text-md font-semibold text-ink">Aucun favori</b>
            <span>Glissez ici un bloc de la grille, ou ajoutez un ticket par son identifiant.</span>
            <span>Cliquez sur un favori pour le copier, ou glissez-le sur la grille.</span>
            <Button size="sm" className="mt-1" onClick={onAdd}>
                <PlusIcon />
                Ajouter un favori
            </Button>
        </li>
    );
}
