# The Reading Room

**A personal, read-only learning site for becoming a sharper software engineer.**

Live: https://sunny-dubey.github.io/reading-room/

Most "what to read" feeds optimise for what's new. The Reading Room optimises for **what makes you better**: deep explanations over announcements, foundations over hype, and a clear reason for every piece you read. It's built around one loop: **read deeply → reflect → revisit**.

It covers the areas a strong engineer needs:

- **Distributed Systems & Databases**: consensus, replication, consistency, storage engines, Postgres internals
- **Scalability & Architecture**: architectural design, trade-offs, reliability patterns, APIs
- **AI Engineering & Agents**: agents, evals, retrieval, LLMs in production
- **ML & LLM Foundations**: how transformers, training, fine-tuning and inference work
- **Applied Mathematics**: probability, optimisation, numerical methods and the maths behind systems, ML and markets
- **Security**: web vulnerabilities, cryptography, cloud security, detection and exploitation (a full cybersecurity engineer roadmap)
- **CS Research**: algorithms, theory and performance, from researchers and new arXiv papers
- **HFT & Low-Latency Engineering**: caches, memory ordering, kernel bypass, market data and matching engines
- **Quantitative Finance**: probability, pricing, risk, market microstructure and the engineering behind trading
- **Macro & Markets**: central banks, inflation, growth and jobs, from data-led sources (the Fed, the New York Fed, the Bank of England, FRED)
- **Postmortems**: real failures, explained

## Who it's for

Engineers who read like researchers and want the newest serious work in one place:

- **CS researchers** and anyone who reads papers: algorithms, theory, performance
- **Distributed-systems and system-design** engineers
- **Software engineers** who care about craft, correctness and production
- **Agentic AI and ML** builders
- **Security** engineers
- **Quantitative finance** enthusiasts
- **Macro** followers who want data, not punditry
- **Applied maths and puzzle** lovers

It's curated from the best experts in each field, puts the latest first, and prefers informative, practical pieces over opinion.

## What's on the site

| Page | What it's for |
|---|---|
| **Today** (`/`) | A newspaper front page built for scanning: the lead story, **The wire** (the newest headlines from every desk), **Latest from every desk** (the freshest worth-reading pieces in each discipline), the puzzle page, the briefing, the outage map and more. Newest first, informative over opinion |
| **Track pages** (`/systems/`, `/architecture/`, …) | The best recent deep reads for that track, plus its Canon |
| **Roadmap** (`/roadmap/`) | 32 areas and ~530 topics to master (a full system design roadmap plus AI, ML, payments, maths, testing, engineering judgment and cybersecurity), with a topic map (every topic placed by meaning; learned ones glow), progress ticks and the reads that teach each topic |
| **Canon** (`/canon/`) | 93 hand-picked foundational reads in order: papers, books, courses and classic articles |
| **Notebook** (`/notebook/`) | Notes on what I've understood, in my own words |
| **Saved** (`/library/`) | Links worth keeping, each with a line on why |
| **Briefing** (`/briefing/`) | Facts that change weekly: release radar and end-of-life dates for your stack, vulnerabilities being exploited right now (CISA), new arXiv papers matched to your Roadmap, and hiring from HN's monthly thread |
| **Puzzles** (`/puzzles/`) | 56 engineering puzzles (spot the bug, back-of-the-envelope, distributed-systems scenarios, interleavings, complexity), each verified by running code or enumerating cases, plus 40 "numbers you should know" cards. Today shows the daily puzzle, a flash card and an incident drill built from a real outage |
| **Incidents** (`/outages/`) | Incident lessons from public status pages (cloud, CDN, developer tools, AI APIs): case studies of resolved incidents with a stated cause or a postmortem, a per-provider reliability table, and every other incident as a linked list. Three sit on Today |
| **Markets** (`/markets/`) | A snapshot of indices, yields, FX, oil, copper, gold and Bitcoin taken at build time, plus a calendar of upcoming central-bank meetings and CPI releases |
| **The week** (`/week/`) | The week's big stories, each desk's best five reads of the last seven days, and the week's incident lessons |
| **Startups** (`/startups/`) | What the best new companies are building (Launch HN, Show HN, Product Hunt, funding news) |
| **Pulse** (`/pulse/`) | The week's ten headlines, kept off the front page on purpose |
| **Sources** (`/sources/`) | Every feed the site reads from, what each is contributing right now (posts, deep reads, latest post, its best current read), and feed health |
| **Search** | Roadmap topics, the Canon, articles, notes and saved links |

Every matched article carries a **"Why read"** line, e.g. *"You'll get better at **Failover Strategies** (Reliability & Fault Tolerance). Teaches you to plan for the moment the primary disappears…"*, so you always know what a piece will do for you.

## Features

**Read anywhere**
- **Offline reading.** After your first visit, the browser keeps the current edition: the front page, every desk, the briefing, markets, incidents, puzzles, the week, the Roadmap, the Canon and search, with their thumbnails. With no connection, those pages still open. Online, the live edition always loads first, so you never get stuck on an old one. (A service worker, `src/pages/sw.js.ts`; the articles themselves live on their authors' sites and need a connection.)
- **Install it as an app.** Add it to your phone's home screen or install it from the browser; it opens in its own window.
- **Phone-friendly, light and dark.** Single column on small screens; the paper tint follows the time of day (morning, midday, evening, late); every motion effect is turned off when you prefer reduced motion.

**Know what's new**
- **New since your last visit.** A count on the front page and "New" badges on each card, measured from your previous visit, not a fixed window.
- **Stale-edition notice.** If the edition you're reading is more than a day old, the front page says so.
- **The big story.** When three or more independent sources cover the same thing in three days, it gets a strip under the ticker.
- **Markets ticker and "Coming up".** Key market numbers and the next central-bank and inflation dates, under the masthead.

**Read with a purpose**
- **"Why read" on every matched article**: the Roadmap topic it will make you better at.
- **Choose desks.** Hide disciplines you don't want on the front page (remembered in your browser).
- **Search** across topics, the Canon, articles, notes and saved links.
- **Progress without an account.** Canon, Roadmap and puzzle ticks and your reading history stay in your browser; read pieces are dimmed. List ids in `progress.yaml` to share progress across devices.

**Practise**
- **A daily puzzle**, "numbers you should know" flash cards with spaced repetition, and an **incident drill** that reveals a real outage one update at a time. Click-only, no typing.
- **A weekly design prompt** with curated reads and a hard question.
- **Puzzles from around the web**, linked and credited, never copied.

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


## Market data (credits)

The markets strip is a snapshot taken when the edition is built, not a live feed. Data: [FRED](https://fred.stlouisfed.org), Federal Reserve Bank of St. Louis (S&P 500 from S&P Dow Jones Indices, Nasdaq-100 from Nasdaq, VIX from Cboe, US Treasury yields, the Fed's H.10 exchange rates, EIA Brent, IMF copper, OECD India yields) and [CoinGecko](https://www.coingecko.com) (Bitcoin; gold via PAX Gold, one token per ounce).

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
