// Calendar files for fan pages.
//   ?p=<slug>&s=<sessionId,...>   -> one-off file with the chosen sessions (alert 15 min before)
//   ?p=<slug>&k=all|qr|r          -> subscription feed (everything / qualifying + races / races only)
// Public: serves only published profiles, read with the publishable key under row level security.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const URL_ = Deno.env.get("SUPABASE_URL")!;
const KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const H = { apikey: KEY, Authorization: `Bearer ${KEY}` };
const get = async (p: string) => {
  const r = await fetch(`${URL_}/rest/v1/${p}`, { headers: H });
  if (!r.ok) throw new Error(`${r.status} ${p}`);
  return r.json();
};

const esc = (t: string) => String(t ?? "").replace(/\\/g, "\\\\").replace(/,/g, "\\,").replace(/;/g, "\\;").replace(/\n/g, "\\n");
const dt = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
const day = (s: string) => s.replace(/-/g, "");
const fold = (line: string) => {
  const out: string[] = []; let s = line;
  while (new TextEncoder().encode(s).length > 73) { out.push(s.slice(0, 70)); s = " " + s.slice(70); }
  out.push(s); return out.join("\r\n");
};

Deno.serve(async (req) => {
  const u = new URL(req.url);
  const slug = (u.searchParams.get("p") || "").toLowerCase();
  const ids = (u.searchParams.get("s") || "").split(",").filter(x => /^[0-9a-f-]{36}$/.test(x));
  const kind = u.searchParams.get("k");
  if (!/^[a-z0-9-]{2,40}$/.test(slug)) return new Response("Not found", { status: 404 });
  try {
    // one race's sessions ("Add to calendar"): race sessions are public data, so this also works while the page is in preview
    if (ids.length) {
      const ss = await get(`session_times?id=in.(${ids.join(",")})&select=id,event_id,type,label,start_utc,end_utc&order=start_utc`);
      if (!ss.length) return new Response("Not found", { status: 404 });
      const evs = await get(`events?id=in.(${[...new Set(ss.map((x: any) => x.event_id))].join(",")})&select=id,series_id,name,venues(name,city,country),series(short_name,website_url)`);
      const [pf] = await get(`profiles?slug=eq.${slug}&select=display_name`);
      const byId = Object.fromEntries(evs.map((e: any) => [e.id, e]));
      const now = dt(new Date());
      const L: string[] = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Racenxt//Race Hub//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH"];
      for (const x of ss) {
        const e = byId[x.event_id]; if (!e) continue;
        const t = `${e.series?.short_name ? e.series.short_name + " " : ""}${e.name}`, summary = `${t} – ${x.label}`;
        const loc = [e.venues?.name, e.venues?.city, e.venues?.country].filter(Boolean).join(", ");
        L.push("BEGIN:VEVENT", `UID:${x.id}@racenxt`, `DTSTAMP:${now}`, `DTSTART:${dt(new Date(x.start_utc))}`, `DTEND:${dt(new Date(x.end_utc))}`,
          fold(`SUMMARY:${esc(summary)}`), fold(`LOCATION:${esc(loc)}`),
          fold(`DESCRIPTION:${esc([pf?.display_name, t, e.series?.website_url].filter(Boolean).join(" · "))}`),
          "BEGIN:VALARM", "ACTION:DISPLAY", fold(`DESCRIPTION:${esc(summary)}`), "TRIGGER:-PT15M", "END:VALARM", "END:VEVENT");
      }
      L.push("END:VCALENDAR");
      return new Response(L.join("\r\n") + "\r\n", { headers: { "Content-Type": "text/calendar; charset=utf-8", "Content-Disposition": `inline; filename="${slug}-sessions.ics"`, "Cache-Control": "public, max-age=300", "Access-Control-Allow-Origin": "*" } });
    }
    const [prof] = await get(`profiles?slug=eq.${slug}&published=eq.true&select=id,display_name,first_name`);
    if (!prof) return new Response("Not found", { status: 404 });
    const entries = await get(`entries?profile_id=eq.${prof.id}&select=series_id,year,category,series(short_name,website_url,classes)`);
    const overrides = await get(`event_overrides?profile_id=eq.${prof.id}&hidden=eq.true&select=event_id`);
    const hidden = new Set(overrides.map((o: any) => o.event_id));
    const ors = entries.map((e: any) => `and(series_id.eq.${e.series_id},year.eq.${e.year})`);
    ors.push(`owner_profile_id.eq.${prof.id}`);
    // shared calendars (e.g. IMSA): only the races where the athlete's class races
    const ck = (c: any) => String(c || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    const myCls: Record<string, string> = {};
    for (const en of entries) if (en.category && (en.series?.classes || []).some((c: any) => ck(c) === ck(en.category))) myCls[en.series_id + "|" + en.year] = ck(en.category);
    const events = (await get(`events?or=(${ors.join(",")})&select=id,series_id,year,classes,name,start_date,end_date,venues(name,city,country)&order=start_date`))
      .filter((e: any) => !hidden.has(e.id))
      .filter((e: any) => { const mc = e.series_id && myCls[e.series_id + "|" + e.year]; return !(mc && (e.classes || []).length && !e.classes.some((c: any) => ck(c) === mc)); });
    const evById = Object.fromEntries(events.map((e: any) => [e.id, e]));
    const short = Object.fromEntries(entries.map((e: any) => [e.series_id, e.series?.short_name || ""]));
    const site = Object.fromEntries(entries.map((e: any) => [e.series_id, e.series?.website_url || ""]));
    const evIds = events.map((e: any) => e.id);
    let sessions: any[] = evIds.length ? await get(`session_times?event_id=in.(${evIds.join(",")})&select=id,event_id,type,label,start_utc,end_utc&order=start_utc`) : [];
    if (ids.length) sessions = sessions.filter(s => ids.includes(s.id));
    else if (kind === "qr") sessions = sessions.filter(s => s.type === "qualifying" || s.type === "race");
    else if (kind === "r") sessions = sessions.filter(s => s.type === "race");
    if (ids.length && !sessions.length) return new Response("Not found", { status: 404 });

    const now = dt(new Date());
    const name = prof.display_name;
    const loc = (e: any) => [e.venues?.name, e.venues?.city, e.venues?.country].filter(Boolean).join(", ");
    const title = (e: any) => `${e.series_id ? short[e.series_id] + " " : ""}${e.name}`;
    const L: string[] = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Racenxt//Race Hub//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH"];
    if (!ids.length) {
      L.push(`X-WR-CALNAME:${esc((prof.first_name || name.split(" ")[0]) + " Race Hub")}`, "REFRESH-INTERVAL;VALUE=DURATION:PT6H", "X-PUBLISHED-TTL:PT6H");
      // race weekends as all-day events
      for (const e of events) {
        const end = new Date(e.end_date + "T00:00:00Z"); end.setUTCDate(end.getUTCDate() + 1);
        L.push("BEGIN:VEVENT", `UID:wk-${e.id}@racenxt`, `DTSTAMP:${now}`, `DTSTART;VALUE=DATE:${day(e.start_date)}`, `DTEND;VALUE=DATE:${dt(end).slice(0, 8)}`,
          fold(`SUMMARY:${esc("🏁 " + title(e))}`), fold(`LOCATION:${esc(loc(e))}`), "TRANSP:TRANSPARENT", "END:VEVENT");
      }
    }
    for (const s of sessions) {
      const e = evById[s.event_id];
      const summary = `${title(e)} – ${s.label}`;
      L.push("BEGIN:VEVENT", `UID:${s.id}@racenxt`, `DTSTAMP:${now}`, `DTSTART:${dt(new Date(s.start_utc))}`, `DTEND:${dt(new Date(s.end_utc))}`,
        fold(`SUMMARY:${esc(summary)}`), fold(`LOCATION:${esc(loc(e))}`),
        fold(`DESCRIPTION:${esc(name + " · " + title(e) + (e.series_id && site[e.series_id] ? " · " + site[e.series_id] : ""))}`),
        "BEGIN:VALARM", "ACTION:DISPLAY", fold(`DESCRIPTION:${esc(summary)}`), "TRIGGER:-PT15M", "END:VALARM", "END:VEVENT");
    }
    L.push("END:VCALENDAR");
    const file = ids.length ? `${slug}-sessions.ics` : `${slug}-race-hub.ics`;
    return new Response(L.join("\r\n") + "\r\n", {
      headers: {
        "Content-Type": "text/calendar; charset=utf-8",
        "Content-Disposition": `inline; filename="${file}"`,
        "Cache-Control": "public, max-age=300",
        "Access-Control-Allow-Origin": "*",
      },
    });
  } catch (err) {
    console.error(err);
    return new Response("Error", { status: 500 });
  }
});
