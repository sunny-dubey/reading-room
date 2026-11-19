// Puzzles from around the web, as LINKS: we fetch only titles and URLs at build time and send readers
// to the original page. Nothing is copied, every item is credited to its source, and "solved" ticks
// live in the reader's browser (localStorage `web:solved`). Last good fetch is cached in .cache/web-puzzles.json.
import { readFile, writeFile, mkdir } from 'node:fs/promises';

export interface WebPuzzle { id: string; source: string; title: string; url: string }
export interface WebSource {
    id: string; name: string; credit: string; kind: string; home: string; about: string; cadence: string;
    items: WebPuzzle[]; ok: boolean;
}

const UA = { 'User-Agent': 'Mozilla/5.0 (compatible; reading-room puzzle links)' };
const text = async (url: string) => {
    const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(20_000) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.text();
};

/** GitHub's heading anchors (github-slugger): lowercase, drop punctuation and symbols, spaces → hyphens, de-duplicate. */
function slugger() {
    const seen = new Map<string, number>();
    return (heading: string) => {
        const plain = heading.replace(/`([^`]*)`/g, '$1').replace(/\\(.)/g, '$1').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/<[^>]+>/g, '');
        const base = plain.toLowerCase().replace(/[^\p{L}\p{M}\p{N}\p{Pc}\- ]/gu, '').replace(/ /g, '-');
        const n = seen.get(base) ?? 0;
        seen.set(base, n + 1);
        return n ? `${base}-${n}` : base;
    };
}

/** Every heading in a README, with its anchor, in order (anchors depend on all headings, for de-duplication). */
function headings(md: string) {
    const slug = slugger();
    const out: { level: number; text: string; anchor: string }[] = [];
    let inCode = false;
    for (const line of md.split('\n')) {
        if (/^```/.test(line)) { inCode = !inCode; continue; }
        const m = !inCode && line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
        if (m) out.push({ level: m[1].length, text: m[2], anchor: slug(m[2]) });
    }
    return out;
}

