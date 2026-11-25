// Communities: the gist of what tech communities around the world are discussing, last 24 hours.
// No AI and no copied text: threads come from each community's official API or feed (title, link, score,
// comment count), and the "gist" is computed: each thread is matched by meaning (local embeddings) to its
// closest Roadmap area, areas are ranked by how much discussion they drew, and stories that show up in two
// or more communities are found with the big story's same-story rule. Links only; every item is credited.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { XMLParser } from 'fast-xml-parser';
import { embed, cosine } from './embed';
import { groupSame } from './bigstory';
import { EDITION_WINDOW } from './edition';
import type { Topic } from './roadmap';

export interface Thread {
    community: string;   // community id
    where?: string;      // sub-forum: a Stack Exchange site, a Lemmy community, a Lobsters tag
    title: string;
    url: string;         // the discussion
    ext?: string;        // the linked article, when it's a link post
    score: number;
    comments: number;    // comments, or answers on Stack Exchange
    at: number;
    tags: string[];
    area?: string;       // closest Roadmap area (computed)
    heat?: number;
}
export interface Community { id: string; name: string; about: string; home: string; credit: string }
export interface Theme { area: string; threads: Thread[]; comments: number }
export interface Gist { community: Community; threads: Thread[]; themes: Theme[]; debated?: Thread; ok: boolean }

export const COMMUNITIES: Community[] = [
    { id: 'hn', name: 'Hacker News', about: 'The largest general tech community; startups, systems, AI, science.', home: 'https://news.ycombinator.com/', credit: 'Y Combinator, via the HN Algolia API' },
    { id: 'lobsters', name: 'Lobsters', about: 'Smaller, invite-only and more technical: systems, languages, security.', home: 'https://lobste.rs/', credit: 'lobste.rs JSON' },
    { id: 'slashdot', name: 'Slashdot', about: 'The original tech news community, since 1997.', home: 'https://slashdot.org/', credit: 'Slashdot RSS' },
    { id: 'lemmy', name: 'programming.dev', about: 'The largest programming instance on Lemmy (the fediverse).', home: 'https://programming.dev/', credit: 'Lemmy API' },
    { id: 'devto', name: 'DEV Community', about: 'A worldwide community of developers writing about their work.', home: 'https://dev.to/', credit: 'Forem API' },
    { id: 'se', name: 'Stack Exchange', about: 'The most-voted new questions on Stack Overflow and six expert sites.', home: 'https://stackexchange.com/', credit: 'Stack Exchange API' },
];
const SE_SITES: [string, string][] = [['stackoverflow', 'Stack Overflow'], ['softwareengineering', 'Software Engineering'], ['unix', 'Unix & Linux'], ['security', 'Information Security'], ['stats', 'Cross Validated'], ['math', 'Mathematics'], ['quant', 'Quantitative Finance']];

const UA = { 'User-Agent': 'reading-room-build (links only; https://sunny-dubey.github.io/reading-room/)' };
const getJson = async (url: string) => { const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(20_000) }); if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() as Promise<any>; };
const getText = async (url: string) => { const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(20_000) }); if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.text(); };
const ENT: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', hellip: '…', mdash: '—', ndash: '–', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“' };
const decode = (s: string) => String(s ?? '').replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => e[0] === '#' ? String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : ENT[e.toLowerCase()] ?? m).trim();

const LOADERS: Record<string, (since: number) => Promise<Thread[]>> = {
    hn: async since => {
        const q = new URLSearchParams({ tags: 'story', numericFilters: `created_at_i>${Math.floor(since / 1000)},points>40`, hitsPerPage: '60' });
        const d = await getJson(`https://hn.algolia.com/api/v1/search?${q}`);
        return (d.hits ?? []).map((h: any) => ({ community: 'hn', title: decode(h.title), url: `https://news.ycombinator.com/item?id=${h.objectID}`, ext: h.url || undefined, score: h.points ?? 0, comments: h.num_comments ?? 0, at: h.created_at_i * 1000, tags: [] }));
    },
    lobsters: async () => (await getJson('https://lobste.rs/hottest.json')).map((s: any) => ({
        community: 'lobsters', where: s.tags?.[0], title: decode(s.title), url: s.comments_url, ext: s.url || undefined, score: s.score ?? 0, comments: s.comment_count ?? 0, at: Date.parse(s.created_at), tags: s.tags ?? [],
    })),
    slashdot: async () => {
        const x = new XMLParser({ ignoreAttributes: false, isArray: n => n === 'item' }).parse(await getText('https://rss.slashdot.org/Slashdot/slashdotMain'));
        const items = x?.['rdf:RDF']?.item ?? x?.rss?.channel?.item ?? [];
        return items.map((i: any) => ({ community: 'slashdot', where: i['slash:section'], title: decode(i.title), url: String(i.link).replace(/\?utm_.*$/, ''), score: 0, comments: Number(i['slash:comments'] ?? 0), at: Date.parse(i['dc:date'] ?? i.pubDate), tags: [i['slash:section']].filter(Boolean) }));
    },
    lemmy: async () => {
        const d = await getJson('https://programming.dev/api/v3/post/list?sort=TopDay&limit=40&type_=Local');
        return (d.posts ?? []).filter((p: any) => !/humou?r|meme|funny|shitpost|jokes?/i.test(p.community?.name ?? '')).map((p: any) => ({
            community: 'lemmy', where: p.community?.name, title: decode(p.post.name), url: `https://programming.dev/post/${p.post.id}`, ext: p.post.url || undefined, score: p.counts?.score ?? 0, comments: p.counts?.comments ?? 0, at: Date.parse(p.post.published), tags: [p.community?.name].filter(Boolean),
        }));
    },
    devto: async () => (await getJson('https://dev.to/api/articles?top=1&per_page=40')).map((a: any) => ({
        community: 'devto', title: decode(a.title), url: a.url, score: a.positive_reactions_count ?? 0, comments: a.comments_count ?? 0, at: Date.parse(a.published_at), tags: a.tag_list ?? [],
    })),
    se: async since => {
        const out: Thread[] = [];
        for (const [site, name] of SE_SITES) {
            try {
                const d = await getJson(`https://api.stackexchange.com/2.3/questions?order=desc&sort=votes&site=${site}&pagesize=8&fromdate=${Math.floor(since / 1000)}`);
                out.push(...(d.items ?? []).filter((q: any) => q.score >= 1).map((q: any) => ({ community: 'se', where: name, title: decode(q.title), url: q.link, score: q.score, comments: q.answer_count ?? 0, at: q.creation_date * 1000, tags: q.tags ?? [] })));
                if (d.backoff) await new Promise(r => setTimeout(r, d.backoff * 1000)); // the API asks clients to wait
            } catch (e) { console.warn(`[communities] se/${site}: ${(e as Error).message}`); }
        }
        return out;
    },
};

