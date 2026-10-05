<!-- Title: a conventional commit (`feat(order): …`, `fix(watch): …`). The pull request is squash-merged, so the title and this description become its one commit on main, and the title becomes its release note. CI checks both. -->

## Why

The problem this solves, and for whom. If it changes what the CLI does, name the `TURBINE-CLI.md` section it updates. Link the issue if there is one. Closes #

## What changed

-

## Evidence

How you know it works: the tests or commands you ran and their result, a recording or a measurement. Name any manual check (and the network it ran on: playground or mainnet).

Independent review (fresh context, AGENTS.md): the tool, what it found, what was fixed, and what was rejected and why.

## Checklist

- [ ] `npm run check` passes
- [ ] `TURBINE-CLI.md` and the README match the change; every acceptance check there is proven by a test
- [ ] Anything that signs or sends has a `--dry-run` path, and no key can reach any output

## Follow-ups

-
