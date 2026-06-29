---
description: Stamp out a vertical config pack (entity aliases, KPIs, copy, AI schema-context) — the platform seam.
argument-hint: <vertical-name> [Menu=Catalog Tables=Counters ...]
---
Create a new vertical config pack for **$ARGUMENTS** under `src/lib/verticals/<name>.ts` — the platform seam that lets Operato become an AI OS for industries beyond restaurants.

The pack declares, without forking the app:
- **Domain entity aliases** (e.g. Menu→Catalog, Table→Counter) for terminology only — the underlying tenant/inventory/CRM/AI core is reused.
- **Dashboard KPIs** specific to this vertical.
- **Terminology & onboarding copy.**
- **AI `schema-context` + curated example question→SQL pairs** for this vertical (this is most of the work — the AI reads the generated schema description, so swapping context is how a new vertical "teaches" the assistant).
- Register the pack so the dashboard shell and the `ai/query` route can select it per tenant.

Keep the curated example Q→SQL pairs in a file that schema-context regeneration won't clobber. Reuse the shared core (Better Auth, Razorpay, Gemini engine, Inventory/CRM/Staff) verbatim. Report the file created and what the AI route needs to select it.
