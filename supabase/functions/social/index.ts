// Racenxt: "is this you?" check for social usernames typed at sign-up.
// GET ?p=x|facebook|tiktok|youtube|instagram&u=<username>
// Returns { found: true|false|null, name, image, url }. found=null means the platform doesn't let us check (Instagram).
// Platforms don't offer public search, so we look up the exact username and show who it is.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info", "Access-Control-Allow-Methods": "GET, OPTIONS" };
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": "private, max-age=600" } });
const URLS: Record<string, (u: string) => string> = {
  x: u => `https://x.com/${u}`,
  facebook: u => `https://www.facebook.com/${u}`,
  tiktok: u => `https://www.tiktok.com/@${u}`,
  youtube: u => `https://www.youtube.com/@${u}`,
  instagram: u => `https://www.instagram.com/${u}/`,
};
const meta = (html: string, prop: string) => {
  const m = html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${prop}["'][^>]*content=["']([^"']*)["']`, "i")) || html.match(new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${prop}["']`, "i"));
  return m ? m[1].replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;|&#x27;/g, "'").trim() : "";
};
function cleanName(p: string, t: string) {
  if (p === "x") return t.replace(/\s*\(@[^)]*\)\s*(on X|\/ X)?\s*$/i, "").trim();
  if (p === "tiktok") return t.replace(/\s*(\(@[^)]*\))?\s*(on|\|)\s*TikTok.*$/i, "").trim();
  if (p === "youtube") return t.replace(/\s*-\s*YouTube\s*$/i, "").trim();
  return t.trim();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const q = new URL(req.url).searchParams;
  const p = (q.get("p") || "").toLowerCase(), u = (q.get("u") || "").trim().replace(/^@/, "");
  if (!URLS[p] || !/^[A-Za-z0-9._-]{1,60}$/.test(u)) return json({ error: "bad request" }, 400);
  const url = URLS[p](u);
  if (p === "instagram") return json({ found: null, url });   // Instagram blocks automatic lookups
  try {
    const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (compatible; facebookexternalhit/1.1; +http://www.facebook.com/externalhit_uatext.php)", "Accept-Language": "en" }, redirect: "follow", signal: AbortSignal.timeout(8000) });
    if (r.status === 404) return json({ found: false, url });
    const html = (await r.text()).slice(0, 600000);
    const title = meta(html, "og:title"), image = meta(html, "og:image");
    const generic = !title || /^(instagram|facebook|tiktok|x|youtube|log in|login)\b/i.test(title) || /not found|page isn.t available|doesn.t exist|discover profiles/i.test(title + " " + (html.match(/<title>([^<]*)<\/title>/i)?.[1] || ""));
    if (generic || !image) return json({ found: false, url });
    return json({ found: true, name: cleanName(p, title) || u, image, url });
  } catch (_) {
    return json({ found: null, url });
  }
});
