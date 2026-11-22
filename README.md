# Racenxt

Race Hub pages for athletes: one link with their season, live schedules in each fan's time zone, where to watch, car and sponsors.

## Structure

- `docs/` – the website (served by GitHub Pages)
  - `index.html` – landing page
  - `404.html` – fan page; any address like `/racenxt/<athlete>` shows that athlete's Race Hub
  - `fan.html` – same fan page, for local testing (`fan.html?a=<athlete>`)
  - `admin.html` – admin space (championships, races, sessions, circuits, vehicles, review queue, athletes)
  - `rnx-data.js` – loads an athlete's data from the database
  - `config.js` – public database address and key
- `supabase/migrations/` – database structure and security rules
- `supabase/functions/ics/` – calendar files (add sessions, subscribe)
- `supabase/seed/` – starter data
- `tools/port_fan.py` – rebuilds the fan page from the Louis Race Hub design

Spec: Racenxt – V1 Product Spec (Claude doc).
