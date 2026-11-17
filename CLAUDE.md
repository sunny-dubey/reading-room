# sunny-docs

Sunny's personal learning notebook. Astro 5 static site, deployed to GitHub Pages on push to `main`.

## Content (all in `src/content/`, schemas in `src/content.config.ts`)

| Tab | Location | Frontmatter |
|---|---|---|
| Log | `log/YYYY-MM-DD-slug.md` | `title`, `date`, `tags`, optional `source`, `draft` |
| Notes | `notes/<topic>.md` (one page per topic) | `title`, `summary`, `updated`, `tags`, `draft` |
| Writing | `writing/<slug>.md` | `title`, `description`, `date`, `tags`, `draft` |
| Library | `library.yaml` (list) | `id`, `title`, `url`, `author`, `kind`, `why`, `added`, `tags` |

- Tags are lowercase and kebab-case. Reuse existing tags before inventing new ones (`grep -rh "^tags:" src/content`).
- `draft: true` shows in `npm run dev` and is hidden in production builds.
- Log entries: one idea each, 2–8 sentences, specific (commands, numbers, error messages). Write in first person, plainly.
- When folding log entries into a note: update the note's `updated` date and keep the log entries (notes link back to them via shared tags).

## Commands

- `npm run dev`: local preview at http://localhost:4321
- `npm run build`: production build into `dist/`
- `npm run new <log|note|writing> "Title" [tags]`: scaffold an entry
