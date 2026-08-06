---
name: Steam Stats
description: Local Steam charcoal ops dashboard for playtime and spend vs shelf value
colors:
  background: "#06080c"
  foreground: "#eef3f8"
  card: "#0e141c"
  soft: "#121a24"
  primary: "#66c0f4"
  primary-foreground: "#061018"
  secondary: "#1b2838"
  muted-foreground: "#8b9aab"
  border: "#1e2a38"
  line-hot: "#2a3f55"
  steam-mist: "#c7d5e0"
  cyan: "#3ee0d5"
  amber: "#ffb347"
  rose: "#ff6b8a"
  volt: "#b8ff5c"
  black: "#000000"
  white: "#ffffff"
typography:
  headline:
    fontFamily: "Outfit, system-ui, sans-serif"
    fontSize: "1.25rem"
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: "-0.02em"
  title:
    fontFamily: "Outfit, system-ui, sans-serif"
    fontSize: "1.1rem"
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: "-0.02em"
  body:
    fontFamily: "Outfit, system-ui, sans-serif"
    fontSize: "0.95rem"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "Outfit, system-ui, sans-serif"
    fontSize: "0.68rem"
    fontWeight: 700
    letterSpacing: "0.16em"
  metric:
    fontFamily: "JetBrains Mono, ui-monospace, monospace"
    fontSize: "1.25rem"
    fontWeight: 500
    letterSpacing: "-0.02em"
rounded:
  xs: "3px"
  sm: "0.45rem"
  md: "0.6rem"
  lg: "0.75rem"
  xl: "1rem"
  "2xl": "14px"
  "3xl": "16px"
  "4xl": "18px"
spacing:
  shell-gutter: "1rem"
  section: "1.25rem"
  cluster: "0.65rem"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.primary-foreground}"
    rounded: "{rounded.md}"
    padding: "0.5rem 1rem"
  button-primary-hover:
    backgroundColor: "#4fb3ef"
    textColor: "{colors.primary-foreground}"
  card-surface:
    backgroundColor: "{colors.card}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.xl}"
    padding: "1.1rem 1.15rem"
  input-field:
    backgroundColor: "{colors.soft}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.md}"
    padding: "0.5rem 0.75rem"
---

# Design System: Steam Stats

## Overview

**Creative North Star: "Steam Ops Console"**

A dark, dense Operate-mode dashboard that feels like a personal telemetry bay for a Steam library — charcoal surfaces, Steam-blue signals, and monospace metrics. Atmosphere comes from soft radial washes and tonal layering, not decorative grids or AI-card chrome. Brand presence is the Steam mark plus the product name in the header; no eyebrow kickers.

Expression stays subordinate to scanability: shelf grids, filters, and money boards must remain readable at library scale.

**Key Characteristics:**
- Always-dark Steam charcoal (`#06080c` base)
- Primary accent Steam blue `#66c0f4`; semantic cyan / amber / rose / volt for data meaning
- Outfit for UI; JetBrains Mono only for numbers and codes
- Tonal elevation + light borders; restrained shadows on chrome only
- shadcn/ui primitives restyled to the Steam token set

## Colors

Cool charcoal neutrals with one Steam-blue voice and a small semantic signal set for money and status.

### Primary
- **Steam Signal** (`#66c0f4`): Primary actions, selected filters, focus rings, key links. Keep rare enough that metrics still read as data, not decoration.

### Secondary
- **Deep Hull** (`#1b2838`): Secondary surfaces and quiet chrome.
- **Cyan Telemetry** (`#3ee0d5`): Positive / “now value” signals.
- **Amber Ledger** (`#ffb347`): Spend / caution.
- **Rose Alert** (`#ff6b8a`): Destructive or loss.
- **Volt Spike** (`#b8ff5c`): Strong positive deltas.

