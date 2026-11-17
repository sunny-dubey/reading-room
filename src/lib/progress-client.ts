// Reading progress in this browser (Canon done, Roadmap learned). The site is read-only:
// progress lives in localStorage. Anything listed in src/content/progress.yaml is merged in,
// so you can record progress in the repo by hand and every device picks it up.
const KEYS = { canon: 'canon:done', learned: 'roadmap:learned' } as const;
type Kind = keyof typeof KEYS;

const readSet = (k: string) => { try { return new Set<string>(JSON.parse(localStorage.getItem(k) ?? '[]')); } catch { return new Set<string>(); } };
const writeSet = (k: string, s: Set<string>) => { try { localStorage.setItem(k, JSON.stringify([...s])); } catch {} };

const repo: Partial<Record<Kind, string[]>> = (() => {
    try { return JSON.parse(document.getElementById('repo-progress')?.textContent ?? '{}'); } catch { return {}; }
})();
for (const kind of Object.keys(KEYS) as Kind[]) {
    const local = readSet(KEYS[kind]);
    (repo[kind] ?? []).forEach(id => local.add(id));
    writeSet(KEYS[kind], local);
}

export const getSet = (kind: Kind) => readSet(KEYS[kind]);

export function setProgress(kind: Kind, id: string, done: boolean) {
    const s = readSet(KEYS[kind]);
    done ? s.add(id) : s.delete(id);
    writeSet(KEYS[kind], s);
}
