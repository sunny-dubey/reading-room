// "You'll learn …": one sentence per article saying concretely what a reader will understand after reading it.
// Written at build time by a LOCAL model (Qwen2.5-1.5B-Instruct, 4-bit ONNX, via transformers.js, the same library
// as the embeddings). No API, no keys, nothing leaves the build. The model downloads once into .cache/models
// (~1.7 GB, kept by the Actions cache). Asked for 2026-11-25; Sunny chose local models over API keys.
// Each article is written once and cached by link in .cache/learn.json; each build writes for at most TIME_BUDGET,
// most important first, so a big backlog is caught up over the next editions instead of slowing one build.
// The sentence starts with a fixed "You'll learn" (the model only completes it); unfinished or odd output is dropped,
// and the card keeps the rule-based "What you'll get" line.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { FeedItem } from './feeds';

const MODEL = 'onnx-community/Qwen2.5-1.5B-Instruct';
const CACHE = '.cache/learn.json';
const TIME_BUDGET = 6 * 60e3;   // writing time per build
const PREFIX = "You'll learn";

let loaded: Promise<{ tok: any; model: any } | null> | undefined;
const load = () => (loaded ??= (async () => {
    try {
        const { AutoTokenizer, AutoModelForCausalLM, env } = await import('@huggingface/transformers');
        env.cacheDir = join(process.cwd(), '.cache', 'models');
        const t0 = Date.now();
        const [tok, model] = await Promise.all([AutoTokenizer.from_pretrained(MODEL), AutoModelForCausalLM.from_pretrained(MODEL, { dtype: 'q4' })]);
        console.log(`[learn] ${MODEL} ready in ${Math.round((Date.now() - t0) / 1000)}s`);
        return { tok, model };
    } catch (e) {
        console.warn(`[learn] local model unavailable, keeping the rule-based line: ${(e as Error).message}`);
        return null;
    }
})());

const messages = (i: FeedItem) => [
    { role: 'system', content: 'You describe technical articles for an expert engineer in one precise sentence.' },
    { role: 'user', content: `Title: ${i.title}\nSource: ${i.feedTitle}\nExcerpt: ${(i.embedText ?? i.summary ?? '').slice(0, 1400)}\n\nIn one sentence of at most 25 words, what will the reader learn? Be concrete: name the technique, mechanism, trade-off or result.` },
];

/** Generate a completion of `prefix` for chat messages; returns the first finished sentence, or null. */
async function complete(m: { tok: any; model: any }, msgs: { role: string; content: string }[], prefix: string): Promise<string | null> {
    const text = m.tok.apply_chat_template(msgs, { tokenize: false, add_generation_prompt: true }) + prefix;
    const inputs = m.tok(text, { add_special_tokens: false });
    const out = await m.model.generate({ ...inputs, max_new_tokens: 64, do_sample: false, repetition_penalty: 1.1 });
    const gen: string = m.tok.batch_decode(out.slice(null, [inputs.input_ids.dims[1], null]), { skip_special_tokens: true })[0];
    const sentence = (prefix + gen).replace(/\s+/g, ' ').match(/^.*?[.!?](?=\s|$)/)?.[0]?.trim();
    if (!sentence) return null;
    const words = sentence.split(' ').length;
    return words >= 8 && words <= 42 ? sentence : null;
}

