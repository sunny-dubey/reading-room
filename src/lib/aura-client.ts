// Aura farming: today's quests earn aura when you learn or test something. Everything is checked
// against what this browser already knows (reading history, puzzle results, drill, plan ticks);
// a few quests are honour-system claims. Aura is logged per day in localStorage `aura:log`.
import { getHistory } from './history-client';

const ymd = (d = new Date()) => d.toLocaleDateString('en-CA');
const load = <T>(k: string, d: T): T => { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } };
const save = (k: string, v: unknown) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };

type Log = Record<string, Record<string, number>>; // date → quest → aura earned
const LOG = 'aura:log';

/** Ranks, lowest first. */
export const RANKS: [number, string][] = [
    [0, 'NPC'], [300, 'Stack Overflow copy-paster'], [800, 'Works on my machine'], [1600, '10x in stand-up'],
    [3000, 'Merges on Friday'], [5000, 'Reads the RFC'], [8000, 'Knows what fsync does'], [12000, 'Principal aura'],
    [20000, 'Aura of a Postgres maintainer'],
];
export const rankOf = (total: number) => {
    let i = 0;
    while (i + 1 < RANKS.length && total >= RANKS[i + 1][0]) i++;
    const [from, name] = RANKS[i], next = RANKS[i + 1];
    return { name, from, next: next?.[0], nextName: next?.[1], pct: next ? (total - from) / (next[0] - from) : 1 };
};

/** Consecutive days (ending today or yesterday) with any aura. */
function streak(log: Log) {
    let n = 0, d = new Date();
    if (!log[ymd(d)] || !Object.keys(log[ymd(d)]).length) d = new Date(Date.now() - 864e5);
    while (log[ymd(d)] && Object.keys(log[ymd(d)]).length) { n++; d = new Date(+d - 864e5); }
    return n;
}

/** Is this quest done today? Returns aura earned (0 if not). */
function check(q: HTMLElement, today: string): number {
    const pts = Number(q.dataset.aura);
    const kind = q.dataset.check;
    const hist = getHistory();
    const readToday = (u: string) => hist.some(h => h.u === u && ymd(new Date(h.at)) === today);
    switch (kind) {
        case 'lead': {
            const link = document.querySelector<HTMLElement>('[data-step="read"]')?.dataset.link;
            return link && readToday(link) ? pts : 0;
        }
        case 'rabbit': {
            const hole = [...document.querySelectorAll<HTMLElement>('[data-hole]')].find(h => !h.hidden);
            const links = hole ? [...hole.querySelectorAll<HTMLElement>('[data-link]')].map(l => l.dataset.link!) : [];
            const read = new Set(hist.map(h => h.u));
            return links.length && links.every(l => read.has(l)) && links.some(readToday) ? pts : 0;
        }
        case 'puzzle': {
            // Today's puzzle may be the AI one or the hand-written one: either counts.
            const all = load<Record<string, { ok: boolean; at: number }>>('puzzles:results', {});
            const r = (q.dataset.pzid ?? '').split(' ').map(id => all[id]).filter(x => x && ymd(new Date(x.at)) === today).sort((a, b) => Number(b!.ok) - Number(a!.ok))[0];
            if (!r) return 0;
            return r.ok ? pts : Math.round(pts / 5); // trying counts for something
        }
        case 'numbers': {
            const ok = load<boolean | null>(`numbers:result:${today}`, null);
            return ok === null ? 0 : ok ? pts : Math.round(pts / 5);
        }
        case 'drill': {
            const st = load<{ note: string; step: number } | null>(`drill:${q.dataset.drillid}`, null);
            const total = document.querySelectorAll('[data-drill-step]').length;
            return st && st.note.trim() && st.step >= total ? pts : 0;
        }
        case 'web': {
            // Any linked puzzle ticked as solved today.
            const done = load<Record<string, number>>('web:solved', {});
            return Object.values(done).some(t => ymd(new Date(t)) === today) ? pts : 0;
        }
        case 'canon':
            return load<string[]>(`plan:${today}`, []).includes('canon') ? pts : 0;
        case 'practice':
            return load<string | null>(`practice:${q.dataset.weekkey}`, null) === '1' ? pts : 0;
        case 'claim':
            return load<boolean>(`aura:claim:${today}:${q.dataset.quest}`, false) ? pts : 0;
    }
    return 0;
}

