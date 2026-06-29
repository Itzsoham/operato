# Operato

The AI operating system for restaurants — a multi-tenant SaaS whose AI assistant talks to the tenant's _real_ business database (text-to-SQL), with weekly auto-summaries and smart inventory alerts. Restaurant is vertical #1 of a vertical-extensible platform.

## Stack

Next.js 15 (App Router, RSC) · TypeScript (strict) · Prisma + Neon Postgres · **Better Auth** · **Razorpay** · **Google Gemini 2.5 Flash via the Vercel AI SDK** · Shadcn/Tailwind · TanStack Query · Zod · Playwright · Vercel Cron.

> The stack changed from the original plan (Clerk → Better Auth, Stripe → Razorpay, Anthropic → Gemini). See [docs/stack-changes.md](docs/stack-changes.md).

## Docs

| Doc                                                    | What's in it                                              |
| ------------------------------------------------------ | --------------------------------------------------------- |
| [operato_project_plan.html](operato_project_plan.html) | The product/architecture plan (open in a browser)         |
| [docs/folder-structure.md](docs/folder-structure.md)   | The `/src` layout and what changed from the plan          |
| [docs/stack-changes.md](docs/stack-changes.md)         | Better Auth, Razorpay, and Gemini migration guides        |
| [docs/agents-and-skills.md](docs/agents-and-skills.md) | How to build this with Claude Code — agents & skills plan |
| [docs/plan-code-review.md](docs/plan-code-review.md)   | Adversarial review of the plan + must-fix list            |
| [CLAUDE.md](CLAUDE.md)                                 | Conventions & non-negotiable rules for AI/dev work        |

## AI tooling

Custom Claude Code subagents live in [.claude/agents/](.claude/agents/) and slash-commands in [.claude/commands/](.claude/commands/). Start a module with `/scaffold-module <Name>`; gate AI-path changes with `/review-sql-safety`.
