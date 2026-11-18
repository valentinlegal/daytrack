import { fill, type QuarterChanges } from './changes';
import type { Clipboard } from './clipboard';
import {
    type Block,
    type Grid,
    normalizeComment,
    normalizeTicket,
    PAUSE,
    sameCell,
    sameContent,
    type SlotContent,
    work,
} from './grid';
import { type Loss, lossIn } from './loss';
import * as Quarter from './quarter';
import type { RecurrenceRule, SeenRecurrence } from './recurrence';
import { type Selection, selectionRuns } from './selection';

/** Le contenu d'un quart d'heure travaillé : un ticket et son commentaire. */
export type Work = Extract<SlotContent, { readonly kind: 'work' }>;

/**
 * Ce qu'une fenêtre de ticket modifie : des quarts d'heure, qu'ouvre Nouveau ticket, un
 * bloc, qu'ouvre Modifier le ticket — une pause comprise —, ou la sélection qu'ouvre
 * Modifier la sélection, son ticket gardé.
 */
export type EntryTarget =
    /**
     * Des quarts d'heure, dans l'ordre : un créneau ou une plage vides, ou la sélection
     * exacte, saisie ou non, qu'elle remplace.
     */
    | { readonly kind: 'new'; readonly quarters: readonly number[] }
    | { readonly kind: 'edit'; readonly block: Block }
    /**
     * La sélection exacte, dans l'ordre, quand chacun de ses quarts d'heure porte le même
     * ticket et le même commentaire : la partie d'un bloc qu'on retouche, en plusieurs
     * morceaux comprise.
     */
    | PartTarget;

/**
 * La sélection qu'ouvre Modifier la sélection. `beyond` dit si un de ses blocs la
 * dépasse : sur des blocs entiers, elle fait ce que ferait Modifier le ticket.
 */
export interface PartTarget {
    readonly kind: 'part';
    readonly quarters: readonly number[];
    readonly content: Work;
    readonly beyond: boolean;
}

/** Ce qui a été tapé dans la fenêtre, tel quel. */
export interface EntryDraft {
    readonly ticket: string;
    readonly comment: string;
}

export type EntryAction =
    /** Rien à enregistrer : la fenêtre se ferme. */
    | { readonly kind: 'close' }
    /**
     * Ce qu'il faut écrire, et le geste que l'écran nomme s'il fait disparaître quelque
     * chose, pour proposer de l'annuler : supprimer un bloc — par son bouton, ou en
     * vidant son ticket —, remplacer une sélection, la convertir en pause, l'effacer ou
     * en modifier le commentaire. Modifier un bloc entier se voit dans la grille : rien à
     * dire.
     */
    | {
          readonly kind: 'write';
          readonly changes: QuarterChanges;
          readonly gesture: EntryGesture | null;
          /** Une coupe : ce qu'elle met dans le presse-papier, une fois l'écriture passée. */
          readonly cuts?: Clipboard;
      }
    /**
     * La case « Récurrence » : créer la récurrence du bloc écrit, la changer à partir de
     * cette fois, ou l'arrêter — `rule` null —, sur le bloc que portait `replaces`, telle
     * que la fenêtre l'a vue.
     */
    | {
          readonly kind: 'recurrence';
          readonly changes: QuarterChanges;
          readonly rule: RecurrenceRule | null;
          readonly replaces: SeenRecurrence | null;
          readonly gesture: EntryGesture | null;
          /** Une coupe avec les suivantes : le bloc et son rythme, une fois la récurrence arrêtée. */
          readonly cuts?: Clipboard;
      }
    /**
     * Un refus connu d'avance, sous les champs de la récurrence : ses jours, sa fin, ou un
     * créneau qu'une autre récurrence prend déjà, dit sous les prochaines fois. Rien ne part.
     */
    | {
          readonly kind: 'refuse';
          readonly weekdays: string | null;
          readonly until: string | null;
          readonly rhythm: string | null;
      }
    /**
     * Un geste sur un bloc qui revient, qui demande quelles fois il change : « Cette fois
     * seulement » — un geste ordinaire, qui détache la fois — ou « Cette fois et les
     * suivantes » — la récurrence coupée ou arrêtée à partir de cette fois.
     */
    | {
          readonly kind: 'ask';
          readonly question: ScopeQuestion;
          readonly once: WriteAction;
          readonly following: RecurrenceAction;
          /**
           * Allonger ou raccourcir : le bloc qui revient, et ses heures après le geste, que la
           * question dit sous son titre.
           */
          readonly reshapes?: { readonly content: SlotContent; readonly start: number; readonly end: number };
      };

