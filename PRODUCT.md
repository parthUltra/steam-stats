# Product

<!-- impeccable:product-schema 1 -->

<!-- Inferred from repository evidence (README, app copy, local-only architecture).
     Confirm with `/impeccable init` if any fact should change. -->

## Platform

web

## Users

Steam players who want a private, local view of how much they play and what their library cost versus what it is worth. Typical session: open the local dashboard after a one-time Account Data fetch, scan library hours or spend/value, optionally refresh market quotes.

## Product Purpose

Steam Stats turns a personal Steam Account Data export (plus optional Web API) into a local analytics dashboard: library playtime, spend vs shelf value, and a downloadable playtime panorama. Success means the owner can answer “what do I play?” and “was this money well spent?” without uploading data to a third-party server.

## Positioning

Runs entirely on the owner’s machine with their own Steam session and files. No hosted analytics account; privacy and ownership of Account Data are the product claim.

## Operating Context

- One-command local launch (`npm run launch`) with Playwright Steam login
- Parsed Account Data under `samples/` / `data/` (gitignored PII)
- Two primary surfaces: **Library** (shelf + panorama) and **Value** (spend vs market)
- Optional Steam Web API key for richer owned-games APIs
- Market quotes via Steam store + CheapShark refresh

## Capabilities and Constraints

- Library: Hours / Recent / A–Z / Panorama (≥30 minutes), search, Family Library when available
- Value: paid vs current/historical-low, cost-per-hour, unplayed spend, gifts, monthly habits, payment mix
- Panorama PNG download via local art proxy
- Must remain local-first; do not invent cloud sync, accounts, or social sharing
- Terminology: Library, Value, panorama, shelf, playtime, cost per hour, historical low

## Brand Commitments

- Product name: **Steam Stats**
- Visual identity leans on Steam charcoal + Steam blue (`#66c0f4`), not a parody Steam client skin
- Fonts in use: Outfit (UI), JetBrains Mono (metrics)

## Evidence on Hand

- Live UI: `src/components/DashboardView.tsx`, `GameLibrary.tsx`, `SpendingValue.tsx`, `PlaytimePanorama.tsx`
- Tokens: `src/app/globals.css` (`:root` Steam charcoal theme)
- Docs: `README.md`, `.env.example`
- Do not fabricate testimonials, user counts, or Steam partnership claims

## Product Principles

1. Local and private by default — data stays on disk
2. Scanability over spectacle — Operate-mode dashboard for real library sizes
3. Honest numbers — playtime and money use monospace; no vanity metrics theater
4. Steam-adjacent, not Steam-cloned — charcoal ops console, not a client replica
5. One job per view — Library for hours/shelf; Value for money

## Accessibility & Inclusion

No product-specific WCAG mandate recorded. Prefer keyboard-reachable controls, visible focus (ring = primary), and contrast suitable for dark UI body text (≥4.5:1).
