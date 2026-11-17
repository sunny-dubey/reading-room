// Progress in the browser, kept in step with src/content/progress.yaml.
// Locally (npm run dev) every change is written to the file. On the live site a "Sync progress"
// button copies the updated file and opens GitHub to commit it (works from any device).
import { ghEditFile } from './site';

const KEYS = { canon: 'canon:done', learned: 'roadmap:learned' } as const;
type Kind = keyof typeof KEYS;

const readSet = (k: string) => { try { return new Set<string>(JSON.parse(localStorage.getItem(k) ?? '[]')); } catch { return new Set<string>(); } };
const writeSet = (k: string, s: Set<string>) => { try { localStorage.setItem(k, JSON.stringify([...s])); } catch {} };

// The repo's progress, embedded in the page at build time.
const repo: Record<Kind, string[]> = (() => {
    try { return JSON.parse(document.getElementById('repo-progress')?.textContent ?? '{}'); } catch { return {}; }
})() as Record<Kind, string[]>;

// Merge once per page load: repo progress always counts in this browser too.
for (const kind of Object.keys(KEYS) as Kind[]) {
    const local = readSet(KEYS[kind]);
    (repo[kind] ?? []).forEach(id => local.add(id));
    writeSet(KEYS[kind], local);
}

export const getSet = (kind: Kind) => readSet(KEYS[kind]);

function yamlFile(canon: string[], learned: string[]) {
    const list = (xs: string[]) => xs.length ? `\n${xs.sort().map(x => `  - ${x}`).join('\n')}` : ' []';
    return `# Your learning progress. Shared across devices and used by ranking (covered topics rank lower,\n# so the Reading Room keeps pushing you to new ground).\n# Updated automatically when you tick things locally (npm run dev); on the live site use "Sync progress".\ncanon:${list(canon)}\nlearned:${list(learned)}\n`;
}

const unsynced = () => (Object.keys(KEYS) as Kind[]).some(kind => {
    const local = readSet(KEYS[kind]), r = new Set(repo[kind] ?? []);
    return local.size !== r.size || [...local].some(x => !r.has(x));
});

function paintSyncButton() {
    if (import.meta.env.DEV) return;
    let btn = document.getElementById('sync-progress') as HTMLButtonElement | null;
    if (!unsynced()) { btn?.remove(); return; }
    if (!btn) {
        btn = document.createElement('button');
        btn.id = 'sync-progress';
        btn.className = 'sync-pill';
        btn.type = 'button';
        btn.title = 'Copy your progress and open GitHub to save it, so every device and the ranking see it';
        btn.addEventListener('click', async () => {
            const text = yamlFile([...getSet('canon')], [...getSet('learned')]);
            try { await navigator.clipboard.writeText(text); } catch {}
            btn!.textContent = 'Copied: replace the file and commit';
            window.open(ghEditFile('src/content/progress.yaml'), '_blank', 'noopener');
        });
        document.body.appendChild(btn);
    }
    btn.textContent = 'Sync progress ↑';
}

/** Record a change in this browser, then write it to the repo (locally) or offer to sync (live). */
export async function setProgress(kind: Kind, id: string, done: boolean) {
    const s = readSet(KEYS[kind]);
    done ? s.add(id) : s.delete(id);
    writeSet(KEYS[kind], s);
    if (import.meta.env.DEV) {
        try {
            await fetch(`${import.meta.env.BASE_URL.replace(/\/$/, '')}/__notebook/progress`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ canon: [...getSet('canon')], learned: [...getSet('learned')] }),
            });
        } catch {}
    }
    paintSyncButton();
}

paintSyncButton();
