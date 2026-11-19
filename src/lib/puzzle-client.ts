// Puzzles, number cards and the incident drill, in the browser. Results stay in localStorage.
const ymd = (d = new Date()) => d.toLocaleDateString('en-CA');
const load = <T>(k: string, d: T): T => { try { return JSON.parse(localStorage.getItem(k) ?? '') ?? d; } catch { return d; } };
const save = (k: string, v: unknown) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };

// ---------- Puzzles ----------
type Results = Record<string, { ok: boolean; at: number }>;
const RESULTS = 'puzzles:results';

function solvedStreak(results: Results) {
    const days = new Set(Object.values(results).filter(r => r.ok).map(r => ymd(new Date(r.at))));
    let n = 0, d = new Date();
    if (!days.has(ymd(d))) d = new Date(Date.now() - 864e5);
    while (days.has(ymd(d))) { n++; d = new Date(+d - 864e5); }
    return n;
}
function paintStreaks() {
    const n = solvedStreak(load<Results>(RESULTS, {}));
    document.querySelectorAll<HTMLElement>('[data-pz-streak]').forEach(el => (el.textContent = n ? ` · solved ${n} ${n === 1 ? 'day' : 'days'} in a row` : ''));
    const solved = Object.values(load<Results>(RESULTS, {})).filter(r => r.ok).length;
    document.querySelectorAll<HTMLElement>('[data-pz-solved]').forEach(el => (el.textContent = String(solved)));
}

function finish(card: HTMLElement, ok: boolean | null, record = true) {
    const result = card.querySelector<HTMLElement>('[data-pz-result]')!;
    const verdict = card.querySelector<HTMLElement>('[data-pz-verdict]')!;
    verdict.textContent = ok === null ? 'Here’s the answer.' : ok ? 'Correct.' : 'Not quite.';
    verdict.className = `pz-verdict ${ok === null ? '' : ok ? 'ok' : 'no'}`;
    result.hidden = false;
    card.classList.add('is-answered');
    card.querySelector<HTMLElement>('[data-pz-reveal]')?.setAttribute('hidden', '');
    if (record && ok !== null) {
        const r = load<Results>(RESULTS, {});
        if (!r[card.dataset.puzzle!]) { r[card.dataset.puzzle!] = { ok, at: Date.now() }; save(RESULTS, r); }
        paintStreaks();
    }
}

export function mountPuzzles(root: ParentNode = document) {
    const results = load<Results>(RESULTS, {});
    root.querySelectorAll<HTMLElement>('[data-puzzle]').forEach(card => {
        const answer = JSON.parse(card.dataset.answer!);
        const prev = results[card.dataset.puzzle!];
        // Bug: click a line. Several bugs = several groups; each correct click finds one group.
        const groups: number[][] = card.dataset.type === 'bug' ? answer : [];
        const found = new Set<number>();
        const lineIn = (n: number) => groups.findIndex(g => g.includes(n));
        card.querySelectorAll<HTMLButtonElement>('[data-line]').forEach(b => b.addEventListener('click', () => {
            if (card.classList.contains('is-answered')) return;
            const n = Number(b.dataset.line), gi = lineIn(n);
            if (gi < 0) {
                b.classList.add('is-wrong');
                card.querySelectorAll<HTMLButtonElement>('[data-line]').forEach(x => { if (lineIn(Number(x.dataset.line)) >= 0) x.classList.add('is-right'); });
                return finish(card, false);
            }
            found.add(gi);
            groups[gi].forEach(l => card.querySelector(`[data-line="${l}"]`)?.classList.add('is-right'));
            const left = groups.length - found.size;
            const v = card.querySelector<HTMLElement>('[data-pz-verdict]')!;
            if (left > 0) { v.textContent = `Found one. ${left} more to go.`; v.className = 'pz-verdict ok'; card.querySelector<HTMLElement>('[data-pz-result]')!.hidden = true; card.querySelector('.pz-progress')?.remove(); b.closest('ol')?.insertAdjacentHTML('afterend', `<p class="pz-progress">Found ${found.size} of ${groups.length}. Keep looking.</p>`); return; }
            card.querySelector('.pz-progress')?.remove();
            finish(card, true);
        }));
        // Choice: pick an option.
        card.querySelectorAll<HTMLButtonElement>('[data-opt]').forEach(b => b.addEventListener('click', () => {
            if (card.classList.contains('is-answered')) return;
            const ok = Number(b.dataset.opt) === answer;
            b.classList.add(ok ? 'is-right' : 'is-wrong');
            card.querySelector<HTMLElement>(`[data-opt="${answer}"]`)?.classList.add('is-right');
            finish(card, ok);
        }));
        card.querySelector<HTMLButtonElement>('[data-pz-reveal]')?.addEventListener('click', () => {
            card.querySelectorAll<HTMLElement>('[data-line], [data-opt]').forEach(x => {
                const n = Number(x.dataset.line ?? x.dataset.opt);
                if (x.dataset.line ? lineIn(n) >= 0 : n === answer) x.classList.add('is-right');
            });
            card.querySelector('.pz-progress')?.remove();
            finish(card, null);
        });
        // Already answered on an earlier visit: show the result.
        if (prev) {
            card.querySelectorAll<HTMLElement>('[data-line], [data-opt]').forEach(x => {
                const n = Number(x.dataset.line ?? x.dataset.opt);
                if (x.dataset.line ? lineIn(n) >= 0 : n === answer) x.classList.add('is-right');
            });
            finish(card, prev.ok, false);
        }
    });
    paintStreaks();
}

// ---------- Numbers you should know: one card a day, click to reveal ----------
export function mountNumbers() {
    const box = document.querySelector<HTMLElement>('[data-numbers]');
    if (!box) return;
    const cards = [...box.querySelectorAll<HTMLElement>('[data-card]')];
    if (!cards.length) return;
    const day = Math.floor((Date.now() + 5.5 * 3600e3) / 864e5);
    const card = cards[(day * 7) % cards.length];
    cards.forEach(c => (c.hidden = c !== card));
    const meta = box.querySelector<HTMLElement>('[data-num-meta]');
    if (meta) meta.textContent = `A new one every day · all ${cards.length} on the puzzle page`;
    card.querySelector<HTMLButtonElement>('[data-num-reveal]')?.addEventListener('click', e => {
        card.querySelector<HTMLElement>('[data-num-result]')!.hidden = false;
        (e.currentTarget as HTMLElement).hidden = true;
    });
}

// ---------- Incident drill ----------
export function mountDrill() {
    const box = document.querySelector<HTMLElement>('[data-drill]');
    if (!box) return;
    const KEY = `drill:${box.dataset.drill}`;
    const state = load<{ step: number }>(KEY, { step: 0 });
    const steps = [...box.querySelectorAll<HTMLElement>('[data-drill-step]')];
    const next = box.querySelector<HTMLButtonElement>('[data-drill-next]')!;
    const end = box.querySelector<HTMLElement>('[data-drill-end]')!;
    const paint = () => {
        steps.forEach((s, i) => (s.hidden = i >= state.step));
        const left = steps.length - state.step;
        next.hidden = left <= 0;
        next.textContent = `Show the next update (${left} left)`;
        end.hidden = left > 0;
    };
    next.addEventListener('click', () => {
        state.step++; save(KEY, state); paint();
        steps[state.step - 1]?.classList.add('flash');
    });
    paint();
}