/** Complete "You'll learn …" for one article; null if the output isn't a finished, sensible sentence. */
async function write(m: { tok: any; model: any }, i: FeedItem): Promise<string | null> {
    const text = m.tok.apply_chat_template(messages(i), { tokenize: false, add_generation_prompt: true }) + PREFIX;
    const inputs = m.tok(text, { add_special_tokens: false });
    const out = await m.model.generate({ ...inputs, max_new_tokens: 64, do_sample: false, repetition_penalty: 1.1 });
    const gen: string = m.tok.batch_decode(out.slice(null, [inputs.input_ids.dims[1], null]), { skip_special_tokens: true })[0];
    const sentence = (PREFIX + gen).replace(/\s+/g, ' ').match(/^.*?[.!?](?=\s|$)/)?.[0]?.trim();
    if (!sentence) return null;                                        // ran out of tokens mid-sentence
    const words = sentence.split(' ').length;
    if (words < 8 || words > 40) return null;                         // too thin to help, or rambling
    if (/\b(this article|the article|the excerpt|the author)\b/i.test(sentence)) return null; // talks about the text, not the subject
    return sentence.replace(/^You'll/, 'You’ll');
}

/** Attach `learn` to the given items (most important first): from the cache, then new sentences within the time budget. */
export async function addLearn(items: FeedItem[]) {
    let cache: Record<string, string | null> = {};
    try { cache = JSON.parse(await readFile(CACHE, 'utf8')); } catch {}
    for (const i of items) if (cache[i.link]) i.learn = cache[i.link]!;
    const todo = [...new Map(items.filter(i => !(i.link in cache) && (i.embedText || i.summary)).map(i => [i.link, i])).values()];
    if (!todo.length) return;
    const m = await load();
    if (!m) return;
    const start = Date.now();
    let written = 0, dropped = 0;
    for (const i of todo) {
        if (Date.now() - start > TIME_BUDGET) break;                  // the rest waits for the next edition
        try { const s = await write(m, i); cache[i.link] = s; if (s) { i.learn = s; written++; } else dropped++; }
        catch (e) { console.warn(`[learn] ${(e as Error).message}`); break; }
    }
    console.log(`[learn] ${written} new sentences, ${dropped} dropped, ${todo.length - written - dropped} left for the next edition (${Math.round((Date.now() - start) / 1000)}s)`);
    try { await mkdir('.cache', { recursive: true }); await writeFile(CACHE, JSON.stringify(cache)); } catch {}
}

// ---------------------------------------------------------------- research papers: the gist and why it matters
// arXiv abstracts are written for specialists. For each paper the local model writes two plain sentences from the
// abstract: what it does ("In plain words, …") and what it changes ("Why it matters: …"). Cached per paper in
// .cache/paper-gist.json; its own time budget so papers never starve the article sentences.
export interface PaperGist { gist: string; impact: string }
const PAPER_CACHE = '.cache/paper-gist.json';
const PAPER_BUDGET = 4 * 60e3;
const paperMsgs = (title: string, abstract: string, ask: string) => [
    { role: 'system', content: 'You explain research papers to a smart engineer who is not a specialist in the field. Plain words, no jargon, no hype; never invent results that the abstract does not state.' },
    { role: 'user', content: `Paper: ${title}\nAbstract: ${abstract.slice(0, 1500)}\n\n${ask}` },
];

/** Attach `paper` ({gist, impact}) to research papers, from the cache or the local model within the time budget. */
export async function addPaperGists<T extends { link?: string; url?: string; title: string; abstract?: string; summary?: string; embedText?: string; paper?: PaperGist }>(papers: T[]) {
    let cache: Record<string, PaperGist | null> = {};
    try { cache = JSON.parse(await readFile(PAPER_CACHE, 'utf8')); } catch {}
    const id = (p: T) => (p.link ?? p.url ?? '').replace(/v\d+$/, '').replace(/^http:/, 'https:');
    for (const p of papers) if (cache[id(p)]) p.paper = cache[id(p)]!;
    const todo = papers.filter(p => !(id(p) in cache));
    if (!todo.length) return;
    const m = await load();
    if (!m) return;
    const start = Date.now();
    let written = 0;
    for (const p of todo) {
        if (Date.now() - start > PAPER_BUDGET) break;
        const abstract = (p.abstract ?? p.embedText ?? p.summary ?? '').replace(/^.*?Abstract:\s*/i, '');
        if (abstract.length < 200) { cache[id(p)] = null; continue; }
        try {
            const gist = await complete(m, paperMsgs(p.title, abstract, 'In one plain sentence of at most 30 words: what does this paper do or find?'), 'In plain words, this paper');
            const impact = gist && await complete(m, paperMsgs(p.title, abstract, 'In one plain sentence of at most 30 words: why does it matter, and who would use it?'), 'Why it matters:');
            cache[id(p)] = gist && impact ? { gist: gist.replace(/^In plain words, this paper/, 'This paper'), impact: impact.replace(/^Why it matters:\s*/, '').replace(/^./, c => c.toUpperCase()) } : null;
            if (cache[id(p)]) { p.paper = cache[id(p)]!; written++; }
        } catch (e) { console.warn(`[learn] paper: ${(e as Error).message}`); break; }
    }
    console.log(`[learn] ${written} paper gists (${Math.round((Date.now() - start) / 1000)}s)`);
    try { await mkdir('.cache', { recursive: true }); await writeFile(PAPER_CACHE, JSON.stringify(cache)); } catch {}
}

