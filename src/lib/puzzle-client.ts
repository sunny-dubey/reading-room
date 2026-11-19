// Puzzles, number cards and the incident drill, in the browser. Results stay in localStorage.
const ymd = (d = new Date()) => d.toLocaleDateString('en-CA');
const load = <T>(k: string, d: T): T => { try { return JSON.parse(localStorage.getItem(k) ?? '') ?? d; } catch { return d; } };
const save = (k: string, v: unknown) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };

/** "23k", "2.7e18", "1,500", "1.2M" → number. */
export function parseNum(s: string): number {
    const t = s.trim().toLowerCase().replace(/,/g, '').replace(/\s+/g, '').replace(/×10\^?/, 'e');
    const m = t.match(/^(-?[\d.]+(?:e[-+]?\d+)?)([kmbt])?/);
    if (!m) return NaN;
    const mult = { k: 1e3, m: 1e6, b: 1e9, t: 1e12 }[m[2] as 'k'] ?? 1;
    return parseFloat(m[1]) * mult;
}
const within = (guess: number, answer: number, tol: number) =>
    guess > 0 && answer > 0 ? Math.max(guess / answer, answer / guess) <= tol : guess === answer;

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
        // Bug: click a line.
        card.querySelectorAll<HTMLButtonElement>('[data-line]').forEach(b => b.addEventListener('click', () => {
            if (card.classList.contains('is-answered')) return;
            const ok = (answer as number[]).includes(Number(b.dataset.line));
            b.classList.add(ok ? 'is-right' : 'is-wrong');
            card.querySelectorAll<HTMLButtonElement>('[data-line]').forEach(x => { if ((answer as number[]).includes(Number(x.dataset.line))) x.classList.add('is-right'); });
            finish(card, ok);
        }));
        // Choice: pick an option.
        card.querySelectorAll<HTMLButtonElement>('[data-opt]').forEach(b => b.addEventListener('click', () => {
            if (card.classList.contains('is-answered')) return;
            const ok = Number(b.dataset.opt) === answer;
            b.classList.add(ok ? 'is-right' : 'is-wrong');
            card.querySelector<HTMLElement>(`[data-opt="${answer}"]`)?.classList.add('is-right');
            finish(card, ok);
        }));
        // Estimate: type a number.
        card.querySelector<HTMLFormElement>('[data-pz-form]')?.addEventListener('submit', e => {
            e.preventDefault();
            if (card.classList.contains('is-answered')) return;
            const input = card.querySelector('input')!;
            const g = parseNum(input.value);
            if (!isFinite(g)) { input.focus(); input.setCustomValidity('Type a number, e.g. 250, 23k or 2.7e18'); input.reportValidity(); input.setCustomValidity(''); return; }
            const ok = within(g, Number(answer), Number(card.dataset.tol || 3));
            const v = card.querySelector<HTMLElement>('[data-pz-verdict]')!;
            finish(card, ok);
            const ratio = g / Number(answer);
            v.textContent = ok ? `Correct, within ${ratio >= 1 ? `${ratio.toFixed(1)}×` : `${(1 / ratio).toFixed(1)}×`} of the answer.` : `Not quite: you were ${ratio > 1 ? `${ratio.toFixed(1)}× too high` : `${(1 / ratio).toFixed(1)}× too low`}.`;
        });
        card.querySelector<HTMLButtonElement>('[data-pz-reveal]')?.addEventListener('click', () => {
            card.querySelectorAll<HTMLElement>('[data-line], [data-opt]').forEach(x => {
                const n = Number(x.dataset.line ?? x.dataset.opt);
                if (Array.isArray(answer) ? answer.includes(n) : n === answer) x.classList.add('is-right');
            });
            finish(card, null);
        });
        // Already answered on an earlier visit: show the result.
        if (prev) {
            card.querySelectorAll<HTMLElement>('[data-line], [data-opt]').forEach(x => {
                const n = Number(x.dataset.line ?? x.dataset.opt);
                if (Array.isArray(answer) ? answer.includes(n) : n === answer) x.classList.add('is-right');
            });
            finish(card, prev.ok, false);
        }
    });
    paintStreaks();
}

