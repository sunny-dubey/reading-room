---
name: edition
description: Build a fresh edition of The Reading Room locally and show it on localhost. Use when Sunny says "update the edition", "new edition", "refresh the site", "update it locally" or types /edition. Publishing is a separate step that needs an explicit "push"/"publish".
---

# Update the edition (locally)

Editions are published on demand (no cron). This skill makes a new edition **on this machine only**.

1. From the repo root run `npm run edition -- --serve`. It rebuilds with fresh data (feeds, outages, CVEs, papers, jobs), prints a summary of the edition, and starts the preview on port 4321 if it isn't already running (a running preview serves `dist/`, so it shows the new edition after a reload).
2. If the build fails, show the error lines and fix the cause; don't publish a broken edition.
3. Reply with the summary in a few lines: dateline, lead story, fresh count and top titles, today's puzzle and question, internet weather, outage stats, briefing counts, and the localhost link (http://localhost:4321/reading-room/).
4. **Do not push, deploy or run the workflow.** Only when Sunny explicitly says "push" or "publish": commit any pending changes and push to `main` (or, with nothing to commit, run `gh workflow run deploy.yml`), then confirm the live site at https://sunny-dubey.github.io/reading-room/ updated.

Note: the published edition is built by GitHub Actions at push time, so it fetches its own fresh data; a few items can differ from the local preview if sources changed in between.
