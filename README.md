# The Reading Room

**A reading and discovery room for careers in software and the industries around it, edited by a local AI.**

Live: https://sunny-dubey.github.io/reading-room/

A daily paper for curious engineers who want to grow without the brain rot. Four editions a day, each carrying only the last 24 hours, from the best experts in each field. Every piece tells you what it is (a how-to, a deep dive, a paper, an opinion), how hard it is, how long it takes and **what you'll learn**, so you can decide whether it's worth your time before you click. A small language model running **locally at build time** writes those lines: no cloud AI, no API keys, nothing leaves the build.

## How it's organised

The site follows one priority order: **discover, learn, stay informed, try things; research and opinion last.**

| Part | What's in it |
|---|---|
| **Summary** (`/digest/`) | Today's reading plan (the few pieces most worth your time, in order, with what you'll learn and a question to check yourself) and every part in two or three sentences |
| **Discover** (`/discover/`) | Startups worth approaching for engineering roles (just funded, hiring in India or remote, YC launches) with how to approach them; big tech engineering blogs; projects on GitHub; what tech communities are discussing |
| **Learn** (`/learn/`) | The clearest deep reads of the day, then every desk: CS research, distributed systems & databases, system design, software engineering, agentic AI, ML, security, HFT & low-latency, quant finance, macro, applied maths, postmortems |
| **News** (`/news/`) | The markets in two sentences, the wire, business & economy, the briefing (releases, end-of-life dates, exploited CVEs, standards, new talks) and incidents |
| **Try it** (`/try/`) | How-tos and benchmarks you can follow along with, and the daily puzzle |
| **Research** (`/papers/`) | New papers, each explained in plain words first: what it does and why it matters |
| **Thoughts** (`/thoughts/`) | Essays and opinion, for perspective |

Also: the **Roadmap** (35 areas and ~530 topics, each with a difficulty level), the **Canon** (foundational reads in order), **Puzzles**, **The week**, **Startups**, **Big tech**, **Communities**, **Business**, **Markets**, **Incidents**, **Sources**, **Search** and an **RSS feed** (`/rss.xml`).

## Features

- **What you'll get, on every card:** kind of read · level (Intro / Intermediate / Advanced) · minutes, a one-sentence "You'll learn …", the article's own section headings, and the Roadmap skill it builds. Papers get "In plain words" and "Why it matters".
- **Time budget:** pick 15 minutes, 30 minutes or an hour, and the page picks the best unread pieces that fit.
- **Substance over hype:** the local model flags hype (announcements, listicles, vague trend talk) and keeps it off the front page.
- **Careers:** startups worth approaching for engineering roles, with why they fit and how to reach out; HN hiring posts filtered to India or remote-worldwide.
- **Same story once:** when several outlets or communities cover the same thing, it's shown once with the others listed.
- **Read anywhere:** offline reading and installable as an app; phone-friendly; light and dark.
- **No account:** read history, progress and preferences stay in your browser.

## How it works

Everything happens **at build time**: no server, no database, no API keys, no cloud AI.

1. **Fetch** ~230 RSS/Atom feeds and official APIs (`src/content/feeds.yaml`; Hacker News, Lobsters, Stack Exchange, GitHub, CISA, endoflife.date, FRED, arXiv, kernel.org and more).
2. **Analyse** each article (`src/lib/summarize.ts`): reading time, depth, concepts, kind of read, difficulty, its own headings and a worth score.
3. **Match** articles to Roadmap topics by meaning with a small local embedding model (all-MiniLM-L6-v2).
4. **Edit** with a local language model (`src/lib/llm.ts`, `src/lib/skills.ts`): Qwen2.5-1.5B on GitHub's runners, Qwen3-4B for local builds. Its skills: substance check, how to approach a startup, "You'll learn", check-yourself questions, paper gists, and the edition summary. Every answer starts with a fixed opening the model completes, is format-checked, cached, and falls back to rule-based text.
5. **Rank and place** (`src/lib/reading.ts`): `rank = worth × 2 + freshness + topic boost + source weight`; each piece goes to a part by its kind of read.
6. **Render** static pages with Astro and deploy to GitHub Pages, four times a day (06:17, 12:17, 18:17 and 00:17 IST).

## Running it locally

```bash
npm install
npm run dev          # http://localhost:4321/reading-room/
npm run build        # production build into dist/
npm run check:links  # verify every Canon link
```

The first build downloads the embedding model and the local language model into `.cache/models` (once; about 3 GB for the local 4B model). Set `LLM_BUDGET_MIN=2 npm run dev` for quick reloads, or `LLM_MODEL=onnx-community/Qwen2.5-1.5B-Instruct` to use the smaller model locally.

## Adding content

The site is **read-only**: there's no editing in the browser. Add content as files, then commit and push (or wait for the next scheduled build):

| To add | Do this |
|---|---|
| A source | Add it to `src/content/feeds.yaml` (pick a track; optional `weight` to rank it up or down) |
| A foundational read | Add it to `src/content/canon.yaml` (for a book or course, list its chapters under `parts`) |
| A topic to learn | Add it to `src/content/roadmap.yaml` |
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
  content/        everything editable: feeds, canon, roadmap, overrides
  lib/            feed fetching, article analysis, topic matching, ranking
  pages/          Today, tracks, roadmap, canon, startups, pulse, search
  components/     cards, canon list, header/footer, shared client script
  styles/         one stylesheet (inlined into every page)
scripts/          note scaffolding, Canon link checker
```

Built with [Astro](https://astro.build), fonts Geist and Newsreader.