// ---------- Numbers you should know (spaced repetition) ----------
type Deck = Record<string, { due: string; misses: number; seen: number }>;
const DECK = 'numbers:deck';
export function mountNumbers() {
    const box = document.querySelector<HTMLElement>('[data-numbers]');
    if (!box) return;
    const deck = load<Deck>(DECK, {});
    const today = ymd();
    const cards = [...box.querySelectorAll<HTMLElement>('[data-card]')];
    const TODAY_KEY = `numbers:today:${today}`;
    const pinned = load<string | null>(TODAY_KEY, null);
    // Today's card: the one already shown today, else the first that's due (missed cards first), else never seen.
    const card = cards.find(c => c.dataset.card === pinned)
        ?? cards.filter(c => deck[c.dataset.card!] && deck[c.dataset.card!].due <= today).sort((a, b) => deck[b.dataset.card!].misses - deck[a.dataset.card!].misses)[0]
        ?? cards.find(c => !deck[c.dataset.card!])
        ?? cards[Math.floor(Date.now() / 864e5) % cards.length];
    cards.forEach(c => (c.hidden = c !== card));
    save(TODAY_KEY, card.dataset.card);
    const seen = Object.keys(deck).length;
    const meta = box.querySelector<HTMLElement>('[data-num-meta]');
    if (meta) meta.textContent = `${seen} of ${cards.length} cards seen · missed ones come back sooner`;
    const show = (ok: boolean | null, g?: number) => {
        const res = card.querySelector<HTMLElement>('[data-num-result]')!;
        const v = card.querySelector<HTMLElement>('[data-num-verdict]')!;
        const a = Number(card.dataset.answer);
        v.textContent = ok === null ? '' : ok ? 'Close enough.' : g !== undefined ? `Off by ${(Math.max(g / a, a / g)).toFixed(1)}×.` : 'Not quite.';
        v.className = `pz-verdict ${ok === null ? '' : ok ? 'ok' : 'no'}`;
        res.hidden = false;
    };
    const done = deck[card.dataset.card!]?.due > today;
    if (done) show(null);
    card.querySelector<HTMLFormElement>('[data-num-form]')?.addEventListener('submit', e => {
        e.preventDefault();
        const g = parseNum(card.querySelector('input')!.value);
        if (!isFinite(g)) return;
        const ok = within(g, Number(card.dataset.answer), Number(card.dataset.tol || 2));
        const prev = deck[card.dataset.card!] ?? { due: today, misses: 0, seen: 0 };
        const gap = ok ? (prev.misses ? 7 : 21) : 2;
        deck[card.dataset.card!] = { due: ymd(new Date(Date.now() + gap * 864e5)), misses: prev.misses + (ok ? 0 : 1), seen: prev.seen + 1 };
        save(DECK, deck);
        show(ok, g);
    });
}

// ---------- Incident drill ----------
export function mountDrill() {
    const box = document.querySelector<HTMLElement>('[data-drill]');
    if (!box) return;
    const KEY = `drill:${box.dataset.drill}`;
    const state = load<{ note: string; step: number }>(KEY, { note: '', step: 0 });
    const note = box.querySelector<HTMLTextAreaElement>('[data-drill-note]')!;
    const steps = [...box.querySelectorAll<HTMLElement>('[data-drill-step]')];
    const next = box.querySelector<HTMLButtonElement>('[data-drill-next]')!;
    const end = box.querySelector<HTMLElement>('[data-drill-end]')!;
    note.value = state.note;
    const paint = () => {
        steps.forEach((s, i) => (s.hidden = i >= state.step));
        const left = steps.length - state.step;
        next.hidden = left <= 0;
        next.textContent = `Show the next update (${left} left)`;
        end.hidden = left > 0;
    };
    note.addEventListener('input', () => { state.note = note.value; save(KEY, state); });
    next.addEventListener('click', () => {
        if (!note.value.trim() && state.step === 0 && !confirmSkip()) return;
        state.step++; save(KEY, state); paint();
        steps[state.step - 1]?.classList.add('flash');
    });
    // Nudge (not force) writing a hypothesis first, without a browser dialog.
    let nudged = false;
    function confirmSkip() {
        if (nudged) return true;
        nudged = true;
        note.placeholder = 'Write a guess first: it’s the whole point. (Click again to skip.)';
        note.focus();
        return false;
    }
    paint();
}