/**
 * Ce que demande la question : modifier, arrêter — la case décochée —, effacer, couper,
 * allonger ou raccourcir.
 */
export type ScopeQuestion = 'modify' | 'stop' | 'erase' | 'cut' | 'extend' | 'shorten';

export type WriteAction = Extract<EntryAction, { readonly kind: 'write' }>;
export type RecurrenceAction = Extract<EntryAction, { readonly kind: 'recurrence' }>;

export type EntryGesture = 'delete' | 'clear' | 'cut' | 'paste' | 'replace' | 'modify' | 'pause';

/** Le double-clic : le bloc sous le pointeur, ou ce seul quart d'heure s'il est vide. */
export function targetAt(grid: Grid, quarter: number): EntryTarget {
    const block = grid.blockAt(quarter);

    return block === null ? { kind: 'new', quarters: [quarter] } : { kind: 'edit', block };
}

/**
 * Entrée, au clavier : une sélection tout entière dans un bloc ouvre le bloc entier, comme
 * un double-clic ; toute autre — une plage vide, en plusieurs morceaux, ou à cheval sur un
 * bloc —, Nouveau ticket sur toute la sélection, comme « Nouveau ticket… » ou une lettre
 * tapée. Le bloc se lit sur la sélection, pas sous le curseur : Ctrl/⌘+clic a pu l'en retirer.
 * Rien sans sélection, même si le curseur est resté sur un créneau après Échap : il ne se
 * voit plus.
 */
export function targetOfSelection(grid: Grid, selection: Selection): EntryTarget | null {
    const range = emptyRange(grid, selection);
    if (range !== null) {
        return { kind: 'new', quarters: range };
    }
    const [first] = selection.quarters;
    if (selection.head === null || first === undefined) {
        return null;
    }
    const block = grid.blockAt(first);
    if (block !== null && selection.quarters.every((quarter) => block.start <= quarter && quarter < block.end)) {
        return { kind: 'edit', block };
    }

    return selectionTarget(selection);
}

/**
 * « Nouveau ticket… » du menu, ou une lettre tapée sur la grille : la sélection
 * exacte, saisie ou non, en plusieurs morceaux comprise, comme elle se convertit en
 * pause. Les parties d'un bloc hors de la sélection gardent ce qu'elles ont. Rien
 * sans sélection.
 */
export function selectionTarget(selection: Selection): EntryTarget | null {
    return selection.quarters.length === 0 ? null : { kind: 'new', quarters: selection.quarters };
}

/**
 * « Modifier la sélection… » du menu, ou F2 : la sélection exacte, quand tous ses quarts
 * d'heure portent le même ticket et le même commentaire. La fenêtre s'ouvre remplie, et
 * seuls ces quarts d'heure changent : le reste du bloc garde ce qu'il avait. Rien sur
 * une pause, un créneau vide, plusieurs tickets ou des commentaires différents.
 */
export function partTarget(grid: Grid, selection: Selection): PartTarget | null {
    return partOf(grid, selection.quarters);
}

/**
 * La fenêtre ouverte, une fois la journée relue — changée ailleurs, ou relue après un
 * serveur muet : Modifier le ticket suit son bloc tel qu'il est désormais. Changé ou
 * disparu, le bloc laisse la place à Nouveau ticket sur les mêmes quarts d'heure, qui
 * dit ce qu'il y remplacerait : enregistrer de nouveau n'écrase jamais en silence ce
 * qu'un autre onglet a posé. Rien ne bouge quand le bloc est resté le même. Modifier la
 * sélection fait de même quand un de ses quarts d'heure a changé.
 */
export function retarget(grid: Grid, target: EntryTarget): EntryTarget {
    if (target.kind === 'new') {
        return target;
    }
    if (target.kind === 'part') {
        const now = partOf(grid, target.quarters);
        if (now === null || !sameCell(now.content, target.content)) {
            return { kind: 'new', quarters: target.quarters };
        }

        return now.beyond === target.beyond ? target : now;
    }
    const { block } = target;
    const now = grid.blockAt(block.start);
    if (now === null || !sameCell(now.content, block.content)) {
        return { kind: 'new', quarters: quartersOf(target) };
    }

    return now.start === block.start && now.end === block.end ? target : { kind: 'edit', block: now };
}

