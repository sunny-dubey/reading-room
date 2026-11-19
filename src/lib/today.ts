// Build-time picks for the Today page beyond the plan: question of the day, rabbit holes, two takes,
// quick reads (15-minute plan), explainer of the day, and a link → topic map for the reading stats.
import { getCollection, type CollectionEntry } from 'astro:content';
import { readFile } from 'node:fs/promises';
import { parse } from 'yaml';
import type { FeedItem } from './feeds';
import { getReading, rank } from './reading';
import type { Topic } from './roadmap';

const DAY = 864e5;
const IST = 5.5 * 3600e3;

export interface Question { q: string; hint?: string; topic?: Topic; canon?: CollectionEntry<'canon'>; read?: FeedItem }
export interface Step { kind: 'article' | 'canon'; title: string; url: string; meta: string; minutes: number }
export interface RabbitHole { topic: Topic; steps: Step[] }
export interface Explainer { title: string; author: string; url: string; track: string; minutes: number; why: string }

const yamlList = async <T>(path: string): Promise<T[]> => {
    try { return parse(await readFile(path, 'utf8')) ?? []; } catch { return []; }
};

let cache: ReturnType<typeof build> | undefined;
export const getToday = () => (cache ??= build());

async function build() {
    const r = await getReading();
    const { learning, now, roadmap } = r;
    const { topics, itemsByTopic, canonByTopic } = roadmap;
    const dayIndex = Math.floor((now + IST) / DAY); // the build's date in IST
    const byRank = (a: FeedItem, b: FeedItem) => rank(b, now) - rank(a, now);
    const recentFor = (id: string, days = 60) =>
        (itemsByTopic.get(id) ?? []).filter(i => now - +i.date < days * DAY && (i.brief?.worth ?? 0) >= 3).sort(byRank);
    const canonMeta = (c: CollectionEntry<'canon'>) => `${c.data.author} · ${c.data.kind} · ${c.data.minutes >= 90 ? `${Math.round(c.data.minutes / 60)} h` : `${c.data.minutes} min`}`;
    const artMeta = (i: FeedItem) => `${i.feedTitle}${i.brief?.minutes ? ` · ${i.brief.minutes} min` : ''}`;

    // ---------- Question of the day ----------
    const qs = await yamlList<{ q: string; topic?: string; hint?: string }>('src/content/questions.yaml');
    const questions: Question[] = qs.map(x => {
        const topic = x.topic ? topics.get(x.topic) : undefined;
        if (x.topic && !topic) console.warn(`[questions] unknown topic "${x.topic}"`);
        return { q: x.q, hint: x.hint, topic, canon: topic ? canonByTopic.get(topic.id)?.[0] : undefined, read: topic ? recentFor(topic.id, 120)[0] : undefined };
    });
    const question = questions.length ? questions[dayIndex % questions.length] : undefined;

    // ---------- Rabbit holes: one topic, easy → deep, mixing a fresh post with the Canon ----------
    const holes: RabbitHole[] = [];
    for (const [id, cs] of canonByTopic) {
        const topic = topics.get(id);
        const arts = recentFor(id);
        if (!topic || !arts.length) continue;
        const start = [...arts].sort((a, b) => (a.brief?.minutes ?? 99) - (b.brief?.minutes ?? 99))[0];
        const canonSorted = [...cs].sort((a, b) => a.data.minutes - b.data.minutes);
        const steps: Step[] = [{ kind: 'article', title: start.title, url: start.link, meta: artMeta(start), minutes: start.brief?.minutes ?? 10 }];
        for (const c of canonSorted.slice(0, 2)) steps.push({ kind: 'canon', title: c.data.title, url: c.data.url, meta: canonMeta(c), minutes: c.data.minutes });
        if (steps.length < 3) {
            const deeper = arts.filter(a => a !== start).sort((a, b) => (b.brief?.minutes ?? 0) - (a.brief?.minutes ?? 0))[0];
            if (deeper) steps.splice(1, 0, { kind: 'article', title: deeper.title, url: deeper.link, meta: artMeta(deeper), minutes: deeper.brief?.minutes ?? 15 });
        }
        if (steps.length >= 3) holes.push({ topic, steps: steps.slice(0, 3) });
    }
    // Best first: topics with the strongest fresh read; the page rotates through them daily.
    const best = (h: RabbitHole) => Math.max(...recentFor(h.topic.id).map(i => rank(i, now)));
    holes.sort((a, b) => best(b) - best(a));
    const rabbitHoles = holes.slice(0, 10);

    // ---------- Two takes: two recent posts on the same topic, from different authors ----------
    let twoTakes: { topic: Topic; a: FeedItem; b: FeedItem } | undefined;
    const shown = new Set([...r.fresh, ...r.picks, ...(r.deepCands ?? [])].map(i => i.link));
    let bestScore = -Infinity;
    for (const [id] of itemsByTopic) {
        const topic = topics.get(id);
        const pool = recentFor(id, 45).filter(i => !shown.has(i.link) && i.category !== 'postmortems');
        const a = pool[0];
        const b = pool.find(i => i.feedId !== a?.feedId);
        // Skip broad, non-technical areas (fundamentals overviews, craft & judgment): two takes should argue a technical idea.
        if (!topic || !a || !b || [2, 25, 31].includes(topic.areaN)) continue;
        const score = rank(a, now) + rank(b, now);
        if (score > bestScore) { bestScore = score; twoTakes = { topic, a, b }; }
    }

    // ---------- Quick reads, for the 15-minute plan ----------
    const quickCands = learning
        .filter(i => now - +i.date < 10 * DAY && (i.brief?.minutes ?? 0) >= 3 && (i.brief?.minutes ?? 99) <= 12 && (i.brief?.worth ?? 0) >= 3 && i.category !== 'postmortems')
        .sort(byRank).slice(0, 6);

    // ---------- Explainer of the day ----------
    const explainers = await yamlList<Explainer>('src/content/explainers.yaml');
    const explainer = explainers.length ? explainers[dayIndex % explainers.length] : undefined;

    // ---------- Link → [minutes, topic index, track] for "Your reading" and "Your week" (client side) ----------
    const topicNames: string[] = [];
    const tIdx = new Map<string, number>();
    const idx = (t?: Topic) => {
        if (!t) return -1;
        if (!tIdx.has(t.id)) { tIdx.set(t.id, topicNames.length); topicNames.push(t.name); }
        return tIdx.get(t.id)!;
    };
    const links: Record<string, [number, number, string]> = {};
    for (const i of learning) links[i.link] = [i.brief?.minutes ?? 0, idx(i.skill?.topic), i.category];
    const canon = await getCollection('canon');
    const canonTopic = new Map<string, Topic>();
    for (const [id, cs] of canonByTopic) for (const c of cs) if (!canonTopic.has(c.id)) canonTopic.set(c.id, topics.get(id)!);
    for (const c of canon) {
        links[c.data.url] ??= [Math.min(c.data.minutes, 60), idx(canonTopic.get(c.id)), c.data.track];
        (c.data.parts ?? []).forEach(p => { if (p.url) links[p.url] ??= [p.minutes, idx(canonTopic.get(c.id)), c.data.track]; });
    }

    const { CATEGORIES } = await import('./feeds');
    const tracks = Object.fromEntries(CATEGORIES.map(c => [c.id, c.short]));
    return { question, rabbitHoles, twoTakes, quickCands, explainer, readMap: { topics: topicNames, tracks, links } };
}
