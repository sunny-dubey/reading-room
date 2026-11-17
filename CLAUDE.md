# reading-room

**The Reading Room**: a site for *understanding* (not news) across four tracks: Distributed Systems & Databases, Backend/APIs/Payments, AI Engineering & Agents, ML & LLM Foundations, plus Postmortems. A small `/pulse/` page holds the week's headlines. Sunny's notebook (log/notes/writing/saved) is where reading gets explained back. Astro 5 static site, GitHub Pages, rebuilt every 6h.

- Sources: `src/content/feeds.yaml`. Tracks: `CATEGORIES` in `src/lib/feeds.ts`. Ranking and Today page selection: `src/lib/reading.ts`.
- **Build-time article analysis, no AI model, no summaries:** `src/lib/summarize.ts` uses feed full-text or fetches the page (cached in `.cache/articles`, 30 days), then extracts concepts (VOCAB list), reading time, depth and a 1-5 `worth` score used for ranking. Deep reads = worth ≥ 3.5.
- The Canon (foundational reads, in order): `src/content/canon.yaml`. Progress lives in the browser (localStorage `canon:done`).

## Content (all in `src/content/`, schemas in `src/content.config.ts`)

| Tab | Location | Frontmatter |
|---|---|---|
| Log | `log/YYYY-MM-DD-slug.md` | `title`, `date`, `tags`, `draft` |
| Notes | `notes/<topic>.md` (one page per topic) | `title`, `summary`, `updated`, `tags`, `draft` |
| Writing | `writing/<slug>.md` | `title`, `description`, `date`, `tags`, `draft` |
| Library | `library.yaml` (list) | `id`, `title`, `url`, `author`, `kind`, `why`, `added`, `tags` |

- Tags are lowercase and kebab-case. Reuse existing tags before inventing new ones (`grep -rh "^tags:" src/content`).
- `draft: true` shows in `npm run dev` and is hidden in production builds.
- Log entries: one idea each, 2–8 sentences, specific (commands, numbers, error messages). Write in first person, plainly.
- When folding log entries into a note: update the note's `updated` date and keep the log entries (notes link back to them via shared tags).

- Site is served under `/reading-room/` (GitHub Pages project site). Wrap every internal link in `u()` from `src/lib/url.ts`, never a bare `/path`.

- In-site editor: `/write/` page + dev-only API in `integrations/notebook-editor.mjs` (save/load/tags under `/reading-room/__notebook/`). Never exists in the static build.

## Commands

- `npm run dev`: local preview at http://localhost:4321
- `npm run build`: production build into `dist/`
- `npm run new <log|note|writing> "Title" [tags]`: scaffold an entry
