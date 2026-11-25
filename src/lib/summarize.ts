// Build-time article analysis. No AI model: technical concept extraction + reading time,
// depth and worth heuristics (no summaries). Article text comes from the feed when it carries the
// full post, otherwise from fetching the page (cached on disk in .cache/articles).
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

export interface Brief {
    concepts: string[];   // technical concepts the piece covers
    minutes: number;      // reading time
    depth: 'quick' | 'article' | 'deep';
    worth: number;        // 1-5: how much it builds lasting understanding (news ≈ 1)
    fetched: boolean;     // false = only the feed's short summary was available
    text?: string;        // start of the article text, used for topic matching then dropped
    outline?: string[];   // the article's own section headings (h2/h3), up to 5: "what it covers" in the author's words
    kind: ReadKind;       // what kind of time investment it is
    level: Level;         // how hard it is to follow (rule-based, see readLevel)
}

export type Level = 'Intro' | 'Intermediate' | 'Advanced';

/** What kind of read a piece is, and what that means for your time. Rule-based from the title, the text and the source. */
export type ReadKind = 'howto' | 'deep' | 'case' | 'postmortem' | 'paper' | 'benchmark' | 'analysis' | 'opinion' | 'news' | 'roundup' | 'long' | 'article' | 'short';
export const KIND: Record<ReadKind, { label: string; intent: string }> = {
    howto: { label: 'How-to', intent: 'Hands-on: you can follow along and apply it.' },
    deep: { label: 'Deep dive', intent: 'How it works inside, step by step.' },
    case: { label: 'Case study', intent: 'A real team’s decisions and their trade-offs.' },
    postmortem: { label: 'Postmortem', intent: 'How a real system failed and what fixed it.' },
    paper: { label: 'Paper', intent: 'A new research result: read the abstract first.' },
    benchmark: { label: 'Benchmark', intent: 'Measurements you can reuse in your own estimates.' },
    analysis: { label: 'Analysis', intent: 'Findings and data from someone who looked closely.' },
    // Nothing in the title says what kind it is: label by length only, and claim nothing more.
    long: { label: 'Long read', intent: 'Set aside real time; it goes far into the subject.' },
    article: { label: 'Article', intent: '' },
    short: { label: 'Short read', intent: 'A few minutes.' },
    opinion: { label: 'Opinion', intent: 'An argument, not a recipe: read for perspective.' },
    news: { label: 'News', intent: 'What changed: skim it.' },
    roundup: { label: 'Roundup', intent: 'A list of links: skim for the one you need.' },
};

const CACHE_DIR = join(process.cwd(), '.cache', 'articles');
const CACHE_DAYS = 30;
const UA = 'Mozilla/5.0 (compatible; reading-room/1.0; +https://sunny-dubey.github.io/reading-room/)';

// ---------------------------------------------------------------- text extraction
const ENT: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', hellip: '…', mdash: '—', ndash: '–', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“' };
const decode = (s: string) => s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) =>
    e[0] === '#' ? String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : ENT[e.toLowerCase()] ?? m);

interface Extract { text: string; words: number; code: number; headings: number; outline?: string[] }

// Page furniture: the article is over once one of these appears.
const FURNITURE = /^(recent (comments|posts|articles)|top posts|popular (posts|articles)|related (posts|articles)|more from .*|you (may|might) also like.*|\d+ (comments?|responses?|replies)|leave a (reply|comment)|post navigation|share this.*|submission history|access paper.*|monthly briefing|categories|archives?|blogroll)$/i;
// Headings that say nothing about the content.
const GENERIC = /^(bibliographic.*|executive summary|key takeaways|share (this|on).*|post navigation|navigation|menu|sidebar|meta|blogroll|links|archive|install(ation)?|prerequisites|getting started|introduction|intro|conclusions?|summary|tl;?dr|references|footnotes|notes|comments?|related( posts| articles)?|share( this)?|subscribe|table of contents|contents|acknowledge?ments|about( the)? authors?|further reading|wrapping up|final thoughts|closing thoughts|thanks|appendix|faq|what'?s next\??|next steps|resources|recent posts|categories|tags|archives?|search|newsletter|follow us|leave a (reply|comment)|you (may|might) also like.*|more from.*|popular.*)$/i;

/** Section headings worth showing: tidy, de-duplicated, generic ones dropped, and the list cut at the first
 *  piece of page furniture ("Recent comments", "Top posts"), since sidebars and footers follow the article. */
export function cleanOutline(raw: string[] = [], max = 5) {
    const seen = new Set<string>(), out: string[] = [];
    for (const r of raw) {
        const t = r.replace(/\s+/g, ' ').replace(/^(\d+[.)]|step \d+:?)\s*/i, '').replace(/[:.]$/, '').trim();
        if (FURNITURE.test(t)) break;
        if (t.length < 3 || t.length > 80 || GENERIC.test(t) || seen.has(t.toLowerCase())) continue;
        seen.add(t.toLowerCase()); out.push(t);
        if (out.length >= max) break;
    }
    return out;
}