const CACHE = '.cache/communities.json';
let memo: ReturnType<typeof build> | undefined;
/** Every community's gist, plus stories discussed in two or more communities. Once per build. */
export const getCommunities = (...a: Parameters<typeof build>) => (memo ??= build(...a));

async function build(now: number, roadmap: { topics: Map<string, Topic>; topicVec: Map<string, number[]> }) {
    const since = now - EDITION_WINDOW;
    let cache: Record<string, { at: number; threads: Thread[] }> = {};
    try { cache = JSON.parse(await readFile(CACHE, 'utf8')); } catch {}
    const fetched = await Promise.all(COMMUNITIES.map(async c => {
        try {
            const threads = (await LOADERS[c.id](since)).filter(t => t.title && t.url && t.at > since && t.at <= now + 36e5);
            cache[c.id] = { at: now, threads };
            return { c, threads, ok: true };
        } catch (e) {
            console.warn(`[communities] ${c.id}: ${(e as Error).message}`);
            // A failed fetch may borrow the last good list, but only threads still inside the 24-hour window.
            return { c, threads: (cache[c.id]?.threads ?? []).filter(t => t.at > since), ok: false };
        }
    }));
    try { await mkdir('.cache', { recursive: true }); await writeFile(CACHE, JSON.stringify(cache)); } catch {}

    // Each thread → its closest Roadmap area by meaning (title + tags). Below the bar it stays unlabelled.
    const all = fetched.flatMap(f => f.threads);
    const topics = [...roadmap.topics.values()].filter(t => roadmap.topicVec.has(t.id));
    const vecs = all.length ? await embed(all.map(t => `${t.title}${t.tags.length ? ` (${t.tags.join(', ')})` : ''}`)) : null;
    all.forEach((t, i) => {
        t.heat = t.comments + t.score / 10;
        if (!vecs) return;
        let best: Topic | undefined, sim = 0;
        for (const tp of topics) { const s = cosine(vecs[i], roadmap.topicVec.get(tp.id)!); if (s > sim) { sim = s; best = tp; } }
        if (best && sim >= 0.42) t.area = best.areaTitle; // 0.35 mislabelled (a security intrusion as Load Balancing)
    });

    const gists: Gist[] = fetched.map(({ c, threads, ok }) => {
        const byArea = new Map<string, Thread[]>();
        for (const t of threads) if (t.area) byArea.set(t.area, [...(byArea.get(t.area) ?? []), t]);
        const themes = [...byArea].map(([area, ts]) => ({ area, threads: ts.sort((a, b) => b.heat! - a.heat!), comments: ts.reduce((n, t) => n + t.comments, 0) }))
            .filter(th => th.threads.length >= 2)
            .sort((a, b) => b.comments - a.comments || b.threads.length - a.threads.length).slice(0, 3);
        // Most debated: many comments relative to votes (communities with votes only).
        const debated = threads.filter(t => t.comments >= 15 && t.score > 0).sort((a, b) => b.comments / (b.score + 1) - a.comments / (a.score + 1))[0];
        return { community: c, threads: [...threads].sort((a, b) => b.heat! - a.heat!), themes, debated, ok };
    });

    // Talked about everywhere: the same story in two or more communities.
    const everywhere = vecs ? groupSame(all.map(t => t.title), all.map(t => t.community), vecs, 0.6)
        .map(ks => ks.map(k => all[k]))
        .filter(g => new Set(g.map(t => t.community)).size >= 2)
        .map(g => ({ threads: g.sort((a, b) => b.heat! - a.heat!), comments: g.reduce((n, t) => n + t.comments, 0) }))
        .sort((a, b) => b.threads.length - a.threads.length || b.comments - a.comments).slice(0, 5) : [];
    return { gists, everywhere, total: all.length };
}

export const communityName = (id: string) => COMMUNITIES.find(c => c.id === id)?.name ?? id;
