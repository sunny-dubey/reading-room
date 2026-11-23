// Reading progress in this browser (Canon done, Roadmap learned), kept in localStorage.
const KEYS = { canon: 'canon:done', learned: 'roadmap:learned' } as const;
type Kind = keyof typeof KEYS;

const readSet = (k: string) => { try { return new Set<string>(JSON.parse(localStorage.getItem(k) ?? '[]')); } catch { return new Set<string>(); } };
const writeSet = (k: string, s: Set<string>) => { try { localStorage.setItem(k, JSON.stringify([...s])); } catch {} };

export const getSet = (kind: Kind) => readSet(KEYS[kind]);

export function setProgress(kind: Kind, id: string, done: boolean) {
    const s = readSet(KEYS[kind]);
    done ? s.add(id) : s.delete(id);
    writeSet(KEYS[kind], s);
}
