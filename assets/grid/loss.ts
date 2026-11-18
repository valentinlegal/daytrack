import { sameContent, type SlotContent } from './grid';
import type { Step } from './history';
import * as Quarter from './quarter';

/**
 * Ce qu'un geste enregistré a fait disparaître : les quarts d'heure qui avaient un
 * contenu et l'ont perdu, effacés ou recouverts. C'est ce que le message d'annulation
 * nomme, et ce que Nouveau ticket annonce avant de remplacer une sélection.
 */
export interface Loss {
    /** Combien de quarts d'heure ont perdu leur contenu. */
    readonly quarters: number;
    /** Ce qu'ils contenaient : un ticket compte une fois, quels que soient ses commentaires, la pause aussi. */
    readonly contents: readonly SlotContent[];
    /** Du premier à la fin du dernier, s'ils se suivent : de quoi dire « de 10:00 à 10:30 ». */
    readonly span: { readonly start: number; readonly end: number } | null;
}

/**
 * Un quart d'heure seulement délié de sa récurrence garde ce qu'on lit : il n'a rien perdu.
 * Un geste qui en prend un détache la fois entière (recurrence.ts, detach), et le message ne
 * nomme que ce qu'il a changé.
 */
export function lossOf(step: Step): Loss {
    const lost: [number, SlotContent][] = [];
    step.quarters.forEach((quarter, index) => {
        const before = step.before[index] ?? null;
        const after = step.after[index] ?? null;
        if (before !== null && (after === null || !sameContent(before, after))) {
            lost.push([quarter, before]);
        }
    });

    return lossIn(lost);
}

/** Ce que ces quarts d'heure contiennent, par leur début, compté comme une perte. */
export function lossIn(occupied: Iterable<readonly [number, SlotContent]>): Loss {
    const contents: SlotContent[] = [];
    const quarters: number[] = [];
    for (const [quarter, content] of occupied) {
        quarters.push(quarter);
        if (!contents.some((known) => sameSubject(known, content))) {
            contents.push(content);
        }
    }
    quarters.sort((a, b) => a - b);
    const first = quarters.at(0);
    const last = quarters.at(-1);
    const span =
        first !== undefined && last !== undefined && last - first === (quarters.length - 1) * Quarter.MINUTES
            ? { start: first, end: last + Quarter.MINUTES }
            : null;

    return { quarters: quarters.length, contents, span };
}

function sameSubject(a: SlotContent, b: SlotContent): boolean {
    return a.kind === 'work' && b.kind === 'work' ? a.ticket === b.ticket : a.kind === b.kind;
}
