// "On GitHub": the best technical projects being built in the open right now, picked fresh for every edition.
// Candidates come from two official APIs, no scraping:
//   1. Hacker News (Algolia API): repos linked from stories with 60+ points in the last 24 hours. HN readers are a
//      strong technical filter.
//   2. GitHub Search API: new repos (≤ 60 days) in systems languages (Rust, Go, C, C++, Zig, OCaml, Haskell, Java),
//      ranked by stars. Python/TypeScript come only via HN: by stars alone they are mostly AI-app wrappers.
// A repo must be active (pushed in the last 24 hours), young (created within a year, so "ongoing", not a giant
// linked for a CVE), have an English description, show no game/emulator/piracy signals, not look star-farmed,
// and its description must match a Roadmap topic by meaning (the same test articles pass). That match is also
// its "Why look" line. One repo per owner. The featured repo rotates: one featured in the last 3 days isn't again.
// Last good list and the featured history are cached in .cache/github.json.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { embed, cosine } from './embed';
import type { Topic } from './roadmap';
import { EDITION_WINDOW } from './edition';

export interface Repo {
    name: string;          // owner/repo
    url: string;
    description: string;
    language: string;
    stars: number;
    forks: number;
    createdAt: string;
    pushedAt: string;
    starsPerDay: number;
    hn?: { points: number; comments: number; url: string; title: string };
    topic?: { id: string; name: string; track: string; sim: number };
    score: number;
}

const DAY = 864e5;
const CACHE = '.cache/github.json';
const LANGS = ['Rust', 'Go', 'C', 'C++', 'Zig', 'OCaml', 'Haskell', 'Java'];
// Repo description ↔ Roadmap topic. HN-upvoted repos already passed a technical audience, so their bar is lower;
// the topic label ("Why look") is shown only for a clear match (≥ LABEL): short descriptions mislabel below that.
const BAR_HN = 0.3, BAR = 0.45, STRONG = 0.4;
export const LABEL = 0.5;
const SKIP = /\b(games?|gaming|gta|zelda|nintendo|switch ?2|xbox|playstation|ps[2-5]|psp|emulat\w*|recomp\w*|roms?|cheats?|crack\w*|piracy|torrent\w*|download manager|media player|music player|waifu|anime|wallpapers?|awesome|curated list|list of|cheat ?sheet|interview|roadmap|course|tutorials?|prompts?|jailbreak|unlock|free (vpn|proxy)|ngrok alternative|telegram bot|discord bot|crypto ?wallet|airdrop|trading bot)\b/i;
// Tracks a repo's topic may belong to: engineering and research, not markets.
const TRACKS = new Set(['research', 'systems', 'backend', 'swe', 'ai-eng', 'ml', 'security', 'hft', 'math', 'postmortems']);
// Soft topics that would let app wrappers in: design-interview prep, case studies, tools lists, career, craft/judgment,
// and the "use AI tools / build AI products" end of AI engineering.
const SOFT_AREAS = new Set([2, 3, 20, 21, 22, 23, 24, 25, 31]);
const SOFT_TOPICS = new Set(['ai-coding', 'ai-product', 'model-selection', 'context-engineering', 'reading-papers', 'ml-math']);

const headers = (): Record<string, string> => ({
    'Accept': 'application/vnd.github+json',
    'User-Agent': 'reading-room-build',
    ...(process.env.GITHUB_TOKEN ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}),
});
const json = async (url: string, h: Record<string, string> = {}) => {
    const r = await fetch(url, { headers: h, signal: AbortSignal.timeout(20_000) });
    if (!r.ok) throw new Error(`HTTP ${r.status} ${url}`);
    return r.json();
};
const english = (s: string) => { const letters = s.replace(/[\s\d\p{P}\p{S}]/gu, ''); return letters.length > 0 && (letters.match(/[a-z]/gi)?.length ?? 0) / letters.length > 0.85; };

interface Cache { at: number; repos: Repo[]; featured: Record<string, number> }
async function readCache(): Promise<Cache> {
    try { return JSON.parse(await readFile(CACHE, 'utf8')); } catch { return { at: 0, repos: [], featured: {} }; }
}