export function mountAura() {
    const box = document.querySelector<HTMLElement>('[data-aura]');
    if (!box) return;
    const today = ymd();
    const quests = [...box.querySelectorAll<HTMLElement>('[data-quest]')];

    function paint() {
        const log = load<Log>(LOG, {});
        const day = (log[today] ??= {});
        // Earned aura only goes up within a day (unticking later doesn't take it back).
        for (const q of quests) {
            const id = q.dataset.quest!;
            // The weekly problem pays once per week (its quest id includes the week), not every day it stays ticked.
            if (q.dataset.check === 'practice' && Object.entries(log).some(([d, v]) => d !== today && v[id])) continue;
            const got = check(q, today);
            if (got > (day[id] ?? 0)) day[id] = got;
        }
        save(LOG, log);

        const s = streak(log);
        const mult = Math.min(1.5, 1 + Math.max(0, s - 1) * 0.1);
        const todayRaw = Object.values(day).reduce((a, b) => a + b, 0);
        const total = Math.round(Object.entries(log).reduce((a, [d, v]) => {
            const raw = Object.values(v).reduce((x, y) => x + y, 0);
            return a + (d === today ? raw * mult : raw);
        }, 0));
        const rank = rankOf(total);
        const set = (sel: string, v: string) => { const el = box.querySelector(sel); if (el) el.textContent = v; };
        set('[data-aura-total]', total.toLocaleString());
        set('[data-aura-today]', `+${Math.round(todayRaw * mult).toLocaleString()} today`);
        set('[data-aura-mult]', s > 1 ? `${mult.toFixed(1)}× streak bonus (${s} days)` : 'Come back tomorrow for a streak bonus');
        set('[data-aura-rank]', rank.name);
        set('[data-aura-next]', rank.next ? `${(rank.next - total).toLocaleString()} to “${rank.nextName}”` : 'Max rank. Touch grass.');
        const bar = box.querySelector<HTMLElement>('[data-aura-bar]');
        if (bar) bar.style.width = `${Math.round(rank.pct * 100)}%`;

        let left = 0;
        for (const q of quests) {
            const got = day[q.dataset.quest!] ?? 0;
            q.classList.toggle('is-done', got >= Number(q.dataset.aura));
            q.classList.toggle('is-partial', got > 0 && got < Number(q.dataset.aura));
            const pts = q.querySelector('[data-aura-pts]');
            if (pts) pts.textContent = got > 0 && got < Number(q.dataset.aura) ? `+${got} / ${q.dataset.aura}` : `+${q.dataset.aura}`;
            if (!got) left += Number(q.dataset.aura);
        }
        set('[data-aura-left]', left ? `${left.toLocaleString()} aura still on the table today` : 'Every quest done. Absolute aura.');
    }

    // Honour-system claims.
    box.addEventListener('click', e => {
        const b = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-claim]');
        if (b) {
            const q = b.closest<HTMLElement>('[data-quest]')!;
            save(`aura:claim:${today}:${q.dataset.quest}`, true);
            q.classList.remove('flash'); void q.offsetWidth; q.classList.add('flash');
            paint();
        }
        const c = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-aura-copy]');
        if (c) {
            const total = box.querySelector('[data-aura-total]')?.textContent, rank = box.querySelector('[data-aura-rank]')?.textContent, td = box.querySelector('[data-aura-today]')?.textContent;
            const text = `${td} aura farmed on The Reading Room · ${total} total · rank: ${rank} · ${location.origin}${location.pathname}`;
            navigator.clipboard?.writeText(text).then(() => { c.textContent = 'Copied ✓'; setTimeout(() => (c.textContent = 'Copy my aura card'), 1600); });
        }
    });
    // Re-check when something happens elsewhere on the page.
    document.addEventListener('aura:update', paint);
    document.addEventListener('canon:changed', paint);
    document.addEventListener('change', () => setTimeout(paint, 0));
    document.addEventListener('click', e => { if ((e.target as HTMLElement).closest('a[data-read]')) setTimeout(paint, 50); });
    window.addEventListener('focus', paint); // back from reading in another tab
    paint();
}
