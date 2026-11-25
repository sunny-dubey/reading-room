// The local language model behind the site's skills (src/lib/skills.ts). No API, no keys: transformers.js runs an
// instruction-tuned model on the CPU at build time; weights download once into .cache/models.
//   • On GitHub Actions (GITHUB_ACTIONS=true): Qwen2.5-1.5B-Instruct, 4-bit, ~1.7 GB, fast enough for the 2-CPU runner.
//   • Local builds: Qwen3-4B, 4-bit/fp16, ~2.8 GB: noticeably sharper sentences, ~25 s each on a laptop.
//   LLM_MODEL overrides either. Every skill shares one time budget per build (LLM_BUDGET_MIN, default 8 min on CI,
//   15 locally), so the build length is bounded; results are cached, so the backlog clears over the next editions.
import { join } from 'node:path';

const CI = process.env.GITHUB_ACTIONS === 'true';
export const MODEL = process.env.LLM_MODEL || (CI ? 'onnx-community/Qwen2.5-1.5B-Instruct' : 'onnx-community/Qwen3-4B-ONNX');
const DTYPE = /Qwen3/i.test(MODEL) ? 'q4f16' : 'q4';
const BUDGET = Number(process.env.LLM_BUDGET_MIN || (CI ? 8 : 15)) * 60e3;
/** Short name for cache files, so sentences from different models never mix. */
export const MODEL_KEY = MODEL.split('/').pop()!.replace(/[^a-z0-9.]+/gi, '-').toLowerCase();

let started = 0;
/** Time left in this build's shared budget (the clock starts at the first model call). */
export const timeLeft = () => (started ? BUDGET - (Date.now() - started) : BUDGET);

let loaded: Promise<{ tok: any; model: any } | null> | undefined;
export const loadModel = () => (loaded ??= (async () => {
    try {
        const { AutoTokenizer, AutoModelForCausalLM, env } = await import('@huggingface/transformers');
        env.cacheDir = join(process.cwd(), '.cache', 'models');
        const t0 = Date.now();
        const [tok, model] = await Promise.all([AutoTokenizer.from_pretrained(MODEL), AutoModelForCausalLM.from_pretrained(MODEL, { dtype: DTYPE as any })]);
        console.log(`[llm] ${MODEL} (${DTYPE}) ready in ${Math.round((Date.now() - t0) / 1000)}s; budget ${Math.round(BUDGET / 60e3)} min`);
        return { tok, model };
    } catch (e) {
        console.warn(`[llm] local model unavailable, skills fall back to rules: ${(e as Error).message}`);
        return null;
    }
})());

export interface Msg { role: 'system' | 'user'; content: string }
/** Complete `prefix` (the start of the answer, written for the model) and return the raw continuation with the
 *  prefix, or null when the model or the time budget is unavailable. */
export async function complete(msgs: Msg[], prefix: string, maxTokens = 64): Promise<string | null> {
    if (timeLeft() <= 0) return null;
    const m = await loadModel();
    if (!m) return null;
    if (!started) started = Date.now();
    // Qwen3 thinks before answering unless given an empty thought; the skills want the answer only.
    const think = /Qwen3/i.test(MODEL) ? '<think>\n\n</think>\n\n' : '';
    const text = m.tok.apply_chat_template(msgs, { tokenize: false, add_generation_prompt: true }) + think + prefix;
    const inputs = m.tok(text, { add_special_tokens: false });
    const out = await m.model.generate({ ...inputs, max_new_tokens: maxTokens, do_sample: false, repetition_penalty: 1.1 });
    const gen: string = m.tok.batch_decode(out.slice(null, [inputs.input_ids.dims[1], null]), { skip_special_tokens: true })[0];
    return (prefix + gen).replace(/<\/?think>/g, '').replace(/\s+/g, ' ').trim();
}

/** The first complete sentence of a completion, if it has a sensible length. */
export const firstSentence = (s: string | null, min = 8, max = 42) => {
    const t = s?.match(/^.*?[.!?](?=\s|$)/)?.[0]?.trim();
    const n = t ? t.split(' ').length : 0;
    return t && n >= min && n <= max ? t : null;
};
