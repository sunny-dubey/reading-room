// "Solved" ticks for linked puzzles, kept in this browser only (localStorage `web:solved`: id → when).
const KEY = 'web:solved';
const load = (): Record<string, number> => { try { return JSON.parse(localStorage.getItem(KEY) ?? '{}'); } catch { return {}; } };
export function mountWebPuzzles() {
    const paint = () => {
        const done = load();
        document.querySelectorAll<HTMLInputElement>('[data-web-solve]').forEach(cb => {
            cb.checked = !!done[cb.dataset.webSolve!];
            cb.closest('li')?.classList.toggle('is-done', cb.checked);
        });
        document.querySelectorAll<HTMLElement>('[data-web-count]').forEach(el => {
            const ids = (el.dataset.webCount ?? '').split(' ');
            el.textContent = `${ids.filter(id => done[id]).length} of ${ids.length} solved`;
        });
    };
    document.addEventListener('change', e => {
        const cb = (e.target as HTMLElement).closest<HTMLInputElement>('[data-web-solve]');
        if (!cb) return;
        const done = load();
        if (cb.checked) done[cb.dataset.webSolve!] = Date.now(); else delete done[cb.dataset.webSolve!];
        try { localStorage.setItem(KEY, JSON.stringify(done)); } catch {}
        paint();
    });
    paint();
}
