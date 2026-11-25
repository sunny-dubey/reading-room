// The Briefing: compact, factual boxes for the engineer who wants to know what changed.
// Release radar + end-of-life notices (endoflife.date), CVE watch (CISA Known Exploited Vulnerabilities),
// paper drop (arXiv, matched to the Roadmap). All public, no keys.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { parse } from 'yaml';
import { XMLParser } from 'fast-xml-parser';
import { embed, cosine } from './embed';
import { getReading } from './reading';
import { EDITION_WINDOW, DATE_ONLY_WINDOW } from './edition';
import type { Topic } from './roadmap';

const DAY = 864e5;
const UA = { 'User-Agent': 'Mozilla/5.0 (compatible; reading-room briefing)' };
const get = async (url: string) => {
    const res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(20_000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res;
};
const strip = (s = '') => s.replace(/<[^>]+>/g, ' ').replace(/&#x2F;/g, '/').replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim();

interface Stack { products: { slug: string; name: string }[]; watch: string[] }
async function stack(): Promise<Stack> {
    try { return parse(await readFile('src/content/stack.yaml', 'utf8')); } catch { return { products: [], watch: [] }; }
}

// ---------- Release radar + end-of-life notices ----------
export interface Release { product: string; slug: string; version: string; cycle: string; date: number; newCycle: boolean; link?: string; others: number }
export interface Eol { product: string; slug: string; cycle: string; date: number; days: number; latest?: string }
async function lifecycles(now: number) {
    const { products } = await stack();
    const releases: Release[] = [], eols: Eol[] = [];
    let failed = 0;
    await Promise.all(products.map(async p => {
        try {
            const cycles: any[] = await (await get(`https://endoflife.date/api/${p.slug}.json`)).json();
            for (const c of cycles.slice(0, 8)) {
                const rel = c.latestReleaseDate ? +new Date(c.latestReleaseDate) : NaN;
                if (rel && now - rel < DATE_ONLY_WINDOW && rel <= now) releases.push({ others: 0,
                    product: p.name, slug: p.slug, version: String(c.latest ?? c.cycle), cycle: String(c.cycle), date: rel,
                    newCycle: !!c.releaseDate && now - +new Date(c.releaseDate) < 30 * DAY, link: typeof c.link === 'string' ? c.link : undefined,
                });
                if (typeof c.eol === 'string') {
                    const d = +new Date(c.eol), days = Math.round((d - now) / DAY);
                    if (days >= -45 && days <= 200) eols.push({ product: p.name, slug: p.slug, cycle: String(c.cycle), date: d, days, latest: c.latest });
                }
            }
        } catch { failed++; }
    }));
    // One row per project: its newest release line, noting how many older lines were patched too.
    const byProduct = new Map<string, Release>();
    for (const r of releases) {
        const cur = byProduct.get(r.slug);
        if (!cur) byProduct.set(r.slug, r);
        else cur.others++;
    }
    releases.length = 0;
    releases.push(...[...byProduct.values()].sort((a, b) => b.date - a.date));
    // Upcoming first (soonest at the top), then the recently dead (most recent first).
    eols.sort((a, b) => Number(a.days < 0) - Number(b.days < 0) || (a.days < 0 ? b.days - a.days : a.days - b.days));
    return { releases, eols, failed, watched: products.length };
}

// ---------- CVE watch ----------
export interface Cve { id: string; vendor: string; product: string; name: string; added: number; due: number; summary: string; ransomware: boolean; mine: boolean; cwe?: string }
async function cves(now: number) {
    const { watch } = await stack();
    const d: any = await (await get('https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json')).json();
    const re = new RegExp(`\\b(${watch.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\b`, 'i');
    const list: Cve[] = (d.vulnerabilities ?? [])
        .map((v: any) => ({
            id: v.cveID, vendor: v.vendorProject, product: v.product, name: v.vulnerabilityName,
            added: +new Date(v.dateAdded), due: +new Date(v.dueDate), summary: v.shortDescription,
            ransomware: v.knownRansomwareCampaignUse === 'Known', mine: re.test(`${v.vendorProject} ${v.product}`), cwe: v.cwes?.[0],
        }))
        .filter((v: Cve) => now - v.added < DATE_ONLY_WINDOW)
        .sort((a: Cve, b: Cve) => b.added - a.added || Number(b.mine) - Number(a.mine));
    return { list, total: d.vulnerabilities?.length ?? 0 };
}

// ---------- Paper drop ----------
export interface Paper { id: string; title: string; url: string; authors: string; cat: string; abstract: string; date: number; topic?: Topic; sim: number; code?: { repo: string; stars: number }; paper?: import('./skills').PaperGist }
const CATS: Record<string, { label: string; tracks: string[] }> = {
    'cs.DC': { label: 'Distributed computing', tracks: ['systems', 'backend'] },
    'cs.DB': { label: 'Databases', tracks: ['systems', 'backend'] },
    'cs.OS': { label: 'Operating systems', tracks: ['systems', 'backend'] },
    'cs.NI': { label: 'Networking', tracks: ['backend', 'systems'] },
    'cs.SE': { label: 'Software engineering', tracks: ['backend', 'systems'] },
    'cs.CR': { label: 'Security', tracks: ['security', 'backend'] },
    'cs.LG': { label: 'Machine learning', tracks: ['ml', 'ai-eng'] },
    'cs.CL': { label: 'Language models', tracks: ['ml', 'ai-eng'] },
};
async function papers(now: number) {
    const xml = new XMLParser({ ignoreAttributes: false, textNodeName: '#text' });
    const file = '.cache/arxiv.json';
    let kept: Omit<Paper, 'topic' | 'sim'>[] = [];
    try { kept = JSON.parse(await readFile(file, 'utf8')); } catch {}
    // arXiv announces Monday–Friday; keep the last week so weekends aren't empty.
    await Promise.all(Object.keys(CATS).map(async cat => {
        try {
            const x = xml.parse(await (await get(`https://rss.arxiv.org/rss/${cat}`)).text());
            const items = [x.rss?.channel?.item ?? []].flat();
            const day = +new Date(x.rss?.channel?.pubDate ?? now);
            for (const it of items.slice(0, 160)) {
                const desc = String(it.description ?? '');
                if (!/Announce Type:\s*new\b/i.test(desc)) continue; // skip cross-lists and replacements
                const id = String(it.link).split('/').pop()!;
                if (kept.some(k => k.id === id)) continue;
                kept.push({ id, title: strip(String(it.title)), url: String(it.link), authors: strip(String(it['dc:creator'] ?? '')).replace(/\\[`'^"~=.]\{?([A-Za-z])\}?/g, '$1'), cat, abstract: strip(desc.replace(/^[\s\S]*?Abstract:\s*/i, '')).slice(0, 1200), date: day });
            }
        } catch {}
    }));
    const unTeX = (a: string) => a.replace(/\\[`'^"~=.]\{?([A-Za-z])\}?/g, '$1').replace(/&#39;/g, "'");
    kept = kept.filter(k => now - k.date < EDITION_WINDOW).map(k => ({ ...k, authors: unTeX(k.authors) }));
    try { await mkdir('.cache', { recursive: true }); await writeFile(file, JSON.stringify(kept)); } catch {}

    // Match each paper to the Roadmap topic it's closest to, within the tracks its category covers.
    const { roadmap } = await getReading();
    const topics = [...roadmap.topics.values()];
    const vecs = await embed(kept.map(p => `${p.title}. ${p.abstract.slice(0, 600)}`));
    const scored: Paper[] = kept.map((p, i) => {
        let best: Topic | undefined, sim = 0;
        const v = vecs?.[i];
        if (v) for (const t of topics) {
            if (!CATS[p.cat].tracks.includes(t.track)) continue;
            const tv = roadmap.topicVec.get(t.id);
            if (!tv) continue;
            const s = cosine(v, tv);
            if (s > sim) { sim = s; best = t; }
        }
        return { ...p, topic: sim >= 0.4 ? best : undefined, sim };
    });
    // Best matches first, at most 3 per category so one busy field doesn't take over.
    const per = new Map<string, number>();
    const picks = scored.filter(p => p.topic).sort((a, b) => b.sim - a.sim).filter(p => {
        const n = per.get(p.cat) ?? 0;
        if (n >= 3) return false;
        per.set(p.cat, n + 1); return true;
    });
    return { picks: picks.slice(0, 12), seen: kept.length, cats: CATS };
}

// ---------------------------------------------------------------- standards radar
// What changed in the systems underneath your code, last 24 hours: new RFCs (RFC Editor), Linux kernel
// releases (kernel.org), and release announcements from PostgreSQL, Python, Rust, Node.js and Kubernetes.
export interface Standard { kind: 'RFC' | 'Kernel' | 'Release'; title: string; url: string; date: number; who: string }
const STD_FEEDS: [string, string, RegExp][] = [
    ['PostgreSQL', 'https://www.postgresql.org/news.rss', /released|release/i],
    ['Python', 'https://blog.python.org/feeds/posts/default', /python \d|release/i],
    ['Rust', 'https://blog.rust-lang.org/feed.xml', /announcing rust|rust \d/i],
    ['Node.js', 'https://nodejs.org/en/feed/blog.xml', /node(\.js)? v?\d|release/i],
    ['Kubernetes', 'https://kubernetes.io/feed.xml', /kubernetes v?\d\.\d+|release/i],
];
async function standards(now: number): Promise<Standard[]> {
    const out: Standard[] = [];
    const xml = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_', isArray: n => ['item', 'entry', 'link'].includes(n) });
    const items = (x: any) => x?.rss?.channel?.item ?? x?.feed?.entry ?? x?.['rdf:RDF']?.item ?? [];
    const link = (i: any) => typeof i.link?.[0] === 'string' ? i.link[0] : i.link?.find?.((l: any) => !l['@_rel'] || l['@_rel'] === 'alternate')?.['@_href'] ?? i.link?.[0]?.['@_href'] ?? '';
    await Promise.all([
        get('https://www.rfc-editor.org/rfcrss.xml').then(r => r.text()).then(t => { for (const i of items(xml.parse(t))) {
            const date = +new Date(i.pubDate ?? i['dc:date']); if (now - date < EDITION_WINDOW + DAY) out.push({ kind: 'RFC', title: strip(String(i.title)), url: link(i), date, who: 'RFC Editor' });
        } }),
        get('https://www.kernel.org/releases.json').then(r => r.json()).then((d: any) => { for (const r of d.releases ?? []) {
            const date = +new Date(r.released?.isodate); if (now - date < DATE_ONLY_WINDOW) out.push({ kind: 'Kernel', title: `Linux ${r.version} (${r.moniker})`, url: r.changelog || 'https://www.kernel.org/', date, who: 'kernel.org' });
        } }),
        ...STD_FEEDS.map(([who, url, re]) => get(url).then(r => r.text()).then(t => { for (const i of items(xml.parse(t)).slice(0, 15)) {
            const title = strip(String(i.title?.['#text'] ?? i.title)); const date = +new Date(i.pubDate ?? i.published ?? i.updated);
            if (re.test(title) && now - date < EDITION_WINDOW) out.push({ kind: 'Release', title, url: link(i), date, who });
        } })),
    ].map(p => p.catch(e => console.warn('[briefing] standards:', (e as Error).message))));
    return out.sort((a, b) => b.date - a.date);
}

// ---------------------------------------------------------------- talk radar
// New conference talks in the last 24 hours, from the conferences' own YouTube channels (public RSS). Shorts skipped.
export interface Talk { title: string; url: string; date: number; who: string }
const TALK_CHANNELS: [string, string][] = [
    ['USENIX', 'UC4-GrpQBx6WCGwmwozP744Q'], ['CppCon', 'UCMlGfpWw-RUdWX_JbLCukXg'], ['PyData', 'UCOjD18EJYcsBog4IozkF_7w'],
    ['InfoQ', 'UCkQX1tChV7Z7l1LFF4L9j_g'], ['GOTO', 'UCs_tLP3AiwYKwdUHpltJPuA'], ['NDC', 'UCTdw38Cw6jcm0atBPA39a0Q'],
    ['Papers We Love', 'UCoj4eQh_dZR37lL78ymC6XA'], ['CMU Database Group', 'UCHnBsf2rH-K7pn09rb3qvkA'], ['Jane Street', 'UCDsVC_ewpcEW_AQcO-H-RDQ'],
    ['Black Hat', 'UCJ6q9Ie29ajGqKApbLqfBOg'], ['DEF CON', 'UC6Om9kAkl32dWlDSNlDS9Iw'], ['Computerphile', 'UC9-y-6csu5WGm29I7JiwpnA'],
];
async function talks(now: number): Promise<Talk[]> {
    const xml = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_', isArray: n => n === 'entry' });
    const out: Talk[] = [];
    await Promise.all(TALK_CHANNELS.map(([who, id]) => get(`https://www.youtube.com/feeds/videos.xml?channel_id=${id}`).then(r => r.text()).then(t => {
        for (const e of xml.parse(t)?.feed?.entry ?? []) {
            const url = e.link?.['@_href'] ?? `https://www.youtube.com/watch?v=${e['yt:videoId']}`, title = strip(String(e.title)), date = +new Date(e.published);
            if (now - date < EDITION_WINDOW && !/\/shorts\/|#shorts/i.test(`${url} ${title}`)) out.push({ title, url, date, who });
        }
    }).catch(err => console.warn(`[briefing] talks ${who}:`, (err as Error).message))));
    return out.sort((a, b) => b.date - a.date);
}

// ---------------------------------------------------------------- paper → code
// For each paper in the drop, its implementation on GitHub if one exists: repos whose README or description
// mention the arXiv id (GitHub search API). Lists and digests that mention hundreds of papers are skipped.
// Cached per paper; a paper with no code is checked again after 2 days.
async function paperCode(picks: Paper[], now: number) {
    const file = '.cache/paper-code.json';
    let cache: Record<string, { at: number; repo?: string; stars?: number }> = {};
    try { cache = JSON.parse(await readFile(file, 'utf8')); } catch {}
    const headers: Record<string, string> = { Accept: 'application/vnd.github+json', 'User-Agent': 'reading-room-build', ...(process.env.GITHUB_TOKEN ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}) };
    for (const p of picks) {
        const id = p.id.replace(/v\d+$/, '');
        const c = cache[id];
        if (!c || (!c.repo && now - c.at > 2 * DAY)) {
            try {
                const r = await fetch(`https://api.github.com/search/repositories?q=${encodeURIComponent(`"${id}" in:readme,description`)}&sort=stars&per_page=10`, { headers, signal: AbortSignal.timeout(15_000) });
                if (!r.ok) throw new Error(`HTTP ${r.status}`);
                const d: any = await r.json();
                const repo = (d.items ?? []).find((x: any) => !/awesome|papers?[-_ ]?(list|reading|daily|digest)|reading[-_]list|arxiv[-_]?(daily|digest|sanity)|daily[-_]?papers/i.test(`${x.full_name} ${x.description ?? ''}`));
                cache[id] = { at: now, repo: repo?.full_name, stars: repo?.stargazers_count };
            } catch (e) { console.warn(`[briefing] paper code ${id}:`, (e as Error).message); break; } // rate limited: try again next build
        }
        if (cache[id]?.repo) (p as Paper & { code?: { repo: string; stars: number } }).code = { repo: cache[id].repo!, stars: cache[id].stars ?? 0 };
    }
    try { await mkdir('.cache', { recursive: true }); await writeFile(file, JSON.stringify(cache)); } catch {}
}

let cache: ReturnType<typeof build> | undefined;
export const getBriefing = () => (cache ??= build());
async function build() {
    const now = Date.now();
    const safe = async <T>(f: () => Promise<T>, fallback: T): Promise<T> => { try { return await f(); } catch (e) { console.warn('[briefing]', (e as Error).message); return fallback; } };
    const [life, cve, paper, std, talk] = await Promise.all([
        safe(() => lifecycles(now), { releases: [], eols: [], failed: 0, watched: 0 }),
        safe(() => cves(now), { list: [] as Cve[], total: 0 }),
        safe(() => papers(now), { picks: [] as Paper[], seen: 0, cats: CATS }),
        safe(() => standards(now), [] as Standard[]),
        safe(() => talks(now), [] as Talk[]),
    ]);
    await safe(() => paperCode(paper.picks, now), undefined);
    await safe(() => import('./skills').then(async s => { await s.paperGist(paper.picks); await s.saveSkills(); }), undefined);
    return { now, ...life, cves: cve.list, kevTotal: cve.total, papers: paper.picks, papersSeen: paper.seen, cats: CATS, standards: std, talks: talk };
}
