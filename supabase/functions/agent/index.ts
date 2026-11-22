// Racenxt research agent.
// POST { action: "discover", series_id }  -> finds official site, logo, calendar; files proposals
// POST { action: "check_event", event_id } -> finds the race timetable and where-to-watch; files proposals
// Callers: signed-in admins (from the admin page) or the service role (scheduled checks).
// The agent never publishes: everything fans see goes through the Review queue.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const SB = Deno.env.get("SUPABASE_URL")!;
const SRK = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const AKEY = Deno.env.get("ANTHROPIC_API_KEY") || "";
const MODEL = "claude-sonnet-5-5";
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...CORS, "Content-Type": "application/json" } });

// ---------- database (service role) ----------
const H = { apikey: SRK, Authorization: `Bearer ${SRK}`, "Content-Type": "application/json" };
async function db(path: string, opt: RequestInit = {}) {
  const r = await fetch(`${SB}/rest/v1/${path}`, { ...opt, headers: { ...H, Prefer: "return=representation", ...(opt.headers || {}) } });
  const t = await r.text();
  if (!r.ok) throw new Error(`db ${r.status}: ${t.slice(0, 300)}`);
  return t ? JSON.parse(t) : null;
}
const ins = (t: string, row: unknown) => db(t, { method: "POST", body: JSON.stringify(row) });
const patch = (t: string, q: string, row: unknown) => db(`${t}?${q}`, { method: "PATCH", body: JSON.stringify(row) });

