// Matches articles, Canon items, notes and saved links to Roadmap topics by meaning.
import { getCollection, type CollectionEntry } from 'astro:content';
import type { FeedItem } from './feeds';
import { embed, cosine } from './embed';
import { getNotes, getLibrary } from './content';
import { getProgress } from './progress';
import { readFile } from 'node:fs/promises';
import { parse } from 'yaml';

export interface Topic {
    id: string;
    name: string;
    group?: string;
    why: string;
    areaId: string;
    areaTitle: string;
    areaN: number;
    track: string;
}

export interface SkillMatch {
    topic: Topic;
    sim: number;
    boost: number;      // added to the article's rank
}

// Similarity thresholds for all-MiniLM-L6-v2 (normalised vectors).
const MATCH = 0.42;     // article ↔ topic: strong enough to claim "you'll get better at X"
const COVER = 0.40;     // note/saved ↔ topic: counts as coverage of the topic

// Which roadmap areas an article may match, by the track of its source. Keeps "voting" in a maths
// essay from matching Leader Election, while letting a queueing post match Queueing Theory.
const ALLOWED: Record<string, string[]> = {
    systems: ['systems', 'backend', 'math'],
    backend: ['backend', 'systems', 'math'],
    postmortems: ['backend', 'systems'],
    'ai-eng': ['ai-eng', 'ml', 'backend'],
    ml: ['ml', 'ai-eng', 'math'],
    math: ['math', 'ml'],
};

let cached: ReturnType<typeof build> | undefined;
/** Build the topic index once per build. Pass the learning articles; they get `.skill` attached. */
export const getRoadmap = (articles: FeedItem[]) => (cached ??= build(articles));

async function build(articles: FeedItem[]) {
    const areas = (await getCollection('roadmap')).sort((a, b) => a.data.n - b.data.n);

    // Unique topics (a topic listed in several areas keeps its first area as home).
    const topics = new Map<string, Topic>();
    const text = new Map<string, string>();
    for (const a of areas) for (const t of a.data.topics) {
        if (topics.has(t.id)) continue;
        topics.set(t.id, { id: t.id, name: t.name, group: t.group, why: t.why ?? a.data.why, areaId: a.id, areaTitle: a.data.title, areaN: a.data.n, track: a.data.track });
        text.set(t.id, `${a.data.title}${t.group ? ` > ${t.group}` : ''} > ${t.name}. ${t.about ?? ''}`.trim());
    }
    const topicList = [...topics.values()];
    const [canon, notes, library] = await Promise.all([getCollection('canon'), getNotes(), getLibrary()]);

    const all = await embed([
        ...topicList.map(t => text.get(t.id)!),
        ...articles.map(i => i.embedText ?? i.title),
        ...canon.map(c => `${c.data.title}. ${c.data.why}`),
        ...notes.map(n => `${n.data.title}. ${(n.body ?? '').slice(0, 1200)}`),
        ...library.map(l => `${l.data.title}. ${l.data.why}`),
    ]);

    const empty = { areas, topics, enabled: false, itemsByTopic: new Map<string, FeedItem[]>(), canonByTopic: new Map<string, CollectionEntry<'canon'>[]>(), notesByTopic: new Map<string, number>(), savedByTopic: new Map<string, number>() };
    if (!all) return empty;

    let k = 0;
    const tv = topicList.map(() => all[k++]);
    const av = articles.map(() => all[k++]);
    const cv = canon.map(() => all[k++]);
    const nv = notes.map(() => all[k++]);
    const lv = library.map(() => all[k++]);

    const best = (v: number[], n = 1, tracks?: string[]) =>
        topicList.map((t, idx) => ({ t, sim: cosine(v, tv[idx]) }))
            .filter(m => !tracks || tracks.includes(m.t.track))
            .sort((a, b) => b.sim - a.sim).slice(0, n);

    // Coverage: what you've written about or saved.
    const notesByTopic = new Map<string, number>();
    const savedByTopic = new Map<string, number>();
    for (const v of nv) for (const m of best(v, 2)) if (m.sim >= COVER) notesByTopic.set(m.t.id, (notesByTopic.get(m.t.id) ?? 0) + 1);
    for (const v of lv) for (const m of best(v, 2)) if (m.sim >= COVER) savedByTopic.set(m.t.id, (savedByTopic.get(m.t.id) ?? 0) + 1);

    // Canon reads per topic.
    const canonByTopic = new Map<string, CollectionEntry<'canon'>[]>();
    canon.forEach((c, idx) => {
        const [first, second] = best(cv[idx], 2);
        for (const m of [first, second]) if (m && m.sim >= (m === first ? MATCH - 0.04 : MATCH + 0.03)) {
            if (!canonByTopic.has(m.t.id)) canonByTopic.set(m.t.id, []);
            canonByTopic.get(m.t.id)!.push(c);
        }
    });

    // Progress from the repo: learned topics and finished Canon reads count as covered.
    const progress = await getProgress();
    const learned = new Set(progress.learned);
    const canonDoneTopics = new Map<string, number>();
    for (const [tid, cs] of canonByTopic) {
        const n = cs.filter(c => progress.canon.includes(c.id)).length;
        if (n) canonDoneTopics.set(tid, n);
    }

    // Manual overrides (src/content/overrides.yaml): pin a topic for a URL, or "none".
    let overrides = new Map<string, string>();
    try {
        const list = parse(await readFile('src/content/overrides.yaml', 'utf8')) ?? [];
        overrides = new Map(list.filter((o: any) => o?.url && o?.topic).map((o: any) => [o.url, String(o.topic)]));
    } catch {}

    // Articles: closest topic, with a boost that favours topics you haven't covered yet.
    const itemsByTopic = new Map<string, FeedItem[]>();
    articles.forEach((i, idx) => {
        const pinned = overrides.get(i.link);
        if (pinned === 'none') return;
        const [top] = pinned && topics.has(pinned)
            ? [{ t: topics.get(pinned)!, sim: 1 }]
            : best(av[idx], 1, ALLOWED[i.category]);
        // Maths posts use different vocabulary from topic names, so they get a slightly lower bar.
        const bar = i.category === 'math' ? MATCH - 0.03 : MATCH;
        if (!top || top.sim < bar) return;
        const covered = learned.has(top.t.id) ? 3
            : (notesByTopic.get(top.t.id) ?? 0) + (savedByTopic.get(top.t.id) ?? 0) * 0.5 + (canonDoneTopics.get(top.t.id) ?? 0);
        const gap = covered === 0 ? 1 : covered < 3 ? 0.6 : 0.3;
        const strength = Math.min(1, (top.sim - bar) / 0.2 + 0.3);
        i.skill = { topic: top.t, sim: top.sim, boost: Math.round(1.5 * strength * gap * 100) / 100 };
        if (!itemsByTopic.has(top.t.id)) itemsByTopic.set(top.t.id, []);
        itemsByTopic.get(top.t.id)!.push(i);
    });

    return { areas, topics, enabled: true, itemsByTopic, canonByTopic, notesByTopic, savedByTopic };
}
