import { getCollection } from 'astro:content';
import { getFeeds, CATEGORIES, type FeedItem } from './feeds';
import { getNotes } from './content';

const DAY = 864e5;

/** How much an item deserves attention right now: depth first, freshness second. */
export const rank = (i: FeedItem, now: number) => {
    const age = (now - +i.date) / DAY;
    const fresh = age < 2 ? 1.2 : age < 7 ? 0.8 : age < 21 ? 0.3 : 0;
    return (i.brief?.worth ?? 2) * 2 + fresh;
};

export const isDeep = (i: FeedItem) => (i.brief?.worth ?? 0) >= 3.5;

export async function getCanon() {
    const all = await getCollection('canon');
    // keep file order within each track
    return CATEGORIES.map(c => ({ ...c, items: all.filter(x => x.data.track === c.id) }));
}

export async function getReading() {
    const { items, status, fetchedAt } = await getFeeds();
    const now = +fetchedAt;
    const learning = items.filter(i => i.category !== 'pulse');
    const byRank = [...learning].sort((a, b) => rank(b, now) - rank(a, now) || +b.date - +a.date);

    const used = new Set<string>();
    const take = (pool: FeedItem[], n: number, distinctTrack = false) => {
        const out: FeedItem[] = [];
        const tracks = new Set<string>();
        for (const i of pool) {
            if (out.length >= n) break;
            if (used.has(i.link) || (distinctTrack && tracks.has(i.category))) continue;
            used.add(i.link); tracks.add(i.category); out.push(i);
        }
        return out;
    };

    // Today's deep read: the most worthwhile thing from the last two weeks (postmortems have their own slot).
    const recent = byRank.filter(i => now - +i.date < 14 * DAY && i.category !== 'postmortems' && i.brief?.fetched);
    const [deepRead] = take(recent.filter(i => (i.brief?.worth ?? 0) >= 4), 1);
    // More worth your time: one per track first, then fill.
    const picks = take(byRank.filter(i => now - +i.date < 21 * DAY && isDeep(i) && i.category !== 'postmortems'), 4, true);
    picks.push(...take(byRank.filter(i => now - +i.date < 21 * DAY && isDeep(i) && i.category !== 'postmortems'), 6 - picks.length));
    // Learn from failure: the best recent postmortem.
    const [postmortem] = take(byRank.filter(i => i.category === 'postmortems' && (i.brief?.worth ?? 0) >= 3), 1);

    const tracks = CATEGORIES.map(c => {
        const all = learning.filter(i => i.category === c.id).sort((a, b) => rank(b, now) - rank(a, now) || +b.date - +a.date);
        return { ...c, all, deep: all.filter(isDeep), light: all.filter(i => !isDeep(i)), sources: status.filter(s => s.category === c.id) };
    });

    // Pulse: Hacker News by points, then Techmeme by recency; ten headlines.
    const pulse = items.filter(i => i.category === 'pulse')
        .sort((a, b) => (b.points ?? 0) - (a.points ?? 0) || +b.date - +a.date)
        .slice(0, 10);

    // Concept index across everything summarised.
    const concepts = new Map<string, FeedItem[]>();
    for (const i of learning) for (const c of i.brief?.concepts ?? []) {
        if (!concepts.has(c)) concepts.set(c, []);
        concepts.get(c)!.push(i);
    }
    const conceptIndex = [...concepts].map(([name, list]) => ({ name, slug: name.replace(/[^a-z0-9]+/g, '-'), items: list.sort((a, b) => rank(b, now) - rank(a, now)) }))
        .sort((a, b) => b.items.length - a.items.length);

    return { items, learning, status, fetchedAt, now, deepRead, picks, postmortem, tracks, pulse, conceptIndex };
}

/** Notebook entries to revisit: written about a week and about a month ago (spaced repetition). */
export async function getRevisit(now: number) {
    const entries = (await getNotes()).map(n => ({ title: n.data.title, href: `/notebook/${n.id}/`, date: n.data.date }));
    const ago = (d: Date) => (now - +d) / DAY;
    const week = entries.filter(e => ago(e.date) >= 5 && ago(e.date) <= 10);
    const month = entries.filter(e => ago(e.date) >= 25 && ago(e.date) <= 40);
    const older = entries.filter(e => ago(e.date) > 40);
    // One deterministic "from the archive" pick per day.
    const archive = older.length ? older[Math.floor(now / DAY) % older.length] : undefined;
    return { week, month, archive, total: entries.length };
}
