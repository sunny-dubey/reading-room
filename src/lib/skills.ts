// The local model's skills: small, defined jobs, each with its own prompt, a fixed start to the answer (the model
// only completes it), a format check, a cache per model, and a rule-based fallback when the model can't answer.
// All share one time budget per build (llm.ts); they run in the order the edition needs them.
//
//   1. substance   Substance or hype? Front-page candidates judged hype are kept off the front page.
//   2. approach    Startups worth approaching: why it fits an engineering career, and what to mention.
//   3. learn       "You'll learn …": what a reader will understand after an article.
//   4. check       "Check yourself": one question that tests what you took from a deep read.
//   5. paperGist   Research papers: "In plain words, this paper …" and "Why it matters: …".
//   6. digest      The edition in one page (/digest/): 2–3 sentences per part, grounded in its listed items.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import type { FeedItem } from './feeds';
import { complete, firstSentence, MODEL_KEY, timeLeft, type Msg } from './llm';

// ---------------------------------------------------------------- cache per skill and model
const caches = new Map<string, Record<string, any>>();
// Sentences written before the skills existed (Qwen2.5-1.5B on CI) live in the old files: carry them over.
const LEGACY: Record<string, string> = { learn: '.cache/learn.json', paper: '.cache/paper-gist.json' };
async function cache(skill: string) {
    if (caches.has(skill)) return caches.get(skill)!;
    const file = `.cache/skills/${skill}.${MODEL_KEY}.json`;
    let c: Record<string, any> = {};
    try { c = JSON.parse(await readFile(file, 'utf8')); }
    catch { if (MODEL_KEY.includes('qwen2.5-1.5b') && LEGACY[skill] && existsSync(LEGACY[skill])) try { c = JSON.parse(await readFile(LEGACY[skill], 'utf8')); } catch {} }
    caches.set(skill, c);
    return c;
}
/** Write every skill cache (call once at the end of a build step). */
export async function saveSkills() {
    await mkdir('.cache/skills', { recursive: true }).catch(() => {});
    for (const [skill, c] of caches) await writeFile(`.cache/skills/${skill}.${MODEL_KEY}.json`, JSON.stringify(c)).catch(() => {});
}
/** Run `fn` for each key not yet cached, while the shared budget lasts; returns the cache. */
async function run<T>(skill: string, keys: string[], fn: (key: string, n: number) => Promise<T | null>) {
    const c = await cache(skill);
    let n = 0, made = 0;
    for (const k of [...new Set(keys)]) {
        if (k in c) continue;
        if (timeLeft() <= 0) break;
        try { const v = await fn(k, n++); if (timeLeft() <= 0 && v === null) break; c[k] = v; if (v) made++; }
        catch (e) { console.warn(`[skills] ${skill}: ${(e as Error).message}`); break; }
    }
    if (n) console.log(`[skills] ${skill}: ${made} new of ${n} tried`);
    return c;
}
const excerpt = (i: FeedItem, n = 1400) => (i.embedText ?? i.summary ?? '').slice(0, n);

// ---------------------------------------------------------------- 1. substance or hype
const SUBSTANCE_SYS = 'You are a strict editor for an engineer who wants to learn, not to be marketed to.';
/** True = hype (keep it off the front page). Rule-based items that already look substantive are not asked. */
export async function substance(items: FeedItem[]) {
    const ask = items.filter(i => (i.brief?.worth ?? 0) < 4.5);
    const c = await run<'hype' | 'ok'>('substance', ask.map(i => i.link), async link => {
        const i = ask.find(x => x.link === link)!;
        const out = await complete([{ role: 'system', content: SUBSTANCE_SYS }, { role: 'user', content: `Title: ${i.title}\nSource: ${i.feedTitle}\nExcerpt: ${excerpt(i, 1000)}\n\nDoes this piece teach something concrete (a mechanism, data, a technique, a real experience), or is it hype (a product announcement, a listicle, vague trend talk, promotion)? Answer with one word: SUBSTANCE or HYPE.` }], 'Answer:', 4);
        return out ? (/HYPE/i.test(out) ? 'hype' : /SUBSTANCE/i.test(out) ? 'ok' : null) : null;
    });
    return new Set(items.filter(i => c[i.link] === 'hype').map(i => i.link));
}

// ---------------------------------------------------------------- 2. approach a startup
export interface Approach { why: string; mention: string }
/** For a startup worth approaching: why it fits an engineering career, and what to mention when reaching out. */
export async function approach(cands: { key: string; name: string; signal: string; text: string }[]) {
    const c = await run<Approach>('approach', cands.map(x => x.key), async key => {
        const x = cands.find(y => y.key === key)!;
        const msgs: Msg[] = [{ role: 'system', content: 'You are a candid career coach for software engineers (backend, infrastructure, distributed systems, AI engineering). Concrete, no fluff, never invent facts about the company.' },
            { role: 'user', content: `Startup: ${x.name}\nSignal: ${x.signal}\nWhat we know: ${x.text.slice(0, 900)}\n\nIn one sentence: why could this be a good place for a backend or infrastructure engineer to grow?` }];
        const why = firstSentence(await complete(msgs, 'It could be a good fit because', 60), 8, 40);
        if (!why) return null;
        const mention = firstSentence(await complete([msgs[0], { role: 'user', content: `${msgs[1].content.split('\n\n')[0]}\n\nIn one sentence: what should an engineer mention when reaching out to them?` }], 'Mention', 60), 6, 40);
        return mention ? { why: why.replace(/^It could be a good fit because\s*/, '').replace(/^./, s => s.toUpperCase()), mention } : null;
    });
    return c as Record<string, Approach | null>;
}

