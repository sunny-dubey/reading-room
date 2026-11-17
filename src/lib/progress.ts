// Build-time view of src/content/progress.yaml.
import { readFile } from 'node:fs/promises';
import { parse } from 'yaml';

export interface Progress { canon: string[]; learned: string[] }

let cached: Promise<Progress> | undefined;
export const getProgress = () => (cached ??= (async () => {
    try {
        const p = parse(await readFile('src/content/progress.yaml', 'utf8')) ?? {};
        return { canon: (p.canon ?? []).map(String), learned: (p.learned ?? []).map(String) };
    } catch {
        return { canon: [], learned: [] };
    }
})());
