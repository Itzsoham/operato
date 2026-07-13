@AGENTS.md

# Claude Code — Operato

## Subagents & skills available

Defined under `.claude/agents/` and `.claude/commands/`. Rationale and the full plan: [docs/agents-and-skills.md](docs/agents-and-skills.md).

- **Agents:** `prisma-modeler`, `route-builder`, `module-ui`, `ai-engineer`, `sql-safety-reviewer` (read-only), `e2e-playwright`, `security-reviewer` (read-only).
- **Skills:** `/scaffold-module`, `/add-api-route`, `/generate-seed-data`, `/review-sql-safety`, `/new-vertical`.

Use `route-builder` for any endpoint (it bakes in the ownership guard) and `ai-engineer` for anything under `src/lib/ai/`. Gate AI-path changes behind `/review-sql-safety`, and merges behind `security-reviewer` — the two reviewers are read-only by design, so they advise rather than silently rewrite security code.

## Before writing Next.js code

This repo is on **Next.js 16**, not 15. `params`/`searchParams`/`cookies()`/`headers()` are Promises (`await` them), `middleware.ts` is now `proxy.ts`, and `next lint` is gone. Read [docs/nextjs-16-notes.md](docs/nextjs-16-notes.md) first — it exists so you don't have to re-read 1,200 lines of `node_modules/next/dist/docs/`.

## Environment

[.env.example](.env.example) is the canonical list of env vars — read it instead of reconstructing names from the migration guides. Note `DATABASE_URL_AI` (the read-only role for the AI path) is a security boundary, not a convenience.
