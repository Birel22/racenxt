// Racenxt: draws a discipline icon (Sportscars, Formula, Karting…) from a short description.
// POST { name, prompt } -> { svg, cost_usd }   Admins only. Claude Sonnet 5.5, about $0.01–0.03 per icon.
// The SVG is cleaned to a small set of drawing elements before it is returned.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const SB = Deno.env.get("SUPABASE_URL")!, SRK = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const AKEY = Deno.env.get("ANTHROPIC_API_KEY") || "";
const MODEL = "claude-sonnet-5-5";
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...CORS, "Content-Type": "application/json" } });

const EXAMPLES = `<svg class="sp-ic" viewBox="-0.6 0.1 23.4 6.8" fill="none" stroke="currentColor" stroke-linejoin="round" stroke-linecap="round"><path stroke-width="0.95" d="M0.3 5.1 L0.8 3.7 Q1.3 2.9 2.6 2.6 Q4.2 2.2 5.6 2.4 L6.7 2.5 L8.7 0.95 Q9.1 0.75 9.8 0.75 L11.4 0.75 Q12.6 0.8 13.6 1.5 L15.6 2.3 Q16.6 2.4 17.6 2.4 L21.9 2.8 L21.9 5.1 L20.5 5.1 A2.05 2.05 0 0 0 16.4 5.1 L7.3 5.1 A2.05 2.05 0 0 0 3.2 5.1 Z"/><path stroke-width="0.7" d="M11.6 0.8 L20.4 1.05 M20.2 1.05 L22.3 0.95 M21.9 1 L21.9 2.8"/><circle stroke-width="0.95" cx="5.25" cy="5.15" r="1.4"/><circle stroke-width="0.95" cx="18.45" cy="5.15" r="1.4"/></svg>
<svg class="sp-ic" viewBox="-0.6 0.1 23.6 7.3" fill="none" stroke="currentColor" stroke-linejoin="round" stroke-linecap="round"><path stroke-width="0.95" d="M0.2 5.4 L2.6 5.4 M2.4 4.6 L6.4 4 L8.8 3.5 L10 2.9 L12.6 2.5 Q15.4 2.3 17.2 3.1 L19.8 4 L19.8 5.1"/><path stroke-width="0.95" d="M6.2 5.3 L16.4 5.3"/><path stroke-width="0.8" d="M9.7 3.1 Q10.8 1.7 12.4 2.5"/><path stroke-width="0.8" d="M19.9 1.2 L22.6 1.2 M22.3 1.2 L22.3 4.7 M20.8 1.2 L21.1 4"/><circle stroke-width="0.95" cx="4.4" cy="5" r="1.65"/><circle stroke-width="0.95" cx="18.1" cy="5" r="1.65"/></svg>
<svg class="sp-ic" viewBox="-0.4 -0.2 14 8.2" fill="none" stroke="currentColor" stroke-linejoin="round" stroke-linecap="round"><circle stroke-width="0.85" cx="2.5" cy="5.2" r="2"/><circle stroke-width="0.85" cx="11" cy="5.2" r="2"/><path stroke-width="0.85" d="M2.5 5.2 L4.3 1.4 M3.6 1.4 L5.2 1.4"/><path stroke-width="0.85" d="M4.6 2.3 Q6 1.4 7.6 1.8 L9.2 2.1 L11.6 1.3 M4.9 3.6 L8.6 3.3 L11 5.2 M6 5.2 L8.6 3.3"/></svg>`;

const SYSTEM = `You draw small line icons for Racenxt, a motorsport calendar app. Every icon must match the style of these existing icons exactly:
${EXAMPLES}
Style rules:
- A side-view (profile) silhouette of the vehicle or object, facing right, drawn with thin strokes only: fill="none" stroke="currentColor" stroke-linejoin="round" stroke-linecap="round" on the <svg>, stroke-width between 0.7 and 1 in the same units.
- A tight viewBox around the drawing (roughly 3:1 wide for vehicles), no width/height attributes, class="sp-ic".
- Simple and recognisable at 44 × 26 pixels: few strokes, no shading, no text, no background.
- Only these elements: svg, g, path, circle, ellipse, line, polyline, polygon, rect.
Answer with the SVG only, nothing else.`;