export function extractText(html: string): Extract {
    let h = html.replace(/<!--[\s\S]*?-->/g, ' ');
    // Prefer the main article region when the page marks one.
    const region = h.match(/<article[\s\S]*?<\/article>/i)?.[0] ?? h.match(/<main[\s\S]*?<\/main>/i)?.[0];
    if (region && region.length > 1500) h = region;
    const code = (h.match(/<pre[\s>]/gi) ?? []).length;
    const headings = (h.match(/<h[23][\s>]/gi) ?? []).length;
    const outline = cleanOutline([...h.matchAll(/<h[23][^>]*>([\s\S]*?)<\/h[23]>/gi)].map(m => decode(m[1].replace(/<[^>]+>/g, ' '))), 12);
    h = h.replace(/<(script|style|noscript|svg|nav|header|footer|aside|form|figure|button|iframe|pre)[\s\S]*?<\/\1>/gi, ' ');
    h = h.replace(/<\/(p|div|li|h[1-6]|blockquote|tr|section)>/gi, '\n').replace(/<br\s*\/?>/gi, '\n');
    const text = decode(h.replace(/<[^>]+>/g, ' ')).replace(/[ \t\r\f\v]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim();
    return { text, words: text.split(/\s+/).filter(Boolean).length, code, headings, outline };
}

async function fetchArticle(url: string): Promise<Extract | null> {
    if (/youtube\.com|youtu\.be|\.pdf($|\?)/i.test(url)) return null;
    const file = join(CACHE_DIR, createHash('sha1').update(url).digest('hex') + '.json');
    if (existsSync(file)) {
        try {
            const c = JSON.parse(await readFile(file, 'utf8'));
            // Entries cached before section headings were kept (no `outline`) are fetched once more.
            if (Date.now() - c.at < CACHE_DAYS * 864e5 && (c.data === null || c.data.outline !== undefined)) return c.data;
        } catch {}
    }
    let data: Extract | null = null;
    try {
        const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'text/html' }, signal: AbortSignal.timeout(15_000), redirect: 'follow' });
        const type = res.headers.get('content-type') ?? '';
        if (res.ok && type.includes('html')) data = extractText((await res.text()).slice(0, 3_000_000));
    } catch {}
    try {
        await mkdir(CACHE_DIR, { recursive: true });
        // Cache failures too (as null) so a blocked site isn't retried on every build.
        await writeFile(file, JSON.stringify({ at: Date.now(), url, data: data && { ...data, text: data.text.slice(0, 60_000) } }));
    } catch {}
    return data;
}

