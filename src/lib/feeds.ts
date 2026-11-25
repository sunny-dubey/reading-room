import { getCollection } from 'astro:content';
import { XMLParser } from 'fast-xml-parser';
import { makeBrief, mapLimit, type Brief } from './summarize';

export interface FeedItem {
    feedId: string;
    feedTitle: string;
    category: string;
    title: string;
    link: string;
    date: Date;
    summary: string;
    embedText?: string;  // title + start of article, for topic matching
    weight?: number;     // source-level ranking nudge from feeds.yaml
    bigtech?: boolean;   // from a big tech company's engineering blog (feeds.yaml `bigtech: true`)
    movedFrom?: string;  // original desk when the article was moved to the desk its topic belongs to (roadmap.ts)
    skill?: import('./roadmap').SkillMatch; // closest Roadmap topic (build time)
    meta?: { description?: string; image?: string; thumb?: string }; // the article's own description and preview thumbnail
    classic?: { id: string; title: string; url: string; author: string; sim: number }; // closest Canon read (Old meets new)
    brief?: Brief;       // build-time summary (learning tracks only)
    learn?: string;      // "You'll learn …": one sentence from the local model (learn.ts)
    paper?: import('./skills').PaperGist; // research papers: plain-words gist and why it matters (skills.ts)
    check?: string;      // "Check yourself": one question about a deep read (skills.ts)
    hype?: boolean;      // judged hype by the substance skill: kept off the front page
    content?: string;    // full feed HTML, used for summarising then dropped
    comments?: string;   // discussion link (Hacker News)
    points?: number;
}

export const CATEGORIES = [
    { id: 'research', slug: 'research', label: 'CS Research', short: 'Research', blurb: 'Algorithms, theory, performance and the papers behind tomorrow\'s systems' },
    { id: 'systems', slug: 'systems', label: 'Distributed Systems & Databases', short: 'Systems & DBs', blurb: 'Consensus, replication, consistency, storage engines, Postgres internals' },
    { id: 'backend', slug: 'architecture', label: 'System Design & Architecture', short: 'System Design', blurb: 'Designing systems at scale: architecture, trade-offs, reliability patterns, APIs' },
    { id: 'swe', slug: 'software-engineering', label: 'Software Engineering', short: 'Software Eng', blurb: 'The craft of building software: design, testing, debugging, performance, compilers, languages and tools' },
    { id: 'ai-eng', slug: 'ai-engineering', label: 'Agentic AI & AI Engineering', short: 'Agentic AI', blurb: 'Agents, evals, retrieval, tool use and LLMs in production' },
    { id: 'ml', slug: 'foundations', label: 'ML & LLM Foundations', short: 'ML Foundations', blurb: 'How transformers, training, fine-tuning and inference actually work' },
    { id: 'security', slug: 'security', label: 'Security', short: 'Security', blurb: 'How attacks work and how to build systems that survive them: web, crypto, cloud, detection' },
    { id: 'hft', slug: 'hft', label: 'HFT & Low-Latency Engineering', short: 'HFT tech', blurb: 'Trading systems where microseconds matter: CPU caches, kernel bypass, lock-free queues, exchanges and market microstructure' },
    { id: 'quant', slug: 'quant', label: 'Quantitative Finance', short: 'Quant', blurb: 'Markets as systems: probability, pricing, risk, microstructure and the engineering behind trading' },
    { id: 'macro', slug: 'macro', label: 'Macro & Markets', short: 'Macro', blurb: 'Central banks, inflation, growth, jobs and trade, from the data and the people who produce it' },
    { id: 'math', slug: 'math', label: 'Applied Mathematics', short: 'Applied Maths', blurb: 'Probability, optimisation, numerical methods and the maths behind systems, ML and markets' },
    { id: 'postmortems', slug: 'postmortems', label: 'Postmortems', short: 'Postmortems', blurb: 'Real failures, explained. The fastest way to learn how systems break' },
] as const;
export const PULSE = { id: 'pulse', slug: 'pulse', label: 'Pulse', short: 'Pulse', blurb: "The week's headlines, in one short page" };
export const STARTUPS = { id: 'startups', slug: 'startups', label: 'Startups', short: 'Startups', blurb: 'What the best new companies are building' };
/** Side pages that aren't learning tracks: no summaries, not on Today. */
export const BUSINESS = { id: 'business', slug: 'business', label: 'Business & Economy', short: 'Business', blurb: 'The last 24 hours of business, markets and economic news from the outlets that break it' };
export const SIDE = new Set(['pulse', 'startups', 'business']);
export const categoryLabel = (id: string) => CATEGORIES.find(c => c.id === id)?.label ?? (id === 'pulse' ? PULSE.label : id === 'startups' ? STARTUPS.label : id === 'business' ? BUSINESS.label : id);
export const categoryShort = (id: string) => CATEGORIES.find(c => c.id === id)?.short ?? (id === 'pulse' ? PULSE.short : id);