const TAGS = new Set(["svg", "g", "path", "circle", "ellipse", "line", "polyline", "polygon", "rect"]);
const ATTRS = new Set(["viewbox", "d", "cx", "cy", "r", "rx", "ry", "x", "y", "width", "height", "x1", "y1", "x2", "y2", "points", "fill", "stroke", "stroke-width", "stroke-linecap", "stroke-linejoin", "transform", "fill-rule", "opacity", "class", "xmlns"]);
function clean(svg: string) {
  const m = svg.match(/<svg[\s\S]*<\/svg>/i); if (!m) return "";
  let out = "", depth = 0;
  for (const t of m[0].matchAll(/<(\/?)([a-zA-Z]+)([^>]*?)(\/?)>/g)) {
    const [, close, tagRaw, attrs, self] = t; const tag = tagRaw.toLowerCase();
    if (!TAGS.has(tag)) continue;
    if (close) { out += `</${tag}>`; depth--; continue; }
    const kept: string[] = [];
    for (const a of attrs.matchAll(/([a-zA-Z:-]+)\s*=\s*"([^"]*)"/g)) {
      const k = a[1].toLowerCase(), v = a[2];
      if (!ATTRS.has(k) || /url\(|javascript:|expression|[<>&]/i.test(v)) continue;
      if ((k === "fill" || k === "stroke") && !/^(none|currentColor)$/i.test(v)) { kept.push(`${a[1]}="${k === "fill" ? "none" : "currentColor"}"`); continue; }
      if (k === "class") { if (tag === "svg") kept.push(`class="sp-ic"`); continue; }
      if (tag === "svg" && (k === "width" || k === "height")) continue;
      kept.push(`${k === "viewbox" ? "viewBox" : a[1]}="${v}"`);
    }
    if (tag === "svg") { if (!kept.some(k => k.startsWith("class"))) kept.push(`class="sp-ic"`); if (!kept.some(k => k.startsWith("xmlns"))) kept.push(`xmlns="http://www.w3.org/2000/svg"`); }
    out += `<${tag}${kept.length ? " " + kept.join(" ") : ""}${self ? "/" : ""}>`;
    if (!self) depth++;
  }
  return out.length < 20000 && /^<svg[\s\S]*<\/svg>$/.test(out) ? out : "";
}

async function isAdmin(token: string) {
  const r = await fetch(`${SB}/rest/v1/rpc/am_i_admin`, { method: "POST", headers: { apikey: Deno.env.get("SUPABASE_ANON_KEY")!, Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: "{}" });
  return r.ok && (await r.json()) === true;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token || !(await isAdmin(token))) return json({ error: "admins only" }, 403);
  if (!AKEY) return json({ error: "ANTHROPIC_API_KEY is not set" }, 500);
  let body: any = {};
  try { body = await req.json(); } catch { return json({ error: "bad request" }, 400); }
  const name = String(body.name || "").trim().slice(0, 60), prompt = String(body.prompt || "").trim().slice(0, 500);
  if (!name && !prompt) return json({ error: "Say what the icon should show" }, 400);
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": AKEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model: MODEL, max_tokens: 4000, system: SYSTEM, messages: [{ role: "user", content: `Discipline: ${name || "(no name yet)"}\nWhat the icon should show: ${prompt || name}` }] }),
  });
  const j = await r.json();
  if (!r.ok) return json({ error: j?.error?.message || `AI ${r.status}` }, 502);
  const text = (j.content || []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("");
  const inp = j.usage?.input_tokens || 0, out = j.usage?.output_tokens || 0;
  const cost = Math.round((inp * 2 / 1e6 + out * 10 / 1e6) * 10000) / 10000;
  const svg = clean(text);
  // logged with the other AI costs
  await fetch(`${SB}/rest/v1/check_runs`, { method: "POST", headers: { apikey: SRK, Authorization: `Bearer ${SRK}`, "Content-Type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify({ kind: "icon", result: svg ? "proposal" : "error", summary: `Icon: ${name || prompt}`.slice(0, 200), usage: { input: inp, output: out, searches: 0, fetches: 0, cost_usd: cost, model: MODEL }, pages: [], finished_at: new Date().toISOString() }) }).catch(() => {});
  if (!svg) return json({ error: "The drawing couldn't be used. Try again." }, 502);
  return json({ svg, cost_usd: cost });
});
