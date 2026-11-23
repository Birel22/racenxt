// Racenxt research agent.
// POST { action: "discover", series_id }  -> finds official site, logo, calendar (+ timetables already out); files proposals
// POST { action: "check_event", event_id } -> finds the race timetable and where-to-watch; files proposals
// POST { action: "links", series_id }     -> the championship's official stream + list of TV broadcasters; files a proposal
// POST { action: "logo", series_id }      -> logo candidates from the official homepage (no AI; the admin page picks with AI)
// POST { action: "prompts" }               -> the instructions for each task, for the admin Agent page
// POST { action: "tick" } + x-cron-secret      -> called by pg_cron every 15 min: starts the checks that are due
// Scheduled checks (monthly / daily) first compare the official pages with last time and skip the AI if unchanged.
// Callers: signed-in admins (from the admin page) or the service role (scheduled checks).
// The agent never publishes: everything fans see goes through the Review queue.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const SB = Deno.env.get("SUPABASE_URL")!;
const SRK = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const AKEY = Deno.env.get("ANTHROPIC_API_KEY") || "";
// Haiku 5.5 does the reading (about 20x cheaper); Sonnet 5.5 steps in only if Haiku's answer can't be used.
// Everything still goes through human review before fans see it.
const FAST = "claude-haiku-5-5", STRONG = "claude-sonnet-5-5";
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15";
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
type Trace = { searches: string[]; opened: string[]; answer?: unknown };
const addTrace = (a: Trace, b: Trace) => { a.searches.push(...b.searches); a.opened.push(...b.opened); return a; };
type Usage = { input: number; output: number; searches: number; fetches: number; cost_usd: number; model?: string };
// Prices per million tokens. Haiku 5.5: $0.10 / $0.50 when a request's prompt is up to 100k tokens, $0.50 / $2.50 above.
// Sonnet 5.5: $2 / $10. Web search: $10 per 1,000 searches. Web fetch: no extra charge.
function priceOf(model: string, inp: number, out: number) {
  if (model === FAST) return inp > 100000 ? inp * 0.5 / 1e6 + out * 2.5 / 1e6 : inp * 0.1 / 1e6 + out * 0.5 / 1e6;
  return inp * 2 / 1e6 + out * 10 / 1e6;
}
const newUsage = (): Usage => ({ input: 0, output: 0, searches: 0, fetches: 0, cost_usd: 0 });
function addUsage(a: Usage, b: Usage) { a.input += b.input; a.output += b.output; a.searches += b.searches; a.fetches += b.fetches; a.cost_usd = Math.round((a.cost_usd + b.cost_usd) * 10000) / 10000; a.model = a.model ? `${a.model} + ${b.model}` : b.model; return a; }
// Ask with Haiku first; if the answer isn't usable JSON, ask Sonnet once.
async function ask(system: string, user: string, maxFetch = 8, models = [FAST, STRONG]) {
  const total = newUsage(), trace: Trace = { searches: [], opened: [] };
  let last = "";
  for (const model of models) {
    try {
      const r = await claude(model, system, user, maxFetch);
      addUsage(total, r.usage); addTrace(trace, r.trace);
      return { out: parseJson(r.text), usage: total, trace };
    } catch (e) { last = String((e as Error).message || e); /* try the stronger model */ }
  }
  throw new Error(last || "The AI's answer couldn't be read");
}
async function claude(model: string, system: string, user: string, maxFetch: number) {
  const tools: any[] = [
    { type: "web_search_20250305", name: "web_search", max_uses: 4 },
    // smaller page extracts keep each request short (and under Haiku's 100k price step)
    { type: "web_fetch_20250910", name: "web_fetch", max_uses: maxFetch, max_content_tokens: 15000 },
  ];
  const messages: any[] = [{ role: "user", content: user }];
  const usage = newUsage(); usage.model = model;
  const trace: Trace = { searches: [], opened: [] };
  let text = "";
  for (let i = 0; i < 8; i++) {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": AKEY, "anthropic-version": "2023-06-01", "anthropic-beta": "web-fetch-2025-09-10", "content-type": "application/json" },
      body: JSON.stringify({ model, max_tokens: 16000, system, messages, tools }),
    });
    const j = await r.json();
    if (!r.ok) throw new Error(`AI ${r.status}: ${j?.error?.message || JSON.stringify(j).slice(0, 200)}`);
    const inp = (j.usage?.input_tokens || 0) + (j.usage?.cache_read_input_tokens || 0) + (j.usage?.cache_creation_input_tokens || 0), outp = j.usage?.output_tokens || 0;
    usage.input += inp; usage.output += outp; usage.cost_usd += priceOf(model, inp, outp);
    const se = j.usage?.server_tool_use?.web_search_requests || 0;
    usage.searches += se; usage.cost_usd += se * 0.01;
    usage.fetches += j.usage?.server_tool_use?.web_fetch_requests || 0;
    for (const b of j.content || []) if (b.type === "server_tool_use") {
      if (b.name === "web_search" && b.input?.query) trace.searches.push(String(b.input.query));
      if (b.name === "web_fetch" && b.input?.url) trace.opened.push(String(b.input.url));
    }
    messages.push({ role: "assistant", content: j.content });
    if (j.stop_reason === "pause_turn") continue;
    text = (j.content || []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("\n");
    break;
  }
  usage.cost_usd = Math.round(usage.cost_usd * 10000) / 10000;
  return { text, usage, trace };
}
function parseJson(text: string) {
  const m = text.match(/```json\s*([\s\S]*?)```/) || text.match(/<json>([\s\S]*?)<\/json>/);
  const raw = m ? m[1] : text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
  return JSON.parse(raw);
}
const host = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return ""; } };
const okDate = (s: unknown) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
const norm = (s: string) => (s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").trim();

// ---------- time zones: official sites often show times in UTC or in the visitor's zone; we store circuit local time ----------
function tzOffset(ms: number, tz: string) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(new Date(ms)).map(x => [x.type, x.value]));
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second) - ms;
}
function wallToUtc(wall: string, tz: string) {
  const [d, t] = wall.split(" "); const [y, mo, da] = d.split("-").map(Number); const [h, mi] = t.split(":").map(Number);
  const guess = Date.UTC(y, mo - 1, da, h, mi);
  let ms = guess - tzOffset(guess, tz);
  ms = guess - tzOffset(ms, tz);
  return ms;
}
function utcToWall(ms: number, tz: string) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).formatToParts(new Date(ms)).map(x => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day} ${String(+p.hour % 24).padStart(2, "0")}:${p.minute}`;
}
const validTz = (tz: string) => { try { new Intl.DateTimeFormat("en", { timeZone: tz }); return true; } catch { return false; } };
// the page's zone as the AI reported it -> an IANA zone ("local" = the circuit's own zone)
function pageZone(z: any, circuitTz: string) {
  const v = String(z || "local").trim();
  if (!v || /^local|track|circuit/i.test(v)) return circuitTz;
  if (/^(utc|gmt|z)$/i.test(v) || /^(utc|gmt)\s*[+±]?\s*0?0?(:00)?$/i.test(v)) return "UTC";
  const off = v.match(/^(?:utc|gmt)\s*([+-])\s*(\d{1,2})(?::?(\d{2}))?$/i);
  if (off && !off[3]) return `Etc/GMT${off[1] === "+" ? "-" : "+"}${+off[2]}`;
  return validTz(v) ? v : circuitTz;
}
function toCircuitTime(list: any[], zone: string, circuitTz: string) {
  if (!circuitTz || !validTz(circuitTz) || zone === circuitTz) return list;
  return (list || []).map((x: any) => x && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(x.local_start || "") ? { ...x, local_start: utcToWall(wallToUtc(x.local_start, zone), circuitTz), ...(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(x.local_end || "") ? { local_end: utcToWall(wallToUtc(x.local_end, zone), circuitTz) } : {}) } : x);
}

// race names: no championship name, year, round number ("4 Hours of Jerez", not "4 Hours of Jerez by ALMS 2027")
const reEsc = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
function cleanName(name: string, series: any) {
  const orig = String(name || "").trim();
  let n = orig;
  const names = [series.name, series.short_name, String(series.name || "").replace(/^FIA\s+/i, "")].filter((x: string) => x && x.length > 1).sort((a: string, b: string) => b.length - a.length);
  for (const x of names) n = n.replace(new RegExp(`\\s*\\(?\\s*(?:by\\s+)?\\b${reEsc(x)}\\b(?:\\s+round\\s+\\d+)?\\s*\\)?\\s*[-–—:]?\\s*`, "ig"), " ");
  n = n.replace(/\(\s*round\s*\d+\s*\)/ig, " ").replace(/\b(19|20)\d{2}\b/g, " ").replace(/^\s*(?:R|Rd|Round)\s*\d+\s*[-–—:]\s*/i, "")
    .replace(/\(\s*\)/g, " ").replace(/^\s*[-–—:]\s*|\s*[-–—:]\s*$/g, "").replace(/\s{2,}/g, " ").trim();
  return n.length >= 3 ? n : orig;
}

const TYPES = ["practice", "qualifying", "race", "warmup", "other"];
// one name per session kind, whatever wording the official page uses ("First Practice Session" -> "Practice 1")
const ORD: Record<string, string> = { first: "1", second: "2", third: "3", fourth: "4", "1st": "1", "2nd": "2", "3rd": "3", "4th": "4" };
function normLabel(label: string) {
  let l = String(label || "").replace(/\s+/g, " ").trim();
  l = l.replace(/\s*\((?:[^)]*\b(?:laps?|mins?|minutes?|hours?|h)\b[^)]*)\)\s*/ig, " ").replace(/\bsession\b/ig, " ").replace(/\s+/g, " ").trim();
  let m = l.match(/^(first|second|third|fourth|1st|2nd|3rd|4th)\s+(?:free\s+)?practice$/i); if (m) return `Practice ${ORD[m[1].toLowerCase()]}`;
  m = l.match(/^(?:free\s+practice|practice|fp)\s*(\d)$/i); if (m) return `Practice ${m[1]}`;
  if (/^free practice$/i.test(l)) return "Practice";
  if (/^grand prix$/i.test(l)) return "Race";
  m = l.match(/^(first|second|third|1st|2nd|3rd)\s+qualifying$/i); if (m) return `Qualifying ${ORD[m[1].toLowerCase()]}`;
  return l.replace(/^\w/, c => c.toUpperCase());
}
const DEF_MIN: Record<string, number> = { practice: 60, qualifying: 60, race: 60, warmup: 20, other: 60 };
function cleanSessions(list: any[], start: string, end: string) {
  const lo = new Date(start + "T00:00:00Z").getTime() - 2 * 864e5, hi = new Date(end + "T23:59:00Z").getTime() + 864e5;
  const ms = (w: string) => new Date(w.replace(" ", "T") + ":00Z").getTime();
  return (list || []).filter((x: any) => x && x.label && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(x.local_start || "") && (() => { const t = ms(x.local_start); return t >= lo && t <= hi; })())
    .map((x: any) => {
      const type = TYPES.includes(x.type) ? x.type : "other";
      // the end time shown on the timetable wins; otherwise the stated length; otherwise a typical length, flagged
      let dur = 0, est = false;
      if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(x.local_end || "")) dur = Math.round((ms(x.local_end) - ms(x.local_start)) / 60000);
      if (!(dur > 0 && dur <= 1800) && +x.duration_min > 0) dur = Math.round(+x.duration_min);
      if (!(dur > 0 && dur <= 1800)) { dur = DEF_MIN[type]; est = true; }
      return { label: normLabel(x.label), type, local_start: x.local_start, duration_min: dur, ...(est ? { end_estimated: true } : {}), category: x.category || null };
    });
}
// "TBC" on the visible timetable means it isn't published, even if the page's hidden data has placeholder times
const isTbc = (t: unknown) => /\bTB[CDA]\b|to be (?:confirmed|announced|defined)/i.test(String(t || ""));

// ---------- logo: try the AI's candidates, then logos found in the official homepage's HTML ----------
function abs(u: string, base: string) { try { return new URL(u.trim().replace(/&amp;/g, "&"), base).href; } catch { return ""; } }
async function logoCandidatesFromHtml(site: string) {
  const out: { url?: string; svg?: string }[] = [];
  try {
    const r = await fetch(site, { headers: { "User-Agent": UA, "Accept": "text/html" }, redirect: "follow" });
    if (!r.ok) return out;
    const html = (await r.text()).slice(0, 800000);
    const base = r.url || site;
    // <img> tags mentioning "logo" (src, data-src, srcset), header ones first
    const header = (html.match(/<header[\s\S]*?<\/header>/i) || [""])[0];
    for (const chunk of [header, html]) {
      for (const tag of chunk.match(/<img\b[^>]*>/gi) || []) {
        if (!/logo/i.test(tag)) continue;
        const src = (tag.match(/\bsrc=["']([^"']+)["']/i) || tag.match(/\bdata-src=["']([^"']+)["']/i) || [])[1]
          || ((tag.match(/\bsrcset=["']([^"']+)["']/i) || [])[1] || "").split(",").pop()?.trim().split(/\s+/)[0];
        if (src && !src.startsWith("data:")) out.push({ url: abs(src, base) });
      }
      // inline <svg> marked as a logo
      for (const m of chunk.matchAll(/<(a|div|span)\b[^>]*logo[^>]*>\s*(<svg[\s\S]*?<\/svg>)/gi)) out.push({ svg: m[2] });
      for (const m of chunk.matchAll(/<svg\b[^>]*logo[^>]*>[\s\S]*?<\/svg>/gi)) out.push({ svg: m[0] });
    }
    for (const m of html.matchAll(/<link\b[^>]*rel=["'](?:apple-touch-icon|icon)["'][^>]*>/gi)) { const h = (m[0].match(/href=["']([^"']+)["']/i) || [])[1]; if (h && /\.(svg|png)/i.test(h)) out.push({ url: abs(h, base) }); }
    const og = (html.match(/<meta\b[^>]*property=["']og:image["'][^>]*content=["']([^"']+)["']/i) || [])[1]; if (og) out.push({ url: abs(og, base) });
  } catch (_) { /* site unreachable */ }
  return out.slice(0, 10);
}
async function storeLogos(slug: string, cands: { url?: string; svg?: string }[], max = 5) {
  const out: string[] = [], seen = new Set<string>();
  for (const c of cands) {
    if (out.length >= max) break;
    if (c.url) { if (seen.has(c.url)) continue; seen.add(c.url); }
    try {
      let body: ArrayBuffer | string, type: string;
      if (c.svg) {
        if (c.svg.length < 200) continue;
        body = c.svg.includes("xmlns=") ? c.svg : c.svg.replace("<svg", '<svg xmlns="http://www.w3.org/2000/svg"'); type = "image/svg+xml";
      } else {
        const img = await fetch(c.url!, { headers: { "User-Agent": UA, "Accept": "image/*,*/*" }, redirect: "follow" });
        if (!img.ok) continue;
        type = (img.headers.get("content-type") || "").split(";")[0];
        const ext = (c.url!.split("?")[0].match(/\.(svg|png|webp|jpe?g)$/i) || [])[1]?.toLowerCase();
        if (!type.startsWith("image/")) type = ext === "svg" ? "image/svg+xml" : ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : ext ? "image/jpeg" : "";
        if (!type) continue;
        body = await img.arrayBuffer();
        if (body.byteLength < 300) continue;
      }
      const ext = type.includes("svg") ? "svg" : type.includes("png") ? "png" : type.includes("webp") ? "webp" : "jpg";
      const path = `series/${slug}-agent-${Date.now()}-${out.length}.${ext}`;
      const up = await fetch(`${SB}/storage/v1/object/media/${path}`, { method: "POST", headers: { apikey: SRK, Authorization: `Bearer ${SRK}`, "Content-Type": type, "x-upsert": "true" }, body });
      if (up.ok) out.push(`${SB}/storage/v1/object/public/media/${path}`);
    } catch (_) { /* next candidate */ }
  }
  return out;
}

// ---------- page fingerprints: skip the AI when the official pages haven't changed ----------
async function sha(buf: ArrayBuffer | Uint8Array) { const d = await crypto.subtle.digest("SHA-256", buf); return [...new Uint8Array(d)].slice(0, 12).map(b => b.toString(16).padStart(2, "0")).join(""); }
async function fingerprint(urls: string[]) {
  const out: { url: string; hash: string | null }[] = [];
  for (const url of [...new Set(urls.filter(u => typeof u === "string" && /^https?:/.test(u)))].slice(0, 4)) {
    try {
      const r = await fetch(url, { headers: { "User-Agent": UA }, redirect: "follow", signal: AbortSignal.timeout(12000) });
      if (!r.ok) { out.push({ url, hash: null }); continue; }
      const type = r.headers.get("content-type") || "";
      if (!type.includes("html") && !type.includes("text")) { out.push({ url, hash: await sha(await r.arrayBuffer()) }); continue; }
      const text = (await r.text())
        .replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<!--[\s\S]*?-->/g, " ")
        .replace(/<[^>]+>/g, " ").replace(/&[a-z#0-9]+;/gi, " ")
        .replace(/\b[a-f0-9]{16,}\b/gi, "").replace(/\s+/g, " ").trim();
      out.push({ url, hash: await sha(new TextEncoder().encode(text)) });
    } catch (_) { out.push({ url, hash: null }); }
  }
  return out;
}
// For scheduled checks: if the pages read last time are identical now (and that AI check is recent enough), skip the AI.
async function unchanged(filter: string, maxAgeDays: number) {
  const [last] = await db(`check_runs?${filter}&result=in.(proposal,no_change)&select=ran_at,pages&order=ran_at.desc&limit=1`);
  if (!last || Date.now() - new Date(last.ran_at).getTime() > maxAgeDays * 864e5) return null;
  const prev = (last.pages || []).filter((p: any) => p.url && p.hash);
  if (!prev.length) return null;
  const now = await fingerprint(prev.map((p: any) => p.url));
  return now.length === prev.length && now.every((p, i) => p.hash && p.hash === prev[i].hash) ? now : null;
}
const SKIPPED = "Official pages unchanged since the last check: AI not needed.";

const RULES = `You are the research agent of Racenxt, an app that shows athletes' race calendars to their fans.
Rules:
- Use OFFICIAL sources only: the championship's or its organiser's website, the circuit's official website, and official documents (timetables, supplementary regulations, entry lists, often PDFs; official timing providers count). Never take dates or times from news sites, fan sites, forums, Wikipedia or ticket resellers.
- Times: copy them exactly as the page shows them (format YYYY-MM-DD HH:MM, 24-hour) and do NOT convert them yourself. Instead, report which time zone the page uses in "times_zone": "local" if the page says local / track / circuit time, "UTC" if it says GMT or UTC, or the IANA zone / UTC offset it states. Many official sites show times in GMT or in the visitor's time zone when read by a program: look for labels such as "GMT", "UTC", "your time", "my time", "track time", "local time". IMPORTANT: when a page has a switch such as "My time / Track time" or "Your time / Local time", you are reading the default view, which shows the reader's time; as a program your time zone is UTC, so write "UTC". If the page doesn't say, write "unknown". Exception: an official timetable document of the event itself (e.g. the organiser's or circuit's timetable PDF) that shows no time zone is in local circuit time: write "local".
- A timetable is only published when the page shows real times. If it shows "TBC", "TBA" or "TBD", it is NOT published, even if the page's hidden data contains times (those are placeholders).
- For each session give the start and, when the timetable shows it, the end time (local_end). Use the session names as the official timetable writes them.
- For support series (e.g. F2, F3, Porsche Supercup, F1 Academy), the main event's official timetable (e.g. formula1.com, which lists every series in local time) is an official source too.
- Never guess. If something is not published on the official site, leave it out or set it to null.
- Be economical: open each page at most once, go straight to the calendar / race pages, and stop as soon as you have the answer.
- Finish with ONE fenced \`\`\`json code block that follows the requested schema, and nothing after it.`;

