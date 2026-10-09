# Yomi — Brand Spec (extracted from mangafire.to / mangabuddy.com)

## Observed DNA (reference sites)

- **Mangabuddy palette tokens**
  - `--bg: #0f0f13` (deep near-black, cool violet-cast)
  - `--panel: #17171d` (raised panel)
  - `--edge: #ecebee` (near-white text)
  - `--pop: #ffd23f` (amber yellow accent)
  - `--pop2: #37c2ff` (cyan secondary)
  - `--text: #ecebee`, `--muted: #9d9ca6`
  - **Hard-offset shadows**: `box-shadow: 6px 6px 0 rgba(236,235,238,.2)` on feature cards — a signature "neo-brutalist" offset shadow on dark.
- **Mangafire**: dark UI, condensed bold type for titles, horizontal scroll rails of cover cards, genre chips, accent red on hover/active.
- **Layout posture**: cover-card rails (horizontal snap-scroll), genre chip rows, "Latest/New" grids, top 10 ranks, section headers w/ small cap kicker.

## Yomi original tokens (OKLch, dark-cinematic "late-night reader")

| token | dark value | light value |
|---|---|---|
| `--bg` | oklch(14% 0.012 262) | oklch(98% 0.004 90) |
| `--panel` | oklch(18% 0.016 262) | oklch(100% 0 0) |
| `--fg` | oklch(93% 0.01 262) | oklch(15% 0.02 30) |
| `--muted` | oklch(64% 0.02 262) | oklch(45% 0.02 40) |
| `--edge`(border) | oklch(28% 0.02 262) | oklch(86% 0.02 60) |
| `--pop`(accent) | oklch(66% 0.22 25) — ember/vermillion red | oklch(58% 0.21 28) |

- **Accent stance**: one ember-red accent, used for active state + a *single* offset shadow per card, echoing the reference's signature shadow but in accent color.
- **Hue posture compromising mangabuddy's wintry violet + mangafire's red**: keep a very light violet-blue undertone in neutrals, pure ember red pop.
- **Type**: display = condensed impact (Anton / Archivo Black) for covers + section titles; body = Outfit/Inter-ish; mono = JetBrains for meta/numbers.
- **Radius**: minimal (8px covers, 4px cards), offset shadows carry the personality instead.