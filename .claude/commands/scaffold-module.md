---
description: Scaffold a full CRUD module vertical slice (schema → route → hooks → UI → nav), then security-review it.
argument-hint: <ModuleName> [field:type ...]
---
Scaffold a complete vertical slice for the module **$ARGUMENTS** in Operato.

Produce, in order, reusing the project's existing patterns and the non-negotiable rules in `CLAUDE.md`:

1. **Schema** — delegate to the `prisma-modeler` agent: add the Prisma model with `restaurantId` + cascade FK + the right `@@index`es, `Decimal` for money/stock, both relation sides. Create the migration.
2. **Validation** — a Zod schema in `src/lib/validations/<module>.ts`.
3. **API route** — delegate to the `route-builder` agent: `src/app/api/restaurants/[restaurantId]/<module>/route.ts` with the ownership guard, Zod parse, tenant-filtered Prisma. `restaurantId` from the URL only.
4. **Hooks** — TanStack Query hooks (list + mutations with optimistic update/rollback).
5. **UI** — delegate to the `module-ui` agent: `src/app/dashboard/[restaurantId]/<module>/page.tsx` (RSC) + client list/dialogs, plus a sidebar nav entry.
6. **Review** — hand the full diff to the `security-reviewer` agent and report its findings.

Parse the field list as `name:type` pairs (flags like `?` for optional, `unique`). If no fields are given, ask for them. End with a summary of every file created and the migration name.
