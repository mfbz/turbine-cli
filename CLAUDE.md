@AGENTS.md

## Claude Code only

- Skills live in `.agents/skills/` and appear here through the `.claude/skills` symlink.
- A PostToolUse hook runs Prettier on every file you edit (`.claude/hooks/format-edited-file.mjs`).
- Designs and plans go in `docs/superpowers/` (gitignored scratch); the PR description is the record.
- `.claude/settings.json` denies bypassing the guards, pushing to `main`, force-pushing and reading `.env` or key files. Merging follows AGENTS.md (only when the maintainer has said so, after `ci` is green). Put personal overrides in `.claude/settings.local.json` (gitignored), never in the shared file.
- Prefer Read/Edit/Grep over shell `cat`/`sed`/`grep`.
