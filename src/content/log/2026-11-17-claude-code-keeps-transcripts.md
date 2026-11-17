---
title: Claude Code keeps every session as JSONL on disk
date: 2026-11-17
tags: [claude-code, tooling]
source: claude session · sunny-docs
---

Every Claude Code session is saved under `~/.claude/projects/<project-path>/` as a `.jsonl` file, one line per message or tool call. So a session is never really lost: you can grep old sessions for a command you ran, or have a script summarise what happened across a day.

```bash
# which past sessions mentioned "idempotency"?
grep -l idempotency ~/.claude/projects/*/*.jsonl
```
