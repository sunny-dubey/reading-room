import { getCollection } from 'astro:content';
import { getFeeds, CATEGORIES, SIDE, type FeedItem } from './feeds';
import { getNotes } from './content';
import { getRoadmap } from './roadmap';
import { getMeta, makeThumb, cleanDescription } from './meta';
import { mapLimit } from './summarize';

const DAY = 864e5;

/** How much an item deserves attention right now. The reader wants the latest, so freshness is strong:
 *  +4 today, +2 at 2.5 days, +1 at 5 days, +0.25 at 10. Worth (×2, so 2–10) still keeps weak posts down. */
export const freshness = (i: FeedItem, now: number) => 4 * 0.5 ** (Math.max(0, now - +i.date) / DAY / 2.5);
export const rank = (i: FeedItem, now: number) => {
    const fresh = freshness(i, now);
    return (i.brief?.worth ?? 2) * 2 + fresh + (i.skill?.boost ?? 0) + (i.weight ?? 0);
};

export const isDeep = (i: FeedItem) => (i.brief?.worth ?? 0) >= 3.5;

export async function getCanon() {
    const all = await getCollection('canon');
    // keep file order within each track
    return CATEGORIES.map(c => ({ ...c, items: all.filter(x => x.data.track === c.id) }));
}

let readingCache: ReturnType<typeof buildReading> | undefined;
/** Everything the reading pages need, computed once per build. */
export const getReading = () => (readingCache ??= buildReading());

