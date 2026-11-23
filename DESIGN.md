# Racenxt design guide

One look across the fan page, the athlete's editor, sign-up and (later) the iOS/Android apps.
Reference component: the **Where to watch** sheet (`tools/fan_watch.css`). Build every new popup, sheet and list like it.

## Colours
| Use | Value |
|---|---|
| Page background | `#0d0e11` |
| Sheet / card | `#16181d`, border `#2c2f37` |
| Row / field | `#1d2026`, border `#2a2d35`, hover `#23262d` / `#3a3d46` |
| Input background | `#0d0e11`, border `#2a2d35` |
| Text / muted / dim | `#f2f2ef` / `#9a9ca3` / `#6c6f77` |
| Accent | the championship colour (`--c`), otherwise Racenxt orange `#FF5A1F` |
| Accent tint (icon tiles, selected rows) | `color-mix(in srgb, var(--c) 14%, transparent)` |
| Backdrop | `rgba(5,6,8,.62)` + `blur(2px)` |

## Type
- Small label above titles: Barlow Condensed 700, 12px, letter-spacing .16em, uppercase, accent colour.
- Sheet / section title: Barlow Condensed 700, 24px, uppercase.
- Row title: Barlow 600, 17px. Row subtitle: Barlow 500, 13.5px, muted.
- Body and fields: Barlow 16px (never smaller on inputs: avoids zoom on iPhone).

## Shapes
- Sheets and cards: radius 22px. Rows and buttons: 14–16px. Icon tiles: 12px, 42px square.
- Round close button: 36px, `#1f2228`, border `#2f323a`, X icon (not a "×" character).
- Tap targets at least 44px high. Rows 64px.

## Sheets (every popup)
- Phone: slides up from the bottom, grab handle, swipe down to close, safe-area padding.
- Computer (≥700px): centred card, max ~520–560px wide, appears with a small scale + fade.
- Header: accent label, title, round close button. Content in rows or fields. Footer actions full width.
- Motion: 0.32s `cubic-bezier(.2,.85,.25,1)` in; ~0.25s out. Backdrop fades. `prefers-reduced-motion`: fade only.
- Always: focus moves into the sheet, Tab stays inside, Esc closes, focus returns to the button that opened it, page scroll locked.

## Buttons
- Primary: accent background, white text, radius 14px, 48px high in sheet footers.
- Secondary: `#1d2026` with border. Ghost: transparent, muted text.
- Segmented choices (e.g. Original / White / Black): `#0d0e11` track, selected segment `#23262d`.

## Words
- Plain, short, verb first ("Add your logo", "Save"). No jargon.
- Same names everywhere: **Official stream**, **TV broadcast** (fans) / **TV broadcasters** + **Event broadcast** (admin).
