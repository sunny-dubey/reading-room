// Chapters of long Canon works (books, courses, long videos). A chapter's progress id is
// "<canon id>/<n>" (1-based) in the same 'canon' set; a work counts as done once every chapter is.
import { getSet, setProgress } from './progress-client';

export interface Part { title: string; minutes: number; url?: string }
export interface Work { title: string; url: string; parts: Part[] }

export const works: Record<string, Work> = (() => {
    try { return JSON.parse(document.getElementById('canon-parts')?.textContent ?? '{}'); } catch { return {}; }
})();

export const partId = (id: string, i: number) => `${id}/${i + 1}`;

/** The first unfinished chapter of a work, or null if it has no chapters or all are done. */
export function nextPart(id: string, done = getSet('canon')) {
    const w = works[id];
    if (!w) return null;
    const i = w.parts.findIndex((_, j) => !done.has(partId(id, j)));
    return i < 0 ? null : { i, part: w.parts[i], n: w.parts.length, url: w.parts[i].url ?? w.url, work: w };
}

/** Tick or untick a chapter; finishing the last chapter finishes the work. Fires `canon:changed`. */
export function markPart(pid: string, done: boolean) {
    const id = pid.slice(0, pid.lastIndexOf('/'));
    setProgress('canon', pid, done);
    const w = works[id];
    if (w) {
        const s = getSet('canon');
        const all = w.parts.every((_, j) => s.has(partId(id, j)));
        if (all) setProgress('canon', id, true);
        else if (!done) setProgress('canon', id, false);
    }
    document.dispatchEvent(new CustomEvent('canon:changed'));
}
