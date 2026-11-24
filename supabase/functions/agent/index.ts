// Racenxt research agents. Five agents, each with one job:
//   calendar (dates and circuits, this year and next) · logo · schedule (one race at a time) · where to watch · checker (rereads the source, attaches proof)
// POST { action: "discover", series_id }  -> calendar agent, then logo, where to watch and the checker; files proposals
// POST { action: "check_event", event_id } -> schedule agent (+ where to watch in race week) and the checker; files proposals
// POST { action: "links", series_id }     -> the championship's official stream + list of TV broadcasters; files a proposal
// POST { action: "logo", series_id }      -> logo candidates from the official homepage (no AI; the admin page picks with AI)
// POST { action: "prompts" }               -> the instructions for each task, for the admin Agent page
// POST { action: "test_cases" }            -> loads the answer key (agent-tests/answer_key.json) into the database
// POST { action: "test_run", case_id }     -> runs one test case without filing anything, and scores it
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
// "UTC" is only believed when the page itself says so (a GMT/UTC label or a my-time/track-time switch, seen in the
// AI's quote AND in the page's code when we can read it); otherwise the times are kept as shown (local), flagged to check.
const ZONE_WORDS = /\b(gmt|utc)\b|my time|your time|track time|local time|heure locale|ora locale|hora local|ortszeit/i;
async function zoneBacked(label: unknown, url: unknown) {
  if (!ZONE_WORDS.test(String(label || ""))) return false;
  if (typeof url !== "string" || !/^https?:/.test(url) || /\.pdf(\?|$)/i.test(url)) return true;
  try {
    const r = await fetch(url, { headers: { "User-Agent": UA }, redirect: "follow", signal: AbortSignal.timeout(12000) });
    if (!r.ok || !(r.headers.get("content-type") || "").includes("html")) return true;
    return ZONE_WORDS.test((await r.text()).slice(0, 1_500_000));
  } catch (_) { return true; }
}
// Many official pages also carry the exact times for programs (e.g. "2027-01-15T10:10:00+01:00" or "...T11:00:00Z").
// Those timestamps say the time zone for sure: they decide between "as shown" and "converted".
async function pageStamps(url: unknown, ctz: string, start: string, end: string) {
  const set = new Set<string>();
  if (typeof url !== "string" || !/^https?:/.test(url) || /\.pdf(\?|$)/i.test(url) || !validTz(ctz)) return set;
  try {
    const r = await fetch(url, { headers: { "User-Agent": UA }, redirect: "follow", signal: AbortSignal.timeout(12000) });
    if (!r.ok) return set;
    const html = (await r.text()).slice(0, 3_000_000);
    const lo = new Date(start + "T00:00:00Z").getTime() - 2 * 864e5, hi = new Date(end + "T23:59:00Z").getTime() + 2 * 864e5;
    for (const m of html.matchAll(/(20\d\d-\d\d-\d\dT\d\d:\d\d)(?::\d\d(?:\.\d+)?)?(Z|[+-]\d\d:?\d\d)/g)) {
      const ms = Date.parse(m[1] + ":00" + (m[2] === "Z" ? "Z" : m[2].replace(/^([+-]\d\d)(\d\d)$/, "$1:$2")));
      if (ms >= lo && ms <= hi) set.add(utcToWall(ms, ctz));
    }
  } catch (_) { /* page unreadable */ }
  return set;
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
function b64(buf: Uint8Array) { let s = ""; for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000)); return btoa(s); }
function abs(u: string, base: string) { try { return new URL(u.trim().replace(/&amp;/g, "&"), base).href; } catch { return ""; } }
type LogoCand = { url?: string; svg?: string; where: string };
// logo candidates in a page's code. The logo is almost always the first link to the homepage, in the header:
// those come first ("home"), then the header's images ("header"), then the rest of the page ("page")
function logoCandidatesFromMarkup(html: string, base: string): LogoCand[] {
  const out: LogoCand[] = [];
  html = html.slice(0, 1_500_000);
  let root: URL | null = null; try { root = new URL(base); } catch (_) { /* bad address */ }
  const isHome = (href: string) => { try { const u = new URL(href.replace(/&amp;/g, "&"), base); return !!root && u.hostname.replace(/^www\./, "") === root.hostname.replace(/^www\./, "") && /^\/?(?:[a-z]{2}(?:-[a-z]{2})?\/?)?(?:index\.\w+)?$/i.test(u.pathname); } catch { return false; } };
  const imgsIn = (chunk: string, where: string) => {
    for (const tag of chunk.match(/<img\b[^>]*>/gi) || []) {
      const src = (tag.match(/\bsrc=["']([^"']+)["']/i) || tag.match(/\bdata-src=["']([^"']+)["']/i) || [])[1]
        || ((tag.match(/\bsrcset=["']([^"']+)["']/i) || [])[1] || "").split(",").pop()?.trim().split(/\s+/)[0];
      if (src && !src.startsWith("data:")) out.push({ url: abs(src, base), where });
    }
    for (const m of chunk.matchAll(/<svg\b[\s\S]*?<\/svg>/gi)) if (m[0].length > 400) out.push({ svg: m[0], where });
  };
  // 1. the first links to the homepage that hold a picture
  let homes = 0;
  for (const m of html.matchAll(/<a\b[^>]*href=["']([^"']*)["'][^>]*>([\s\S]{0,20000}?)<\/a>/gi)) {
    if (homes >= 2) break;
    if (!isHome(m[1]) || !/<img|<svg/i.test(m[2])) continue;
    homes++; imgsIn(m[2], "home");
  }
  // 2. the header
  const header = (html.match(/<header[\s\S]*?<\/header>/i) || [""])[0];
  for (const tag of header.match(/<img\b[^>]*>/gi) || []) { const src = (tag.match(/\bsrc=["']([^"']+)["']/i) || [])[1]; if (src && !src.startsWith("data:")) out.push({ url: abs(src, base), where: "header" }); }
  // 3. anything named "logo" elsewhere, the site icons and the share picture
  for (const tag of html.match(/<img\b[^>]*>/gi) || []) {
    if (!/logo/i.test(tag)) continue;
    const src = (tag.match(/\bsrc=["']([^"']+)["']/i) || tag.match(/\bdata-src=["']([^"']+)["']/i) || [])[1];
    if (src && !src.startsWith("data:")) out.push({ url: abs(src, base), where: "page" });
  }
  for (const m of html.matchAll(/<svg\b[^>]*logo[^>]*>[\s\S]*?<\/svg>/gi)) out.push({ svg: m[0], where: "page" });
  for (const m of html.matchAll(/<link\b[^>]*rel=["'](?:apple-touch-icon|icon)["'][^>]*>/gi)) { const h = (m[0].match(/href=["']([^"']+)["']/i) || [])[1]; if (h && /\.(svg|png)/i.test(h)) out.push({ url: abs(h, base), where: "page" }); }
  const og = (html.match(/<meta\b[^>]*property=["']og:image["'][^>]*content=["']([^"']+)["']/i) || [])[1]; if (og) out.push({ url: abs(og, base), where: "page" });
  return out.filter(x => x.svg || x.url).slice(0, 24);
}
async function logoCandidatesFromHtml(site: string): Promise<LogoCand[]> {
  try {
    const r = await fetch(site, { headers: { "User-Agent": UA, "Accept": "text/html" }, redirect: "follow", signal: AbortSignal.timeout(15000) });
    if (!r.ok) return [];
    return logoCandidatesFromMarkup(await r.text(), r.url || site);
  } catch (_) { return []; }
}
// a real browser (Cloudflare Browser Run): the page as a visitor sees it, after its JavaScript has run.
// Off until the CF_ACCOUNT_ID and CF_BROWSER_TOKEN secrets are set; the free plan gives 10 minutes a day.
const CF_ACC = Deno.env.get("CF_ACCOUNT_ID") || "", CF_TOK = Deno.env.get("CF_BROWSER_TOKEN") || "";
async function cfBrowser(kind: "content" | "screenshot", url: string): Promise<string | null> {
  if (!CF_ACC || !CF_TOK) return null;
  const body: any = { url, gotoOptions: { waitUntil: "networkidle2", timeout: 30000 }, viewport: { width: 1280, height: 800 } };
  if (kind === "screenshot") body.screenshotOptions = { type: "jpeg", quality: 70 };
  for (const path of ["browser-run", "browser-rendering"]) {
    try {
      const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${CF_ACC}/${path}/${kind}`, { method: "POST", headers: { Authorization: `Bearer ${CF_TOK}`, "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(50000) });
      if (r.status === 404) continue;
      if (!r.ok) return null;
      if (kind === "content") { const t = await r.text(); try { const j = JSON.parse(t); return typeof j.result === "string" ? j.result : null; } catch { return t; } }
      const buf = new Uint8Array(await r.arrayBuffer());
      return buf.length > 2000 ? b64(buf) : null;
    } catch (_) { return null; }
  }
  return null;
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
- Use OFFICIAL sources only: the championship's or its organiser's website, the circuit's official website, and official documents (timetables, supplementary regulations, entry lists, often PDFs; official timing providers count). Never take dates or times from news sites, fan sites, forums, Wikipedia or ticket resellers, unless the task explicitly allows reliable press as a fallback (then follow its conditions; Wikipedia, fan sites and forums never count).
- Times: copy them exactly as the page shows them (format YYYY-MM-DD HH:MM, 24-hour) and do NOT convert them yourself. Instead, report which time zone the page uses in "times_zone": "local" if the page says local / track / circuit time, "UTC" if it says GMT or UTC, or the IANA zone / UTC offset it states. Many official sites show times in GMT or in the visitor's time zone when read by a program: look for labels such as "GMT", "UTC", "your time", "my time", "track time", "local time". IMPORTANT: only when the page really shows a switch such as "My time / Track time" or "Your time / Local time" are you reading the reader's time; as a program your time zone is UTC, so then write "UTC". Never assume a switch you can't see. If the page doesn't say which zone its times are in, write "unknown". Also copy, in "zone_label", the exact words on the page that tell the zone (e.g. "GMT", "Local time", "My time / Track time"), or null if there are none. Exception: an official timetable document of the event itself (e.g. the organiser's or circuit's timetable PDF) that shows no time zone is in local circuit time: write "local".
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
// agent 1, calendar: dates and circuits only (no logo, no timetable, no where to watch)
function discoverPrompt(series: any, src: any, year: number) {
  return `Championship: ${series.name}${series.short_name && series.short_name !== series.name ? ` (${series.short_name})` : ""}
Sport category: ${series.sport}
Known official website: ${series.website_url || "unknown"}
${(series.classes || []).length ? `Known classes: ${series.classes.join(", ")}\n` : ""}Today: ${new Date().toISOString().slice(0, 10)}
${src?.agent_instructions ? `Instructions from the Racenxt team:\n${src.agent_instructions}\n` : ""}
Task: the race calendar, nothing else.
1. Find the official website of this championship. It may be published by its organiser together with other championships (e.g. a "Cup Series" running several classes): then use the organiser's calendar and keep only this championship's rounds.
2. Read the official calendar for ${year} and ${year + 1} (only seasons officially published). Give EVERY round of ${year}, also the ones already raced: we need the whole season. Next season's calendar is often announced in a news article on the official site before the calendar page changes: search for "${series.short_name || series.name} ${year + 1} calendar" too.
3. For each race weekend: round number (if one weekend holds two or more championship rounds, a "double header" e.g. Formula E rounds 6 and 7 on the same weekend: "round" is the first and "round_to" the last; otherwise "round_to" is null), the race's own name WITHOUT the championship name, the year, the round number or title sponsors (e.g. "4 Hours of Jerez", "Qatar Grand Prix"; not "4 Hours of Jerez by ALMS", "Formula 1 Qatar Airways Qatar Grand Prix 2026" or "Qatar Grand Prix (FIA Formula 2 Round 13)"; if the official name is only the championship and a round, use the circuit's town), first and last day of the race weekend (YYYY-MM-DD), race length label if published (e.g. "4h", "24h", "2 × 30 min"), and the circuit: official circuit name, town, country, ISO 3166 two-letter country code, IANA time zone (e.g. Europe/Paris) and approximate latitude/longitude.
4. Test days, prologues and other events that are not races of this championship are not rounds: leave them out.
5. A round without a confirmed date (TBC, or only a month) goes in "tbc" with what is known. Never invent or copy a date from another championship.
6. If official sources disagree on a date, use the most recent one and say so in "doubts".
7. Official announcements often show the calendar only as a picture, which you can't read: give the address of the official page announcing the ${year + 1} calendar in "announcement_url" (we read its pictures), even if its text has no dates.
8. Fallback, only for rounds whose exact dates the official sites don't give in text: reliable motorsport press or the circuit's own official website (e.g. formula1.com, motorsport.com, autosport.com, the-race.com, racer.com, sportscar365.com, dailysportscar.com, endurance-info.com, speedweek.com). Use such a round only when at least 2 independent sources give the same race day (the last day of the weekend); the first day often differs between sources (some count practice or the Thursday): that is not a disagreement, use the earliest first day given. Then set "source": "press" and list the addresses in "sources". If the race days differ, keep the round in "tbc" with both versions in "when". Rounds read on official pages have "source": "official".
9. Classes: if the championship runs several classes with their own classification on one shared calendar and not every class races at every round (e.g. IMSA: GTP, LMP2, GTD PRO, GTD; some rounds are GT only), list the classes in "classes" with their official short names${(series.classes || []).length ? " (use the known classes' names)" : ""}. Otherwise "classes" is []. (Which class races where is checked separately: don't research it.)
JSON schema:
{"website_url": string|null, "calendar_url": string|null, "announcement_url": string|null, "classes": [string],
 "seasons": [{"year": number, "events": [{"round": number|null, "round_to": number|null, "name": string, "start_date": "YYYY-MM-DD", "end_date": "YYYY-MM-DD", "duration_label": string|null, "source": "official"|"press", "sources": [string],
   "circuit": {"name": string, "city": string|null, "country": string, "country_code": string|null, "timezone": string, "lat": number|null, "lng": number|null}}]}],
 "tbc": [{"year": number, "round": number|null, "name": string|null, "circuit": string|null, "when": string|null}],
 "doubts": [string], "notes": string}`;
}
// agent 3, schedule: one race at a time
function checkPrompt(ev: any, series: any, src: any, v: any, raceWeek: boolean) {
  return `Championship: ${series.name}${series.short_name && series.short_name !== series.name ? ` (${series.short_name})` : ""}
Official website: ${series.website_url || "unknown"}
${(src?.urls || []).length ? `Official pages we know: ${(src.urls || []).map((u: any) => u.url).join(", ")}\n` : ""}Race: ${ev.name}
Dates: ${ev.start_date} to ${ev.end_date}
Circuit: ${[v.name, v.city, v.country].filter(Boolean).join(", ")} (local time zone ${v.timezone || "unknown"})
Today: ${new Date().toISOString().slice(0, 10)}
${src?.agent_instructions ? `Instructions from the Racenxt team:\n${src.agent_instructions}\n` : ""}${src?.tt_url ? `Last time, this championship's timetable was found here: ${src.tt_url} (look at the same place for this race first).\n` : ""}${fmtText(series.weekend_format) ? `A full race weekend of this championship usually has ${fmtText(series.weekend_format)} (it can vary, e.g. sprint weekends or double headers).\n` : ""}
Task:
1. Find the official timetable (schedule) of this race weekend. Search strategy:
   a. Open the race's page on the championship website (and its documents / downloads section).
   b. If it isn't there, search the web, for example "${series.short_name || series.name} ${v.name || ev.name} ${ev.start_date.slice(0, 4)} timetable", and also in the local language of the circuit (horaires, programme, horario, Zeitplan, orari, tijdschema).
   c. The timetable is often a PDF on the organiser's or the circuit's website, or published with the event's supplementary regulations. Open PDFs: you can read them.
   List every on-track session of THIS championship (all its classes/categories): practice, qualifying, hyperpole, warm-up, races. Skip support series and non-track events.
If the timetable is not published yet, set "timetable_found": false and an empty list. If only part of it is published (e.g. practice only, or sessions still TBC), give what is published and set "complete": false.
JSON schema:
{"timetable_found": boolean, "complete": boolean, "source_url": string|null, "race_page_url": string|null, "excerpt": string|null, "times_zone": "local"|"UTC"|string|null, "zone_label": string|null,
 "sessions": [{"label": string, "type": "practice"|"qualifying"|"race"|"warmup"|"other", "local_start": "YYYY-MM-DD HH:MM", "local_end": "YYYY-MM-DD HH:MM"|null, "duration_min": number|null, "category": string|null}]}`;
}
const fmtText = (f: any) => { if (!f || typeof f !== "object") return ""; const n: Record<string, string> = { practice: "practice", qualifying: "qualifying", race: "race" }; return Object.entries(f).filter(([k, v]) => n[k] && +(v as any) > 0).map(([k, v]) => `${v} ${n[k]} session${+(v as any) > 1 ? "s" : ""}`).join(", "); };
const DEEP = "\nA first search didn't find the timetable. Look harder: search the web in English and in the local language, and check the circuit's own website and official PDF documents.";

// ---------- where to watch: set per championship; a race only gets its own link if it has a page of its own ----------
const WATCH_TASK = `Where to watch, for the whole championship (official sources only):
   - "stream_url": the championship's official live stream, i.e. its own streaming service or official live channel (e.g. F1 TV, MotoGP VideoPass, FIA WEC+, the official YouTube live page). null if there is none.
   - "broadcasters_url": the official page that lists the TV broadcasters by country (often called "Where to watch", "Broadcasters", "TV schedule"). null if there is none.`;
const sameUrl = (a: unknown, b: unknown) => {
  if (!a || !b) return false;
  const c = (u: unknown) => String(u).replace(/[/#?]+$/, "").replace(/^https?:\/\/(www\.)?/, "").toLowerCase();
  if (c(a) === c(b)) return true;
  // the same page under another address shape (fiaformula3.com/About/<id>/... and /en/latest/article/...<id>)
  const id = (String(a).match(/[A-Za-z0-9]{18,}/) || [""])[0];
  return !!id && host(String(a)) === host(String(b)) && String(b).includes(id);
};
const okUrl = (u: unknown) => typeof u === "string" && /^https?:\/\/[^\s]+$/.test(u);
// agent 4, where to watch, for one race in race week: only a page made for that race weekend
function raceWatchPrompt(ev: any, series: any) {
  return `Championship: ${series.name}${series.short_name && series.short_name !== series.name ? ` (${series.short_name})` : ""}
Official website: ${series.website_url || "unknown"}
Race: ${ev.name}, ${ev.start_date} to ${ev.end_date}
Today: ${new Date().toISOString().slice(0, 10)}
Task: where to watch THIS race. Only a page made for this race weekend (e.g. "How to watch the ${ev.name}", the race's broadcast or TV-times page), on an official site. Not the championship's general stream${series.stream_url ? ` (${series.stream_url})` : ""} or general broadcaster list${series.broadcasters_url ? ` (${series.broadcasters_url})` : ""}. null if there is no page for this race.
JSON schema: {"watch_url": string|null}`;
}
// agent 5, checker: opens the source page again and says, item by item, whether it really shows what was found, with the exact words
const CHECK_RULES = `You check facts against ONE official web page (or PDF). Open that page and only that page: never search the web and never use another source.
For each numbered item, say whether the page shows it. The page may write it differently (e.g. "15-17 Jan", "Friday 15 January", "10:10 AM", "10h10"): that still counts. A different date or time does not count.
Quote the short exact words from the page that show it (at most 15 words), or null.
Finish with ONE fenced \`\`\`json code block and nothing after it.`;
async function checkSource(url: unknown, items: string[], models = [FAST]) {
  if (typeof url !== "string" || !/^https?:/.test(url) || !items.length) return null;
  const list = items.slice(0, 30);
  try {
    const r = await ask(CHECK_RULES, `Page: ${url}\nItems:\n${list.map((x, i) => `${i + 1}. ${x}`).join("\n")}\nJSON schema: {"readable": boolean, "items": [{"n": number, "found": boolean, "quote": string|null}]}`, 2, models);
    const by = new Map<number, any>((r.out.items || []).map((x: any) => [Math.round(Number(x.n)), x]));
    const res = list.map((item, i) => ({ item, found: !!by.get(i + 1)?.found, quote: by.get(i + 1)?.quote ? String(by.get(i + 1).quote).slice(0, 200) : null }));
    return { url, readable: r.out.readable !== false, found: res.filter(x => x.found).length, total: res.length, items: res, usage: r.usage, checked_at: new Date().toISOString() };
  } catch (e) { return { url, readable: false, found: 0, total: list.length, items: [], error: String((e as Error).message || e).slice(0, 200), checked_at: new Date().toISOString() }; }
}
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
// the calendar the AI finds, cleaned up (names, dates, times converted to circuit time). Nothing is filed here.
const clsKey = (c: string) => String(c || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
// the classes racing at one round, in the championship's own names; null when it's all of them (or unknown)
function fixClasses(all: string[], ev: any): string[] | null {
  if (!Array.isArray(ev)) return null;
  const keys = new Set(ev.map((x: any) => clsKey(x)));
  const l = all.filter(a => keys.has(clsKey(a)));
  return l.length && l.length < all.length ? l : null;
}
const sameCls = (a: any, b: any) => (a || []).map(clsKey).sort().join("|") === (b || []).map(clsKey).sort().join("|");
async function computeCalendar(series: any, src: any) {
  const year = new Date().getUTCFullYear();
  const user = discoverPrompt(series, src, year);
  const { out, usage, trace } = await ask(SYS(), user, 10);
  const found = (out.seasons || []).flatMap((s: any) => (s.events || []).map((e: any) => ({ ...e, year: s.year || +String(e.start_date).slice(0, 4) })))
    .map((e: any) => ({ ...e, name: cleanName(e.name, series) })).filter((e: any) => e.name && okDate(e.start_date) && okDate(e.end_date || e.start_date))
    .map((e: any) => {
      const tz = e.circuit?.timezone || "";
      let zone = tz && validTz(tz) ? pageZone(e.times_zone, tz) : tz;
      if (tz && zone !== tz && !ZONE_WORDS.test(String(e.zone_label || ""))) zone = tz;
      const conv = tz && zone && zone !== tz;
      return { ...e, end_date: e.end_date || e.start_date, zoneNote: conv ? ` (times converted from ${e.times_zone} to local ${tz})` : String(e.times_zone || "").toLowerCase() === "unknown" && !/\.pdf(\?|$)/i.test(e.timetable_url || "") ? " (the page didn't say which time zone: check the times)" : "",
        sessions: isTbc(e.timetable_note) ? [] : cleanSessions(conv ? toCircuitTime(e.sessions, zone, tz) : e.sessions, e.start_date, e.end_date || e.start_date) };
    });
  // classes on a shared calendar: the known names win; a round with every class is stored as null (= all)
  const allCls: string[] = (series.classes || []).length ? series.classes : [...new Map((Array.isArray(out.classes) ? out.classes : []).map((c: any) => String(c || "").trim()).filter(Boolean).map((c: string) => [clsKey(c), c])).values()];
  out.classes = allCls.length > 1 ? allCls : [];
  // the official announcement's calendar picture: read when some rounds are undated or only from the press
  if (out.announcement_url && ((out.tbc || []).length || found.some((e: any) => e.source === "press"))) {
    try {
      const img = await readCalendarImages(series, out.announcement_url, year + 1);
      if (img) {
        addUsage(usage, img.usage);
        for (const x of img.events) {
          if (!okDate(x.start_date) || !okDate(x.end_date || x.start_date)) continue;
          const yr = +String(x.start_date).slice(0, 4);
          const ex = found.find((e: any) => e.year === yr && sameCircuit(`${e.circuit?.name || ""} ${e.circuit?.city || ""} ${e.name || ""}`, `${x.circuit?.name || ""} ${x.circuit?.city || ""} ${x.name || ""}`));
          if (ex && ex.source !== "press") continue; // the official text wins
          const ev = { ...(ex || {}), round: x.round ?? ex?.round ?? null, round_to: x.round_to ?? ex?.round_to ?? null, name: ex?.name || cleanName(x.name || x.circuit?.city || "", series), year: yr,
            start_date: x.start_date, end_date: x.end_date || x.start_date, duration_label: ex?.duration_label || null, circuit: ex?.circuit || x.circuit || null,
            source: "official_image", sources: [out.announcement_url], zoneNote: "", sessions: [] };
          if (ex) Object.assign(ex, ev); else if (ev.name) found.push(ev);
          out.tbc = (out.tbc || []).filter((t: any) => !(+t.year === yr && sameCircuit(`${t.circuit || ""} ${t.name || ""}`, `${x.circuit?.name || ""} ${x.circuit?.city || ""} ${x.name || ""}`)));
        }
        trace.opened.push(...img.images);
      }
    } catch (_) { /* pictures unreadable: keep what we have */ }
  }
  return { out, usage, trace, found };
}
// the pictures of an official announcement page, read by the AI (calendars are often published as an image)
async function readCalendarImages(series: any, url: string, year: number) {
  const r = await fetch(url, { headers: { "User-Agent": UA }, redirect: "follow", signal: AbortSignal.timeout(15000) });
  if (!r.ok) return null;
  const html = (await r.text()).slice(0, 2_000_000);
  const base = r.url || url;
  const urls: string[] = [];
  const og = (html.match(/<meta\b[^>]*property=["']og:image["'][^>]*content=["']([^"']+)["']/i) || [])[1]; if (og) urls.push(abs(og, base));
  for (const tag of html.match(/<img\b[^>]*>/gi) || []) {
    const src = (tag.match(/\bsrcset=["']([^"']+)["']/i) || [])[1]?.split(",").pop()?.trim().split(/\s+/)[0] || (tag.match(/\b(?:data-src|src)=["']([^"']+)["']/i) || [])[1];
    if (!src || src.startsWith("data:") || /\.svg(\?|$)|logo|icon|avatar|sprite|flag/i.test(src)) continue;
    urls.push(abs(src, base));
  }
  const pics: { url: string; data: string }[] = [];
  for (const u of [...new Set(urls.filter(Boolean))]) { if (pics.length >= 6) break; const data = await asJpeg(u, 1600); if (data) pics.push({ url: u, data }); }
  if (!pics.length) return null;
  const content: any[] = [];
  pics.forEach((p, i) => { content.push({ type: "text", text: `Picture ${i + 1}:` }); content.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: p.data } }); });
  content.push({ type: "text", text: `These pictures come from the official page announcing the ${series.name} calendar (${url}).
If one of them shows this championship's race calendar for ${year}, read every round in it: round number, first and last day (YYYY-MM-DD, year ${year} unless the picture says otherwise), race name or town, and the circuit (official name, town, country, ISO two-letter country code, IANA time zone, approximate latitude/longitude). Only rounds of THIS championship (not support series, tests or prologues). Never guess a date that isn't in a picture.
Answer with JSON only: {"found": boolean, "events": [{"round": number|null, "round_to": number|null, "name": string, "start_date": "YYYY-MM-DD", "end_date": "YYYY-MM-DD", "circuit": {"name": string, "city": string|null, "country": string, "country_code": string|null, "timezone": string, "lat": number|null, "lng": number|null}}]}` });
  const v = await vision(STRONG, content);
  return v.out?.found ? { events: v.out.events || [], usage: v.usage, images: pics.map(p => p.url) } : { events: [], usage: v.usage, images: pics.map(p => p.url) };
}
async function discover(series: any, src: any, runId: string, kind = "discover") {
  if (kind === "monthly") {
    const same = await unchanged(`series_id=eq.${series.id}&event_id=is.null`, 90);
    if (same) return { result: "skipped_unchanged", summary: SKIPPED, usage: null, pages: same };
  }
  const known = await db(`events?series_id=eq.${series.id}&select=id,year,round,round_to,name,start_date,end_date,duration_label,classes,venues(name)`);
  const { out, usage, trace, found } = await computeCalendar(series, src);
  const site = out.website_url || series.website_url;
  const domain = host(site || "");
  const props: string[] = [];

  // agent settings and website (internal, not shown to fans)
  const urls = [...new Set([...(src?.urls || []).map((u: any) => u.url), out.calendar_url].filter(Boolean))];
  const domains = [...new Set([...(src?.allowed_domains || []), domain].filter(Boolean))];
  await db("series_sources", { method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify({ series_id: series.id, urls: urls.map(url => ({ url })), allowed_domains: domains, agent_instructions: src?.agent_instructions || "" }) });
  const upd: any = {};
  if (!series.website_url && site) upd.website_url = site;

  // logo: when the championship has none yet, the best pictures go to the Review queue (Reject / Adjust / Approve)
  let logoNote = "";
  const [logoPending] = await db(`proposals?series_id=eq.${series.id}&kind=eq.logo&status=eq.pending&select=id&limit=1`);
  if (!series.logo_url && !logoPending) {
    // agent 2, logo: its own search (the calendar agent doesn't look for logos any more)
    let logos: string[] = [];
    try {
      const f = await findLogo({ ...series, website_url: site }, null, `${series.slug}-svg`);
      addUsage(usage, f.usage);
      // the AI's pick first, then the next best candidates (the admin can switch to another one)
      const order = f.picked >= 0 ? [f.cands[f.picked], ...f.cands.filter((_, i) => i !== f.picked)] : f.cands;
      logos = await storeLogos(series.slug, order.slice(0, 5).map(x => ({ url: x.url })));
      if (logos.length) {
        await ins("proposals", { run_id: runId, series_id: series.id, kind: "logo", payload: { candidates: logos, picked: f.picked >= 0 ? logos[0] : null }, evidence: { url: site || "", excerpt: f.picked >= 0 ? "The official logo, picked by the AI among the pictures on the official site." : "The AI wasn't sure which picture is the official logo: pick one." } });
        props.push("logo");
      }
    } catch (_) { /* no logo this time */ }
    if (!logos.length) logoNote = " No logo found: add one in Edit championship.";
  }
  if (Object.keys(upd).length) await patch("series", `id=eq.${series.id}`, upd);
  // agent 4, where to watch: when the championship is added or checked by hand, or when a link is missing
  if (kind !== "monthly" || !series.stream_url || !series.broadcasters_url) {
    try {
      const w = await ask(SYS(), linksPrompt({ ...series, website_url: site }), 5);
      addUsage(usage, w.usage); addTrace(trace, w.trace);
      if (await proposeLinks(series, w.out, runId, site || "")) props.push("where to watch");
    } catch (_) { /* where to watch next time */ }
  }
  // agent 5, checker: every date about to be proposed is looked up again on the calendar page, with the exact words
  const label = (e: any) => `${e.name} (${e.circuit?.name || "circuit ?"}): ${e.start_date} to ${e.end_date || e.start_date}`;
  const tocheck = found.filter((e: any) => {
    const match = known.find((k: any) => k.year === e.year && ((e.circuit?.name && k.venues?.name && norm(k.venues.name) === norm(e.circuit.name)) || norm(k.name) === norm(e.name) || (e.round && k.round === e.round)));
    return !match || match.start_date !== e.start_date || match.end_date !== (e.end_date || e.start_date);
  });
  // official rounds against the calendar page; press rounds against their own first source; rounds read on the official picture are marked as such
  const offi = tocheck.filter((e: any) => e.source !== "press" && e.source !== "official_image");
  let chk: any = offi.length ? await checkSource(out.calendar_url || site, offi.map(label)) : null;
  if (chk?.usage) { addUsage(usage, chk.usage); delete chk.usage; }
  // nothing confirmed: read the page again with the stronger model before anything goes to the Review queue
  if (chk && chk.total > 0 && chk.found === 0) {
    const c2: any = await checkSource(out.calendar_url || site, offi.map(label), [STRONG]);
    if (c2?.usage) { addUsage(usage, c2.usage); delete c2.usage; }
    if (c2) chk = { ...c2, retried: true };
  }
  const extraItems: any[] = [];
  const bySrc = new Map<string, any[]>();
  for (const e of tocheck.filter((e: any) => e.source === "press" && okUrl(e.sources?.[0]))) bySrc.set(e.sources[0], [...(bySrc.get(e.sources[0]) || []), e]);
  for (const [u, list] of bySrc) {
    const c: any = await checkSource(u, list.map(label));
    if (c?.usage) { addUsage(usage, c.usage); delete c.usage; }
    for (const it of c?.items || []) extraItems.push({ ...it, src: u, press: true });
  }
  for (const e of tocheck.filter((e: any) => e.source === "official_image")) extraItems.push({ item: label(e), found: true, quote: "read from the calendar picture on the official announcement", src: e.sources?.[0] || out.announcement_url });
  if (extraItems.length) {
    const items = [...(chk?.items || []), ...extraItems];
    chk = { ...(chk || { url: out.calendar_url || site, readable: true, checked_at: new Date().toISOString() }), items, found: items.filter((i: any) => i.found).length, total: items.length };
  }
  const proofOf = (e: any) => { const x = chk?.items?.find((i: any) => i.item === label(e)); return x ? { ...chk, items: [x], found: x.found ? 1 : 0, total: 1 } : null; };
  const extra = [(out.tbc || []).length ? `Not dated yet: ${(out.tbc || []).map((t: any) => [t.name || t.circuit, t.when].filter(Boolean).join(" ")).join("; ")}.` : "", (out.doubts || []).length ? `Doubts: ${(out.doubts || []).join(" ")}` : ""].filter(Boolean).join(" ");

  // calendar: new races in one proposal, changed dates as separate proposals
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
    const newRoundTo = e.round_to && e.round && e.round_to > e.round && match.round === e.round && match.round_to !== e.round_to;
    if (e.source === "press") continue; // a date we already have is only changed by an official source
    if (match.start_date !== e.start_date || match.end_date !== (e.end_date || e.start_date) || newRoundTo) {
      await ins("proposals", { run_id: runId, series_id: series.id, event_id: match.id, kind: "event_change",
        payload: { start_date: e.start_date, end_date: e.end_date || e.start_date, ...(e.duration_label ? { duration_label: e.duration_label } : {}), ...(newRoundTo ? { round: e.round, round_to: e.round_to } : {}) },
        evidence: { url: out.calendar_url || site, excerpt: `${e.name}: ${e.start_date} → ${e.end_date}`, check: proofOf(e) } });
      props.push(newRoundTo && match.start_date === e.start_date ? `double header: ${match.name}` : `date change: ${match.name}`);
    }
  }
  // classes: a shared calendar (e.g. IMSA). Which class races where is a separate job with its own time budget:
  // started now for the races we already have, or when the new races are approved (database trigger)
  if (out.classes.length > 1 && !fresh.length) {
    try {
      await fetch(`${SB}/functions/v1/agent`, { method: "POST", headers: { Authorization: `Bearer ${SRK}`, "Content-Type": "application/json" }, body: JSON.stringify({ action: "classes", series_id: series.id, classes: out.classes, calendar_url: out.calendar_url || site }) });
      props.push("classes (checked race by race next)");
    } catch (_) { /* next check */ }
  }
  if (fresh.length) {
    await ins("proposals", { run_id: runId, series_id: series.id, kind: "new_season",
      payload: { ...(out.classes.length > 1 && !(series.classes || []).length ? { classes: out.classes } : {}), events: fresh.map((e: any) => ({ round: e.round ?? null, round_to: e.round_to ?? null, ...(e.source && e.source !== "official" ? { source: e.source, sources: (e.sources || []).filter(okUrl).slice(0, 4) } : {}), name: e.name, start_date: e.start_date, end_date: e.end_date, duration_label: e.duration_label || null, year: e.year, circuit: e.circuit || null, ...(e.sessions.length ? { sessions: e.sessions, timetable_note: (e.timetable_url ? `Source: ${e.timetable_url}` : "") + e.zoneNote } : {}) })) },
      evidence: { url: out.calendar_url || site, excerpt: [fresh.some((e: any) => e.source === "press") ? `${fresh.filter((e: any) => e.source === "press").length} race(s) from reliable press (the official site doesn't give the dates yet): check them.` : "", fresh.some((e: any) => e.source === "official_image") ? `${fresh.filter((e: any) => e.source === "official_image").length} race(s) read on the official calendar picture.` : "", out.classes.length > 1 ? `Shared calendar: ${out.classes.join(", ")}. Once approved, the AI checks which classes race at each round.` : "", out.notes || "", extra].filter(Boolean).join(" "), check: chk ? (() => { const items = chk.items.filter((i: any) => fresh.some((e: any) => label(e) === i.item)); return { ...chk, items, found: items.filter((i: any) => i.found).length, total: items.length }; })() : null } });
    props.push(`${fresh.length} new race${fresh.length > 1 ? "s" : ""} (timetables are checked race by race)`);
  }
  const summary = (props.length ? `Found: ${props.join(", ")}.` : "Nothing new: the calendar matches what we have.") + logoNote;
  return { result: props.length ? "proposal" : "no_change", summary, usage, pages: await fingerprint([out.calendar_url, ...urls, site]), trace: { ...trace, answer: out } };
}

// ---------- classes: which classes race at each round of a shared calendar ----------
function classesPrompt(series: any, cls: string[], calUrl: string, evs: any[]) {
  return `Championship: ${series.name}${series.short_name && series.short_name !== series.name ? ` (${series.short_name})` : ""}
Official calendar: ${calUrl || series.website_url || "unknown"}
Classes: ${cls.join(", ")}
Today: ${new Date().toISOString().slice(0, 10)}
Task: these classes share one calendar, and not every class races at every round. For each numbered round below, say which of the classes race there.
Read the official calendar page first: it usually shows each round's classes (often as small class labels or logos). Open a round's own official page only if the calendar doesn't show them. If you can't tell for a round, use null. Use the class names exactly as listed above.
Rounds:
${evs.map((e, i) => `${i + 1}. ${e.name} (${e.venues?.name || "circuit ?"}), ${e.start_date} to ${e.end_date}`).join("\n")}
JSON schema: {"calendar_url": string|null, "rounds": [{"n": number, "classes": [string]|null}]}`;
}
async function classesJob(series: any, src: any, runId: string, body: any) {
  const cls: string[] = (series.classes || []).length > 1 ? series.classes : (Array.isArray(body.classes) ? body.classes.map((c: any) => String(c || "").trim()).filter(Boolean) : []);
  if (cls.length < 2) return { result: "no_change", summary: "One class: nothing to check.", usage: null, pages: [] };
  const evs = await db(`events?series_id=eq.${series.id}&year=gte.${new Date().getUTCFullYear()}&select=id,name,start_date,end_date,classes,venues(name)&order=start_date&limit=40`);
  if (!evs.length) return { result: "no_change", summary: "No races yet.", usage: null, pages: [] };
  const calUrl = body.calendar_url || (src?.urls || [])[0]?.url || series.website_url || "";
  const { out, usage, trace } = await ask(SYS(), classesPrompt(series, cls, calUrl, evs), 4);
  const by = new Map<number, any>((out.rounds || []).map((r: any) => [Math.round(Number(r.n)), r.classes]));
  const evCh: any[] = [];
  let subsets = 0;
  evs.forEach((ev: any, i: number) => {
    const c = fixClasses(cls, by.get(i + 1));
    if (c) subsets++;
    // a round the AI can't tell about (null) keeps what we already have
    if ((c || (Array.isArray(by.get(i + 1)) && !(ev.classes || []).length)) && !sameCls(ev.classes, c)) evCh.push({ event_id: ev.id, name: ev.name, start_date: ev.start_date, classes: c });
  });
  const pages = await fingerprint([out.calendar_url, calUrl]);
  if (!subsets && !(series.classes || []).length) return { result: "no_change", summary: "Every class races at every round: no class choice needed.", usage, pages, trace: { ...trace, answer: out } };
  const [pending] = await db(`proposals?series_id=eq.${series.id}&kind=eq.classes&status=eq.pending&select=id&limit=1`);
  if (pending || (!evCh.length && sameCls(series.classes, cls))) return { result: "no_change", summary: pending ? "A classes suggestion is already waiting in the Review queue." : "Nothing new: classes unchanged.", usage, pages, trace: { ...trace, answer: out } };
  await ins("proposals", { run_id: runId, series_id: series.id, kind: "classes", payload: { classes: cls, events: evCh },
    evidence: { url: out.calendar_url || calUrl, excerpt: `${series.short_name || series.name} runs ${cls.length} classes on one calendar and not every class races at every round. Athletes pick their class: their page only shows the races of their class.` } });
  return { result: "proposal", summary: `Found: classes${evCh.length ? ` (${evCh.length} race${evCh.length > 1 ? "s" : ""} without every class)` : ""}.`, usage, pages, trace: { ...trace, answer: out } };
}

// ---------- check_event: timetable + where to watch ----------
// the timetable the AI finds for one race, cleaned up and in circuit time. Nothing is filed here.
async function computeSchedule(ev: any, series: any, src: any, current: any[], models = [FAST, STRONG]) {
  const v = ev.venues || {};
  // the race's own broadcast page is only published in the days before the race
  const raceWeek = Math.round((new Date(ev.start_date + "T12:00:00Z").getTime() - Date.now()) / 864e5) <= 7;
  const user = checkPrompt(ev, series, src, v, raceWeek);
  let { out, usage, trace } = await ask(SYS(), user, models.length === 1 ? 10 : 8, models);
  // close to the race and still nothing: one more, deeper look with the stronger model
  const daysToStart = Math.round((new Date(ev.start_date + "T12:00:00Z").getTime() - Date.now()) / 864e5);
  if (models.length > 1 && !(out.timetable_found && (out.sessions || []).length) && daysToStart <= 10 && daysToStart >= -1) {
    try { const deep = await ask(SYS(), user + DEEP, 10, [STRONG]); addUsage(usage, deep.usage); addTrace(trace, deep.trace); if (deep.out.timetable_found && (deep.out.sessions || []).length) out = deep.out; } catch (_) { /* keep the first answer */ }
  }
  const ctz = v.timezone && validTz(v.timezone) ? v.timezone : "";
  let zone = ctz ? pageZone(out.times_zone, ctz) : "";
  let zoneDoubt = false;
  if (ctz && zone !== ctz && !(await zoneBacked(out.zone_label, out.source_url))) { zone = ctz; zoneDoubt = true; }
  const conv = !!ctz && zone !== ctz;
  const zoneNote = conv ? ` (times converted from ${out.times_zone} to local ${ctz})` : zoneDoubt || (String(out.times_zone || "").toLowerCase() === "unknown" && !/\.pdf(\?|$)/i.test(out.source_url || "")) ? " (the page didn't say which time zone: kept as shown, check the times)" : "";
  if (isTbc(out.excerpt)) out.timetable_found = false;
  let sessions = cleanSessions(conv ? toCircuitTime(out.sessions, zone, ctz) : out.sessions, ev.start_date, ev.end_date);
  let zoneFix = "";
  // the page's own exact timestamps, when it has them, settle the time zone
  if (ctz && (out.sessions || []).length) {
    const stamps = await pageStamps(out.source_url, ctz, ev.start_date, ev.end_date);
    if (stamps.size >= 2) {
      const hits = (l: any[]) => l.filter(x => stamps.has(String(x.local_start).replace("T", " ").slice(0, 16))).length;
      const options = [
        { list: sessions, note: "" },
        { list: cleanSessions(out.sessions, ev.start_date, ev.end_date), note: " (checked against the page's own timestamps: times are local)" },
        { list: cleanSessions(toCircuitTime(out.sessions, "UTC", ctz), ev.start_date, ev.end_date), note: ` (checked against the page's own timestamps: converted from UTC to local ${ctz})` },
      ];
      const best = options.reduce((a, o) => hits(o.list) > hits(a.list) ? o : a, options[0]);
      if (best !== options[0] && hits(best.list) > 0) { sessions = best.list; zoneFix = best.note; }
      else if (hits(options[0].list) > 0) zoneFix = " (checked against the page's own timestamps)";
    }
  }
  // safety net: zone not stated, but read as UTC the times match what we already have -> the page was showing UTC
  if (!zoneFix && !conv && ctz && ctz !== "UTC" && String(out.times_zone || "").toLowerCase() === "unknown" && current.length) {
    const asUtc = cleanSessions(toCircuitTime(out.sessions, "UTC", ctz), ev.start_date, ev.end_date);
    const starts = (l: any[]) => JSON.stringify(l.map(s => String(s.local_start).replace("T", " ").slice(0, 16)).sort());
    if (starts(asUtc) === starts(current)) { sessions = asUtc; zoneFix = ` (times were shown in UTC: converted to local ${ctz})`; }
  }
  if (!(out.timetable_found && sessions.length)) sessions = [];
  return { out, usage, trace, sessions, zoneNote, zoneFix, raceWeek };
}
async function checkEvent(ev: any, series: any, src: any, runId: string, kind = "manual") {
  if (kind === "daily" || kind === "weekly") {
    // skip the AI while the pages stay the same (race week: still asked at least every other day)
    const same = await unchanged(`event_id=eq.${ev.id}`, kind === "daily" ? 2 : 8);
    if (same) return { result: "skipped_unchanged", summary: SKIPPED, usage: null, pages: same };
  }
  const current = await db(`sessions?event_id=eq.${ev.id}&select=label,type,local_start,duration_min&order=local_start`);
  let { out, usage, trace, sessions, zoneNote, zoneFix, raceWeek } = await computeSchedule(ev, series, src, current);
  const props: string[] = [];
  if (sessions.length) {
    // only real changes count: start times and lengths, not how the sessions are named
    // (an estimated length never replaces a known one)
    const key = (l: any[]) => JSON.stringify(l.map(s => String(s.local_start).replace("T", " ").slice(0, 16)).sort());
    const lens = (l: any[]) => JSON.stringify([...l].sort((a, b) => String(a.local_start).localeCompare(String(b.local_start))).map(s => s.end_estimated ? null : s.duration_min));
    const curLens = JSON.stringify(current.map((s: any) => s.duration_min));
    const changedLens = current.length === sessions.length && JSON.parse(lens(sessions)).some((d: any, i: number) => d !== null && d !== JSON.parse(curLens)[i]);
    if (key(sessions) !== key(current) || changedLens) {
      // agent 5, checker: the times as the page shows them (before any time-zone conversion), looked up again on the source
      const rawOf = (o: any) => (o.sessions || []).filter((x: any) => x?.label && x?.local_start).map((x: any) => `${x.label}${x.category ? ` (${x.category})` : ""}: ${x.local_start}${x.local_end ? ` to ${String(x.local_end).slice(11)}` : ""}`);
      let chk: any = await checkSource(out.source_url, rawOf(out));
      if (chk?.usage) { addUsage(usage, chk.usage); delete chk.usage; }
      // nothing confirmed on the source: one more search with the stronger model, and keep it if its source confirms it
      if (chk && chk.total > 0 && chk.found === 0) {
        try {
          const r2 = await computeSchedule(ev, series, src, current, [STRONG]); addUsage(usage, r2.usage); addTrace(trace, r2.trace);
          if (r2.sessions.length) {
            const chk2: any = await checkSource(r2.out.source_url, rawOf(r2.out), [STRONG]);
            if (chk2?.usage) { addUsage(usage, chk2.usage); delete chk2.usage; }
            if (chk2 && chk2.found > 0) { out = r2.out; sessions = r2.sessions; zoneNote = r2.zoneNote; zoneFix = r2.zoneFix; chk = { ...chk2, retried: true }; }
            else chk = { ...chk, retried: true };
          }
        } catch (_) { /* keep the first answer */ }
      }
      await ins("proposals", { run_id: runId, series_id: series.id, event_id: ev.id, kind: "timetable", payload: { sessions }, evidence: { url: out.source_url || series.website_url || "", excerpt: (out.excerpt || "") + (zoneFix || zoneNote) + (out.complete === false ? " (only part of the timetable is published yet: the search goes on)" : ""), check: chk } });
      props.push(`timetable (${sessions.length} sessions)`);
    }
  }
  // agent 4, where to watch this race: only in race week, when race pages get published
  let watchUrl: string | null = null;
  if (raceWeek) {
    try { const w = await ask(SYS(), raceWatchPrompt(ev, series), 4); addUsage(usage, w.usage); addTrace(trace, w.trace); watchUrl = okUrl(w.out.watch_url) ? w.out.watch_url : null; } catch (_) { /* next check */ }
  }
  if (sameUrl(watchUrl, series.stream_url) || sameUrl(watchUrl, series.broadcasters_url)) watchUrl = null;
  if (watchUrl && !sameUrl(watchUrl, ev.watch_url)) {
    await ins("proposals", { run_id: runId, series_id: series.id, event_id: ev.id, kind: "watch_link", payload: { watch_url: watchUrl }, evidence: { url: watchUrl, excerpt: `Broadcast page for ${ev.name}` } });
    props.push("this race's broadcast page");
  }
  const summary = props.length ? `Found: ${props.join(", ")}.` : out.timetable_found ? "Nothing new: timetable unchanged." : "Timetable not published yet.";
  return { result: props.length ? "proposal" : "no_change", summary, usage, pages: await fingerprint([out.source_url, out.race_page_url, ...(src?.urls || []).map((u: any) => u.url)]), trace: { ...trace, answer: out } };
}


// ---------- agent tests: run a task on a case of the answer key, without filing anything, and score it ----------
const KEY_URL = "https://raw.githubusercontent.com/Birel22/racenxt/main/agent-tests/answer_key.json";
async function syncCases() {
  const r = await fetch(KEY_URL + "?t=" + Date.now(), { headers: { "Cache-Control": "no-cache" } });
  if (!r.ok) throw new Error("answer key not reachable");
  const key = await r.json();
  const rows = (key.cases || []).map((c: any, i: number) => ({ id: c.id, sort: i, data: c, updated_at: new Date().toISOString() }));
  if (rows.length) await db("agent_test_cases", { method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify(rows) });
  return rows.length;
}
// circuits are written many ways: compare on meaningful words, with a few known aliases
const ALIAS: [RegExp, string][] = [[/algarve/, "portimao"], [/catalunya|catalonia|montmelo/, "barcelona"], [/castellet|paul ricard/, "ricard"], [/yas/, "yas abu dhabi"], [/abu dhabi/, "yas abu dhabi"],
  [/lusail|losail/, "lusail qatar"], [/red bull ring|spielberg/, "spielberg"], [/hungaroring|budapest|mogyorod/, "budapest"], [/enzo e dino|imola/, "imola"], [/gilles villeneuve|montreal/, "montreal"],
  [/albert park|melbourne/, "melbourne"], [/sakhir|bahrain/, "sakhir"], [/jeddah|corniche/, "jeddah"], [/marina bay|singapore/, "singapore"], [/autodromo nazionale|monza/, "monza"],
  [/nevers|magny/, "magny"], [/francorchamps|spa\b/, "spa"], [/navarra|los arcos/, "navarra"], [/misano|marco simoncelli/, "misano"], [/istanbul|intercity|park/, "istanbul"],
  [/hermanos rodriguez|mexico/, "mexico"], [/baku/, "baku"], [/madrid|madring|ifema/, "madrid"], [/jerez|angel nieto/, "jerez"]];
const STOP = new Set(["circuit", "circuito", "de", "do", "of", "the", "international", "internacional", "internazionale", "autodromo", "world", "grand", "prix", "track", "karting", "kart", "raceway", "speedway", "park", "and", "la", "le", "del", "di"]);
const words = (s: string) => { let n = norm(s); for (const [re, w] of ALIAS) if (re.test(n)) n += " " + w; return new Set(n.split(" ").filter(w => w.length > 2 && !STOP.has(w))); };
const sameCircuit = (a: string, b: string) => { const A = words(a), B = words(b); for (const w of A) if (B.has(w)) return true; return false; };
const firstUrl = (s: unknown) => (String(s || "").match(/https?:\/\/[^\s)]+/) || [""])[0];
const looseUrl = (found: unknown, exp: unknown) => {
  const e = firstUrl(exp), f = String(found || "");
  if (!e || !f) return false;
  if (sameUrl(f, e)) return true;
  // same page id in a different URL shape (fiaformula2.com/About/<id>/... vs /en/information/...<id>)
  const id = (e.match(/[A-Za-z0-9]{18,}/) || [""])[0];
  if (id && f.includes(id)) return true;
  const clean = (u: string) => u.replace(/^https?:\/\/(www\.)?/, "").replace(/[/#?]+$/, "").toLowerCase();
  const fe = clean(f), ee = clean(e);
  // same host and one path is the start of the other (youtube.com/@channel vs youtube.com/@channel/streams, f1tv.formula1.com vs f1tv.formula1.com/...)
  return fe.startsWith(ee) || ee.startsWith(fe) || (host(f) === host(e) && host(e).length > 0 && ee.split("/").length <= 1);
};

function scoreCalendar(c: any, found: any[]) {
  const yr = String(c.year).match(/^\d{4}$/) ? +c.year : null;
  // a winter season (2026-27): only what starts from about a month before its first expected round
  const first = (c.expect || []).map((x: any) => x.start).filter(Boolean).sort()[0] || "";
  const from = first ? new Date(new Date(first).getTime() - 40 * 864e5).toISOString().slice(0, 10) : "";
  const now = new Date().toISOString().slice(0, 10);
  const pool = found.filter((e: any) => (e.end_date || e.start_date) >= now && (yr ? String(e.start_date).startsWith(String(yr)) : (!from || e.start_date >= from)));
  const rows: any[] = []; const used = new Set<number>();
  let score = 0, max = 0;
  const today = new Date().toISOString().slice(0, 10);
  for (const x of c.expect || []) {
    if (x.end && x.end < today) continue; // rounds already over: the agent is told to skip them
    max++;
    const idx = pool.findIndex((e: any, i: number) => !used.has(i) && sameCircuit(`${e.circuit?.name || ""} ${e.circuit?.city || ""} ${e.name || ""}`, `${x.circuit} ${x.name || ""}`));
    const f = idx >= 0 ? pool[idx] : null; if (idx >= 0) used.add(idx);
    if (!x.start) { // no date announced yet: right if the agent didn't invent one
      const ok = !f;
      if (ok) score++;
      rows.push({ expect: `${x.circuit} · date not announced`, found: f ? `${f.name} ${f.start_date}→${f.end_date}` : "not added", ok, why: ok ? "" : "invented a date" });
      continue;
    }
    const ok = !!f && f.start_date === x.start && f.end_date === x.end;
    if (ok) score++;
    rows.push({ expect: `${x.circuit} ${x.start}→${x.end}`, found: f ? `${f.name} ${f.start_date}→${f.end_date}` : "missed", ok, why: ok ? "" : f ? "wrong dates" : "missed" });
  }
  const extra = pool.filter((_: any, i: number) => !used.has(i));
  for (const e of extra) rows.push({ expect: "(not in the answer key)", found: `${e.name} ${e.start_date}→${e.end_date}`, ok: false, why: "extra" });
  score = Math.max(0, score - extra.length * 0.5);
  return { score, max, rows };
}
function scoreSchedule(c: any, sessions: any[]) {
  const t = (s: any) => String(s.local_start).replace("T", " ").slice(0, 16);
  if (typeof c.expect === "string") { // nothing published yet
    const ok = !sessions.length;
    return { score: ok ? 1 : 0, max: 1, rows: [{ expect: "nothing yet (TBC)", found: sessions.length ? `${sessions.length} sessions proposed` : "nothing proposed", ok, why: ok ? "" : "invented a timetable" }] };
  }
  const rows: any[] = []; const used = new Set<number>(); let score = 0, max = 0;
  for (const x of c.expect) {
    const want = `${x.day} ${x.start}`;
    const idx = sessions.findIndex((s: any, i: number) => !used.has(i) && t(s) === want);
    if (idx >= 0) used.add(idx);
    const f = idx >= 0 ? sessions[idx] : null;
    let ok = !!f, why = f ? "" : "missed";
    if (f && x.end) { const end = new Date(new Date(want.replace(" ", "T") + ":00Z").getTime() + f.duration_min * 60000).toISOString().slice(11, 16); if (end !== x.end && !f.end_estimated) { ok = false; why = `ends ${end}, not ${x.end}`; } }
    if (!x.optional) { max++; if (ok) score++; else if (f) score += 0.5; }
    rows.push({ expect: `${x.label} ${want}${x.end ? `–${x.end}` : ""}${x.optional ? " (optional)" : ""}`, found: f ? `${f.label} ${t(f)} (${f.duration_min} min)` : "missed", ok, why });
  }
  const ign = (c.ignore_extra || []).map((w: string) => w.toLowerCase());
  const extra = sessions.filter((s: any, i: number) => !used.has(i) && !ign.some((w: string) => String(s.label).toLowerCase().includes(w)));
  for (const e of extra) rows.push({ expect: "(not in the answer key)", found: `${e.label} ${t(e)}`, ok: false, why: "extra or wrong time" });
  score = Math.max(0, score - extra.length * 0.25);
  return { score, max, rows };
}
function scoreWatch(c: any, out: any) {
  const rows: any[] = []; let score = 0, max = 0;
  for (const k of ["stream_url", "broadcasters_url"]) {
    if (!c.expect?.[k]) continue;
    max++;
    const ok = looseUrl(out?.[k], c.expect[k]);
    if (ok) score++;
    rows.push({ expect: `${k === "stream_url" ? "Official stream" : "TV broadcasters"}: ${firstUrl(c.expect[k]) || c.expect[k]}`, found: out?.[k] || "nothing", ok, why: ok ? "" : out?.[k] ? "different link" : "missed" });
  }
  return { score, max, rows };
}
// ---------- logo test: the app's logo pipeline (homepage + AI search candidates, then the AI picks), compared with a reference picture ----------
const RAW = "https://raw.githubusercontent.com/Birel22/racenxt/main/";
// any logo picture -> JPEG on grey (the AI can't read SVG, and white logos vanish on transparency); via a public image proxy
async function asJpeg(url: string, size = 600) {
  try {
    const r = await fetch(`https://images.weserv.nl/?url=${encodeURIComponent(url)}&output=jpg&bg=7f7f7f&w=${size}&h=${size}&fit=inside&we`, { signal: AbortSignal.timeout(15000) });
    if (!r.ok) return null;
    const buf = new Uint8Array(await r.arrayBuffer());
    return buf.length > 400 && buf.length < 2_500_000 ? b64(buf) : null;
  } catch (_) { return null; }
}
// one vision question; a bad or empty answer is asked again once (room to think first: a short limit left empty answers)
async function vision(model: string, content: any[]) {
  const u = newUsage(); u.model = model;
  let last = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const r = await fetch("https://api.anthropic.com/v1/messages", { method: "POST", headers: { "x-api-key": AKEY, "anthropic-version": "2023-06-01", "content-type": "application/json" }, body: JSON.stringify({ model, max_tokens: 4000, messages: [{ role: "user", content }] }) });
      const t = await r.text();
      const j = t ? JSON.parse(t) : {};
      if (!r.ok) { last = `AI ${r.status}: ${j?.error?.message || "no answer"}`; await new Promise(x => setTimeout(x, 3000)); continue; }
      u.input += j.usage?.input_tokens || 0; u.output += j.usage?.output_tokens || 0; u.cost_usd = Math.round(priceOf(model, u.input, u.output) * 10000) / 10000;
      const text = (j.content || []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("");
      if (!text.includes("{")) { last = `no JSON in the answer (${j.stop_reason}): ${text.slice(0, 120)}`; continue; }
      return { out: JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)), usage: u };
    } catch (e) { last = String((e as Error).message || e); }
  }
  throw new Error(`the AI's answer couldn't be read twice (${last})`);
}
const LOGO_PROMPT = (s: any) => `Championship: ${s.name}${s.short_name && s.short_name !== s.name ? ` (${s.short_name})` : ""}
Official website: ${s.website_url || "unknown"}
Task: find this championship's own official logo. Give up to 4 direct, absolute image URLs (SVG or PNG preferred): the logo in the official site's header, its media / press kit, or a Wikimedia Commons file of the official logo (upload.wikimedia.org). Not the organiser's, a sponsor's or an older logo.
JSON schema: {"logo_urls": [string]}`;
// sorts logo candidates before the AI sees them: pages show many partner logos, so the championship's own come first
const GENERIC = new Set(["series", "championship", "cup", "the", "fia", "international", "racing", "trophy", "official"]);
function rankLogos(urls: string[], series: any, prio: Map<string, number>) {
  const toks = norm(`${series.name || ""} ${series.short_name || ""}`).split(" ").filter((w: string) => w.length >= 4 && !GENERIC.has(w));
  const short = norm(series.short_name || "");
  const site = host(series.website_url || "");
  const score = (u: string) => {
    const file = norm(decodeURIComponent(u.split("?")[0].split("/").slice(-2).join(" ")));
    const fw = file.split(" ");
    let n = 0;
    if (toks.some((t: string) => fw.some(w => w.length >= 4 && (w.startsWith(t.slice(0, 5)) || t.startsWith(w.slice(0, 5)))))) n += 4;
    if (short && fw.includes(short)) n += 3;
    if (/\blogo\b/.test(file)) n += 1;
    n += prio.get(u) || 0;
    if (/partner|sponsor|supplier|fournisseur|team|teams|equipe/.test(file)) n -= 4;
    // an old year in the address (uploads/2024/...) usually means an older logo
    const yrs = (u.match(/\/(20\d{2})\//g) || []).map(y => +y.slice(1, 5));
    if (yrs.length && Math.max(...yrs) < new Date().getUTCFullYear() - 1) n -= 1;
    if (site && host(u) === site) n += 1;
    return n;
  };
  return urls.map((u, i) => ({ u, i, n: score(u) })).sort((a, b) => b.n - a.n || a.i - b.i).map(x => x.u);
}
let stage = "";
// ---------- logo finder, shared by "add a championship", "Find logo with AI" and the tests ----------
// 1. the page as a visitor sees it (Cloudflare browser, when set up) and its raw code; the homepage link in the header first
// 2. optional: an AI web search for more candidates
// 3. the AI picks, looking at a screenshot of the top of the official homepage when there is one
const WHERE_PRIO: Record<string, number> = { home: 6, header: 2, ai: 2, page: 0 };
async function findLogo(series: any, aiUrls: string[] | null, slugPrefix: string) {
  const usage = newUsage(); const trace: Trace = { searches: [], opened: [] };
  const site = series.website_url || "";
  let items: LogoCand[] = [], shot: string | null = null, rendered = false;
  if (site) {
    stage = "opening the official homepage";
    const [html, png] = await Promise.all([cfBrowser("content", site), cfBrowser("screenshot", site)]);
    if (html) { items.push(...logoCandidatesFromMarkup(html, site)); rendered = true; }
    shot = png;
    items.push(...await logoCandidatesFromHtml(site));
  }
  if (aiUrls === null) {
    stage = "searching the web";
    aiUrls = [];
    try { const r = await ask(SYS(), LOGO_PROMPT(series), 4); addUsage(usage, r.usage); addTrace(trace, r.trace); aiUrls = (r.out.logo_urls || []).filter((u: any) => typeof u === "string" && /^https?:/.test(u)); } catch (_) { /* page candidates only */ }
  }
  items.push(...aiUrls.map(url => ({ url, where: /wiki/.test(url) ? "page" : "ai" })));
  // inline drawings (SVG in the page's code) get an address of their own
  const prio = new Map<string, number>(); const order: string[] = [];
  const add = (url: string, where: string) => { if (!url) return; if (!prio.has(url)) order.push(url); prio.set(url, Math.max(prio.get(url) ?? -9, WHERE_PRIO[where] ?? 0)); };
  const svgs = items.filter(x => x.svg).slice(0, 4);
  for (const x of svgs) { const [u] = await storeLogos(slugPrefix, [x], 1); if (u) add(u, x.where); }
  for (const x of items) if (x.url) add(x.url, x.where);
  const urls = rankLogos(order, series, prio);
  stage = "reading the logo pictures";
  const cands: { url: string; data: string }[] = [];
  for (const url of urls) { if (cands.length >= 10) break; const data = await asJpeg(url); if (data) cands.push({ url, data }); }
  let picked = -1;
  if (cands.length) {
    const content: any[] = [];
    if (shot) content.push({ type: "text", text: "Screenshot of the top of the championship's official homepage:" }, { type: "image", source: { type: "base64", media_type: "image/jpeg", data: shot } });
    cands.forEach((x, i) => { content.push({ type: "text", text: `Image ${i + 1} (from ${x.url.replace(/^https?:\/\//, "").split("?")[0].slice(0, 140)}):` }); content.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: x.data } }); });
    content.push({ type: "text", text: `These images were found for the motorsport championship "${series.name}"${series.short_name && series.short_name !== series.name ? ` (${series.short_name})` : ""}. They are shown on a grey background.
Which image is THIS championship's own official logo? Not the organiser's or promoter's logo, not a sponsor, partner, team, manufacturer, tyre supplier, broadcaster or social-media icon, not a different championship of the same organiser, not a photo. A federation mark (e.g. FIA) only counts if it is part of the championship's logo. Prefer the most complete version (symbol + name together) and a clean one. When two versions of the logo appear, prefer the one the championship's own website uses today (official site, recent upload) over an older one (e.g. a press area or a file dated years ago).${shot ? "\nThe screenshot shows the official homepage as visitors see it: the championship's logo is usually the main logo at the top (often top-left). Pick the image that is that logo." : ""}
Answer with JSON only: {"index": <image number, or 0 if none of them is the championship's logo>}` });
    stage = "picking the logo";
    const p = await vision(FAST, content); addUsage(usage, p.usage);
    const i = Math.round(Number(p.out.index)) - 1;
    picked = i >= 0 && i < cands.length ? i : -1;
  }
  return { cands, picked, urls, usage, trace: { ...trace, candidates: urls, rendered, screenshot: !!shot } };
}
async function runLogoTest(c: any, series: any) {
  const f = await findLogo(series, null, `test-${series.slug || "x"}`);
  const { cands, picked, usage } = f; const trace = f.trace;
  if (!cands.length) return { score: 0, max: 1, rows: [{ expect: "the official logo", found: "no logo picture found", ok: false, why: "missed" }], usage, trace };
  // 3. judge against the reference picture (the stronger model, so the score is reliable)
  stage = "comparing with the reference";
  const ref = await fetch(RAW + c.reference + "?t=" + Date.now());
  if (!ref.ok) throw new Error("reference picture not reachable");
  const refData = b64(new Uint8Array(await ref.arrayBuffer()));
  const jc: any[] = [{ type: "text", text: "Reference logo:" }, { type: "image", source: { type: "base64", media_type: "image/png", data: refData } }];
  cands.forEach((x, i) => { jc.push({ type: "text", text: `Candidate ${i + 1}:` }); jc.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: x.data } }); });
  jc.push({ type: "text", text: `Which candidates show the SAME logo as the reference? Same design and same wording counts even if colours, background, size or a little cropping differ. A different logo, an older version, only the symbol without the name, or a picture where the logo is a small part of a photo or banner does not count.
Answer with JSON only: {"matches": [candidate numbers]}` });
  const jd = await vision(STRONG, jc); addUsage(usage, jd.usage);
  const matches: number[] = (jd.out.matches || []).map((n: any) => Math.round(Number(n)) - 1).filter((n: number) => n >= 0 && n < cands.length);
  const alsoOk = (c.also_ok || []).map((x: string) => String(x).toLowerCase());
  cands.forEach((x, i) => { if (alsoOk.some((a: string) => x.url.toLowerCase().includes(a)) && !matches.includes(i)) matches.push(i); });
  const ok = picked >= 0 && matches.includes(picked);
  const rows = [{ expect: "the official logo (reference picture)", found: picked >= 0 ? `picked #${picked + 1}: ${cands[picked].url}` : "picked none", ok, why: ok ? "" : matches.length ? `the right logo was found (#${matches.map(m => m + 1).join(", #")}) but not picked` : "the right logo was never found" },
    ...cands.map((x, i) => ({ expect: `candidate #${i + 1}`, found: x.url, ok: matches.includes(i), why: matches.includes(i) ? "" : "not this logo" }))];
  return { score: ok ? 1 : 0, max: 1, rows, usage, trace };
}
async function runTest(caseId: string, runId: string) {
  stage = "loading the test";
  const [row] = await db(`agent_test_cases?id=eq.${encodeURIComponent(caseId)}&select=data`);
  if (!row) throw new Error("unknown case");
  const c = row.data;
  const [series] = c.series_id ? await db(`series?id=eq.${c.series_id}&select=*`) : [c.series];
  if (!series) throw new Error("championship not found");
  const [src] = series.id ? await db(`series_sources?series_id=eq.${series.id}&select=*`) : [null];
  let res: any, usage: any, trace: any;
  stage = "running the agent";
  if (c.task === "calendar") {
    const r = await computeCalendar(series, src); usage = r.usage; trace = { ...r.trace, answer: r.out };
    res = scoreCalendar(c, r.found);
  } else if (c.task === "schedule") {
    const [ev] = await db(`events?id=eq.${c.event_id}&select=*,venues(name,city,country,timezone)`);
    if (!ev) throw new Error("race not found");
    const r = await computeSchedule(ev, series, src, []); usage = r.usage; trace = { ...r.trace, answer: r.out };
    res = scoreSchedule(c, r.sessions);
  } else if (c.task === "watch") {
    const r = await ask(SYS(), linksPrompt(series), 5); usage = r.usage; trace = { ...r.trace, answer: r.out };
    res = scoreWatch(c, r.out);
  } else if (c.task === "logo") {
    const r = await runLogoTest(c, series); usage = r.usage; trace = r.trace;
    res = r;
  } else throw new Error("unknown task");
  stage = "saving the result";
  await patch("agent_test_runs", `id=eq.${runId}`, { status: "done", score: Math.round(res.score * 100) / 100, max: res.max, details: { rows: res.rows }, usage, trace, finished_at: new Date().toISOString() });
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

// the classes job started by the database (after new races of a shared calendar are approved): run as the service role
async function startJob(b: any) {
  const r = await fetch(`${SB}/functions/v1/agent`, { method: "POST", headers: { Authorization: `Bearer ${SRK}`, "Content-Type": "application/json" }, body: JSON.stringify({ action: "classes", series_id: b.series_id }) });
  return json(await r.json().catch(() => ({})), r.status);
}

// ---------- entry ----------
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  const cron = req.headers.get("x-cron-secret");
  if (cron) {
    // with the cron secret, the full test run can also be started from the database (no admin sign-in needed)
    const b = await req.json().catch(() => ({}));
    if (b.action !== "test_all" && b.action !== "test_one" && b.action !== "classes") return tick(cron);
    const [row] = await db(`agent_secrets?key=eq.cron&select=value`);
    if (!row || row.value !== cron) return json({ error: "bad secret" }, 403);
    if (!AKEY) return json({ error: "ANTHROPIC_API_KEY is not set" }, 500);
    await loadGuidance();
    if (b.action === "classes") return startJob(b);
    if (b.action === "test_one") {
      // one test per call, so each has the function's full time limit
      const job = runTest(b.case_id, b.run_id).catch(e => patch("agent_test_runs", `id=eq.${b.run_id}`, { status: "error", error: ((stage ? stage + ": " : "") + String((e as Error).message || e)).slice(0, 500), finished_at: new Date().toISOString() }));
      // @ts-ignore EdgeRuntime is provided by Supabase
      if (typeof EdgeRuntime !== "undefined") EdgeRuntime.waitUntil(job); else await job;
      return json({ ok: true });
    }
    await syncCases();
    const cases = await db(`agent_test_cases?select=id&order=sort`);
    for (const c of cases) {
      const [run] = await ins("agent_test_runs", { case_id: c.id, status: "running" });
      await fetch(`${SB}/functions/v1/agent`, { method: "POST", headers: { "x-cron-secret": cron, "Content-Type": "application/json" }, body: JSON.stringify({ action: "test_one", case_id: c.id, run_id: run.id }) });
      await new Promise(r => setTimeout(r, 8000));
    }
    return json({ started: cases.length });
  }
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
      { key: "discover", title: "1 · Calendar agent", when: "When you add a championship or click Check calendar with AI, then once a month (skipped for free when the official pages haven't changed). Dates and circuits for this year and next only.", text: discoverPrompt(S, SRC, new Date().getUTCFullYear()) },
      { key: "logo", title: "2 · Logo agent", when: "When a championship has no logo yet (added, or Find logo with AI). Reads the official homepage (the homepage link in the header first), searches the web, then the AI picks among the pictures.", text: LOGO_PROMPT(S) },
      { key: "race", title: "3 · Schedule agent", when: "Only races a published athlete takes part in. After a calendar is approved: races one by one in date order, until 2 have no timetable. Then nothing until D-30: once a week, twice a week from D-14, every day in race week, until the timetable is complete (every kind of session the championship usually has); a final check at D-3/D-2. Skipped for free while the pages are unchanged. It looks first where the championship's timetable was found last time. If the checker can't confirm anything on the source, it searches once more with the stronger model.", text: checkPrompt(EV, S, SRC, V, false) },
      { key: "deeper", title: "3b · Schedule agent, deeper look", when: "Added when the race is less than 10 days away and the first search found no timetable. Uses the stronger model.", text: DEEP.trim() },
      { key: "links", title: "4 · Where-to-watch agent (championship)", when: "When a championship is added or checked by hand, or a link is missing.", text: linksPrompt(S) },
      { key: "raceweek", title: "4b · Where-to-watch agent (this race)", when: "Race week only: a page made for that race weekend, if there is one.", text: raceWatchPrompt(EV, S) },
      { key: "classes", title: "1b · Classes (shared calendars)", when: "Only for championships whose classes share one calendar without every class racing everywhere (e.g. IMSA). Right after the calendar check (or once the new races are approved), then with each later calendar check.", text: classesPrompt(S, ["<class A>", "<class B>"], "<official calendar>", [{ name: "<race>", start_date: "2027-01-01", end_date: "2027-01-03", venues: { name: "<circuit>" } }]) },
      { key: "checker", title: "5 · Checker", when: "Before anything goes to the Review queue: opens the source page again and checks each date or time, with the exact words. You see the result on each suggestion. If nothing is confirmed, it reads again with the stronger model.", text: CHECK_RULES },
    ] });
  }
  if (body.action === "test_cases") {
    const n = await syncCases();
    return json({ synced: n });
  }
  if (body.action === "test_run") {
    if (!/^[a-z0-9-]{3,80}$/.test(body.case_id || "")) return json({ error: "bad case" }, 400);
    const [run] = await ins("agent_test_runs", { case_id: body.case_id, status: "running" });
    const job = (async () => { try { await runTest(body.case_id, run.id); } catch (e) { await patch("agent_test_runs", `id=eq.${run.id}`, { status: "error", error: ((stage ? stage + ": " : "") + String((e as Error).message || e)).slice(0, 500), finished_at: new Date().toISOString() }); } })();
    // @ts-ignore EdgeRuntime is provided by Supabase
    if (typeof EdgeRuntime !== "undefined") EdgeRuntime.waitUntil(job); else await job;
    return json({ run_id: run.id });
  }
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!UUID.test(body.series_id || body.event_id || "")) return json({ error: "bad id" }, 400);
  let series: any, ev: any = null;
  if (body.action === "logo") {
    // free: logo candidates from the official homepage (+ earlier ones); the admin page picks with AI
    const [s] = await db(`series?id=eq.${body.series_id}&select=id,slug,website_url,logo_candidates`);
    if (!s) return json({ error: "not found" }, 404);
    if (!s.website_url) return json({ candidates: s.logo_candidates || [] });
    const [full] = await db(`series?id=eq.${body.series_id}&select=*`);
    const f = await findLogo(full, null, `${s.slug}-svg`);
    const order = f.picked >= 0 ? [f.cands[f.picked], ...f.cands.filter((_, i) => i !== f.picked)] : f.cands;
    const logos = await storeLogos(s.slug, order.slice(0, 6).map(x => ({ url: x.url })), 6);
    return json({ candidates: logos, picked: f.picked >= 0 && logos.length ? logos[0] : null });
  }
  if (body.action === "discover" || body.action === "links" || body.action === "classes") {
    [series] = await db(`series?id=eq.${body.series_id}&select=*`);
  } else if (body.action === "check_event") {
    [ev] = await db(`events?id=eq.${body.event_id}&select=*,venues(name,city,country,timezone)`);
    if (ev?.series_id) [series] = await db(`series?id=eq.${ev.series_id}&select=*`);
  } else return json({ error: "unknown action" }, 400);
  if (!series) return json({ error: "not found" }, 404);
  const [src] = await db(`series_sources?series_id=eq.${series.id}&select=*`);

  const kind = body.action === "classes" ? "classes" : ["monthly", "weekly", "daily", "final", "initial"].includes(body.kind) ? body.kind : (body.action === "discover" ? "discover" : "manual");
  const [run] = await ins("check_runs", { series_id: series.id, event_id: ev?.id || null, kind, result: "running", pages: [] });
  const job = (async () => {
    try {
      const r = body.action === "discover" ? await discover(series, src, run.id, kind) : body.action === "links" ? await links(series, run.id) : body.action === "classes" ? await classesJob(series, src, run.id, body) : await checkEvent(ev, series, src, run.id, kind);
      await patch("check_runs", `id=eq.${run.id}`, { result: r.result, summary: r.summary, usage: r.usage, pages: r.pages, trace: (r as any).trace || null, finished_at: new Date().toISOString() });
    } catch (e) {
      await patch("check_runs", `id=eq.${run.id}`, { result: "error", error: String((e as Error).message || e).slice(0, 500), finished_at: new Date().toISOString() });
    }
  })();
  // @ts-ignore EdgeRuntime is provided by Supabase
  if (typeof EdgeRuntime !== "undefined") EdgeRuntime.waitUntil(job); else await job;
  return json({ run_id: run.id });
});
