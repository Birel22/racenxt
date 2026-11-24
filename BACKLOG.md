# Racenxt backlog (ideas kept for later)

## Karting: single-round titled events
Many karting titles are one-event championships (e.g. ACI 2027: Coppa dei Campioni ACI Sport 9-10 Oct,
Campionato Italiano KZN & Trofeo Nazionale MINI Gr.3 5-7 Nov at South Garda Karting Lonato, Legend 100/125 TBA).
Karting could be a big market: plan a simple way to add one-event championships (a championship with a single event),
and let the calendar agent pick them up from the organiser's pages. Not part of the first agent test.

## Security, later
- "New sign-in on your account" email (needs the Resend key as an Edge Function secret).
- Leaked-password protection (Supabase Pro plan).

## Agent
- Cost saving: judge a timetable "complete" only for the classes published athletes race in (e.g. KZ2 out, OK Junior not: stop re-checking if no athlete is in OK Junior). Today every class must be complete (migration 0038; the per-class version was 0037).
- Cloudflare Browser Run for logos (code ready, off): add secrets CF_ACCOUNT_ID + CF_BROWSER_TOKEN (token permission "Browser Run - Edit"). Free plan: 10 min/day.
- Schedule agent: time zone on pages with a "my time / track time" switch (ALMS Jerez read 1 h late). Check the page's own zone instead of assuming UTC.
