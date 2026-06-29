---
description: Write/refresh prisma/seed.ts with realistic, correlated multi-month demo data so the AI features look real.
argument-hint: [months=3] [restaurants=1]
---
Write or update `prisma/seed.ts` to generate realistic, **correlated** demo data for Operato. Args: $ARGUMENTS (default 3 months of history, 1–2 restaurants).

Requirements:
- One or two restaurants, with members (Better Auth `user` rows + `RestaurantMember`), menu categories + items, tables.
- ~N months of orders with **believable patterns**: busier weekends/evenings, realistic order values and item mixes, a spread of statuses ending mostly PAID.
- Derived fields kept consistent: `Customer.totalSpend`/`visitCount`/`lastVisitAt` computed from their orders; `InventoryTransaction.balanceAfter` and `InventoryItem.currentStock` internally consistent; staff + shifts with plausible hours.
- Respect tenancy: every row carries the correct `restaurantId` (including `OrderItem`, `InventoryTransaction`, `Shift`).
- **Idempotent** — safe to re-run (upsert or clear-then-insert by a seed marker). Wired to `prisma db seed` in `package.json`.

The goal: when the text-to-SQL assistant runs "top customers", "AOV this week vs last", "what to reorder", the answers are non-trivial and varied. Avoid uniform/random noise — make it look like a real restaurant's quarter. End by running the seed and reporting row counts per table.