type Def = Omit<WebSource, 'items' | 'ok'> & { load: () => Promise<WebPuzzle[]> };
const DEFS: Def[] = [
    {
        id: 'js-questions', name: 'JavaScript Questions', credit: 'Lydia Hallie', kind: 'What does it print? (JavaScript)', cadence: 'a growing set',
        home: 'https://github.com/lydiahallie/javascript-questions',
        about: 'Short JavaScript snippets: predict the output, then read the explanation.',
        load: async () => {
            const md = await text('https://raw.githubusercontent.com/lydiahallie/javascript-questions/master/README.md');
            return headings(md).filter(h => h.level === 6 && /^\d+\.\s/.test(h.text)).map(h => {
                const [, n, t] = h.text.match(/^(\d+)\.\s+(.*)$/)!;
                return { id: `js-${n}`, source: 'js-questions', title: `Question ${n}: ${t.replace(/`/g, '')}`, url: `https://github.com/lydiahallie/javascript-questions#${h.anchor}` };
            });
        },
    },
    {
        id: 'wtfpython', name: 'What the f*ck Python!', credit: 'Satwik Kansal', kind: 'Python gotcha', cadence: 'a fixed set',
        home: 'https://github.com/satwikkansal/wtfpython',
        about: 'Surprising Python behaviour: guess what happens, then read why.',
        load: async () => {
            const md = await text('https://raw.githubusercontent.com/satwikkansal/wtfpython/master/README.md');
            return headings(md).filter(h => h.level === 3 && h.text.startsWith('▶')).map((h, i) => ({
                id: `wtf-${h.anchor}`, source: 'wtfpython', title: h.text.replace(/^▶\s*/, '').replace(/\\\*/g, '').replace(/`/g, '').replace(/\s*\*\s*$/, '').trim(),
                url: `https://github.com/satwikkansal/wtfpython#${h.anchor}`,
            }));
        },
    },
    {
        id: 'sdp', name: 'The System Design Primer', credit: 'Donne Martin', kind: 'System design', cadence: 'a fixed set',
        home: 'https://github.com/donnemartin/system-design-primer#system-design-interview-questions-with-solutions',
        about: 'Design questions with worked solutions. Sketch your own design first, then compare.',
        load: async () => {
            const md = await text('https://raw.githubusercontent.com/donnemartin/system-design-primer/master/README.md');
            return [...md.matchAll(/^\|\s*(Design [^|]+?)\s*\|\s*\[Solution\]\(([^)]+)\)/gm)].map(m => ({
                id: `sdp-${m[2]}`, source: 'sdp', title: m[1].trim(), url: `https://github.com/donnemartin/system-design-primer/blob/master/${m[2]}`,
            }));
        },
    },
    {
        id: 'euler', name: 'Project Euler', credit: 'Project Euler', kind: 'Maths + programming', cadence: 'new problems every week or two',
        home: 'https://projecteuler.net/archives',
        about: 'Mathematical problems you solve with code. These are the newest; the archive goes back over a thousand.',
        load: async () => {
            const xml = await text('https://projecteuler.net/rss2_euler.xml');
            return [...xml.matchAll(/<item>[\s\S]*?<title>([^<]+)<\/title>[\s\S]*?<link>([^<]+)<\/link>/g)].map(m => ({
                id: `euler-${m[2].split('=').pop()}`, source: 'euler', title: m[1].trim(), url: m[2].trim(),
            }));
        },
    },
    {
        id: 'monthly', name: 'Monthly puzzles', credit: 'Jane Street, IBM Research', kind: 'This month', cadence: 'monthly',
        home: 'https://www.janestreet.com/puzzles/current-puzzle/',
        about: 'Two long-running monthly puzzles. Hard, satisfying, and with published solutions.',
        load: async () => [
            { id: 'jane-street', source: 'monthly', title: "Jane Street's puzzle of the month", url: 'https://www.janestreet.com/puzzles/current-puzzle/' },
            { id: 'ponder-this', source: 'monthly', title: "IBM Research's Ponder This", url: 'https://research.ibm.com/haifa/ponderthis/index.shtml' },
        ],
    },
    {
        id: 'more', name: 'Worth a session', credit: 'Various', kind: 'Practice sets', cadence: 'fixed',
        home: 'https://deadlockempire.github.io/',
        about: 'Bigger sets to work through over a few sittings.',
        load: async () => [
            { id: 'deadlock-empire', source: 'more', title: 'The Deadlock Empire: break concurrent code by playing the scheduler', url: 'https://deadlockempire.github.io/' },
            { id: 'mit-6824-exams', source: 'more', title: 'MIT 6.824 Distributed Systems: past exams with answers', url: 'https://ocw.mit.edu/courses/6-824-distributed-computer-systems-engineering-spring-2006/pages/exams/' },
            { id: 'advent-of-code', source: 'more', title: 'Advent of Code: 25 puzzles every December', url: 'https://adventofcode.com/' },
        ],
    },
];

let cache: Promise<WebSource[]> | undefined;
export const getWebPuzzles = () => (cache ??= build());
async function build(): Promise<WebSource[]> {
    const file = '.cache/web-puzzles.json';
    let prev: Record<string, WebPuzzle[]> = {};
    try { prev = JSON.parse(await readFile(file, 'utf8')); } catch {}
    const sources = await Promise.all(DEFS.map(async ({ load, ...d }) => {
        try {
            const items = await load();
            if (!items.length) throw new Error('no items');
            return { ...d, items, ok: true };
        } catch (e) {
            console.warn(`[web-puzzles] ${d.id}: ${(e as Error).message}; using the last good list`);
            return { ...d, items: prev[d.id] ?? [], ok: false };
        }
    }));
    try {
        await mkdir('.cache', { recursive: true });
        await writeFile(file, JSON.stringify(Object.fromEntries(sources.filter(s => s.items.length).map(s => [s.id, s.items]))));
    } catch {}
    return sources;
}

/** Today's picks: one from each rotating source, chosen by the edition's date (IST). */
export function todaysPicks(sources: WebSource[], now: number) {
    const day = Math.floor((now + 5.5 * 3600e3) / 864e5);
    const week = Math.floor((day + 3) / 7);
    const by = (id: string) => sources.find(s => s.id === id);
    const pick = (id: string, n: number) => { const s = by(id); return s?.items.length ? { source: s, item: s.items[n % s.items.length] } : undefined; };
    return [
        pick('js-questions', day * 7),     // stride so neighbouring days aren't neighbouring questions
        pick('wtfpython', day * 5),
        pick('sdp', week),                 // design problems change weekly
        pick('euler', 0),                  // the newest Project Euler problem
        pick('monthly', week),             // alternate Jane Street / Ponder This each week
    ].filter(Boolean) as { source: WebSource; item: WebPuzzle }[];
}
