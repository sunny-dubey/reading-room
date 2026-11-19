# The Reading Room

**A personal, read-only learning site for becoming a sharper software engineer.**

Live: https://sunny-dubey.github.io/reading-room/

Most "what to read" feeds optimise for what's new. The Reading Room optimises for **what makes you better**: deep explanations over announcements, foundations over hype, and a clear reason for every piece you read. It's built around one loop: **read deeply → reflect → revisit**.

It covers the areas a strong engineer needs:

- **Distributed Systems & Databases**: consensus, replication, consistency, storage engines, Postgres internals
- **Scalability & Architecture**: architectural design, trade-offs, reliability patterns, APIs
- **AI Engineering & Agents**: agents, evals, retrieval, LLMs in production
- **ML & LLM Foundations**: how transformers, training, fine-tuning and inference work
- **Mathematics**: discrete maths, probability, linear algebra, and the maths behind systems and ML
- **Security**: web vulnerabilities, cryptography, cloud security, detection and exploitation (a full cybersecurity engineer roadmap)
- **Quantitative Finance**: probability, pricing, risk, market microstructure and the engineering behind trading
- **Postmortems**: real failures, explained

## What's on the site

| Page | What it's for |
|---|---|
| **Today** (`/`) | A newspaper-style front page whose paper colour follows the time of day (morning, midday, evening, late edition). A question of the day; a daily plan you can size to 15 minutes, an hour or a weekend (deep read, Canon chapter, design practice, revisit); your reading streak; a rabbit hole that takes one topic from a first read to real depth; fresh reads; two takes on one topic; an explainer of the day; and a Sunday recap of your week |
| **Track pages** (`/systems/`, `/architecture/`, …) | The best recent deep reads for that track, plus its Canon |
| **Roadmap** (`/roadmap/`) | 32 areas and ~530 topics to master (a full system design roadmap plus AI, ML, payments, maths, testing, engineering judgment and cybersecurity), with a topic map (every topic placed by meaning; learned ones glow), progress ticks and the reads that teach each topic |
| **Canon** (`/canon/`) | 93 hand-picked foundational reads in order: papers, books, courses and classic articles |
| **Notebook** (`/notebook/`) | Notes on what I've understood, in my own words |
| **Saved** (`/library/`) | Links worth keeping, each with a line on why |
| **Briefing** (`/briefing/`) | Facts that change weekly: internet weather by region, release radar and end-of-life dates for your stack, vulnerabilities being exploited right now (CISA), new arXiv papers matched to your Roadmap, and hiring from HN's monthly thread |
| **Puzzles** (`/puzzles/`) | 56 engineering puzzles (spot the bug, back-of-the-envelope, distributed-systems scenarios, interleavings, complexity), each verified by running code or enumerating cases, plus 40 "numbers you should know" cards. Today shows the daily puzzle, a flash card and an incident drill built from a real outage |
| **Outages** (`/outages/`) | A world map of outages from 18 public status pages (cloud, CDN, developer tools, AI APIs, communication), each opening into an investigation report: where, how long, the provider's own timeline, and the postmortem when published. A small version sits on Today |
| **Startups** (`/startups/`) | What the best new companies are building (Launch HN, Show HN, Product Hunt, funding news) |
| **Pulse** (`/pulse/`) | The week's ten headlines, kept off the front page on purpose |
| **Sources** (`/sources/`) | Every feed the site reads from, what each is contributing right now (posts, deep reads, latest post, its best current read), and feed health |
| **Search** | Roadmap topics, the Canon, articles, notes and saved links |

Every matched article carries a **"Why read"** line, e.g. *"You'll get better at **Failover Strategies** (Reliability & Fault Tolerance). Teaches you to plan for the moment the primary disappears…"*, so you always know what a piece will do for you.

## How it works

Everything happens **at build time**. There's no server, no database, no API keys and no AI service.

1. **Fetch.** About 75 RSS/Atom sources (`src/content/feeds.yaml`): engineering blogs like Marc Brooker, Martin Fowler, Brandur, Stripe, Cloudflare, Lilian Weng, Sebastian Raschka, Jeremy Kun and more.
2. **Analyse.** For each article (`src/lib/summarize.ts`): uses the full text from the feed or fetches the page (cached for 30 days), then estimates reading time and depth, extracts technical concepts, and gives it a **worth score (1–5)** for how much it builds lasting understanding. Announcements, newsletters and roundups score low.
3. **Match.** A small local embedding model (all-MiniLM-L6-v2, ~23 MB, via `@huggingface/transformers`) matches each article to its closest **Roadmap topic** by meaning (`src/lib/roadmap.ts`). That's where "Why read" comes from.
4. **Rank.** `rank = worth × 2 + freshness + topic boost + source weight`. Depth comes first, but freshness counts for a lot (+2.5 today, halving every 4 days), so a good new post beats a slightly better old one. Topics you haven't covered yet get a boost, and authors known for depth get a small nudge (`src/lib/reading.ts`).
5. **Render.** Astro builds static pages, deployed to GitHub Pages.