async function buildReading() {
    const { items, status, fetchedAt } = await getFeeds();
    const now = +fetchedAt;
    const learning = items.filter(i => !SIDE.has(i.category));
    const roadmap = await getRoadmap(learning); // attaches .skill to matched articles
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
    const recent = byRank.filter(i => now - +i.date < 7 * DAY && i.category !== 'postmortems' && i.brief?.fetched);
    // Up to 5 candidates in rank order; the page shows the first one you haven't read or been shown on an
    // earlier day, so the plan's deep read changes daily even when the same post keeps ranking first.
    const deepCands = recent.filter(i => (i.brief?.worth ?? 0) >= 4 && !used.has(i.link)).slice(0, 5);
    const deepRead = deepCands[0];
    if (deepRead) used.add(deepRead.link);
    // Fresh this week: the best of the last 3 days (7 if it's a quiet week), one per track first.
    const freshPool = (days: number) => byRank.filter(i => now - +i.date < days * DAY && i.category !== 'postmortems'
        && (i.brief?.worth ?? 0) >= 3 && (i.skill || isDeep(i)));
    const pool = freshPool(3).length >= 6 ? freshPool(3) : freshPool(7);
    const fresh = take(pool, 4, true);
    fresh.push(...take(pool, 8 - fresh.length));
    // More worth your time: one per track first, then fill.
    const picks = take(byRank.filter(i => now - +i.date < 10 * DAY && isDeep(i) && i.category !== 'postmortems'), 4, true);
    picks.push(...take(byRank.filter(i => now - +i.date < 10 * DAY && isDeep(i) && i.category !== 'postmortems'), 6 - picks.length));
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

    // Startups: grouped by where the signal comes from.
    const startup = (id: string) => items.filter(i => i.feedId === id);
    const startups = {
        launches: startup('launch-hn').map(i => ({ i, ...parseLaunch(i.title) })),
        show: startup('show-hn').sort((a, b) => (b.points ?? 0) - (a.points ?? 0)),
        // Product Hunt descriptions end with "Discussion | Link" boilerplate.
        producthunt: startup('product-hunt').map(i => ({ ...i, summary: i.summary.replace(/\s*Discussion\s*\|\s*Link\s*$/i, '') })),
        funding: startup('tc-startups'),
    };

    // Latest from every desk: each discipline's freshest worth-reading pieces (quality floor).
    const newest = (a: FeedItem, b: FeedItem) => +b.date - +a.date;
    const desks = CATEGORIES.map(c => {
        const mine = learning.filter(i => i.category === c.id && +i.date <= now);
        // Recency-heavy rank (freshness dominates) so the latest leads, but a practical piece beats a same-day essay.
        let list = mine.filter(i => now - +i.date < 10 * DAY && (i.brief?.worth ?? 0) >= 3).sort((a, b) => rank(b, now) - rank(a, now));
        if (list.length < 2) list = [...list, ...mine.filter(i => !list.includes(i) && (i.brief?.worth ?? 0) >= 2.5).sort(newest)];
        // Different sources first, so one prolific feed doesn't fill a desk.
        const seen = new Set<string>(), varied = list.filter(i => !seen.has(i.feedTitle) && seen.add(i.feedTitle));
        return { ...c, items: [...varied, ...list.filter(i => !varied.includes(i))].slice(0, 3) };
    }).filter(d => d.items.length);
    // The wire: the newest headlines from every desk, for scanning.
    // At most two per source, so a batch publisher (arXiv posts its whole day at once) can't flood it.
    const perFeed = new Map<string, number>();
    const wire = learning.filter(i => +i.date <= now && (i.brief?.worth ?? 0) >= 2.5 && i.link !== deepRead?.link).sort(newest)
        .filter(i => { const n = perFeed.get(i.feedId) ?? 0; perFeed.set(i.feedId, n + 1); return n < 2; }).slice(0, 10);
    // Top stories under the lead: the best recent pieces not already in the wire or the desks.
    const shownElsewhere = new Set([...wire, ...desks.flatMap(d => d.items)].map(i => i.link));
    const topStories = byRank.filter(i => now - +i.date < 7 * DAY && isDeep(i) && !shownElsewhere.has(i.link) && !deepCands.some(d => d.link === i.link) && i.category !== 'postmortems').slice(0, 6);
    // The article's own description and preview image for everything shown with a picture or a dek.
    const showcase = [...new Set([...deepCands, ...topStories, ...desks.flatMap(d => d.items), ...wire])];
    await mapLimit(showcase, 8, async i => {
        const m = await getMeta(i.link);
        i.meta = { description: cleanDescription(m.description, i.title), image: m.image };
    });
    // An image reused across a feed's posts is a site logo, not the article's picture.
    const uses = new Map<string, number>();
    for (const i of showcase) if (i.meta?.image) uses.set(`${i.feedId} ${i.meta.image}`, (uses.get(`${i.feedId} ${i.meta.image}`) ?? 0) + 1);
    for (const i of showcase) if (i.meta?.image && (uses.get(`${i.feedId} ${i.meta.image}`) ?? 0) > 1) delete i.meta.image;
    const thumbFor = async (i: FeedItem, w: number) => { if (i.meta?.image) i.meta.thumb = await makeThumb(i.meta.image, w); };
    await mapLimit(deepCands, 4, i => thumbFor(i, 760));
    await mapLimit([...topStories, ...desks.map(d => d.items[0])].filter(Boolean), 6, i => thumbFor(i, 360));
    return { items, learning, status, fetchedAt, now, deepRead, deepCands, fresh, picks, desks, wire, topStories, postmortem, tracks, pulse, startups, roadmap };
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

/** "Launch HN: Acme (YC W26) – Agents that file your taxes" → name, batch, tagline. */
export function parseLaunch(title: string) {
    const m = title.match(/^Launch HN:\s*(.+?)\s*\((YC\s*[A-Z]\d{2,4})\)\s*[–—-]\s*(.+)$/i)
        ?? title.match(/^Launch HN:\s*(.+?)\s*[–—-]\s*(.+)$/i);
    if (!m) return { name: title.replace(/^Launch HN:\s*/i, ''), batch: '', tagline: '' };
    return m.length === 4 ? { name: m[1], batch: m[2].replace(/\s+/, ' '), tagline: m[3] } : { name: m[1], batch: '', tagline: m[2] };
}
