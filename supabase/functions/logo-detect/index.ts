// Racenxt: finds the logo in a picture (screenshot, photo, flyer) so the app can cut it out.
// POST { image: <base64 JPEG, max ~1024 px> }  ->  { found, box: [left, top, right, bottom] as fractions of the image }
// POST { images: [<base64 JPEG>, …up to 8], name, short }  ->  { index (0-based, -1 = none), box, badge }
//   picks the championship's own logo among candidates found on its website
// Signed-in users only. Uses Claude Haiku 5.5 vision (a fraction of a cent per logo).
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const AKEY = Deno.env.get("ANTHROPIC_API_KEY") || "";
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...CORS, "Content-Type": "application/json" } });
const PROMPT = `This picture contains a company or brand logo (it may be a screenshot with other things around it).
Find the main logo and give a tight bounding box around the whole logo: the symbol and its wordmark/name if they belong together, nothing else (no app interface, no other text, no photos).
Answer with JSON only: {"found": true, "box": [left, top, right, bottom], "badge": true|false} using fractions of the image width and height between 0 and 1. "badge" is true if the logo is text or symbols cut out of / printed on a solid filled shape (a plate, box, circle or shield that is part of the logo). If there is no logo, answer {"found": false}.`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  if (!AKEY) return json({ found: false, error: "not configured" });
  let body: any = {};
  try { body = await req.json(); } catch { return json({ error: "bad request" }, 400); }
  if (Array.isArray(body.images)) return pick(body);
  const img = String(body.image || "");
  if (!img || img.length > 2_500_000 || !/^[A-Za-z0-9+/=]+$/.test(img)) return json({ error: "bad image" }, 400);
  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": AKEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: "claude-haiku-5-5", max_tokens: 200, messages: [{ role: "user", content: [
        { type: "image", source: { type: "base64", media_type: "image/jpeg", data: img } },
        { type: "text", text: PROMPT }] }] }),
    });
    const j = await r.json();
    if (!r.ok) return json({ found: false, error: j?.error?.message || r.status });
    const text = (j.content || []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("");
    const out = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
    const box = Array.isArray(out.box) ? out.box.map((n: any) => Math.max(0, Math.min(1, Number(n)))) : null;
    return json({ found: !!out.found && !!box && box[2] > box[0] && box[3] > box[1], box, badge: !!out.badge });
  } catch (e) {
    return json({ found: false, error: String((e as Error).message || e) });
  }
});

const okImg = (s: string) => !!s && s.length < 1_500_000 && /^[A-Za-z0-9+/=]+$/.test(s);
async function pick(body: any) {
  const imgs = (body.images as any[]).map(String).filter(okImg).slice(0, 8);
  if (!imgs.length) return json({ error: "bad images" }, 400);
  const name = String(body.name || "").slice(0, 120), short = String(body.short || "").slice(0, 60);
  const content: any[] = [];
  imgs.forEach((d, i) => { content.push({ type: "text", text: `Image ${i + 1}:` }); content.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: d } }); });
  content.push({ type: "text", text: `These images were found on the official website of the motorsport championship "${name}"${short && short !== name ? ` (${short})` : ""}. They are shown on a grey background.
Which image is THIS championship's own official logo? Not the organiser's or promoter's logo, not a sponsor, partner, team, manufacturer, tyre supplier, broadcaster or social-media icon, not a different championship of the same organiser, not a photo. A federation mark (e.g. FIA) only counts if it is part of the championship's logo.
Prefer the most complete version (symbol + name together) and a clean one.
Answer with JSON only: {"index": <image number, or 0 if none of them is the championship's logo>, "box": [left, top, right, bottom], "badge": true|false}
- box: tight bounding box around the logo inside that image, as fractions (0 to 1) of its width and height.
- badge: true if the logo is text or symbols cut out of / printed on a solid filled shape (a plate, box, circle or shield that is part of the logo), false otherwise.` });
  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": AKEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: "claude-haiku-5-5", max_tokens: 200, messages: [{ role: "user", content }] }),
    });
    const j = await r.json();
    if (!r.ok) return json({ index: -1, error: j?.error?.message || r.status });
    const text = (j.content || []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("");
    const out = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
    const idx = Math.round(Number(out.index)) - 1;
    const box = Array.isArray(out.box) ? out.box.map((n: any) => Math.max(0, Math.min(1, Number(n)))) : null;
    return json({ index: idx >= 0 && idx < imgs.length ? idx : -1, box: box && box[2] > box[0] && box[3] > box[1] ? box : null, badge: !!out.badge });
  } catch (e) {
    return json({ index: -1, error: String((e as Error).message || e) });
  }
}
