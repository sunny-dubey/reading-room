import { getCollection } from 'astro:content';
import { getFeeds, CATEGORIES, SIDE, type FeedItem } from './feeds';
import { getRoadmap } from './roadmap';
import { bigStories } from './bigstory';
import { isRoundup } from './summarize';
import { getMeta, makeThumb, cleanDescription } from './meta';
import { mapLimit } from './summarize';
import * as skills from './skills';
import type { ReadKind } from './summarize';

const DAY = 864e5;
import { EDITION_WINDOW } from './edition';
export { EDITION_WINDOW };

/** How much an item deserves attention right now. The reader wants the latest, so freshness is strong:
 *  +4 today, +2 at 2.5 days, +1 at 5 days, +0.25 at 10. Worth (×2, so 2–10) still keeps weak posts down. */
export const freshness = (i: FeedItem, now: number) => 4 * 0.5 ** (Math.max(0, now - +i.date) / DAY / 2.5);
export const rank = (i: FeedItem, now: number) => {
    const fresh = freshness(i, now);
    return (i.brief?.worth ?? 2) * 2 + fresh + (i.skill?.boost ?? 0) + (i.weight ?? 0);
};

export const isDeep = (i: FeedItem) => (i.brief?.worth ?? 0) >= 3.5;

/** The front page's bands, in Sunny's priority order (2026-11-25): discover, readable, learn, informative,
 *  experimental, research, thoughts. Each article goes to one band by its kind of read. */