// extra rules written by the Racenxt team on the Agent page, added to every task
let GUIDANCE = "";
const SYS = () => RULES + (GUIDANCE.trim() ? `\nExtra rules from the Racenxt team (they take priority):\n${GUIDANCE.trim()}` : "");
async function loadGuidance() { try { const [g] = await db(`app_settings?key=eq.agent_guidance&select=value`); GUIDANCE = String(g?.value?.text || ""); } catch (_) { /* keep the last */ } }

// ---------- the instructions for each task (also shown on the admin Agent page) ----------
function linksPrompt(series: any) {
  return `Championship: ${series.name}${series.short_name && series.short_name !== series.name ? ` (${series.short_name})` : ""}
Official website: ${series.website_url || "unknown"}
Today: ${new Date().toISOString().slice(0, 10)}
Task: ${WATCH_TASK}
JSON schema: {"stream_url": string|null, "broadcasters_url": string|null}`;
}
function discoverPrompt(series: any, src: any, year: number) {
  return `Championship: ${series.name}${series.short_name && series.short_name !== series.name ? ` (${series.short_name})` : ""}
Sport category: ${series.sport}
Known official website: ${series.website_url || "unknown"}
Today: ${new Date().toISOString().slice(0, 10)}
${src?.agent_instructions ? `Instructions from the Racenxt team:\n${src.agent_instructions}\n` : ""}
Task:
1. Find the official website of this championship.
2. Find the championship's official logo: up to 3 direct, absolute image URLs (SVG or PNG preferred), e.g. the logo image in the official site's header. If the official site doesn't expose one, a Wikimedia Commons file of the official logo (upload.wikimedia.org) is acceptable as the last candidate.
3. Find the official calendar page and read the season calendar for ${year} and ${year + 1} (only seasons that are officially published; skip rounds that are already over in ${year}). Next season's calendar is often announced in a news article on the official site before the calendar page changes: search for "${series.short_name || series.name} ${year + 1} calendar" too.
4. For each race weekend: round number, the race's own name WITHOUT the championship name, the year, the round number or title sponsors (e.g. "4 Hours of Jerez", "Qatar Grand Prix"; not "4 Hours of Jerez by ALMS", "Formula 1 Qatar Airways Qatar Grand Prix 2026" or "Qatar Grand Prix (FIA Formula 2 Round 13)"; if the official name is only the championship and a round, use the circuit's town), first and last day of the race weekend (YYYY-MM-DD), race length label if published (e.g. "4h", "24h", "2 × 30 min"), and the circuit: official circuit name, town, country, ISO 3166 two-letter country code, IANA time zone (e.g. Europe/Paris) and approximate latitude/longitude.
5. Timetables: for the next upcoming race weekends, check the race page on the official site. If the official timetable (HTML or PDF) is already published, list every on-track session of THIS championship (practice, qualifying, hyperpole, warm-up, races) in local circuit time. If it is not published yet, set "sessions": null. Don't spend more than a few page reads on this; stop at the first race whose timetable is not published.
6. ${WATCH_TASK}
JSON schema:
{"website_url": string|null, "logo_urls": [string], "calendar_url": string|null, "stream_url": string|null, "broadcasters_url": string|null,
 "seasons": [{"year": number, "events": [{"round": number|null, "name": string, "start_date": "YYYY-MM-DD", "end_date": "YYYY-MM-DD", "duration_label": string|null,
   "circuit": {"name": string, "city": string|null, "country": string, "country_code": string|null, "timezone": string, "lat": number|null, "lng": number|null},
   "sessions": [{"label": string, "type": "practice"|"qualifying"|"race"|"warmup"|"other", "local_start": "YYYY-MM-DD HH:MM", "local_end": "YYYY-MM-DD HH:MM"|null, "duration_min": number|null, "category": string|null}] | null,
   "times_zone": "local"|"UTC"|string|null, "timetable_url": string|null}]}],
 "notes": string}`;
}
function checkPrompt(ev: any, series: any, src: any, v: any, raceWeek: boolean) {
  return `Championship: ${series.name}${series.short_name && series.short_name !== series.name ? ` (${series.short_name})` : ""}
Official website: ${series.website_url || "unknown"}
${(src?.urls || []).length ? `Official pages we know: ${(src.urls || []).map((u: any) => u.url).join(", ")}\n` : ""}Race: ${ev.name}
Dates: ${ev.start_date} to ${ev.end_date}
Circuit: ${[v.name, v.city, v.country].filter(Boolean).join(", ")} (local time zone ${v.timezone || "unknown"})
Today: ${new Date().toISOString().slice(0, 10)}
${src?.agent_instructions ? `Instructions from the Racenxt team:\n${src.agent_instructions}\n` : ""}
Task:
1. Find the official timetable (schedule) of this race weekend. Search strategy:
   a. Open the race's page on the championship website (and its documents / downloads section).
   b. If it isn't there, search the web, for example "${series.short_name || series.name} ${v.name || ev.name} ${ev.start_date.slice(0, 4)} timetable", and also in the local language of the circuit (horaires, programme, horario, Zeitplan, orari, tijdschema).
   c. The timetable is often a PDF on the organiser's or the circuit's website, or published with the event's supplementary regulations. Open PDFs: you can read them.
   List every on-track session of THIS championship (all its classes/categories): practice, qualifying, hyperpole, warm-up, races. Skip support series and non-track events.
2. ${raceWeek ? `Where to watch THIS race: only a page made for this race weekend (e.g. "How to watch the ${ev.name}", the race's broadcast or TV-times page), on an official site. Not the championship's general stream${series.stream_url ? ` (${series.stream_url})` : ""} or general broadcaster list${series.broadcasters_url ? ` (${series.broadcasters_url})` : ""}. Set "watch_url" to null if there is no page for this race.` : `Skip where to watch: set "watch_url" to null.`}
If the timetable is not published yet, set "timetable_found": false and an empty list.
JSON schema:
{"timetable_found": boolean, "source_url": string|null, "race_page_url": string|null, "excerpt": string|null, "times_zone": "local"|"UTC"|string|null,
 "sessions": [{"label": string, "type": "practice"|"qualifying"|"race"|"warmup"|"other", "local_start": "YYYY-MM-DD HH:MM", "local_end": "YYYY-MM-DD HH:MM"|null, "duration_min": number|null, "category": string|null}],
 "watch_url": string|null}`;
}
const DEEP = "\nA first search didn't find the timetable. Look harder: search the web in English and in the local language, and check the circuit's own website and official PDF documents.";

// ---------- where to watch: set per championship; a race only gets its own link if it has a page of its own ----------
const WATCH_TASK = `Where to watch, for the whole championship (official sources only):
   - "stream_url": the championship's official live stream, i.e. its own streaming service or official live channel (e.g. F1 TV, MotoGP VideoPass, FIA WEC+, the official YouTube live page). null if there is none.
   - "broadcasters_url": the official page that lists the TV broadcasters by country (often called "Where to watch", "Broadcasters", "TV schedule"). null if there is none.`;
const sameUrl = (a: unknown, b: unknown) => !!a && !!b && String(a).replace(/[/#?]+$/, "").replace(/^https?:\/\/(www\.)?/, "").toLowerCase() === String(b).replace(/[/#?]+$/, "").replace(/^https?:\/\/(www\.)?/, "").toLowerCase();
const okUrl = (u: unknown) => typeof u === "string" && /^https?:\/\/[^\s]+$/.test(u);
// proposes the championship links that are new or changed (never removes one)
async function proposeLinks(series: any, out: any, runId: string, url: string) {
  const pl: any = {};
  if (okUrl(out.stream_url) && !sameUrl(out.stream_url, series.stream_url)) pl.stream_url = out.stream_url;
  if (okUrl(out.broadcasters_url) && !sameUrl(out.broadcasters_url, series.broadcasters_url)) pl.broadcasters_url = out.broadcasters_url;
  if (!Object.keys(pl).length) return false;
  await ins("proposals", { run_id: runId, series_id: series.id, kind: "series_links", payload: pl, evidence: { url: pl.broadcasters_url || pl.stream_url || url, excerpt: `Where to watch ${series.short_name || series.name}` } });
  return true;
}
async function links(series: any, runId: string) {
  const user = linksPrompt(series);
  const { out, usage, trace } = await ask(SYS(), user, 5);
  const found = await proposeLinks(series, out, runId, series.website_url || "");
  return { result: found ? "proposal" : "no_change", summary: found ? "Found: where to watch for the championship." : "Nothing new: where-to-watch links unchanged.", usage, pages: [], trace: { ...trace, answer: out } };
}

// ---------- discover: official site, logo, calendar ----------
async function discover(series: any, src: any, runId: string, kind = "discover") {
  if (kind === "monthly") {
    const same = await unchanged(`series_id=eq.${series.id}&event_id=is.null`, 90);
    if (same) return { result: "skipped_unchanged", summary: SKIPPED, usage: null, pages: same };
  }
  const year = new Date().getUTCFullYear();
  const known = await db(`events?series_id=eq.${series.id}&select=id,year,round,name,start_date,end_date,duration_label,venues(name)`);
  const user = discoverPrompt(series, src, year);
  const { out, usage, trace } = await ask(SYS(), user, 10);
  const site = out.website_url || series.website_url;
  const domain = host(site || "");
  const props: string[] = [];

  // agent settings and website (internal, not shown to fans)
  const urls = [...new Set([...(src?.urls || []).map((u: any) => u.url), out.calendar_url].filter(Boolean))];
  const domains = [...new Set([...(src?.allowed_domains || []), domain].filter(Boolean))];
  await db("series_sources", { method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify({ series_id: series.id, urls: urls.map(url => ({ url })), allowed_domains: domains, agent_instructions: src?.agent_instructions || "" }) });
  const upd: any = {};
  if (!series.website_url && site) upd.website_url = site;

  // logo: copied to our storage when the championship has none yet (the admin turns it white and asks for confirmation)
  let logoNote = "";
  if (!series.logo_url) {
    const aiC = [...(out.logo_urls || []), out.logo_url].filter((u: any) => typeof u === "string" && /^https?:/.test(u)).map((url: string) => ({ url }));
    const wiki = aiC.filter(c => /wikimedia|wikipedia/.test(c.url)), own = aiC.filter(c => !/wikimedia|wikipedia/.test(c.url));
    const fromHtml = site ? await logoCandidatesFromHtml(site) : [];
    const logos = await storeLogos(series.slug, [...own, ...fromHtml, ...wiki]);
    // the admin page picks the right one with AI, then makes it white and standard size
    if (logos.length) { upd.logo_url = logos[0]; upd.logo_candidates = logos; } else logoNote = " No logo found: add one on the review page.";
  }
  if (Object.keys(upd).length) await patch("series", `id=eq.${series.id}`, upd);
  if (await proposeLinks(series, out, runId, site || "")) props.push("where to watch");

  // calendar: new races in one proposal, changed dates as separate proposals
  const found = (out.seasons || []).flatMap((s: any) => (s.events || []).map((e: any) => ({ ...e, year: s.year || +String(e.start_date).slice(0, 4) })))
    .map((e: any) => ({ ...e, name: cleanName(e.name, series) })).filter((e: any) => e.name && okDate(e.start_date) && okDate(e.end_date || e.start_date))
    .map((e: any) => {
      const tz = e.circuit?.timezone || "";
      const zone = tz && validTz(tz) ? pageZone(e.times_zone, tz) : tz;
      const conv = tz && zone && zone !== tz;
      return { ...e, end_date: e.end_date || e.start_date, zoneNote: conv ? ` (times converted from ${e.times_zone} to local ${tz})` : String(e.times_zone || "").toLowerCase() === "unknown" && !/\.pdf(\?|$)/i.test(e.timetable_url || "") ? " (the page didn't say which time zone: check the times)" : "",
        sessions: isTbc(e.timetable_note) ? [] : cleanSessions(conv ? toCircuitTime(e.sessions, zone, tz) : e.sessions, e.start_date, e.end_date || e.start_date) };
    });
  const fresh: any[] = [];
  let ttFound = 0;
  for (const e of found) {
    const match = known.find((k: any) => k.year === e.year && (
      (e.circuit?.name && k.venues?.name && norm(k.venues.name) === norm(e.circuit.name)) ||
      norm(k.name) === norm(e.name) ||
      (e.round && k.round === e.round)));
    if (!match) { fresh.push(e); if (e.sessions.length) ttFound++; continue; }
    if (e.sessions.length && new Date(e.end_date) >= new Date(new Date().toISOString().slice(0, 10))) {
      const [has] = await db(`sessions?event_id=eq.${match.id}&select=id&limit=1`);
      if (!has) {
        await ins("proposals", { run_id: runId, series_id: series.id, event_id: match.id, kind: "timetable", payload: { sessions: e.sessions }, evidence: { url: e.timetable_url || out.calendar_url || site, excerpt: `Timetable for ${e.name}${e.zoneNote}` } });
        props.push(`timetable: ${match.name}`);
      }
    }
    if (match.start_date !== e.start_date || match.end_date !== (e.end_date || e.start_date)) {
      await ins("proposals", { run_id: runId, series_id: series.id, event_id: match.id, kind: "event_change",
        payload: { start_date: e.start_date, end_date: e.end_date || e.start_date, ...(e.duration_label ? { duration_label: e.duration_label } : {}) },
        evidence: { url: out.calendar_url || site, excerpt: `${e.name}: ${e.start_date} → ${e.end_date}` } });
      props.push(`date change: ${match.name}`);
    }
  }
  if (fresh.length) {
    await ins("proposals", { run_id: runId, series_id: series.id, kind: "new_season",
      payload: { events: fresh.map((e: any) => ({ round: e.round ?? null, name: e.name, start_date: e.start_date, end_date: e.end_date, duration_label: e.duration_label || null, year: e.year, circuit: e.circuit || null, ...(e.sessions.length ? { sessions: e.sessions, timetable_note: (e.timetable_url ? `Source: ${e.timetable_url}` : "") + e.zoneNote } : {}) })) },
      evidence: { url: out.calendar_url || site, excerpt: out.notes || "" } });
    props.push(`${fresh.length} new race${fresh.length > 1 ? "s" : ""} (timetable already out for ${ttFound}; the others are checked closer to each race)`);
  }
  const summary = (props.length ? `Found: ${props.join(", ")}.` : "Nothing new: the calendar matches what we have.") + logoNote;
  return { result: props.length ? "proposal" : "no_change", summary, usage, pages: await fingerprint([out.calendar_url, ...urls, site]), trace: { ...trace, answer: out } };
}

// ---------- check_event: timetable + where to watch ----------
async function checkEvent(ev: any, series: any, src: any, runId: string, kind = "manual") {
  if (kind === "daily") {
    // race week: skip the AI while the pages stay the same, but ask it at least every other day
    const same = await unchanged(`event_id=eq.${ev.id}`, 2);
    if (same) return { result: "skipped_unchanged", summary: SKIPPED, usage: null, pages: same };
  }
  const current = await db(`sessions?event_id=eq.${ev.id}&select=label,type,local_start,duration_min&order=local_start`);
  const v = ev.venues || {};
  // the race's own broadcast page is only published in the days before the race
  const raceWeek = Math.round((new Date(ev.start_date + "T12:00:00Z").getTime() - Date.now()) / 864e5) <= 7;
  const user = checkPrompt(ev, series, src, v, raceWeek);
  let { out, usage, trace } = await ask(SYS(), user, 8);
  // close to the race and still nothing: one more, deeper look with the stronger model
  const daysToStart = Math.round((new Date(ev.start_date + "T12:00:00Z").getTime() - Date.now()) / 864e5);
  if (!(out.timetable_found && (out.sessions || []).length) && daysToStart <= 10 && daysToStart >= -1) {
    try { const deep = await ask(SYS(), user + DEEP, 10, [STRONG]); addUsage(usage, deep.usage); addTrace(trace, deep.trace); if (deep.out.timetable_found && (deep.out.sessions || []).length) out = deep.out; else if (!out.watch_url && deep.out.watch_url) out.watch_url = deep.out.watch_url; } catch (_) { /* keep the first answer */ }
  }
  const props: string[] = [];
  const ctz = v.timezone && validTz(v.timezone) ? v.timezone : "";
  const zone = ctz ? pageZone(out.times_zone, ctz) : "";
  const conv = !!ctz && zone !== ctz;
  const zoneNote = conv ? ` (times converted from ${out.times_zone} to local ${ctz})` : String(out.times_zone || "").toLowerCase() === "unknown" && !/\.pdf(\?|$)/i.test(out.source_url || "") ? " (the page didn't say which time zone: check the times)" : "";
  if (isTbc(out.excerpt)) out.timetable_found = false;
  let sessions = cleanSessions(conv ? toCircuitTime(out.sessions, zone, ctz) : out.sessions, ev.start_date, ev.end_date);
  let zoneFix = "";
  // safety net: zone not stated, but read as UTC the times match what we already have -> the page was showing UTC
  if (!conv && ctz && ctz !== "UTC" && String(out.times_zone || "").toLowerCase() === "unknown" && current.length) {
    const asUtc = cleanSessions(toCircuitTime(out.sessions, "UTC", ctz), ev.start_date, ev.end_date);
    const starts = (l: any[]) => JSON.stringify(l.map(s => String(s.local_start).replace("T", " ").slice(0, 16)).sort());
    if (starts(asUtc) === starts(current)) { sessions = asUtc; zoneFix = ` (times were shown in UTC: converted to local ${ctz})`; }
  }
  if (out.timetable_found && sessions.length) {
    // only real changes count: start times and lengths, not how the sessions are named
    // (an estimated length never replaces a known one)
    const key = (l: any[]) => JSON.stringify(l.map(s => String(s.local_start).replace("T", " ").slice(0, 16)).sort());
    const lens = (l: any[]) => JSON.stringify([...l].sort((a, b) => String(a.local_start).localeCompare(String(b.local_start))).map(s => s.end_estimated ? null : s.duration_min));
    const curLens = JSON.stringify(current.map((s: any) => s.duration_min));
    const changedLens = current.length === sessions.length && JSON.parse(lens(sessions)).some((d: any, i: number) => d !== null && d !== JSON.parse(curLens)[i]);
    if (key(sessions) !== key(current) || changedLens) {
      await ins("proposals", { run_id: runId, series_id: series.id, event_id: ev.id, kind: "timetable", payload: { sessions }, evidence: { url: out.source_url || series.website_url || "", excerpt: (out.excerpt || "") + (zoneFix || zoneNote) } });
      props.push(`timetable (${sessions.length} sessions)`);
    }
  }
  if (!raceWeek || sameUrl(out.watch_url, series.stream_url) || sameUrl(out.watch_url, series.broadcasters_url) || !okUrl(out.watch_url)) out.watch_url = null;
  if (out.watch_url && !sameUrl(out.watch_url, ev.watch_url)) {
    await ins("proposals", { run_id: runId, series_id: series.id, event_id: ev.id, kind: "watch_link", payload: { watch_url: out.watch_url }, evidence: { url: out.watch_url, excerpt: `Broadcast page for ${ev.name}` } });
    props.push("this race's broadcast page");
  }
  const summary = props.length ? `Found: ${props.join(", ")}.` : out.timetable_found ? "Nothing new: timetable unchanged." : "Timetable not published yet.";
  return { result: props.length ? "proposal" : "no_change", summary, usage, pages: await fingerprint([out.source_url, out.race_page_url, ...(src?.urls || []).map((u: any) => u.url)]), trace: { ...trace, answer: out } };
}

// ---------- tick: start what's due (called by pg_cron) ----------
async function tick(secret: string) {
  const [row] = await db(`agent_secrets?key=eq.cron&select=value`);
  if (!row || row.value !== secret) return json({ error: "bad secret" }, 403);
  const [cfg] = await db(`app_settings?key=eq.auto_checks&select=value`);
  const due = await db("rpc/due_checks", { method: "POST", body: JSON.stringify({ p_limit: Math.min(6, +(cfg?.value?.per_tick) || 3) }) });
  const started = [];
  for (const d of due || []) {
    const body = d.event_id ? { action: "check_event", event_id: d.event_id, kind: d.kind } : { action: "discover", series_id: d.series_id, kind: d.kind };
    const r = await fetch(`${SB}/functions/v1/agent`, { method: "POST", headers: { Authorization: `Bearer ${SRK}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });
    started.push({ ...d, status: r.status });
  }
  return json({ started });
}

// ---------- entry ----------
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  const cron = req.headers.get("x-cron-secret");
  if (cron) return tick(cron);
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token || !(await isAdmin(token))) return json({ error: "admins only" }, 403);
  if (!AKEY) return json({ error: "ANTHROPIC_API_KEY is not set" }, 500);
  let body: any = {};
  try { body = await req.json(); } catch { return json({ error: "bad request" }, 400); }

  await loadGuidance();
  if (body.action === "prompts") {
    // the real instructions, filled with example values, for the admin Agent page
    const S = { name: "<championship>", short_name: "<short name>", sport: "<discipline>", website_url: "<official website>", stream_url: "<official stream>", broadcasters_url: "<all broadcasters page>" };
    const SRC = { urls: [{ url: "<official pages the agent knows>" }], agent_instructions: "<instructions for this championship, including your rejection notes>" };
    const EV = { name: "<race>", start_date: "2027-01-01", end_date: "2027-01-03" }, V = { name: "<circuit>", city: "<town>", country: "<country>", timezone: "<circuit time zone>" };
    return json({ rules: RULES, guidance: GUIDANCE, tasks: [
      { key: "discover", title: "Adding a championship · monthly calendar check", when: "When you add a championship or click Check calendar with AI, then once a month (skipped for free when the official pages haven't changed).", text: discoverPrompt(S, SRC, new Date().getUTCFullYear()) },
      { key: "race", title: "Race check, far from the race", when: "Once for every race of this season and next (first check), and when you click Search with AI.", text: checkPrompt(EV, S, SRC, V, false) },
      { key: "raceweek", title: "Race check, in race week", when: "Every day from 6 days before the race (skipped while the pages are unchanged, but at least every other day), and a final check 2-3 days before.", text: checkPrompt(EV, S, SRC, V, true) },
      { key: "deeper", title: "Deeper look", when: "Added to the race check when the race is less than 10 days away and the first search found no timetable. Uses the stronger model.", text: DEEP.trim() },
      { key: "links", title: "Where to watch for the championship", when: "When you click Find with AI in Edit championship (also part of the monthly calendar check).", text: linksPrompt(S) },
    ] });
  }
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!UUID.test(body.series_id || body.event_id || "")) return json({ error: "bad id" }, 400);
  let series: any, ev: any = null;
  if (body.action === "logo") {
    // free: logo candidates from the official homepage (+ earlier ones); the admin page picks with AI
    const [s] = await db(`series?id=eq.${body.series_id}&select=id,slug,website_url,logo_candidates`);
    if (!s) return json({ error: "not found" }, 404);
    if (!s.website_url) return json({ candidates: s.logo_candidates || [] });
    const logos = await storeLogos(s.slug, await logoCandidatesFromHtml(s.website_url), 6);
    const all = [...logos, ...(s.logo_candidates || [])].slice(0, 8);
    await patch("series", `id=eq.${s.id}`, { logo_candidates: all });
    return json({ candidates: all });
  }
  if (body.action === "discover" || body.action === "links") {
    [series] = await db(`series?id=eq.${body.series_id}&select=*`);
  } else if (body.action === "check_event") {
    [ev] = await db(`events?id=eq.${body.event_id}&select=*,venues(name,city,country,timezone)`);
    if (ev?.series_id) [series] = await db(`series?id=eq.${ev.series_id}&select=*`);
  } else return json({ error: "unknown action" }, 400);
  if (!series) return json({ error: "not found" }, 404);
  const [src] = await db(`series_sources?series_id=eq.${series.id}&select=*`);

  const kind = ["monthly", "weekly", "daily", "final", "initial"].includes(body.kind) ? body.kind : (body.action === "discover" ? "discover" : "manual");
  const [run] = await ins("check_runs", { series_id: series.id, event_id: ev?.id || null, kind, result: "running", pages: [] });
  const job = (async () => {
    try {
      const r = body.action === "discover" ? await discover(series, src, run.id, kind) : body.action === "links" ? await links(series, run.id) : await checkEvent(ev, series, src, run.id, kind);
      await patch("check_runs", `id=eq.${run.id}`, { result: r.result, summary: r.summary, usage: r.usage, pages: r.pages, trace: (r as any).trace || null, finished_at: new Date().toISOString() });
    } catch (e) {
      await patch("check_runs", `id=eq.${run.id}`, { result: "error", error: String((e as Error).message || e).slice(0, 500), finished_at: new Date().toISOString() });
    }
  })();
  // @ts-ignore EdgeRuntime is provided by Supabase
  if (typeof EdgeRuntime !== "undefined") EdgeRuntime.waitUntil(job); else await job;
  return json({ run_id: run.id });
});