### Neutral
- **Void** (`#06080c`): Page background.
- **Panel** (`#0e141c`): Cards and elevated boards.
- **Soft Well** (`#121a24`): Inputs, nested wells, popovers.
- **Fog Text** (`#eef3f8`): Primary text.
- **Muted Fog** (`#8b9aab`): Secondary labels (tint toward surface hue on colored boards; never pure gray-on-color).
- **Hull Line** (`#1e2a38`): Borders and dividers.

### Named Rules
**The One Steam Voice Rule.** Steam blue is the only brand accent for interactive chrome. Semantic colors carry meaning; they do not rebrand the shell.

## Typography

**Display / Body Font:** Outfit (system-ui fallback)
**Metric Font:** JetBrains Mono (ui-monospace fallback)

**Character:** Geometric sans for ops clarity; mono reserved for playtime, currency, and KPIs — never as a “tech costume” on body copy.

### Hierarchy
- **Headline** (700, ~1.25rem, tight tracking): Product title and section heroes.
- **Title** (600, ~1.1rem): Board and shelf section titles.
- **Body** (400, ~0.95rem): Supporting copy and list rows.
- **Label** (700, ~0.68rem, wide tracking, uppercase): Filter labels and metric captions — use sparingly; prefer a real heading when introducing a section.
- **Metric** (500, mono, ~1.1–1.35rem): Money and hours.

### Named Rules
**The Metric Mono Rule.** If it is not a number, code, or ID, it is not mono.

## Layout

Centered shell `min(1280px, 100% - 2rem)` with ~1.5rem top padding. Header chrome + tabbed Library / Value surfaces. Dense Operate rhythm: tight clusters inside boards, generous gaps between boards (~1–1.25rem). Library shelf uses responsive card grids; panorama fills one viewport band (`min(58vh, 560px)`). Break to single column under ~860px.

## Elevation & Depth

Hybrid: tonal surfaces first, then a soft ambient drop on primary chrome. Soft radial orbs behind the shell for atmosphere. No decorative two-axis grid overlays. No thick colored side-tabs on list cards.

### Shadow Vocabulary
- **Chrome lift** (`0 18px 50px rgba(0,0,0,0.35)` plus hairline ring): Header / primary ops bar.
- **Panel lift** (`0 12px 36px rgba(0,0,0,0.25)`): Glass panels and boards.
- **Signal glow** (small colored blur on active meters): Data emphasis only, never as a zero-offset halo substitute for depth.

## Shapes

Medium-soft radii (~12–16px on panels, ~10–12px on list rows). Progress meters use full pills. Borders are 1px hull lines; accents use border-color mix with Steam blue or semantic hues, not 3px side stripes.

## Components

### Buttons
- **Shape:** medium radius (`~0.6–0.75rem`)
- **Primary:** Steam blue fill, near-black text
- **Secondary / outline:** hull border on card surface
- **Focus:** Steam blue ring

### Chips / Toggle filters
- Quiet secondary surface; selected state uses primary tint border/fill
- Prefer ToggleGroup patterns already in Library / Value

### Cards / Containers
- Panel background `#0e141c`, 1px border, optional light gradient wash tinted by board accent
- No nested cards; no left accent bars on habit/note lists
- Internal padding ~1.1–1.35rem

### Inputs / Fields
- Soft well background, hull border, primary focus ring
- Search sits in shelf control rows beside sort toggles

### Tabs
- Compact shadcn TabsList in the header for Library / Value
- Shelf sorts use ToggleGroup, not a second page-level tab chrome

## Do's and Don'ts

### Do
- Keep the Steam mark flat and non-interactive next to the product name
- Use mono for hours and currency
- Prefer transform/opacity for motion; animate meter fills with `scaleX` from the left
- Preserve dark charcoal + Steam blue as the incumbent world

### Don't
- Add eyebrow kickers above headings (“Local telemetry”, section numbers, pill clusters)
- Use decorative grid-line backgrounds
- Use 3px colored left/top “side-tab” stripes on cards or lists
- Introduce Inter, purple gradients, cream+terracotta, or broadsheet newspaper layouts
- Nest cards or invent hero-metric marketing blocks inside Operate views