export type Band = 'learn' | 'informative' | 'experimental' | 'research' | 'thoughts';
const BAND: Record<ReadKind, Band> = {
    howto: 'experimental', benchmark: 'experimental', paper: 'research', opinion: 'thoughts',
    news: 'informative', analysis: 'informative', roundup: 'informative',
    deep: 'learn', case: 'learn', postmortem: 'learn', long: 'learn', article: 'learn', short: 'learn',
};
export const bandOf = (i: FeedItem): Band => (i.brief?.kind ? BAND[i.brief.kind] : /arxiv\.org\//.test(i.link) ? 'research' : 'learn');

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
    // The edition shows only what was published in the 24 hours before it was built (Sunny, 2026-11-21).
    // The week page, Pulse, Startups, search and the Roadmap's reading lists still use everything fetched.
    const edition = learning.filter(i => +i.date <= now && now - +i.date < EDITION_WINDOW);
    const byRank = [...edition].sort((a, b) => rank(b, now) - rank(a, now) || +b.date - +a.date);
    // The big story: the same thing covered by several independent sources (headline feeds count too).
    const big = await bigStories(items.filter(i => i.category !== 'business'), now, 1); // business news has its own page
    if (process.env.BIG_DEBUG) for (const b of big) console.log('[big]', b.sources, b.items.map(i => `${i.feedTitle}: ${i.title}`).join(' | '));

    // Substance check (local model): front-page candidates that are hype stay off the front page (desk pages keep them).
    const hype = await skills.substance(byRank.filter(i => bandOf(i) !== 'research').slice(0, 40));
    for (const i of edition) if (hype.has(i.link)) i.hype = true;
    // What may lead or headline the front: not a paper, not an opinion, not news, not hype.
    const frontable = (i: FeedItem) => !i.hype && ['learn', 'experimental'].includes(bandOf(i));

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

    // The lead: the most worthwhile thing in this edition (postmortems have their own slot).
    // Readable first: Intro and Intermediate pieces before Advanced ones of similar rank.
    const readable = (i: FeedItem) => (i.brief?.level === 'Advanced' ? 1 : 0);
    const recent = byRank.filter(i => i.category !== 'postmortems' && i.brief?.fetched && frontable(i)).sort((a, b) => readable(a) - readable(b));
    // Up to 5 candidates in rank order; the page shows the first one you haven't read or been shown on an
    // earlier day. A quiet day with nothing at worth 4 still gets a lead: the bar drops to 3.5, then 3.
    const leadAt = (w: number) => recent.filter(i => (i.brief?.worth ?? 0) >= w).slice(0, 5);
    const deepCands = [4, 3.5, 3].map(leadAt).find(l => l.length) ?? [];
    const deepRead = deepCands[0];
    if (deepRead) used.add(deepRead.link);
    // Fresh: the best of the edition, one per track first.
    const pool = byRank.filter(i => i.category !== 'postmortems' && (i.brief?.worth ?? 0) >= 3 && (i.skill || isDeep(i)));
    const fresh = take(pool, 4, true);
    fresh.push(...take(pool, 8 - fresh.length));
    // More worth your time: one per track first, then fill.
    const picks = take(byRank.filter(i => isDeep(i) && i.category !== 'postmortems'), 4, true);
    picks.push(...take(byRank.filter(i => isDeep(i) && i.category !== 'postmortems'), 6 - picks.length));
    // Learn from failure: the best recent postmortem.
    const [postmortem] = take(byRank.filter(i => i.category === 'postmortems' && (i.brief?.worth ?? 0) >= 3), 1);

    const tracks = CATEGORIES.map(c => {
        const all = edition.filter(i => i.category === c.id).sort((a, b) => rank(b, now) - rank(a, now) || +b.date - +a.date);
        return { ...c, all, deep: all.filter(isDeep), light: all.filter(i => !isDeep(i)), sources: status.filter(s => s.category === c.id) };
    });

    // Pulse: Hacker News by points, then Techmeme by recency; ten headlines.
    const inWindow = (i: FeedItem) => +i.date <= now && now - +i.date < EDITION_WINDOW;
    const pulse = items.filter(i => i.category === 'pulse' && inWindow(i))
        .sort((a, b) => (b.points ?? 0) - (a.points ?? 0) || +b.date - +a.date)
        .slice(0, 10);

    // Startups: grouped by where the signal comes from.
    const startup = (id: string) => items.filter(i => i.feedId === id && inWindow(i));
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
        const mine = edition.filter(i => i.category === c.id);
        // Recency-heavy rank (freshness dominates) so the latest leads, but a practical piece beats a same-day essay.
        // A desk with nothing in the last 24 hours is left out of the edition.
        let list = mine.filter(i => (i.brief?.worth ?? 0) >= 3).sort((a, b) => rank(b, now) - rank(a, now));
        if (list.length < 2) list = [...list, ...mine.filter(i => !list.includes(i) && (i.brief?.worth ?? 0) >= 2.5).sort(newest)];
        // Different sources first, so one prolific feed doesn't fill a desk.
        const seen = new Set<string>(), varied = list.filter(i => !seen.has(i.feedTitle) && seen.add(i.feedTitle));
        // Outside the Research desk, a paper listing shouldn't lead: practitioners first, arXiv after.
        const paper = (i: FeedItem) => Number(c.id !== 'research' && i.feedId.startsWith('arxiv'));
        varied.sort((a, b) => paper(a) - paper(b));
        const rest = list.filter(i => !varied.includes(i) && !paper(i)); // and at most one paper per desk
        return { ...c, items: [...varied, ...rest].slice(0, 3) };
    }).filter(d => d.items.length);
    // The wire: the newest headlines from every desk, for scanning.
    // At most two per source, so a batch publisher (arXiv posts its whole day at once) can't flood it.
    const perFeed = new Map<string, number>();
    const wire = edition.filter(i => (i.brief?.worth ?? 0) >= 2.5 && i.link !== deepRead?.link && bandOf(i) !== 'research' && !i.hype).sort(newest)
        // All arXiv listings count as one source here, so new-submission batches can't fill the wire.
        .filter(i => { const k = i.feedId.startsWith('arxiv') ? 'arxiv' : i.feedId; const n = perFeed.get(k) ?? 0; perFeed.set(k, n + 1); return n < 2; }).slice(0, 11);
    // Top stories under the lead: the best recent pieces not already in the wire or the desks.
    const shownElsewhere = new Set([...wire, ...desks.flatMap(d => d.items)].map(i => i.link));
    const topStories = byRank.filter(i => isDeep(i) && frontable(i) && bandOf(i) === 'learn' && !shownElsewhere.has(i.link) && !deepCands.some(d => d.link === i.link) && i.category !== 'postmortems').slice(0, 6);
    // The other bands, each the best of its kind in the edition.
    const notLead = (i: FeedItem) => !deepCands.some(d => d.link === i.link) && !topStories.includes(i);
    const experimental = byRank.filter(i => bandOf(i) === 'experimental' && !i.hype && notLead(i) && (i.brief?.worth ?? 0) >= 2.5).slice(0, 6);
    const research = byRank.filter(i => bandOf(i) === 'research').slice(0, 6);
    const thoughts = byRank.filter(i => bandOf(i) === 'thoughts' && !i.hype && (i.brief?.worth ?? 0) >= 2).slice(0, 4);
    // The article's own description and preview image for everything shown with a picture or a dek.
    const showcase = [...new Set([...deepCands, ...topStories, ...experimental, ...thoughts, ...research, ...desks.flatMap(d => d.items), ...wire])];
    await mapLimit(showcase, 8, async i => {
        // arXiv's og:image is always its logo and its description is the abstract: show neither.
        if (i.feedId.startsWith('arxiv')) { i.meta = {}; return; }
        const m = await getMeta(i.link);
        i.meta = { description: cleanDescription(m.description, i.title), image: m.image };
    });
    // An image reused across a feed's posts is a site logo, not the article's picture.
    const uses = new Map<string, number>();
    for (const i of showcase) if (i.meta?.image) uses.set(`${i.feedId} ${i.meta.image}`, (uses.get(`${i.feedId} ${i.meta.image}`) ?? 0) + 1);
    for (const i of showcase) if (i.meta?.image && (uses.get(`${i.feedId} ${i.meta.image}`) ?? 0) > 1) delete i.meta.image;
    // Big tech engineering blogs (feeds with bigtech: true): the last 24 hours, and the week for /big-tech/.
    const bigtechDay = edition.filter(i => i.bigtech).sort((a, b) => +b.date - +a.date);
    const bigtechWeek = learning.filter(i => i.bigtech && +i.date <= now && now - +i.date < 7 * DAY && !bigtechDay.includes(i)).sort((a, b) => +b.date - +a.date);
    // "You'll learn" sentences for everything shown with a card: the front page first, then the desk pages.
    // The local model's skills, in the order the edition needs them (they share one time budget; see skills.ts).
    const deskTop = CATEGORIES.flatMap(c => edition.filter(i => i.category === c.id).sort((a, b) => rank(b, now) - rank(a, now)).slice(0, 12));
    const { getStartups } = await import('./startups');
    await getStartups(now, roadmap); // the approach skill, for the Discover band
    await skills.learn([...deepCands, ...topStories, ...bigtechDay, ...experimental, ...thoughts, ...showcase, ...deskTop].filter(i => bandOf(i) !== 'research'));
    await skills.check([...deepCands.slice(0, 3), ...topStories]);
    await skills.paperGist([...research, ...showcase, ...deskTop].filter(i => bandOf(i) === 'research'));
    await skills.saveSkills();
    const thumbFor = async (i: FeedItem, w: number) => { if (i.meta?.image) i.meta.thumb = await makeThumb(i.meta.image, w); };
    await mapLimit(deepCands, 4, i => thumbFor(i, 760));
    await mapLimit([...topStories, ...desks.map(d => d.items[0])].filter(Boolean), 6, i => thumbFor(i, 360));
    // The week: each desk's best of the last 7 days by worth (not freshness), for days you didn't read.
    const weekBig = await bigStories(items.filter(i => i.category !== 'business'), now, 7, 6);
    const weekDesks = CATEGORIES.map(c => {
        const mine = learning.filter(i => i.category === c.id && +i.date <= now && now - +i.date < 7 * DAY && (i.brief?.worth ?? 0) >= 3 && !isRoundup(i.title));
        const score = (i: FeedItem) => (i.brief?.worth ?? 2) * 2 + (i.skill?.boost ?? 0) + (i.weight ?? 0);
        const list = [...mine].sort((a, b) => score(b) - score(a));
        const seen = new Set<string>(), varied = list.filter(i => !seen.has(i.feedId) && seen.add(i.feedId));
        return { ...c, total: mine.length, items: [...varied, ...list.filter(i => !varied.includes(i))].slice(0, 5) };
    }).filter(d => d.items.length);

    return { edition, big, experimental, research, thoughts, bigtech: { day: bigtechDay, week: bigtechWeek }, week: { big: weekBig, desks: weekDesks }, items, learning, status, fetchedAt, now, deepRead, deepCands, fresh, picks, desks, wire, topStories, postmortem, tracks, pulse, startups, roadmap };
}

/** "Launch HN: Acme (YC W26) – Agents that file your taxes" → name, batch, tagline. */
export function parseLaunch(title: string) {
    const m = title.match(/^Launch HN:\s*(.+?)\s*\((YC\s*[A-Z]\d{2,4})\)\s*[–—-]\s*(.+)$/i)
        ?? title.match(/^Launch HN:\s*(.+?)\s*[–—-]\s*(.+)$/i);
    if (!m) return { name: title.replace(/^Launch HN:\s*/i, ''), batch: '', tagline: '' };
    return m.length === 4 ? { name: m[1], batch: m[2].replace(/\s+/, ' '), tagline: m[3] } : { name: m[1], batch: '', tagline: m[2] };
}