/** Les quarts d'heure que la fenêtre écrit. */
export function quartersOf(target: EntryTarget): readonly number[] {
    return target.kind === 'edit' ? Quarter.between(target.block.start, target.block.end) : target.quarters;
}

/**
 * Ce que Nouveau ticket remplacera, lu sur la journée affichée : de quoi l'annoncer
 * sous ses champs. Rien quand ses quarts d'heure sont vides, ni pour Modifier le
 * ticket, qui modifie un bloc entier, ni pour Modifier la sélection, qui garde son
 * ticket.
 */
export function replacedBy(grid: Grid, target: EntryTarget): Loss | null {
    if (target.kind !== 'new') {
        return null;
    }
    const occupied = target.quarters.flatMap((quarter): [number, SlotContent][] => {
        const cell = grid.at(quarter);

        return cell === null ? [] : [[quarter, cell]];
    });

    return occupied.length === 0 ? null : lossIn(occupied);
}

/**
 * Nouveau ticket sur une plage vide : le créneau visé se dessine en pointillé. Sur une
 * sélection déjà saisie, ou en plusieurs morceaux, c'est la sélection qui reste
 * dessinée.
 */
export function aimsAtEmptyRange(grid: Grid, target: EntryTarget): boolean {
    if (target.kind !== 'new') {
        return false;
    }
    const first = target.quarters.at(0);
    const last = target.quarters.at(-1);

    return (
        first !== undefined &&
        last !== undefined &&
        last - first === (target.quarters.length - 1) * Quarter.MINUTES &&
        target.quarters.every((quarter) => grid.at(quarter) === null)
    );
}

/** Ce que la fenêtre montre à l'ouverture. */
export function draftOf(target: EntryTarget): EntryDraft {
    const content = target.kind === 'edit' ? target.block.content : target.kind === 'part' ? target.content : null;

    return content?.kind === 'work'
        ? { ticket: content.ticket, comment: content.comment ?? '' }
        : { ticket: '', comment: '' };
}

/**
 * « Enregistrer », Entrée, ou un clic à côté.
 *
 * Un bloc dont on vide le ticket se supprime, comme une cellule qu'on vide : son
 * commentaire part avec lui, et Ctrl/⌘+Z le rend. Ailleurs, un ticket vide ne se devine
 * pas : sans rien de tapé, une fenêtre neuve se ferme — sans rien remplacer —, et une
 * pause reste une pause. Un commentaire sans ticket part tel quel, et le serveur le
 * refuse sous le champ : c'est lui qui dit ce qui manque.
 */
export function saveEntry(target: EntryTarget, draft: EntryDraft): EntryAction {
    const quarters = quartersOf(target);
    const ticket = normalizeTicket(draft.ticket);
    const comment = normalizeComment(draft.comment);
    if (target.kind === 'part') {
        return savePart(target, ticket, comment);
    }
    if (ticket === null && target.kind === 'edit' && target.block.content.kind === 'work') {
        return deleteEntry(target);
    }
    if (ticket === null && comment === null) {
        return { kind: 'close' };
    }

    return {
        kind: 'write',
        changes: fill(quarters, work(ticket ?? '', comment)),
        gesture: target.kind === 'edit' ? null : 'replace',
    };
}

/**
 * Modifier la sélection : vider le ticket l'efface, et seulement elle ; rien de changé,
 * rien ne s'écrit. Sur une partie de bloc, le geste se dit pour qu'on puisse l'annuler
 * — un autre commentaire la modifie, un autre ticket la remplace — ; sur des blocs
 * entiers, la grille le montre, comme après Modifier le ticket.
 */
function savePart(target: PartTarget, ticket: string | null, comment: string | null): EntryAction {
    if (ticket === null) {
        return deleteEntry(target);
    }
    const content = work(ticket, comment);
    // Le même ticket et le même commentaire, sur une partie d'un bloc qui revient : rien ne
    // part, et la fois garde sa récurrence.
    if (sameContent(content, target.content)) {
        return { kind: 'close' };
    }

    return {
        kind: 'write',
        changes: fill(target.quarters, content),
        gesture: !target.beyond ? null : ticket === target.content.ticket ? 'modify' : 'replace',
    };
}

