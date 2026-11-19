// The puzzle page: daily puzzle (src/content/puzzles.yaml), numbers flash cards (numbers.yaml)
// and an incident drill built from real outages. Everything is decided at build time except
// the reader's own answers, which stay in their browser.
import { readFile } from 'node:fs/promises';
import { parse } from 'yaml';
import { getCollection } from 'astro:content';
import { getOutages, type Incident } from './outages';

export type PuzzleType = 'bug' | 'estimate' | 'scenario' | 'interleave' | 'complexity';
export const TYPE_LABEL: Record<PuzzleType, string> = { bug: 'Spot the bug', estimate: 'Back of the envelope', scenario: 'What happens next?', interleave: 'Interleavings', complexity: 'Complexity & bits' };
export interface Puzzle {
    id: string; type: PuzzleType; title: string; prompt: string;
    lang?: string; code?: string; options?: string[]; unit?: string; tolerance?: number;
    answer: number | number[]; hint?: string; explain: string; proof?: string;
    read?: string; readLink?: { title: string; href: string; external: boolean };
}
export interface NumberCard { id: string; q: string; answer: number; unit: string; tolerance?: number; how: string; source: string }

const DAY = 864e5, IST = 5.5 * 3600e3;
const yamlList = async <T>(p: string): Promise<T[]> => { try { return parse(await readFile(p, 'utf8')) ?? []; } catch { return []; } };

let cache: ReturnType<typeof build> | undefined;
export const getPuzzles = () => (cache ??= build());

async function build() {
    const [raw, numbers, canon, roadmap, outages] = await Promise.all([
        yamlList<Puzzle>('src/content/puzzles.yaml'), yamlList<NumberCard>('src/content/numbers.yaml'),
        getCollection('canon'), getCollection('roadmap'), getOutages(),
    ]);
    const topicName = new Map(roadmap.flatMap(a => a.data.topics.map(t => [t.id, t.name] as [string, string])));
    const puzzles = raw.map(p => {
        const [kind, id] = (p.read ?? '').split(':');
        let readLink: Puzzle['readLink'];
        if (kind === 'canon') { const c = canon.find(x => x.id === id); if (c) readLink = { title: c.data.title, href: c.data.url, external: true }; }
        if (kind === 'topic' && topicName.has(id)) readLink = { title: topicName.get(id)!, href: `/roadmap/#${id}`, external: false };
        if (p.read && !readLink) console.warn(`[puzzles] unknown read "${p.read}" in ${p.id}`);
        return { ...p, readLink };
    });

    // Daily order: round-robin across types, so consecutive days differ.
    const byType = new Map<string, Puzzle[]>();
    for (const p of puzzles) byType.set(p.type, [...(byType.get(p.type) ?? []), p]);
    const order: Puzzle[] = [];
    for (let i = 0; order.length < puzzles.length; i++) for (const list of byType.values()) if (list[i]) order.push(list[i]);
    const day = Math.floor((outages.now + IST) / DAY);
    const today = order.length ? order[day % order.length] : undefined;

    // Incident drill: a real, resolved incident with a story (several updates), preferably with a report.
    const drills = outages.incidents
        .filter(i => !i.ongoing && i.updates.length >= 4 && i.end)
        .sort((a, b) => (b.rca ? 1 : 0) - (a.rca ? 1 : 0) || b.updates.length - a.updates.length)
        .slice(0, 14);
    const drill: Incident | undefined = drills.length ? drills[day % drills.length] : undefined;

    return { puzzles, order, today, numbers, drill, now: outages.now };
}

/** Generic "first things to check" for an incident's opening symptom. A thinking aid, not the answer. */
export function checklist(text: string): string[] {
    const t = text.toLowerCase();
    const out: string[] = [];
    if (/error|fail|5\d\d|unavailable|outage/.test(t)) out.push('What changed recently? Deploys, config and feature flags in the last hour', 'Is a dependency failing (database, auth, DNS, an upstream API)?');
    if (/latenc|slow|delay|timeout|degraded/.test(t)) out.push('Where is the time going: queues backing up, database locks, GC pauses, saturated CPU?', 'Are retries amplifying the load?');
    if (/region|zone|us-|eu-|ap-|datacent|data center/.test(t)) out.push('Is it one region or zone? Check routing, capacity and that region\'s dependencies');
    if (/login|sign|auth|token|oauth/.test(t)) out.push('Auth path: identity provider, token signing keys, certificate expiry');
    if (/email|webhook|notification|queue|delivery/.test(t)) out.push('Is a queue or worker pool stuck? Look at backlog age and consumer health');
    if (/model|ai|llm|inference|gpu/.test(t)) out.push('Model capacity: GPU pool, rate limits, an upstream model provider');
    if (!out.length) out.push('What changed recently?', 'Which users or regions are affected, and what do they have in common?');
    out.push('How will you know it\'s fixed? Pick the metric before you act');
    return [...new Set(out)].slice(0, 5);
}
