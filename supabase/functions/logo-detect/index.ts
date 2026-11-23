// Racenxt: finds the logo in a picture (screenshot, photo, flyer) so the app can cut it out.
// POST { image: <base64 JPEG, max ~1024 px> }  ->  { found, box: [left, top, right, bottom] as fractions of the image }
// Signed-in users only. Uses Claude Haiku 5.5 vision (a fraction of a cent per logo).
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const AKEY = Deno.env.get("ANTHROPIC_API_KEY") || "";
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...CORS, "Content-Type": "application/json" } });
const PROMPT = `This picture contains a company or brand logo (it may be a screenshot with other things around it).
Find the main logo and give a tight bounding box around the whole logo: the symbol and its wordmark/name if they belong together, nothing else (no app interface, no other text, no photos).
Answer with JSON only: {"found": true, "box": [left, top, right, bottom]} using fractions of the image width and height between 0 and 1. If there is no logo, answer {"found": false}.`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  if (!AKEY) return json({ found: false, error: "not configured" });
  let body: any = {};
  try { body = await req.json(); } catch { return json({ error: "bad request" }, 400); }
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
    return json({ found: !!out.found && !!box && box[2] > box[0] && box[3] > box[1], box });
  } catch (e) {
    return json({ found: false, error: String((e as Error).message || e) });
  }
});