/**
 * Ce qu'on tape dans le champ Ticket, tel qu'il s'affiche aussitôt : en majuscules, sans
 * espace. Une adresse de ticket collée (`…/browse/SHOP-482`, ou un tableau ouvert sur
 * `selectedIssue=SHOP-482`) donne son identifiant.
 */
export function typedTicket(text: string): string {
    const link = /\/browse\/([a-z][a-z0-9_]*-\d+)/i.exec(text) ?? /[?&]selectedIssue=([a-z][a-z0-9_]*-\d+)/i.exec(text);

    return (link?.[1] ?? text.replace(/\s+/gu, '')).toUpperCase();
}

/**
 * Ce qu'on tape dans le champ Commentaire : il tient sur une ligne, comme le bloc et le
 * récapitulatif le montrent. Un retour à la ligne collé devient une espace, comme tout
 * caractère que le serveur refuserait dans une ligne.
 */
export function typedComment(text: string): string {
    return text.replace(/\r\n/g, ' ').replace(/[\p{Cc}\p{Zl}\p{Zp}]/gu, ' ');
}

/**
 * Un identifiant de ticket, tel que le serveur l'accepte (src/Api/Input/SlotChangeInput.php) :
 * « SHOP-482 ». Un champ vide n'a pas de forme à juger.
 */
export function hasTicketShape(ticket: string): boolean {
    const normalized = normalizeTicket(ticket);

    return normalized === null || /^[A-Z][A-Z0-9_]+-[1-9][0-9]*$/.test(normalized);
}

/**
 * « Enregistrer » grisé, comme Entrée : une pause ne change qu'en recevant un ticket,
 * et sans lui il n'y a rien à enregistrer. Un clic à côté reste un enregistrement :
 * rien de tapé, la fenêtre se ferme ; un commentaire seul, le serveur dit ce qui manque.
 */
export function saveDisabled(target: EntryTarget, draft: EntryDraft): boolean {
    return target.kind === 'edit' && target.block.content.kind === 'pause' && normalizeTicket(draft.ticket) === null;
}

/** « Pause » dans Nouveau ticket, « Convertir en pause » dans Modifier le ticket. */
export function pauseEntry(target: EntryTarget): EntryAction {
    return {
        kind: 'write',
        changes: fill(quartersOf(target), PAUSE),
        gesture: target.kind === 'edit' ? null : 'pause',
    };
}

/** La corbeille, « Effacer », dans Modifier le ticket comme dans Modifier la sélection. */
export function deleteEntry(target: EntryTarget): EntryAction {
    return {
        kind: 'write',
        changes: fill(quartersOf(target), null),
        gesture: target.kind === 'part' ? 'clear' : 'delete',
    };
}

/**
 * Ces quarts d'heure, s'ils portent tous le même ticket et le même commentaire, et si un
 * de leurs blocs les dépasse.
 */
function partOf(grid: Grid, quarters: readonly number[]): PartTarget | null {
    const first = quarters[0] === undefined ? null : grid.at(quarters[0]);
    // Une partie qui revient et une autre posée à la main se lisent pareil : elles se modifient ensemble.
    if (first?.kind !== 'work' || !quarters.every((quarter) => isSameWork(grid.at(quarter), first))) {
        return null;
    }
    const selected = new Set(quarters);
    const beyond = quarters.some((quarter) => {
        const block = grid.blockAt(quarter);

        return block !== null && Quarter.between(block.start, block.end).some((inBlock) => !selected.has(inBlock));
    });

    return { kind: 'part', quarters, content: first, beyond };
}

/** La sélection, si c'est une seule plage de quarts d'heure vides. */
function emptyRange(grid: Grid, selection: Selection): number[] | null {
    const runs = selectionRuns(selection);
    const run = runs.length === 1 ? runs[0] : undefined;
    if (run === undefined) {
        return null;
    }
    const quarters = Quarter.between(run.start, run.end);

    return quarters.every((quarter) => grid.at(quarter) === null) ? quarters : null;
}

function isSameWork(cell: SlotContent | null, work: SlotContent): boolean {
    return cell !== null && sameContent(cell, work);
}