// ---------------------------------------------------------------- concepts
// Technical vocabulary for concept extraction. Order doesn't matter; label is what's shown.
const VOCAB: [RegExp, string][] = ([
    // distributed systems & databases
    ['consensus'], ['raft'], ['paxos'], ['replication'], ['leader election'], ['quorum'], ['sharding', 'shard(s|ing)?'], ['partitioning', 'partition(s|ing)?'],
    ['consistency models', 'linearizab\\w+|serializab\\w+|eventual consistency|strong consistency|causal consistency'], ['isolation levels', 'isolation level(s)?|snapshot isolation|read committed|repeatable read'],
    ['transactions', 'transaction(s|al)?'], ['mvcc'], ['write-ahead log', 'write-ahead log|\\bwal\\b'], ['b-tree', 'b-?trees?'], ['lsm tree', 'lsm[- ]trees?|log-structured merge'],
    ['indexes', 'indexes|indices|index scans?|create index|indexed|secondary index'], ['query planner', 'query plan(ner)?|explain analyze'], ['postgres', 'postgres(ql)?'], ['mysql'], ['sqlite'], ['vacuum'],
    ['clocks', 'logical clocks?|vector clocks?|lamport clock|clock skew'], ['crdt', 'crdts?'], ['cap theorem', 'cap theorem'], ['two-phase commit', 'two-phase commit|2pc'],
    ['formal methods', 'tla\\+|formal (methods|verification)|model checking'], ['storage engines', 'storage engines?'], ['fsync', 'fsync'],
    // backend, apis, reliability
    ['idempotency', 'idempoten\\w+'], ['retries', 'retr(y|ies)|backoff|jitter'], ['rate limiting', 'rate[- ]limit\\w*'], ['load shedding', 'load shedding'],
    ['backpressure', 'back-?pressure'], ['circuit breakers', 'circuit breakers?'], ['queues', 'message queues?|job queues?|\\bqueues?\\b'], ['kafka'], ['redis'],
    ['caching', 'cach(e|es|ing)'], ['latency', 'latenc(y|ies)|p99|tail latency'], ['throughput'], ['observability', 'observability|tracing|opentelemetry'],
    ['api design', 'api design|rest(ful)? api|grpc|graphql'], ['webhooks', 'webhooks?'], ['payments', 'payments?|ledger|reconciliation|double-entry'],
    ['migrations', 'schema migrations?|online migrations?|zero-downtime'], ['microservices', 'microservices?'], ['kubernetes', 'kubernetes|\\bk8s\\b'],
    ['concurrency', 'concurren\\w+|race conditions?|deadlocks?|locks?\\b|mutex'], ['networking', 'tcp|bgp|dns|http/2|http/3|quic'],
    ['incident response', 'incident|post-?mortem|root cause|outage'], ['autoscaling', 'autoscal\\w+'], ['security', 'authentication|authorization|oauth|encryption|tls'],
    // security
    ['sql injection', 'sql injection|sqli'], ['xss', 'xss|cross-site scripting'], ['csrf', 'csrf|cross-site request forgery'], ['ssrf', 'ssrf|server-side request forgery'],
    ['rce', 'remote code execution|\\brce\\b'], ['privilege escalation', 'privilege escalation|privesc'], ['memory safety', 'memory safety|buffer overflows?|use-after-free|memory corruption'],
    ['exploits', 'exploit(s|ation|ed)?'], ['vulnerabilities', 'vulnerabilit(y|ies)|\\bcves?\\b|cve-\\d{4}-\\d+'], ['fuzzing', 'fuzz(ing|ers?)'], ['malware', 'malware|ransomware|trojans?|backdoors?'],
    ['cryptography', 'cryptograph\\w+|cipher(s|text)?|aes|rsa|elliptic curves?|signatures?'], ['pki', 'pki|certificate authorit(y|ies)|x\\.509'], ['threat detection', 'detection engineering|siem|edr|threat hunting'],
    ['forensics', 'forensics?|dfir'], ['reverse engineering', 'reverse engineer\\w*|disassembl\\w+|decompil\\w+'], ['zero trust', 'zero trust|beyondcorp'],
    ['supply chain security', 'supply[- ]chain (attacks?|security)|sbom|dependency confusion'], ['iam', '\\biam\\b|identity and access management'], ['prompt injection', 'prompt injection|jailbreaks?'],
    ['threat actors', 'threat actors?|apts?\\b|lateral movement|initial access'],
    // quantitative finance
    ['options', 'options? pricing|call options?|put options?|black[- ]scholes'], ['volatility', 'volatility|vix|implied vol\\w*'], ['greeks', '\\bgreeks\\b|\\bdelta hedg\\w+|\\bgamma\\b|\\bvega\\b'],
    ['backtesting', 'backtest\\w*|overfitting|look-?ahead bias|survivorship bias'], ['sharpe ratio', 'sharpe( ratio)?'], ['factor models', 'factor (models?|investing|exposures?)|fama[- ]french'],
    ['market making', 'market[- ]mak\\w+|inventory risk'], ['order book', 'order ?books?|limit orders?|bid[- ]ask|spreads?\\b'], ['execution', 'slippage|twap|vwap|market impact|price impact'],
    ['portfolio', 'portfolio (optimi[sz]ation|construction)|risk parity|markowitz|mean[- ]variance'], ['risk', 'value at risk|\\bvar\\b|drawdowns?|tail risk'], ['momentum', 'momentum|trend[- ]following'],
    ['mean reversion', 'mean[- ]revers\\w+|pairs trading|stat(istical)? arb\\w*'], ['stochastic calculus', 'stochastic (calculus|process\\w*)|brownian motion|it[oô]\\b'],
    // ai engineering
    ['agents', 'agents?|agentic'], ['tool use', 'tool (use|calling|calls)|function calling'], ['mcp', 'model context protocol|\\bmcp\\b'], ['evals', 'evals?|evaluation(s)?'],
    ['rag', 'rag|retrieval[- ]augmented'], ['embeddings', 'embeddings?'], ['vector search', 'vector (search|database|store)s?'], ['prompting', 'prompt(s|ing)?|prompt engineering'],
    ['context engineering', 'context (window|engineering)'], ['structured outputs', 'structured outputs?|json schema'], ['guardrails', 'guardrails?'],
    ['llm observability', 'llm observability|traces? of'], ['fine-tuning', 'fine-?tun\\w+'], ['inference', 'inference'], ['open-weights models', 'open[- ]weights?'],
    // ml foundations
    ['transformers', 'transformers?'], ['attention', 'self-attention|attention (mechanism|heads?)'], ['tokenization', 'tokeniz\\w+|tokenizers?|bpe'], ['pretraining', 'pre-?train\\w*'],
    ['rlhf', 'rlhf|reinforcement learning from human feedback'], ['reinforcement learning', 'reinforcement learning|\\brl\\b|grpo|ppo'], ['lora', 'lora|low-rank adaptation'],
    ['quantization', 'quantiz\\w+'], ['kv cache', 'kv[- ]cache'], ['scaling laws', 'scaling laws?'], ['mixture of experts', 'mixture[- ]of[- ]experts|\\bmoe\\b'],
    ['distillation', 'distillation'], ['interpretability', 'interpretability|mechanistic'], ['reasoning models', 'reasoning models?|chain[- ]of[- ]thought'],
    ['gpus', 'gpus?|cuda|kernels?'],
    // software engineering
    ['testing', 'unit tests?|integration tests?|test suites?|test-driven|\\btdd\\b|snapshot tests?|flaky tests?'], ['property-based testing', 'property-based|quickcheck|hypothesis testing library|proptest'],
    ['refactoring', 'refactor\\w*|legacy code'], ['code review', 'code reviews?|pull requests?'], ['debugging', 'debugg\\w+|git bisect|\\bgdb\\b|\\blldb\\b'],
    ['type systems', 'type systems?|type checker|type inference|generics|algebraic data types?'], ['compilers', 'compilers?|interpreters?|\\bllvm\\b|\\bjit\\b|codegen|intermediate representation'],
    ['build systems', 'build systems?|bazel|incremental builds?|\\bninja\\b|cargo|dependency management'], ['memory management', 'garbage collect\\w*|allocators?|arena allocat\\w+|borrow checker|ownership'],
    ['static analysis', 'static analysis|linters?|sanitizers?'], ['software design', 'software design|abstractions?|modularity|information hiding|coupling'],
    // mathematics
    ['probability', 'probabilit(y|ies)|bayes\\w*|random variables?'], ['statistics', 'statistic(s|al)|hypothesis test\\w*|p-values?|confidence intervals?'],
    ['linear algebra', 'linear algebra|matri(x|ces)|eigen\\w+|vectors?'], ['calculus', 'calculus|derivatives?|integrals?'],
    ['optimization', 'convex|optimi[sz]ation|gradient descent'], ['queueing theory', "queue?ing theory|little'?s law|utili[sz]ation"],
    ['graph theory', 'graph theory|graphs?\\b'], ['proofs', 'proofs?|theorems?|lemmas?'], ['information theory', 'entropy|information theory'],
    ['floating point', 'floating[- ]point|ieee 754'], ['diffusion', 'diffusion models?'], ['benchmarks', 'benchmarks?'], ['synthetic data', 'synthetic data'],
] as [string, string?][]).map(([label, pat]) => [new RegExp(`\\b(${pat ?? label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})\\b`, 'gi'), label]);

