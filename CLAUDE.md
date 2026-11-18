# reading-room

**The Reading Room**: a site for *understanding* (not news) across four tracks: Distributed Systems & Databases, Backend/APIs/Payments, AI Engineering & Agents, ML & LLM Foundations, plus Postmortems. A small `/pulse/` page holds the week's headlines. Sunny's notebook (notes + saved links, written as files) is displayed read-only. Astro 5 static site, GitHub Pages, rebuilt every 6h.

- Sources: `src/content/feeds.yaml`. Tracks: `CATEGORIES` in `src/lib/feeds.ts`. Ranking and Today page selection: `src/lib/reading.ts`.
- **Build-time article analysis, no AI model, no summaries:** `src/lib/summarize.ts` uses feed full-text or fetches the page (cached in `.cache/articles`, 30 days), then extracts concepts (VOCAB list), reading time, depth and a 1-5 `worth` score used for ranking. Deep reads = worth ≥ 3.5.
- The Canon (foundational reads, in order): `src/content/canon.yaml`. Progress lives in the browser (localStorage `canon:done`). Long works (books, courses, long videos) have `parts` (chapters or sittings); Today and the Canon page point at the next unfinished chapter, tracked as `<id>/<n>` in the same set (`src/lib/canon-parts-client.ts`), and finishing every chapter finishes the work.
- **Roadmap** (`src/content/roadmap.yaml`, page `/roadmap/`): Sunny's 25-area system design roadmap + AI engineering, ML foundations, payments, mathematics (29 areas, ~470 topics). `src/lib/embed.ts` runs a local embedding model (all-MiniLM-L6-v2 via @huggingface/transformers; cached in `.cache/models`, vectors in `.cache/embeddings.json`) at build time. `src/lib/roadmap.ts` matches each article to its closest topic (restricted by source track, see `ALLOWED`), giving cards a "Why read: you'll get better at <topic>" line and a rank boost for topics not yet covered by notes/saved links. If the model can't load, ranking falls back to the rules.
- **Overrides** (`src/content/overrides.yaml`): pin a roadmap topic for an article URL, or `none`.
- **Ranking:** `rank = worth×2 + freshness + topic boost + source weight`; freshness = 2.5 halving every 4 days (`freshness()` in reading.ts). Today has a "Fresh this week" block (worth ≥ 3, last 3 days, 7 if quiet) right after the plan; cards under 48h old get a "New" badge (client-side) (`weight` per feed in feeds.yaml; roundup/newsletter titles lose worth in summarize.ts).
- **Progress** is read-only on the site: Canon/Roadmap/plan ticks live in the browser (`src/lib/progress-client.ts`). Ids listed in `src/content/progress.yaml` (edit by hand) are merged in on every device and used by build-time ranking.
- **The site is read-only:** no in-site editor, saving, syncing or Explain-it-back. Notes and saved links are added as files (`npm run new`, `/til`, or editing `src/content/`).
- **Reading history** (`src/lib/history-client.ts`): opened pieces + timestamps in localStorage (`reading:history`); drives read dimming and spaced revisits (≈1 week / ≈1 month later) on Today.
- **Weekly design practice** (`src/content/practice.yaml`): one "Design a …" prompt per week on Today, with curated topics, Canon reads and a hard question; prompts not listed fall back to embedding matches. "Read first" never lists a whole book or course (book/course over 120 min is dropped with a build warning); it adds the best recent deep article (topic match ≥ 0.5) for the exercise topics when there is one.
- **Sources** (`src/pages/sources.astro`, in the sections bar): every feed grouped by track with posts, deep reads, latest post, best current read, ranking nudge and health.
- **Search** covers roadmap topics, Canon, articles, notes and saved links (`src/pages/search-index.json.ts`).
- **Today** (`src/pages/index.astro`): Today's plan (deep read with its Why read → next Canon item, rotating tracks daily → revisit from notes or reading history, else reflect), this week's design practice, Canon next-ups, picks, postmortem, revisit.
- `npm run check:links` checks Canon URLs (runs after each deploy, non-blocking).
- Tracks: systems, backend (shown as "Scalability & Architecture" at /architecture/), ai-eng, ml, math, postmortems (+ side pages pulse, startups).

## Content (all in `src/content/`, schemas in `src/content.config.ts`)

| What | Location | Frontmatter |
|---|---|---|
| Notebook notes | `notes/YYYY-MM-DD-slug.md` → `/notebook/<id>/` | `title`, `date`, `tags`, optional `source` (URL), `draft` |
| Saved links | `library.yaml` (list) → `/library/` | `id`, `title`, `url`, `author`, `kind`, `why`, `added`, `tags` |
| Canon | `canon.yaml` | see file header |
| Sources | `feeds.yaml` | see file header |

- The notebook has one kind of entry: a note (what Sunny understood, in his own words). No log/writing split.
- Tags are lowercase and kebab-case. Reuse existing tags before inventing new ones (`grep -rh "^tags:" src/content/notes`).
- `draft: true` shows in `npm run dev` and is hidden in production builds.

- Site is served under `/reading-room/` (GitHub Pages project site). Wrap every internal link in `u()` from `src/lib/url.ts`, never a bare `/path`.


## Commands

- `npm run dev`: local preview at http://localhost:4321
- `npm run build`: production build into `dist/`
- `npm run new "Title" [tags]`: scaffold a note
- `npm run check:links`: verify Canon links
