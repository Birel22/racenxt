// Place search for custom events, with Google Places (New).
// The key stays here (secret GOOGLE_MAPS_KEY); only signed-in athletes can call this.
// {action:"auto", q, s}      -> suggestions [{id, name, sub}]
// {action:"details", id, s}  -> {name?, city, country, cc, lat, lng, address}
// s = session token: the typing + the final pick count as one Google session (typing is then free).
// Only "Essentials" fields are asked for, the cheapest kind.
const KEY = Deno.env.get("GOOGLE_MAPS_KEY") || "";
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const out = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...CORS, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (!KEY) return out({ error: "no_key" });
  let b: any = {};
  try { b = await req.json(); } catch { return out({ error: "bad_request" }, 400); }
  const s = String(b.s || "").slice(0, 64);
  try {
    if (b.action === "auto") {
      const q = String(b.q || "").trim().slice(0, 120);
      if (q.length < 2) return out({ list: [] });
      const r = await fetch("https://places.googleapis.com/v1/places:autocomplete", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Goog-Api-Key": KEY },
        body: JSON.stringify({ input: q, languageCode: "en", ...(s ? { sessionToken: s } : {}) }),
      });
      const j = await r.json();
      if (!r.ok) return out({ error: j?.error?.status || "google_error", message: j?.error?.message || "" }, 502);
      const list = (j.suggestions || []).map((x: any) => x.placePrediction).filter(Boolean).map((p: any) => ({
        id: p.placeId, name: p.structuredFormat?.mainText?.text || p.text?.text || "", sub: p.structuredFormat?.secondaryText?.text || "",
      }));
      return out({ list });
    }
    if (b.action === "details") {
      const id = String(b.id || "");
      if (!/^[A-Za-z0-9_-]{10,300}$/.test(id)) return out({ error: "bad_id" }, 400);
      const r = await fetch(`https://places.googleapis.com/v1/places/${id}?languageCode=en${s ? `&sessionToken=${encodeURIComponent(s)}` : ""}`, {
        headers: { "X-Goog-Api-Key": KEY, "X-Goog-FieldMask": "addressComponents,location,formattedAddress" },
      });
      const j = await r.json();
      if (!r.ok) return out({ error: j?.error?.status || "google_error", message: j?.error?.message || "" }, 502);
      const comp = (t: string) => (j.addressComponents || []).find((c: any) => (c.types || []).includes(t));
      const city = comp("locality") || comp("postal_town") || comp("administrative_area_level_3") || comp("administrative_area_level_2");
      const country = comp("country");
      return out({
        city: city?.longText || "", country: country?.longText || "", cc: (country?.shortText || "").toUpperCase(),
        lat: j.location?.latitude ?? null, lng: j.location?.longitude ?? null, address: j.formattedAddress || "",
      });
    }
    return out({ error: "bad_action" }, 400);
  } catch (e) {
    return out({ error: "failed", message: String(e) }, 502);
  }
});