function concepts(text: string, title: string, max = 5): string[] {
    const counts: [string, number][] = [];
    for (const [re, label] of VOCAB) {
        const n = (text.match(re) ?? []).length + ((title.match(re) ?? []).length * 3);
        if (n >= 2) counts.push([label, n]);
    }
    return counts.sort((a, b) => b[1] - a[1]).slice(0, max).map(([l]) => l);
}

const ANNOUNCE = /\b(announc\w*|launch(es|ed|ing)?|introduc(ing|es)|now available|generally available|release notes|what'?s new|we'?re hiring|webinar|event|conference|meetup|join us|recap|roundup|weekly|newsletter|funding|raises|acquires?|pricing|partner(s|ship)|award|podcast|episode|livestream|keynote)\b/i;

// Roundups and newsletters: long, but a list of links rather than an explanation.
// The reader wants informative, practical pieces over opinion: titles that signal a take lose worth,
// titles that signal how-it-works or how-to gain a little.
const OPINION = /\b(why (i|we|you)\b|my (take|thoughts|view)|thoughts on|in defen[cs]e of|the case (for|against)|unpopular opinion|hot take|rant\b|i think|i believe|reflections on|is (dead|overrated|over|broken)\b|stop (using|doing)|conversation with|in conversation|ask me anything|\bama\b|interview with|op-?ed|opinion|manifesto)\b/i;
const PRACTICAL = /\b(how (to|we|it works|does)|guide|tutorial|walkthrough|deep dive|explained|internals|under the hood|benchmark(s|ing)?|case study|lessons (from|learned)|post-?mortem|step[- ]by[- ]step|implement(ing|ation)|from scratch|primer|introduction to|measur(ing|ed|ement)|nowcast|data on|what the data)\b/i;
const ROUNDUP = /^\[ainews\]|^ep\d+[:\s]|\bthis week in\b|\bweekly\b|\broundup\b|\bdigest\b|\blinks? (for|of the)\b|\bissue #?\d+|\bnewsletter\b|\bthe pulse\b|\b(day \d+|days? \d+ and \d+)\)?$|\s#\d+\s*$/i;
export const isRoundup = (title: string) => ROUNDUP.test(title);

