# reading-room

**The Reading Room**: a reading and discovery room for careers in software and the industries around it, edited at build time by a **local** language model (no cloud AI). Goal (Sunny): a goldmine for a curious engineer who wants to grow without brain rot. Astro 5 static site on GitHub Pages under `/reading-room/`.

## Sunny's standing decisions (don't undo without being asked)
- **Priority order:** discoverability, readability, learning, informative, experimental, research, thoughts. The front page, navigation and ranking follow it; papers and opinion never lead.
- **Local AI only.** No Gemini/OpenAI/Claude calls and no API keys anywhere (keys were removed 2026-11-25). The site's AI is `src/lib/llm.ts` + `src/lib/skills.ts`. Don't add other AI features unless asked.
- **24-hour editions**, four a day (06:17, 12:17, 18:17, 00:17 IST; cron `47 0,6,12,18 * * *` in deploy.yml), plus on every push and manual runs. Every news section shows only the last 24 hours (`EDITION_WINDOW` in `src/lib/edition.ts`; `DATE_ONLY_WINDOW` = today or yesterday for date-only sources). Empty sections say so (`.fp-empty`); never fall back to older items. Not windowed by design: Canon, Roadmap, puzzles, numbers, macro calendar, end-of-life dates, `/week/` (7 days), `/big-tech/` "earlier this week", search, `/outages/` reliability table, startups "worth approaching" (funding 7 days, HN hiring thread this month).
- **Read-only and click-only:** no editor, accounts, syncing or text inputs. Progress, read history and preferences live in the browser (localStorage). No personal features (notebook, saved links, progress.yaml, `/til` were removed 2026-11-23).
- **Informative over opinion; practical over hype.** Data-led sources for macro. Never scrape sites that block bots (Stooq, NSE/BSE, Reddit, X, LinkedIn…); official APIs and feeds only; links and short titles, never copied text.
- **Removed on request, don't re-add:** the editor's note on the front page, the scrolling markets ticker, the 13-desk chip bar, Today's plan/aura/rabbit hole/two takes/your reading.
- **Hiring rule:** HN postings count only if in India (onsite, hybrid or remote) or remote open worldwide; region-restricted remote is dropped (`whereFits` in startups.ts).
- Phone readability matters: reading text 16px, metadata 13px, no sideways scroll; no font under 12px in global.css.
- **Design = calm reading layout** (Sunny, 2026-11-25: "content is not the issue, design and viewability is"): the front, part and summary pages use `.calm` (end of global.css): one column ~740px, sentence-case small grey labels (no letter-spaced capitals), serif titles carry the hierarchy, hairline separators and whitespace instead of double rules and coloured card borders, one supporting line per item (extra detail behind a toggle, e.g. startups' "Why it fits"). Keep new sections to that style.

## Navigation and pages
- **Top bar = the parts:** Summary `/digest/`, Discover `/discover/`, Learn `/learn/`, News `/news/`, Try it `/try/`, Research `/papers/` (`/research/` is the CS Research desk), Thoughts `/thoughts/`. Phones: the same as a scrollable row (`.parts-bar`). Each other page highlights its part (`PARTS` in Header.astro). Everything else is in the footer site map; desks and study pages are linked at the top of Learn.
- **Front page** (`src/pages/index.astro`): masthead, time budget (15/30/60 min picks the best unread reads that fit, in the browser), a link to Today's summary, and six short boxes (≤3 items, "Open … →").
- **Part pages** render `src/components/Edition.astro` with `part=`: Discover (big story, Startups worth approaching, Big tech engineering, On GitHub, Communities) · Learn (desk index, lead + top stories with "Check yourself", question of the day, every desk with "Choose desks", postmortem + explainer) · News (markets line, the wire, business box, briefing, incidents) · Try it (how-tos/benchmarks, the puzzle) · Research (papers with plain-words gists) · Thoughts (opinion).
- **Today's summary** (`/digest/`): a reading plan (≤6 pieces, readable → deeper → try → paper, with kind, level, minutes, "You'll learn" and a check-yourself question; ticked when opened) and a 2–3 sentence summary per part from the `digest` skill, with the items listed under it.
- Other pages: desks `[section].astro`, `/startups/`, `/big-tech/`, `/communities/`, `/business/`, `/briefing/`, `/markets/`, `/outages/`, `/puzzles/`, `/roadmap/`, `/canon/`, `/week/`, `/sources/`, `/pulse/`, `/search/`, `/rss.xml`. Add new top-level pages to `precache` in `src/pages/sw.js.ts`.

## How an edition is built
- **Feeds:** `src/content/feeds.yaml` (schema in `src/content.config.ts`: `category`, `limit`, `maxAgeDays`, `weight`, `onlyTags`, `skipTitles`, `bigtech`). Desks = `CATEGORIES` in `src/lib/feeds.ts` (research, systems, backend→/architecture/, swe, ai-eng, ml, security, hft, quant, macro, math, postmortems). Side categories (no analysis): pulse, startups, business. Titles/summaries: LaTeX → Unicode (`delatex`).
- **Article analysis** (`src/lib/summarize.ts`, rule-based): fetches the page (cache `.cache/articles`, 30 days), extracts concepts (VOCAB), minutes, depth, `worth` 1–5, `kind` (How-to, Deep dive, Case study, Postmortem, Paper, Benchmark, Analysis, Opinion, News, Roundup, else Long read/Article/Short read; `KIND` has the label + intent), `level` (Intro/Intermediate/Advanced via `readLevel`) and `outline` (the article's own h2/h3s via `cleanOutline`).
- **Embeddings** (`src/lib/embed.ts`, all-MiniLM-L6-v2, `.cache/embeddings.json`): Roadmap topic per article (`src/lib/roadmap.ts`, restricted by `ALLOWED`, rank boost 1.5 × strength), Canon "builds on", the big story / same-story grouping (`groupSame` in bigstory.ts: meaning ≥ sim AND a shared rare word), communities, GitHub, startups and paper matching. Roadmap topics have a `level` (`topicLevel`).
- **Ranking and placement** (`src/lib/reading.ts`): `rank = worth×2 + freshness + topic boost + source weight`, freshness = 4 × 0.5^(age/2.5 days). `bandOf` puts each article in learn / informative / experimental / research / thoughts by its kind. Lead and top stories: `frontable` only (learn/experimental, not hype), Intro/Intermediate first. arXiv items go last on desks (max one per desk outside Research).
- **Local model** (`src/lib/llm.ts`): Qwen2.5-1.5B-Instruct q4 on GitHub Actions; Qwen3-4B q4f16 locally (empty `<think>` block); `LLM_MODEL` overrides. One shared time budget per build (`LLM_BUDGET_MIN`: 8 CI, 15 local). Answers start with a fixed prefix the model completes, then are format-checked; results cached per skill and model in `.cache/skills/`.
- **Skills** (`src/lib/skills.ts`, in run order; each has a rule-based fallback): 1 `substance` (hype kept off the front page), 2 `approach` (startups: why it fits + how to approach; else `PLAYBOOK`), 3 `learn` ("You'll learn …"), 4 `check` (a check-yourself question), 5 `paperGist` ("In plain words" + "Why it matters"), 6 `digest` (Today's summary, must name an item).
- **"What you'll get"** (`src/components/Gets.astro`): kind · level · minutes, the "You'll learn" sentence (or the kind's intent), "Covers:" headings, the Roadmap skill. Papers show their gist + why it matters.

## Sections (where to look)
- **Startups** (`src/lib/startups.ts`): Worth approaching, Funding (round/amount from the headline; a funding word is required), Deep tech, Impact, Hiring (HN "Who is hiring?"), Launches, News. Feeds `su-news-*`, `su-deep-*`, `su-impact-*`, plus Launch HN, Show HN, Product Hunt.
- **Big tech engineering:** every feed with `bigtech: true` (29 company blogs).
- **On GitHub** (`src/lib/github.ts`): HN-linked repos (24h) + GitHub search (new, systems languages); active, young, English, no games/lists/courses, star-farm guard, Roadmap match; featured rotates every 3 days; needs `GITHUB_TOKEN` in CI.
- **Communities** (`src/lib/communities.ts`): HN, Lobsters, Slashdot, programming.dev, DEV, Stack Exchange; subjects = Roadmap areas (bar 0.42), most debated, "in several communities".
- **Business** (`src/lib/business.ts`): 19 business/economy feeds, same story across outlets once.
- **Briefing** (`src/lib/briefing.ts`, stack in `src/content/stack.yaml`): Release radar, Obituaries (endoflife.date), CVE watch (CISA KEV), Paper drop (arXiv, code links via GitHub search), Standards radar (RFCs, kernel.org, runtime releases), Talk radar (12 conference YouTube channels).
- **Markets** (`src/lib/markets.ts`, `MarketBrief.astro`, `src/lib/macro-calendar.ts`): FRED + CoinGecko snapshot; the markets line = two rule-based sentences about the last session + the next macro event; `/markets/` calendar with "What it moves" and a FRED "Now" signal. Not advice; no Stooq/NSE/BSE.
- **Incidents** (`src/lib/outages.ts`, `src/content/status-pages.yaml`): provider status feeds, stated timing and causes only, case studies, reliability table.
- **Puzzles** (`src/lib/puzzles.ts`, `src/content/puzzles.yaml`, `numbers.yaml`, `web-puzzles.ts`): every answer verified (code run, interleavings enumerated, arithmetic in `proof`); click-only. When adding puzzles, verify them the same way.
- **Canon** (`src/content/canon.yaml`, long works have `parts`), **Roadmap** (`src/content/roadmap.yaml`, 35 areas, topic map via UMAP), **overrides** (`src/content/overrides.yaml`), weekly design practice (`src/content/practice.yaml`), questions (`questions.yaml`), explainers (`explainers.yaml`).

## Deploy (`.github/workflows/deploy.yml`)
- Caches: local models under a fixed key (`models-…-v1`; change it when a model changes); everything else in `.cache` per run.
- The build log is checked for `[ERROR]` (Astro exits 0 when a YAML collection fails to load). Failed runs open a GitHub issue "Edition build failed"; the next good run closes it. A keepalive commit (`.github/last-edition`) after 45 quiet days keeps the schedule on.
- `npm run check:links` checks Canon URLs after deploy (non-blocking).

## Conventions
- Wrap every internal link in `u()` from `src/lib/url.ts`, never a bare `/path`.
- Small helpers inside `.astro` templates must be called as functions (`{Line(x)}`), not used as tags.
- In YAML, quote values containing `: `.
- Commands: `npm run dev` (http://localhost:4321/reading-room/; set `LLM_BUDGET_MIN=2` for quick reloads), `npm run build`, `npm run check:links`.
