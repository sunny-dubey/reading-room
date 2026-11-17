---
title: Claude Code
summary: How I use Claude Code day to day, plus the parts that surprised me.
updated: 2026-11-17
tags: [claude-code, tooling]
---

A living page. When log entries tagged `claude-code` pile up, the useful bits get folded in here.

## Where things live

- `~/.claude/projects/` holds session transcripts (JSONL), one folder per project.
- `~/.claude/skills/<name>/SKILL.md` holds personal slash commands, available in every project.
- A `CLAUDE.md` in a repo is read at the start of every session there.

## Habits that work

- End a session that taught me something with `/til`, then edit the draft it writes.