/** Repos linked from Hacker News stories with 60+ points in the edition window (24 hours). */
async function fromHN(now: number) {
    const since = Math.floor((now - EDITION_WINDOW) / 1000);
    const q = new URLSearchParams({ tags: 'story', query: 'github.com', restrictSearchableAttributes: 'url', numericFilters: `points>60,created_at_i>${since}`, hitsPerPage: '100' });
    const d = await json(`https://hn.algolia.com/api/v1/search_by_date?${q}`);
    const out = new Map<string, Repo['hn']>();
    for (const h of d.hits ?? []) {
        const m = String(h.url ?? '').match(/^https?:\/\/github\.com\/([\w.-]+\/[\w.-]+?)(?:\.git)?(?:[/#?]|$)/i);
        if (!m) continue;
        const name = m[1].toLowerCase();
        const prev = out.get(name);
        if (!prev || h.points > prev.points) out.set(name, { points: h.points, comments: h.num_comments ?? 0, url: `https://news.ycombinator.com/item?id=${h.objectID}`, title: h.title });
    }
    return out;
}

/** New repos (≤ 60 days) in systems and infrastructure languages, by stars. */
async function fromSearch(now: number) {
    const created = new Date(now - 60 * DAY).toISOString().slice(0, 10);
    const out: any[] = [];
    for (const lang of LANGS) {
        const q = `created:>${created} stars:>150 language:"${lang}" archived:false fork:false`;
        try {
            const d = await json(`https://api.github.com/search/repositories?q=${encodeURIComponent(q)}&sort=stars&order=desc&per_page=30`, headers());
            out.push(...(d.items ?? []));
        } catch (e) { console.warn(`[github] search ${lang}: ${(e as Error).message}`); }
    }
    return out;
}

/** The repo's own description; if it has none (or a stub), the HN title, but only a Show HN or one that names
 *  the repo, so an editorialised headline never stands in for a description. */
function describe(r: any, hn?: Repo['hn']) {
    const own = (r.description ?? '').trim();
    if (own.length >= 20 || !hn) return own;
    const repo = String(r.name ?? '').toLowerCase().replace(/[-_.]+/g, ' ');
    const title = hn.title.replace(/^(Show|Launch) HN:\s*/i, '').trim();
    return /^(Show|Launch) HN:/i.test(hn.title) || title.toLowerCase().replace(/[-_.]+/g, ' ').includes(repo) ? title : own;
}

function toRepo(r: any, now: number, hn?: Repo['hn']): Repo {
    const age = Math.max(1, (now - Date.parse(r.created_at)) / DAY);
    return {
        name: r.full_name, url: r.html_url,
        description: describe(r, hn), language: r.language ?? '',
        stars: r.stargazers_count, forks: r.forks_count, createdAt: r.created_at, pushedAt: r.pushed_at,
        starsPerDay: Math.round(r.stargazers_count / age), hn, score: 0,
    };
}

const eligible = (r: Repo, now: number) =>
    r.description.length >= 20 && english(r.description) && !SKIP.test(`${r.name} ${r.description}`)
    && now - Date.parse(r.pushedAt) < EDITION_WINDOW && now - Date.parse(r.createdAt) < 365 * DAY
    // Star-farmed repos have stars and no forks. HN upvotes are real attention, so HN repos skip this guard.
    && (r.hn ? r.stars >= 20 : r.stars >= 50 && r.forks / Math.max(1, r.stars) >= 0.01);

let memo: ReturnType<typeof build> | undefined;
/** The edition's GitHub section: a featured repo and up to 6 more, all matched to Roadmap topics. Once per build. */
export const getGitHub = (...a: Parameters<typeof build>) => (memo ??= build(...a));

async function build(now: number, roadmap: { topics: Map<string, Topic>; topicVec: Map<string, number[]> }) {
    const cache = await readCache();
    let repos: Repo[] = [], fetched = false;
    try {
        const [hn, search] = await Promise.all([fromHN(now), fromSearch(now)]);
        const byName = new Map<string, Repo>();
        for (const r of search) byName.set(r.full_name.toLowerCase(), toRepo(r, now, hn.get(r.full_name.toLowerCase())));
        // HN-linked repos not already found by search: look each one up.
        for (const [name, h] of hn) {
            if (byName.has(name)) continue;
            try { byName.set(name, toRepo(await json(`https://api.github.com/repos/${name}`, headers()), now, h)); }
            catch (e) { console.warn(`[github] ${name}: ${(e as Error).message}`); }
        }
        if (process.env.GH_DEBUG) for (const r of byName.values()) if (r.hn && !eligible(r, now)) console.log('[github] drop', r.name, JSON.stringify({
            desc: r.description.length >= 20, english: english(r.description), skip: SKIP.exec(`${r.name} ${r.description}`)?.[0],
            pushedDays: Math.round((now - Date.parse(r.pushedAt)) / DAY), ageDays: Math.round((now - Date.parse(r.createdAt)) / DAY), stars: r.stars, forkRatio: +(r.forks / Math.max(1, r.stars)).toFixed(3) }));
        repos = [...byName.values()].filter(r => eligible(r, now));
        fetched = true;
    } catch (e) {
        console.warn(`[github] fetch failed, using the last good list: ${(e as Error).message}`);
    }
    // The cache stands in only when the fetch failed, and only if it's from inside the edition window:
    // an empty day shows an empty section, never yesterday's repos.
    if (!fetched) repos = now - cache.at < EDITION_WINDOW ? cache.repos : [];
    else if (repos.length) {
        // Topic match by meaning; drop anything that doesn't teach a Roadmap topic.
        const topics = [...roadmap.topics.values()].filter(t => TRACKS.has(t.track) && !SOFT_AREAS.has(t.areaN) && !SOFT_TOPICS.has(t.id) && roadmap.topicVec.has(t.id));
        const vecs = await embed(repos.map(r => `${r.name.split('/')[1].replace(/[-_]/g, ' ')}: ${r.description}`));
        if (vecs) {
            repos.forEach((r, i) => {
                let best: Topic | undefined, sim = 0;
                for (const t of topics) { const s = cosine(vecs[i], roadmap.topicVec.get(t.id)!); if (s > sim) { sim = s; best = t; } }
                if (best && sim >= (r.hn ? BAR_HN : BAR)) r.topic = { id: best.id, name: best.name, track: best.track, sim };
            });
            if (process.env.GH_DEBUG) repos.forEach((r, i) => { if (!r.topic && r.hn) { let b = '', m = 0; for (const t of topics) { const x = cosine(vecs[i], roadmap.topicVec.get(t.id)!); if (x > m) { m = x; b = t.name; } } console.log('[github] no topic', r.name, m.toFixed(2), b, '|', r.description); } });
            repos = repos.filter(r => r.topic);
        }
        // Momentum (stars per day, log-scaled) + HN attention + how clearly it teaches a topic.
        for (const r of repos) r.score = Math.log10(1 + r.starsPerDay) * 2 + (r.hn ? Math.log10(r.hn.points) * 1.5 : 0) + (r.topic ? (r.topic.sim - STRONG) * 12 : 0);
        repos.sort((a, b) => b.score - a.score);
        // One repo per owner: an org launching a series shouldn't fill the section.
        const seenOwner = new Set<string>();
        repos = repos.filter(r => { const o = r.name.split('/')[0].toLowerCase(); return !seenOwner.has(o) && !!seenOwner.add(o); });
        if (process.env.GH_DEBUG) for (const r of repos) console.log('[github]', r.score.toFixed(2), r.name, `★${r.stars} +${r.starsPerDay}/d`, r.hn ? `HN ${r.hn.points}` : '', '→', r.topic?.name, r.topic?.sim.toFixed(2));
    }
    // Feature the best repo not featured in the last 3 days; then up to 6 more.
    const featuredAt = cache.featured ?? {};
    const featured = repos.find(r => !(now - (featuredAt[r.name] ?? -Infinity) < 3 * DAY)) ?? repos[0];
    const more = repos.filter(r => r !== featured).slice(0, 6);
    if (featured) {
        const log = Object.fromEntries(Object.entries(featuredAt).filter(([, t]) => now - t < 30 * DAY));
        log[featured.name] = now;
        try { await mkdir('.cache', { recursive: true }); await writeFile(CACHE, JSON.stringify({ at: now, repos, featured: log })); } catch {}
    }
    return { featured, more };
}