// ---------------------------------------------------------------- 3. you'll learn
export async function learn(items: FeedItem[]) {
    const ask = items.filter(i => i.embedText || i.summary);
    const c = await run<string>('learn', ask.map(i => i.link), async link => {
        const i = ask.find(x => x.link === link)!;
        const s = firstSentence(await complete([{ role: 'system', content: 'You describe technical articles for an expert engineer in one precise sentence.' },
            { role: 'user', content: `Title: ${i.title}\nSource: ${i.feedTitle}\nExcerpt: ${excerpt(i)}\n\nIn one sentence of at most 25 words, what will the reader learn? Be concrete: name the technique, mechanism, trade-off or result.` }], "You'll learn"), 8, 40);
        return s && !/\b(this article|the article|the excerpt|the author)\b/i.test(s) ? s.replace(/^You'll/, 'You’ll') : null;
    });
    for (const i of items) if (c[i.link]) i.learn = c[i.link];
}

// ---------------------------------------------------------------- 4. check yourself
export async function check(items: FeedItem[]) {
    const c = await run<string>('check', items.map(i => i.link), async link => {
        const i = items.find(x => x.link === link)!;
        const out = await complete([{ role: 'system', content: 'You write one good exam question for an engineer who has just read an article.' },
            { role: 'user', content: `Title: ${i.title}\nExcerpt: ${excerpt(i)}\n\nWrite one question, answerable from the article, that checks real understanding (why or how, not trivia). At most 25 words.` }], 'Question:', 50);
        const q = out?.replace(/^Question:\s*/, '').match(/^[^?]{10,200}\?/)?.[0];
        return q ?? null;
    });
    for (const i of items) if (c[i.link]) i.check = c[i.link];
}

// ---------------------------------------------------------------- 5. research papers in plain words
export interface PaperGist { gist: string; impact: string }
const paperMsgs = (title: string, abstract: string, ask: string): Msg[] => [
    { role: 'system', content: 'You explain research papers to a smart engineer who is not a specialist in the field. Plain words, no jargon, no hype; never invent results that the abstract does not state.' },
    { role: 'user', content: `Paper: ${title}\nAbstract: ${abstract.slice(0, 1500)}\n\n${ask}` },
];
export async function paperGist<T extends { link?: string; url?: string; title: string; abstract?: string; summary?: string; embedText?: string; paper?: PaperGist }>(papers: T[]) {
    const id = (p: T) => (p.link ?? p.url ?? '').replace(/v\d+$/, '').replace(/^http:/, 'https:');
    const c = await run<PaperGist>('paper', papers.map(id), async key => {
        const p = papers.find(x => id(x) === key)!;
        const abstract = (p.abstract ?? p.embedText ?? p.summary ?? '').replace(/^.*?Abstract:\s*/i, '');
        if (abstract.length < 200) return null;
        const gist = firstSentence(await complete(paperMsgs(p.title, abstract, 'In one plain sentence of at most 30 words: what does this paper do or find?'), 'In plain words, this paper'));
        const impact = gist && firstSentence(await complete(paperMsgs(p.title, abstract, 'In one plain sentence of at most 30 words: why does it matter, and who would use it?'), 'Why it matters:'));
        return gist && impact ? { gist: gist.replace(/^In plain words, this paper/, 'This paper'), impact: impact.replace(/^Why it matters:\s*/, '').replace(/^./, s => s.toUpperCase()) } : null;
    });
    for (const p of papers) if (c[id(p)]) p.paper = c[id(p)];
}

// ---------------------------------------------------------------- 6. edition digest
// The whole edition on one page (/digest/): for each part, 2–3 sentences on what's happening, written from that
// part's own items (titles plus their "You'll learn" / plain-words lines). A paragraph must name at least one of
// the items, or it's replaced with a plain list; the items are always listed under it, so every claim is checkable.
export interface DigestItem { title: string; note?: string }
export async function digest(day: string, part: string, items: DigestItem[]): Promise<string | null> {
    if (items.length < 2) return null;
    const key = `${day}|${part}|${items.map(i => i.title).join('|').slice(0, 400)}`;
    const c = await run<string>('digest', [key], async () => {
        const list = items.slice(0, 8).map((i, k) => `${k + 1}. ${i.title}${i.note ? ` (${i.note})` : ''}`).join('\n');
        const out = await complete([{ role: 'system', content: 'You write a daily digest for a curious software engineer. Plain, specific, calm; no hype, no clichés, no invented facts.' },
            { role: 'user', content: `Part of today's edition: ${part}\nItems:\n${list}\n\nIn two or three sentences, tell the reader what is happening in this part today and what is worth their attention. Refer to items by name. Use only the information given.` }], `In ${part} today,`, 130);
        if (!out) return null;
        const text = out.match(/[^.!?]+[.!?]/g)?.slice(0, 3).join(' ').trim() ?? '';
        const named = items.some(i => text.toLowerCase().includes(i.title.toLowerCase().split(/\s+/).slice(0, 3).join(' ')));
        return text.split(' ').length <= 95 && named && !/\bas an ai\b/i.test(text) ? text : null;
    });
    return c[key] ?? null;
}