export interface FeedStatus {
    id: string;
    title: string;
    url: string;
    site?: string;
    category: string;
    ok: boolean;
    count: number;
    error?: string;
}

const TIMEOUT_MS = 15_000;

const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    textNodeName: '#text',
    isArray: name => ['item', 'entry', 'link'].includes(name),
});

const arr = <T>(x: T | T[] | undefined): T[] => (x == null ? [] : Array.isArray(x) ? x : [x]);

const text = (x: unknown): string => {
    if (x == null) return '';
    if (typeof x === 'string' || typeof x === 'number') return String(x);
    if (typeof x === 'object' && '#text' in (x as any)) return String((x as any)['#text']);
    return '';
};

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', hellip: '…', mdash: '—', ndash: '–', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“' };
const decode = (s: string) =>
    s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) =>
        e[0] === '#'
            ? String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10))
            : ENTITIES[e.toLowerCase()] ?? m);

// Inline LaTeX (arXiv titles and abstracts) → readable text: $T\subseteq V$ → T ⊆ V, $2^n$ → 2ⁿ, $O(n\log n)$ → O(n log n).
const TEX: Record<string, string> = {
    subseteq: '⊆', subset: '⊂', supseteq: '⊇', in: '∈', notin: '∉', cup: '∪', cap: '∩', setminus: '∖', emptyset: '∅',
    le: '≤', leq: '≤', ge: '≥', geq: '≥', neq: '≠', ne: '≠', approx: '≈', sim: '∼', equiv: '≡', ll: '≪', gg: '≫',
    times: '×', cdot: '·', pm: '±', infty: '∞', to: '→', rightarrow: '→', leftarrow: '←', mapsto: '↦', Rightarrow: '⇒', iff: '⇔',
    forall: '∀', exists: '∃', neg: '¬', land: '∧', lor: '∨', sum: 'Σ', prod: 'Π', partial: '∂', nabla: '∇', ldots: '…', dots: '…', cdots: '⋯',
    alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ε', varepsilon: 'ε', zeta: 'ζ', eta: 'η', theta: 'θ', kappa: 'κ', lambda: 'λ',
    mu: 'μ', nu: 'ν', xi: 'ξ', pi: 'π', rho: 'ρ', sigma: 'σ', tau: 'τ', phi: 'φ', varphi: 'φ', chi: 'χ', psi: 'ψ', omega: 'ω',
    Gamma: 'Γ', Delta: 'Δ', Theta: 'Θ', Lambda: 'Λ', Sigma: 'Σ', Phi: 'Φ', Psi: 'Ψ', Omega: 'Ω', log: 'log', ln: 'ln', exp: 'exp', max: 'max', min: 'min',
};
const SUP: Record<string, string> = { 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹', n: 'ⁿ', i: 'ⁱ', k: 'ᵏ', d: 'ᵈ', m: 'ᵐ', t: 'ᵗ', x: 'ˣ', j: 'ʲ', r: 'ʳ', s: 'ˢ', p: 'ᵖ', a: 'ᵃ', b: 'ᵇ', c: 'ᶜ', e: 'ᵉ', '+': '⁺', '-': '⁻', '*': '*', T: 'ᵀ' };
const SUB: Record<string, string> = { 0: '₀', 1: '₁', 2: '₂', 3: '₃', 4: '₄', 5: '₅', 6: '₆', 7: '₇', 8: '₈', 9: '₉', i: 'ᵢ', j: 'ⱼ', k: 'ₖ', n: 'ₙ', a: 'ₐ', e: 'ₑ', o: 'ₒ', x: 'ₓ', m: 'ₘ', t: 'ₜ', p: 'ₚ', s: 'ₛ', l: 'ₗ', h: 'ₕ', r: 'ᵣ', u: 'ᵤ', v: 'ᵥ', '+': '₊', '-': '₋' };
const script = (s: string, map: Record<string, string>, mark: string) => [...s].every(c => map[c]) ? [...s].map(c => map[c]).join('') : `${mark}${s.length > 1 ? `(${s})` : s}`;
const GREEK = /^[α-ωΑ-Ωε]$/;
const grp = (x: string) => /^[\w.]+$/.test(x) ? x : `(${x})`;
export const delatex = (s: string) => !/\$|\\[a-zA-Z]/.test(s) ? s : s.replace(/\$\$?([^$]{1,120})\$\$?/g, (all, m: string) => /^\d[\d,.]*(\s|$)/.test(m) ? all : m // "$5 and $10" is money, not maths
    .replace(/\\(?:mathcal|mathbb|mathrm|mathbf|mathsf|text|textbf|textit|operatorname|widetilde|tilde|hat|bar|overline)\{([^{}]*)\}/g, (__, x: string) => x === 'R' && /mathbb/.test(__) ? 'ℝ' : x === 'N' && /mathbb/.test(__) ? 'ℕ' : x === 'Z' && /mathbb/.test(__) ? 'ℤ' : x)
    .replace(/\\sqrt\{([^{}]*)\}/g, (__, x: string) => `√${grp(x)}`).replace(/\\frac\{([^{}]*)\}\{([^{}]*)\}/g, (__, a: string, b: string) => `${grp(a)}/${grp(b)}`)
    // Operators and function names get spaces around them (T ⊆ V, n log n); Greek letters don't.
    .replace(/\\([a-zA-Z]+)/g, (__, c: string) => { const t = TEX[c] ?? c; return GREEK.test(t) ? t : ` ${t} `; }).replace(/\\([{}%&_#,;!])/g, (__, c: string) => /[,;!]/.test(c) ? ' ' : c)
    .replace(/\^\{([^{}]*)\}|\^(\w)/g, (__, a?: string, b?: string) => script(a ?? b!, SUP, '^'))
    .replace(/_\{([^{}]*)\}|_(\w)/g, (__, a?: string, b?: string) => script(a ?? b!, SUB, '_'))
    .replace(/[{}]/g, '').replace(/\s+/g, ' ').replace(/\( /g, '(').replace(/ \)/g, ')').trim());

const clean = (html: string, max = 220) => {
    const s = delatex(decode(decode(html).replace(/<[^>]*>/g, ' '))).replace(/\s+/g, ' ').trim();
    return s.length > max ? s.slice(0, max).replace(/\s+\S*$/, '') + '…' : s;
};

function atomLink(links: any[]): string {
    const alt = links.find(l => typeof l === 'object' && (!l['@_rel'] || l['@_rel'] === 'alternate'));
    const l = alt ?? links[0];
    return typeof l === 'string' ? l : l?.['@_href'] ?? '';
}

type Parsed = Omit<FeedItem, 'feedId' | 'feedTitle' | 'category'> & { tags?: string[] };

function parseFeed(xml: string): Parsed[] {
    const doc = parser.parse(xml);
    if (doc.rss?.channel || doc['rdf:RDF']) {
        const items = arr(doc.rss?.channel?.item ?? doc['rdf:RDF']?.item);
        return items.map((i: any) => {
            const raw = text(i.description) || text(i['content:encoded']);
            const base = {
                title: clean(text(i.title), 200),
                link: text(arr(i.link)[0]) || text(i.guid),
                date: new Date(text(i.pubDate) || text(i['dc:date'])),
                summary: clean(raw),
                content: text(i['content:encoded']) || raw,
                tags: arr(i.category).map((c: any) => text(c).trim()).filter(Boolean),
            };
            // lobste.rs: description is only a comments link.
            if (/^Comments$/.test(base.summary)) return { ...base, summary: '', comments: text(i.comments) || undefined };
            // hnrss: description is just "Article URL / Comments URL / Points" boilerplate.
            const hn = raw.match(/Comments URL:\s*<a href="([^"]+)"/) ?? raw.match(/Comments URL:\s*(\S+)/);
            if (hn) {
                const pts = raw.match(/Points:\s*(\d+)/);
                return { ...base, summary: '', comments: decode(hn[1]), points: pts ? Number(pts[1]) : undefined };
            }
            return base;
        });
    }
    if (doc.feed) {
        return arr(doc.feed.entry).map((e: any) => ({
            title: clean(text(e.title), 200),
            link: atomLink(arr(e.link)),
            date: new Date(text(e.published) || text(e.updated)),
            summary: clean(text(e.summary) || text(e.content)),
            content: text(e.content) || text(e.summary),
        }));
    }
    throw new Error('not an RSS or Atom feed');
}

async function load(): Promise<{ items: FeedItem[]; status: FeedStatus[]; fetchedAt: Date }> {
    const feeds = await getCollection('feeds');

    const results = await Promise.all(feeds.map(async ({ id, data }) => {
        const base: FeedStatus = { id, title: data.title, url: data.url, site: data.site, category: data.category, ok: false, count: 0 };
        const cutoff = Date.now() - data.maxAgeDays * 864e5;
        try {
            const res = await fetch(data.url, {
                signal: AbortSignal.timeout(TIMEOUT_MS),
                headers: { 'User-Agent': 'reading-room feed reader (+https://sunny-dubey.github.io/reading-room/)', Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.5' },
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const items = parseFeed(await res.text())
                .filter(i => i.link && i.title && !isNaN(+i.date) && +i.date >= cutoff && +i.date <= Date.now() + 864e5)
                .filter(i => !data.onlyTags || (i.tags ?? []).some(t => data.onlyTags!.includes(t)))
                .filter(i => !data.skipTitles || !new RegExp(data.skipTitles, 'i').test(i.title))
                .sort((a, b) => +b.date - +a.date)
                .slice(0, data.limit)
                .map(({ tags, ...i }) => ({ ...i, feedId: id, feedTitle: data.title, category: data.category, weight: data.weight, bigtech: data.bigtech || undefined }));
            return { status: { ...base, ok: true, count: items.length }, items };
        } catch (err) {
            const error = err instanceof Error ? err.message : String(err);
            console.warn(`[feeds] ${id}: ${error}`);
            return { status: { ...base, error }, items: [] as FeedItem[] };
        }
    }));

    // Summarise learning items at build time (cached on disk), then drop raw HTML.
    // Drop duplicate links (the same post can appear in two feeds).
    const seenLinks = new Set<string>();
    const all = results.flatMap(r => r.items).filter(i => !seenLinks.has(i.link) && !!seenLinks.add(i.link));
    const learning = all.filter(i => !SIDE.has(i.category));
    const started = Date.now();
    await mapLimit(learning, 8, async i => {
        try {
            const b = await makeBrief(i);
            i.embedText = `${i.title}. ${b.text || i.summary}`.slice(0, 1400);
            delete b.text;
            i.brief = b;
        } catch (err) { console.warn(`[brief] ${i.link}: ${err}`); }
    });
    for (const i of all) delete i.content;
    console.log(`[brief] summarised ${learning.length} articles in ${((Date.now() - started) / 1000).toFixed(1)}s`);

    return {
        items: all.sort((a, b) => +b.date - +a.date),
        status: results.map(r => r.status),
        fetchedAt: new Date(),
    };
}

// Fetch once per build, shared by every page that asks.
let cached: ReturnType<typeof load> | undefined;
export const getFeeds = () => (cached ??= load());
