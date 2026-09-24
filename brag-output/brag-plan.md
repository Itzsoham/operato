# Brag Plan: Operato

## What is this app?
A multi-tenant restaurant SaaS whose AI assistant reads the restaurant's own database (text-to-SQL through a read-only, row-level-secured role) and answers in plain English, plus a Monday summary, stock warnings, and menu/orders/inventory/regulars in one dashboard.

## The angle
The landing page's own promise: **"Ask your restaurant a question. Get a straight answer."** The video asks one, gets the answer with the working (the chart and the real SQL), then shows the other jobs (summary, stock warning). It finishes by flexing the design system: four palettes that change the whole app, then dark mode.

## Hook
A question types into the assistant input: "What sold best last Saturday?", then Enter.

## Key moments
- The answer card: the sentence, five bars growing one per beat, then "Show SQL" expands to the actual query, with the badge "Read-only · Row-Level Security".
- The Monday summary + "three days of paneer left, order 12 kg".
- The palette demo: Crema → Forno → Lievito → Saffron House → back to Crema → Dark.

## Outro
Dark crema. "Operato" · "Free plan forever · Pro ₹999/month" · operato-ai.vercel.app.

## User flow worth showing
Ask → read the answer and the SQL → act (reorder), plus the dashboard in any look.

## Tone
- Preset: polished (with app-store feature clarity)
- Creative direction: a speciality-coffee-counter product film: espresso on chalk, caramel accents
- Interpretation: restrained motion, serif headlines, generous holds; the design-system flex is the one showy moment.

## Format: landscape 1920x1080 · Duration: 23s

## Visual identity (from src/app/globals.css)
- Crema light: bg #FBF8F3, fg #23180F, card #FFFDFA, muted #6B5747, border #E7DCCB, primary #2A1D16, brand #7A4C17, success #556A58
- Crema dark: bg #1A130E, fg #F4E9DA, card #241A13, muted #B7A48C, border #3B2C1F, primary #EFE0C8, brand #D9A566, success #ADBDB6
- Forno #F0E2CA/#1C1310/#6E1607 · Lievito #EFEDE6/#1B1A17/#8A3F2C · Saffron House #EFE6D5/#241A22/#584309
- Heading: Iowan Old Style serif stack (Gelasio stands in, embedded) · Body: Plus Jakarta Sans · Mono: JetBrains Mono (the SQL panel)

## Share copy (draft)
Built Operato: ask your restaurant a question, get a straight answer. The AI writes the SQL against your own data through a read-only, row-level-secured role, and the whole app re-skins in four looks.

## Audio direction
- Music: happy-beats-business-moves-vol-11 (114.8 BPM), bed at 0.4 in the automation lane, loudness-normalized to -14 LUFS after render
- Cues: Enter 2.12, wordmark 3.70 (strong), bars 6.86–8.96 on the beat, Show SQL 9.50 (strong), stock card 12.65 (strong), palettes 16.34/16.86/17.39/17.91, dark 18.44, name 20.02
- SFX: typing on every other character, Enter click, soft impacts on reveals, glass ticks on bars, clicks on Show SQL / palette chips / mode toggle, switch on dark, bell at the end
- Audio-reactive: RMS softly lifts the card shadow glow

## Storyboard
1. Ask — 0–3.4s — input pill, question types, Enter on 2.12, "Asking…" shimmer
2. Reveal — 3.4–6.3s — Operato wordmark (3.70) + hero headline
3. The answer — 6.3–11.4s — left: "You get the answer and the working"; right: answer card, bars 1-by-1, Show SQL expands at 9.50, read-only badge; held ≥1.8s
4. Summary + stock — 11.4–15.4s — "It summarises. It warns you first." + Monday summary card (12.12) + stock card (12.65); held ≥2.5s
5. Four looks — 15.4–19.8s — "Four looks. Pick one and watch the whole thing change." dashboard preview (Takings today ₹38,420 · Tickets 186 · Average ticket ₹207 + trend), palette chips cycle, then Dark
6. Outro — 19.8–23s — dark crema wordmark, pricing line, URL
