// Local text embeddings at build time: a small model (all-MiniLM-L6-v2, ~23 MB) via transformers.js.
// No API, no key. The model downloads once into .cache/models; vectors are cached in .cache/embeddings.json.
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const MODEL = 'Xenova/all-MiniLM-L6-v2';
const CACHE_DIR = join(process.cwd(), '.cache');
const VEC_FILE = join(CACHE_DIR, 'embeddings.json');

let extractor: Promise<any> | null | undefined;
let vecCache: Map<string, number[]> | undefined;

async function getExtractor() {
    if (extractor === undefined) {
        extractor = (async () => {
            try {
                const { pipeline, env } = await import('@huggingface/transformers');
                env.cacheDir = join(CACHE_DIR, 'models');
                return await pipeline('feature-extraction', MODEL, { dtype: 'q8' });
            } catch (err) {
                console.warn(`[embed] model unavailable, ranking falls back to rules: ${err}`);
                return null;
            }
        })();
    }
    return extractor;
}

async function loadCache() {
    if (!vecCache) {
        vecCache = new Map();
        try { if (existsSync(VEC_FILE)) for (const [k, v] of Object.entries(JSON.parse(await readFile(VEC_FILE, 'utf8')))) vecCache.set(k, v as number[]); } catch {}
    }
    return vecCache;
}

const key = (t: string) => createHash('sha1').update(MODEL + '\n' + t).digest('hex');

/** Embed texts (normalised vectors). Returns null if the model can't be loaded. */
export async function embed(texts: string[]): Promise<number[][] | null> {
    const cache = await loadCache();
    const missing = [...new Set(texts.filter(t => !cache.has(key(t))))];
    if (missing.length) {
        const fe = await getExtractor();
        if (!fe) return null;
        for (let i = 0; i < missing.length; i += 32) {
            const batch = missing.slice(i, i + 32);
            const out = (await fe(batch, { pooling: 'mean', normalize: true })).tolist() as number[][];
            batch.forEach((t, k) => cache.set(key(t), out[k].map(x => Math.round(x * 1e4) / 1e4)));
        }
        try {
            await mkdir(CACHE_DIR, { recursive: true });
            await writeFile(VEC_FILE, JSON.stringify(Object.fromEntries(cache)));
        } catch {}
    }
    return texts.map(t => cache.get(key(t))!);
}

export const cosine = (a: number[], b: number[]) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; };