async function isAdmin(token: string) {
  if (token === SRK) return true;
  const r = await fetch(`${SB}/rest/v1/rpc/am_i_admin`, { method: "POST", headers: { apikey: Deno.env.get("SUPABASE_ANON_KEY")!, Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: "{}" });
  return r.ok && (await r.json()) === true;
}

// ---------- Claude with web search + web fetch ----------
type Usage = { input: number; output: number; searches: number; fetches: number };
async function claude(system: string, user: string, fetchDomains: string[] = []) {
  const tools: any[] = [
    { type: "web_search_20250305", name: "web_search", max_uses: 6 },
    { type: "web_fetch_20250910", name: "web_fetch", max_uses: 12, max_content_tokens: 60000, ...(fetchDomains.length ? { allowed_domains: fetchDomains } : {}) },
  ];
  const messages: any[] = [{ role: "user", content: user }];
  const usage: Usage = { input: 0, output: 0, searches: 0, fetches: 0 };
  let text = "";
  for (let i = 0; i < 8; i++) {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": AKEY, "anthropic-version": "2023-06-01", "anthropic-beta": "web-fetch-2025-09-10", "content-type": "application/json" },
      body: JSON.stringify({ model: MODEL, max_tokens: 16000, system, messages, tools }),
    });
    const j = await r.json();
    if (!r.ok) throw new Error(`AI ${r.status}: ${j?.error?.message || JSON.stringify(j).slice(0, 200)}`);
    usage.input += j.usage?.input_tokens || 0;
    usage.output += j.usage?.output_tokens || 0;
    usage.searches += j.usage?.server_tool_use?.web_search_requests || 0;
    usage.fetches += j.usage?.server_tool_use?.web_fetch_requests || 0;
    messages.push({ role: "assistant", content: j.content });
    if (j.stop_reason === "pause_turn") continue;
    text = (j.content || []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("\n");
    break;
  }
  return { text, usage };
}
function parseJson(text: string) {
  const m = text.match(/```json\s*([\s\S]*?)```/) || text.match(/<json>([\s\S]*?)<\/json>/);
  const raw = m ? m[1] : text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
  return JSON.parse(raw);
}
const host = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return ""; } };
const okDate = (s: unknown) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
const norm = (s: string) => (s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").trim();

const RULES = `You are the research agent of Racenxt, an app that shows athletes' race calendars to their fans.
Rules:
- Use the championship's OFFICIAL website as the source of truth for dates, timetables and broadcast information. Use web search only to find that official site or pages on it. Never take dates or times from news sites, fan sites, Wikipedia or ticket resellers.
- Times must be LOCAL CIRCUIT TIME exactly as published (no conversion). Format YYYY-MM-DD HH:MM, 24-hour.
- Never guess. If something is not published on the official site, leave it out or set it to null.
- Finish with ONE fenced \`\`\`json code block that follows the requested schema, and nothing after it.`;

// ---------- discover: official site, logo, calendar ----------
async function discover(series: any, src: any, runId: string) {
  const year = new Date().getUTCFullYear();
  const known = await db(`events?series_id=eq.${series.id}&select=id,year,round,name,start_date,end_date,duration_label,venues(name)`);
  const user = `Championship: ${series.name}${series.short_name && series.short_name !== series.name ? ` (${series.short_name})` : ""}
Sport category: ${series.sport}
Known official website: ${series.website_url || "unknown"}
Today: ${new Date().toISOString().slice(0, 10)}
${src?.agent_instructions ? `Instructions from the Racenxt team:\n${src.agent_instructions}\n` : ""}
Task:
1. Find the official website of this championship.
2. Find the official logo as a direct image URL (PNG, SVG or JPG) hosted on the official site or its CDN.
3. Find the official calendar page and read the season calendar for ${year} and ${year + 1} (only seasons that are officially published; skip rounds that are already over in ${year}).
4. For each race weekend: round number, official race name, first and last day of the race weekend (YYYY-MM-DD), race length label if published (e.g. "4h", "24h", "2 × 30 min"), and the circuit: official circuit name, town, country, ISO 3166 two-letter country code, IANA time zone (e.g. Europe/Paris) and approximate latitude/longitude.
5. Find the official page where fans can watch (official streaming service, YouTube channel or TV page), if published.
JSON schema:
{"website_url": string|null, "logo_url": string|null, "calendar_url": string|null, "watch_url": string|null,
 "seasons": [{"year": number, "events": [{"round": number|null, "name": string, "start_date": "YYYY-MM-DD", "end_date": "YYYY-MM-DD", "duration_label": string|null,
   "circuit": {"name": string, "city": string|null, "country": string, "country_code": string|null, "timezone": string, "lat": number|null, "lng": number|null}}]}],
 "notes": string}`;
  const { text, usage } = await claude(RULES, user);
  const out = parseJson(text);
  const site = out.website_url || series.website_url;
  const domain = host(site || "");
  const props: string[] = [];

  // agent settings and website (internal, not shown to fans)
  const urls = [...new Set([...(src?.urls || []).map((u: any) => u.url), out.calendar_url].filter(Boolean))];
  const domains = [...new Set([...(src?.allowed_domains || []), domain].filter(Boolean))];
  await db("series_sources", { method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify({ series_id: series.id, urls: urls.map(url => ({ url })), allowed_domains: domains, agent_instructions: src?.agent_instructions || "" }) });
  const upd: any = {};
  if (!series.website_url && site) upd.website_url = site;
  // logo: copied to our storage when the championship has none yet
  if (!series.logo_url && out.logo_url) {
    try {
      const img = await fetch(out.logo_url);
      const type = img.headers.get("content-type") || "";
      if (img.ok && type.startsWith("image/")) {
        const ext = type.includes("svg") ? "svg" : type.includes("png") ? "png" : type.includes("webp") ? "webp" : "jpg";
        const path = `series/${series.slug}-agent-${Date.now()}.${ext}`;
        const up = await fetch(`${SB}/storage/v1/object/media/${path}`, { method: "POST", headers: { apikey: SRK, Authorization: `Bearer ${SRK}`, "Content-Type": type, "x-upsert": "true" }, body: await img.arrayBuffer() });
        if (up.ok) upd.logo_url = `${SB}/storage/v1/object/public/media/${path}`;
      }
    } catch (_) { /* logo is optional */ }
  }
  if (Object.keys(upd).length) await patch("series", `id=eq.${series.id}`, upd);

  // where to watch (shown to fans -> review)
  if (out.watch_url && out.watch_url !== series.watch_url) {
    await ins("proposals", { run_id: runId, series_id: series.id, kind: "watch_link", payload: { watch_url: out.watch_url }, evidence: { url: out.watch_url, excerpt: "Official where-to-watch page for the championship" } });
    props.push("where to watch");
  }

  // calendar: new races in one proposal, changed dates as separate proposals
  const found = (out.seasons || []).flatMap((s: any) => (s.events || []).map((e: any) => ({ ...e, year: s.year || +String(e.start_date).slice(0, 4) })))
    .filter((e: any) => e.name && okDate(e.start_date) && okDate(e.end_date || e.start_date));
  const fresh: any[] = [];
  for (const e of found) {
    const match = known.find((k: any) => k.year === e.year && (
      (e.circuit?.name && k.venues?.name && norm(k.venues.name) === norm(e.circuit.name)) ||
      norm(k.name) === norm(e.name) ||
      (e.round && k.round === e.round)));
    if (!match) { fresh.push(e); continue; }
    if (match.start_date !== e.start_date || match.end_date !== (e.end_date || e.start_date)) {
      await ins("proposals", { run_id: runId, series_id: series.id, event_id: match.id, kind: "event_change",
        payload: { start_date: e.start_date, end_date: e.end_date || e.start_date, ...(e.duration_label ? { duration_label: e.duration_label } : {}) },
        evidence: { url: out.calendar_url || site, excerpt: `${e.name}: ${e.start_date} → ${e.end_date}` } });
      props.push(`date change: ${match.name}`);
    }
  }
  if (fresh.length) {
    await ins("proposals", { run_id: runId, series_id: series.id, kind: "new_season",
      payload: { events: fresh.map((e: any) => ({ round: e.round ?? null, name: e.name, start_date: e.start_date, end_date: e.end_date || e.start_date, duration_label: e.duration_label || null, year: e.year, circuit: e.circuit || null })) },
      evidence: { url: out.calendar_url || site, excerpt: out.notes || "" } });
    props.push(`${fresh.length} new race${fresh.length > 1 ? "s" : ""}`);
  }
  const summary = props.length ? `Found: ${props.join(", ")}.` : "Nothing new: the calendar matches what we have.";
  return { result: props.length ? "proposal" : "no_change", summary, usage, pages: [site, out.calendar_url].filter(Boolean).map((url: string) => ({ url })) };
}

// ---------- check_event: timetable + where to watch ----------
async function checkEvent(ev: any, series: any, src: any, runId: string) {
  const current = await db(`sessions?event_id=eq.${ev.id}&select=label,type,local_start,duration_min&order=local_start`);
  const v = ev.venues || {};
  const user = `Championship: ${series.name}${series.short_name && series.short_name !== series.name ? ` (${series.short_name})` : ""}
Official website: ${series.website_url || "unknown"}
${(src?.urls || []).length ? `Official pages we know: ${(src.urls || []).map((u: any) => u.url).join(", ")}\n` : ""}Race: ${ev.name}
Dates: ${ev.start_date} to ${ev.end_date}
Circuit: ${[v.name, v.city, v.country].filter(Boolean).join(", ")} (local time zone ${v.timezone || "unknown"})
Today: ${new Date().toISOString().slice(0, 10)}
${src?.agent_instructions ? `Instructions from the Racenxt team:\n${src.agent_instructions}\n` : ""}
Task:
1. Find the official timetable (schedule) of this race weekend on the official website (it can be an HTML page or a PDF). List every on-track session of THIS championship (all its classes/categories): practice, qualifying, hyperpole, warm-up, races. Skip support series and non-track events.
2. Find the official where-to-watch information for this race (streaming link or official broadcast page), if published.
If the timetable is not published yet, set "timetable_found": false and an empty list.
JSON schema:
{"timetable_found": boolean, "source_url": string|null, "excerpt": string|null,
 "sessions": [{"label": string, "type": "practice"|"qualifying"|"race"|"warmup"|"other", "local_start": "YYYY-MM-DD HH:MM", "duration_min": number|null, "category": string|null}],
 "watch_url": string|null}`;
  const { text, usage } = await claude(RULES, user);
  const out = parseJson(text);
  const props: string[] = [];
  const lo = new Date(ev.start_date + "T00:00:00Z").getTime() - 2 * 864e5, hi = new Date(ev.end_date + "T23:59:00Z").getTime() + 864e5;
  const sessions = (out.sessions || []).filter((s: any) => s.label && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(s.local_start || "") && (() => { const t = new Date(s.local_start.replace(" ", "T") + ":00Z").getTime(); return t >= lo && t <= hi; })())
    .map((s: any) => ({ label: s.label, type: ["practice", "qualifying", "race", "warmup", "other"].includes(s.type) ? s.type : "other", local_start: s.local_start, duration_min: Math.max(1, Math.round(+s.duration_min || 60)), category: s.category || null }));
  if (out.timetable_found && sessions.length) {
    const key = (l: any[]) => JSON.stringify(l.map(s => [String(s.local_start).replace("T", " ").slice(0, 16), norm(s.label), s.duration_min]).sort());
    if (key(sessions) !== key(current)) {
      await ins("proposals", { run_id: runId, series_id: series.id, event_id: ev.id, kind: "timetable", payload: { sessions }, evidence: { url: out.source_url || series.website_url || "", excerpt: out.excerpt || "" } });
      props.push(`timetable (${sessions.length} sessions)`);
    }
  }
  const curWatch = ev.watch_url || series.watch_url;
  if (out.watch_url && out.watch_url !== curWatch) {
    await ins("proposals", { run_id: runId, series_id: series.id, event_id: series.watch_url ? ev.id : null, kind: "watch_link", payload: { watch_url: out.watch_url }, evidence: { url: out.watch_url, excerpt: `Where to watch ${ev.name}` } });
    props.push("where to watch");
  }
  const summary = props.length ? `Found: ${props.join(", ")}.` : out.timetable_found ? "Nothing new: timetable unchanged." : "Timetable not published yet.";
  return { result: props.length ? "proposal" : "no_change", summary, usage, pages: [out.source_url].filter(Boolean).map((url: string) => ({ url })) };
}

// ---------- entry ----------
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token || !(await isAdmin(token))) return json({ error: "admins only" }, 403);
  if (!AKEY) return json({ error: "ANTHROPIC_API_KEY is not set" }, 500);
  let body: any = {};
  try { body = await req.json(); } catch { return json({ error: "bad request" }, 400); }

  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!UUID.test(body.series_id || body.event_id || "")) return json({ error: "bad id" }, 400);
  let series: any, ev: any = null;
  if (body.action === "discover") {
    [series] = await db(`series?id=eq.${body.series_id}&select=*`);
  } else if (body.action === "check_event") {
    [ev] = await db(`events?id=eq.${body.event_id}&select=*,venues(name,city,country,timezone)`);
    if (ev?.series_id) [series] = await db(`series?id=eq.${ev.series_id}&select=*`);
  } else return json({ error: "unknown action" }, 400);
  if (!series) return json({ error: "not found" }, 404);
  const [src] = await db(`series_sources?series_id=eq.${series.id}&select=*`);

  const [run] = await ins("check_runs", { series_id: series.id, event_id: ev?.id || null, kind: body.kind || (body.action === "discover" ? "discover" : "manual"), result: "running", pages: [] });
  const job = (async () => {
    try {
      const r = body.action === "discover" ? await discover(series, src, run.id) : await checkEvent(ev, series, src, run.id);
      await patch("check_runs", `id=eq.${run.id}`, { result: r.result, summary: r.summary, usage: r.usage, pages: r.pages, finished_at: new Date().toISOString() });
    } catch (e) {
      await patch("check_runs", `id=eq.${run.id}`, { result: "error", error: String((e as Error).message || e).slice(0, 500), finished_at: new Date().toISOString() });
    }
  })();
  // @ts-ignore EdgeRuntime is provided by Supabase
  if (typeof EdgeRuntime !== "undefined") EdgeRuntime.waitUntil(job); else await job;
  return json({ run_id: run.id });
});
