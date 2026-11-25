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