// ---------------------------------------------------------------- public API
export async function makeBrief(i: { title: string; link: string; summary: string; content?: string; category: string }): Promise<Brief> {
    // Use full text from the feed when it has it; otherwise fetch the page.
    let ex: Extract | null = null;
    if (i.content && i.content.length > 2500) ex = extractText(i.content);
    if (!ex || ex.words < 350) {
        const fetched = await fetchArticle(i.link);
        if (fetched && fetched.words > (ex?.words ?? 0)) ex = fetched;
    }
    const fetched = !!ex && ex.words >= 250;
    const text = fetched ? ex!.text : i.summary;
    const words = fetched ? ex!.words : 0;

    const found = concepts(text, i.title);
    const minutes = Math.max(1, Math.round(words / 230));
    const depth: Brief['depth'] = words > 2500 || (words > 1500 && (ex!.code >= 3 || ex!.headings >= 6)) ? 'deep' : words >= 800 ? 'article' : 'quick';

    let worth = 3;
    if (depth === 'deep') worth += 1;
    if (depth === 'quick' && fetched) worth -= 1;
    if (found.length >= 4) worth += 0.5;
    if (fetched && ex!.code >= 2) worth += 0.5;
    if (ANNOUNCE.test(i.title)) worth -= 2;
    else if (ROUNDUP.test(i.title)) worth -= 1.5;
    if (i.category === 'postmortems') worth += 0.5;
    if (OPINION.test(i.title)) worth -= 1;
    else if (PRACTICAL.test(i.title)) worth += 0.5;
    // Heavy first-person writing is usually a personal take rather than an explainer.
    if (fetched && words > 300) {
        const firstPerson = (text.match(/\b(I|I'm|I've|I'd|my)\b/g) ?? []).length / words * 1000;
        if (firstPerson > 14) worth -= 0.5;
    }
    if (!fetched) worth -= 0.5;
    // A new research paper is informative by nature even though only its abstract is visible here.
    if (/arxiv\.org\/abs\//.test(i.link)) worth = Math.max(worth, 3.5);
    worth = Math.max(1, Math.min(5, Math.round(worth * 2) / 2));

    const firstPersonHeavy = fetched && words > 300 && (text.match(/\b(I|I'm|I've|I'd|my)\b/g) ?? []).length / words * 1000 > 14;
    const kind = readKind(i, { depth, code: fetched ? ex!.code : 0, firstPersonHeavy, minutes: fetched ? minutes : 0 });
    const level = readLevel(kind, { text, words, code: fetched ? ex!.code : 0, concepts: found.length, depth });
    return { concepts: found, minutes: fetched ? minutes : 0, depth, worth, fetched, text: text.slice(0, 1200), outline: fetched && !/arxiv\.org\//.test(i.link) ? cleanOutline(ex!.outline) : undefined, kind, level };
}

/** How hard a piece is to follow, from the text itself: code, density of technical concepts, maths, the kind of read
 *  and length. Points: 0–1 Intro, 2–3 Intermediate, 4+ Advanced. */
function readLevel(kind: ReadKind, f: { text: string; words: number; code: number; concepts: number; depth: Brief['depth'] }): Level {
    let p = 0;
    if (kind === 'paper') p += 3;
    if (kind === 'deep' || kind === 'benchmark') p += 1;
    if (kind === 'news' || kind === 'opinion' || kind === 'roundup') p -= 1;
    if (f.code >= 3) p += 1;
    if (f.code >= 8) p += 1;
    if (f.concepts >= 3) p += 1;
    if (f.concepts >= 5) p += 1;
    if (f.depth === 'deep') p += 1;
    // Maths: equations, Greek letters, complexity notation per 1,000 words.
    const math = (f.text.match(/[=≤≥≈∑∫∂√∈⊆]|\b(O|Θ|Ω)\(|[α-ωΑ-Ω]|\b(theorem|lemma|proof|corollary|eigen\w*|gradient|variance|stochastic)\b/g) ?? []).length;
    if (f.words > 200 && math / f.words * 1000 > 6) p += 1;
    if (/\b(introduction to|beginner|for beginners|basics|101|getting started|what is)\b/i.test(f.text.slice(0, 300))) p -= 2;
    return p >= 4 ? 'Advanced' : p >= 2 ? 'Intermediate' : 'Intro';
}

function readKind(i: { title: string; link: string; category: string }, f: { depth: Brief['depth']; code: number; firstPersonHeavy: boolean; minutes: number }): ReadKind {
    const t = i.title;
    if (ROUNDUP.test(t)) return 'roundup';
    if (/arxiv\.org\/(abs|pdf)\//.test(i.link) || /\[pdf\]/i.test(t)) return 'paper';
    if (i.category === 'postmortems' || /\b(post-?mortem|incident (report|review)|outage|root cause)\b/i.test(t)) return 'postmortem';
    if (ANNOUNCE.test(t)) return 'news';
    if (OPINION.test(t) || f.firstPersonHeavy) return 'opinion';
    if (/\b(benchmark\w*|measur(ing|ed|ement)s?|faster than|\bvs\.?\b|versus|latency of|throughput of)\b/i.test(t)) return 'benchmark';
    if (/\b(how to|guide|tutorial|walkthrough|step[- ]by[- ]step|from scratch|build(ing)? (a|an|your)|implement(ing)?|cookbook|recipe)\b/i.test(t)) return 'howto';
    if (/\b(case study|lessons|how we|why we|migrat\w+|at scale|in production|our journey)\b/i.test(t)) return 'case';
    if (/\b(deep dive|internals|under the hood|how .{1,40} works|explained|anatomy of|inside)\b/i.test(t) || (f.depth === 'deep' && f.code >= 3)) return 'deep';
    if (/\b(trends?|report|analysis|state of|survey|tactics|findings|what the data|data (on|shows?))\b/i.test(t)) return 'analysis';
    return f.minutes >= 12 ? 'long' : f.minutes && f.minutes <= 4 ? 'short' : 'article';
}

/** Run an async mapper with limited concurrency. */
export async function mapLimit<T, R>(list: T[], limit: number, fn: (x: T) => Promise<R>): Promise<R[]> {
    const out: R[] = new Array(list.length);
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(limit, list.length) }, async () => {
        while (next < list.length) { const k = next++; out[k] = await fn(list[k]); }
    }));
    return out;
}