**Editions are published on demand.** There's no timer: each push to `main` (or a manual run of the workflow from the Actions tab) fetches everything fresh, builds and deploys a new edition. To publish today's edition, push or run the workflow. After each deploy, a separate job checks that every Canon link still works.

## Running it locally

```bash
npm install
npm run dev          # http://localhost:4321/reading-room/
npm run build        # production build into dist/
npm run check:links  # verify every Canon link
```

The first build downloads the embedding model into `.cache/` (once).

## Adding content

The site is **read-only**: there's no editing in the browser. Add content as files, then commit and push (or wait for the next scheduled build):

| To add | Do this |
|---|---|
| A note | `npm run new "What I understood about MVCC" postgres,mvcc`, or `/til` in a Claude Code session. Notes live in `src/content/notes/` |
| A saved link | Add an entry to `src/content/library.yaml` |
| A source | Add it to `src/content/feeds.yaml` (pick a track; optional `weight` to rank it up or down) |
| A foundational read | Add it to `src/content/canon.yaml` (for a book or course, list its chapters under `parts`) |
| A topic to learn | Add it to `src/content/roadmap.yaml` |
| Progress on every device | List Canon ids or topic ids in `src/content/progress.yaml` (ticks on the site are kept per browser) |
| Change the daily questions or explainers | Edit `src/content/questions.yaml` or `src/content/explainers.yaml` |
| Add a puzzle or number card | `src/content/puzzles.yaml` / `src/content/numbers.yaml` (verify it and note how in `proof`) |
| Watch another project's releases / end of life | Add it to `src/content/stack.yaml` (its endoflife.date id) |
| Watch another status page | Add it to `src/content/status-pages.yaml` |
| Change the weekly design prompts | Edit `src/content/practice.yaml` (topics, reads, the hard question) |
| Fix a bad "Why read" match | Pin a topic (or `none`) for a URL in `src/content/overrides.yaml` |

## Open source: run your own Reading Room

The Reading Room is open source. Fork or clone it and run your own paper:

```bash
git clone https://github.com/sunny-dubey/reading-room && cd reading-room
npm install
npm run edition -- --serve      # builds today's edition and opens it at http://localhost:4321/reading-room/
```

Make it yours by editing the files in `src/content/`: your sources (`feeds.yaml`), what you're learning (`roadmap.yaml`), your foundational reads (`canon.yaml`), your stack (`stack.yaml`), puzzles and status pages. To publish on GitHub Pages, change `site` and `base` in `astro.config.mjs` and enable Pages (GitHub Actions) in your repo settings.


## Puzzles from around the web (credits)

The puzzle page links to the best puzzle collections online. **Nothing is copied:** at build time we fetch only titles and links, every link opens the original page, and each is credited to its maker. Your "solved" ticks stay in your browser.

| Collection | By | Link |
|---|---|---|
| JavaScript Questions | Lydia Hallie | https://github.com/lydiahallie/javascript-questions |
| What the f*ck Python! | Satwik Kansal | https://github.com/satwikkansal/wtfpython |
| The System Design Primer (design questions) | Donne Martin | https://github.com/donnemartin/system-design-primer |
| Project Euler | Project Euler | https://projecteuler.net |
| Puzzle of the month | Jane Street | https://www.janestreet.com/puzzles/current-puzzle/ |
| Ponder This | IBM Research | https://research.ibm.com/haifa/ponderthis/index.shtml |
| The Deadlock Empire | Deadlock Empire authors | https://deadlockempire.github.io/ |
| 6.824 Distributed Systems exams | MIT OpenCourseWare | https://ocw.mit.edu/courses/6-824-distributed-computer-systems-engineering-spring-2006/pages/exams/ |
| Advent of Code | Eric Wastl | https://adventofcode.com |

## Project layout

```
src/
  content/        everything editable: feeds, canon, roadmap, notes, saved links, progress, overrides
  lib/            feed fetching, article analysis, topic matching, ranking
  pages/          Today, tracks, roadmap, canon, notebook, saved, startups, pulse, search
  components/     cards, canon list, header/footer, shared client script
  styles/         one stylesheet (inlined into every page)
scripts/          note scaffolding, Canon link checker
```

Built with [Astro](https://astro.build), fonts Geist and Newsreader.
