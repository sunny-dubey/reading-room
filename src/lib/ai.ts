// AI content generated locally by scripts/ai-edition.mjs and committed (src/content/ai/<date>.json).
// The public build never calls Claude; it shows the latest committed file with its date.
import { readdir, readFile } from 'node:fs/promises';

export interface EditorsNote { headline: string; body: string; focus: string }
export interface AiDay { date: string; generatedAt: string; model: string; editorsNote?: EditorsNote }

let cache: Promise<AiDay | undefined> | undefined;
/** The most recent AI file, or undefined if none has been generated yet. */
export const getLatestAi = () => (cache ??= (async () => {
    try {
        const files = (await readdir('src/content/ai')).filter(f => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort();
        const last = files.at(-1);
        return last ? JSON.parse(await readFile(`src/content/ai/${last}`, 'utf8')) as AiDay : undefined;
    } catch { return undefined; }
})());
