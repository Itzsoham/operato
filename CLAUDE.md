@AGENTS.md

# Claude Code — Operato

## Subagents & skills available

Defined under `.claude/agents/` and `.claude/commands/`. Rationale and the full plan: [docs/agents-and-skills.md](docs/agents-and-skills.md).

- **Agents:** `prisma-modeler`, `route-builder`, `module-ui`, `sql-safety-reviewer` (read-only), `e2e-playwright`, `security-reviewer` (read-only).
- **Skills:** `/scaffold-module`, `/add-api-route`, `/generate-seed-data`, `/review-sql-safety`, `/new-vertical`.

Use `route-builder` for any endpoint (it bakes in the ownership guard). Gate AI-path changes behind `/review-sql-safety`, and merges behind `security-reviewer`.
