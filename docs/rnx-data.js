// Racenxt fan page: loads an athlete's data from the database and maps it to the page's structures.
(function () {
  const C = window.RNX_CONFIG;
  // The page owner (signed in on the Racenxt app in this browser) can preview an unpublished page
  const sess = (() => { for (const k of ["rnx_sess", "rnx_user_sess", "rnx_admin_sess"]) { try { const s = JSON.parse(localStorage.getItem(k) || "null"); if (s && s.access_token && s.expires_at > Date.now() / 1000 + 30) return s; } catch (e) {} } return null; })();
  const H = { apikey: C.key, Authorization: "Bearer " + (sess ? sess.access_token : C.key) };
  // Car specs: the fixed list from the admin library (old free-form lists still work)
  const DRIVE = { awd: "All-wheel drive (AWD)", rwd: "Rear-wheel drive (RWD)", fwd: "Front-wheel drive (FWD)" };
  const carSpecs = v => {
    const list = [["Engine", v.engine], ["Hybrid system", v.hybrid], ["Power", v.power], ["Drivetrain", DRIVE[v.drivetrain] || ""], ["Max rpm", v.max_rpm], ["Gearbox", v.gearbox], ["Weight", v.weight], ["Dimensions", v.dimensions]].filter(x => x[1]);
    return list.length ? list : (v.specs || []).map(x => [x.label, x.value]);
  };
  const get = p => fetch(C.url + "/rest/v1/" + p, { headers: H }).then(r => { if (!r.ok) throw new Error(r.status + " " + p); return r.json(); });

  // Page address: racenxt.com/<slug> (served by 404.html on static hosting) or ?a=<slug>
  function slugFromUrl() {
    const q = new URLSearchParams(location.search).get("a");
    if (q) return q.toLowerCase();
    const parts = location.pathname.split("/").filter(Boolean).filter(p => !/\.html?$/.test(p));
    const base = (window.RNX_BASE || "").split("/").filter(Boolean);
    const rest = parts.slice(base.length);
    return rest.length ? decodeURIComponent(rest[0]).toLowerCase() : null;
  }

  const flagOf = cc => cc && /^[A-Za-z]{2}$/.test(cc) ? String.fromCodePoint(...[...cc.toUpperCase()].map(c => 127397 + c.charCodeAt(0))) : "";

  function message(title, text) {
    document.body.innerHTML = `<div style="min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px;background:#0f1013;color:#f4f4f2;font-family:Barlow,system-ui,sans-serif;text-align:center"><div><div style="font:800 italic 34px 'Barlow Condensed',sans-serif;letter-spacing:-.5px">RACEN<span style="background:linear-gradient(90deg,#FF5A1F 50%,#F4F4F2 50%);-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent">X</span>T</div><h1 style="font:700 24px 'Barlow Condensed',sans-serif;margin:22px 0 8px;text-transform:uppercase;letter-spacing:.04em">${title}</h1><p style="margin:0;color:#a9abb2">${text}</p></div></div>`;
  }

  function build(raw) {
    const { prof, entries, overrides, sponsors, events, sessions } = raw;
    const hidden = new Set(overrides.filter(o => o.hidden).map(o => o.event_id));
    const notes = Object.fromEntries(overrides.filter(o => o.note).map(o => [o.event_id, o.note]));
    const series = [], logo = {}, label = {}, official = {}, watch = {}, tv = {}, carOf = {}, cars = {}, team = {}, color = {}, square = {};
    for (const en of entries) {
      const s = en.series; if (!s) continue;
      if (!series.find(x => x.slug === s.slug)) series.push(s);
      logo[s.slug] = s.logo_url || ""; label[s.slug] = s.short_name; official[s.slug] = s.website_url || "";
      /* where to watch: the championship's stream + list of broadcasters; a race can have its own page (ev.watch) */ watch[s.slug] = s.stream_url || ""; tv[s.slug] = s.broadcasters_url || ""; color[s.slug] = en.color || "#8a8d96"; square[s.slug] = s.slug === "wec";
      team[s.slug] = { num: en.car_number || "", team: en.team || "", mates: en.teammates || [] };
      if (en.vehicles) {
        // specs from the library, photo = the user's own livery
        carOf[s.slug] = en.id;
        cars[en.id] = { name: en.vehicles.name, img: en.car_photo_url || "", specs: carSpecs(en.vehicles) };
      }
    }
    // the athlete's own events (no championship), grouped by kind
    const KINDS = { test: ["Testing", "Test", "#9AA3AF"], appearance: ["Appearances", "Appearance", "#C9A86A"], simulator: ["Simulator", "Sim", "#7FA7D9"], media: ["Media", "Media", "#B892D6"], other: ["Other events", "Event", "#8a8d96"] };
    for (const k of Object.keys(KINDS)) {
      if (!events.some(e => !e.series_id && (e.kind || "other") === k)) continue;
      const sl = "x-" + k, [nm, lb, cl] = KINDS[k];
      series.push({ slug: sl, name: nm, short_name: lb });
      logo[sl] = ""; label[sl] = lb; official[sl] = ""; watch[sl] = ""; tv[sl] = ""; color[sl] = cl; team[sl] = null;
    }
    const slugOfSeries = Object.fromEntries(entries.filter(e => e.series).map(e => [e.series_id, e.series.slug]));
    const byEvent = {};
    for (const s of sessions) (byEvent[s.event_id] = byEvent[s.event_id] || []).push(s);
    const EVENTS = [], TT = {};
    for (const e of events) {
      if (hidden.has(e.id)) continue;
      const sl = e.series_id ? slugOfSeries[e.series_id] : "x-" + (e.kind || "other");
      if (!sl) continue;
      const v = e.venues || {};
      const id = e.ext_key || e.id.slice(0, 8);
      // a custom event can have its own car
      let carKey = "";
      if (!e.series_id && e.vehicles) { carKey = "e-" + e.id.slice(0, 8); carOf[carKey] = carKey; label[carKey] = e.name; cars[carKey] = { name: e.vehicles.name, img: e.car_photo_url || "", specs: carSpecs(e.vehicles) }; }
      EVENTS.push({
        s: e.start_date, e: e.end_date, series: sl, id, uuid: e.id, name: e.name, dur: e.duration_label || "",
        where: v.name ? (v.city ? `${v.name} · ${v.city}` : v.name) : "", country: v.country || "", flag: flagOf(v.country_code),
        note: notes[e.id] || e.note || undefined, watch: e.watch_url || "", carKey, links: (e.links || []).filter(l => l && /^https?:\/\//.test(l.url || ""))
      });
      const ss = byEvent[e.id];
      if (ss && ss.length) {
        TT[id] = {
          src: official[sl] || "", tz: ss[0].timezone, missing: [],
          title: sl.startsWith("x-") ? e.name : `${label[sl]} ${e.name}`, loc: [v.name, v.city, v.country].filter(Boolean).join(", "),
          sessions: ss.map(x => ({ id: x.id, date: x.local_start.slice(0, 10), time: x.local_start.slice(11, 16), label: x.label, min: x.duration_min, utc: new Date(x.start_utc).toISOString() }))
        };
      }
    }
    const first = prof.first_name || prof.display_name.split(" ")[0];
    const season = Math.max(...entries.map(e => e.year), ...events.map(e => e.year), new Date().getFullYear());
    // championship colours chosen by the athlete
    const css = Object.entries(color).map(([k, c]) => `.ev.${k},.tt-head.${k},.countdown.${k}{--c:${c}}`).join("\n");
    const st = document.createElement("style"); st.textContent = css; document.head.appendChild(st);
    return {
      profile: prof, first, season, series, events: EVENTS, timetables: TT, logo, label, official, watch, tv, carOf, cars, team, color, square,
      sponsors, pageUrl: location.origin + (window.RNX_BASE || "/") + encodeURIComponent(prof.slug) + "/", /* the public address, with its link preview */ entries,
      customEvents: events.filter(e => !e.series_id)
    };
  }

  window.rnxLoad = async function () {
    const slug = slugFromUrl();
    if (!slug) { message("Race Hub", "Open an athlete's page, for example racenxt.com/louis"); return null; }
    try {
      const [prof] = await get(`profiles?slug=eq.${encodeURIComponent(slug)}&select=*`);
      if (!prof) { message("Page not found", "This Race Hub doesn’t exist."); return null; }
      if (!prof.published) {
        // only members get here (RLS): show a small preview banner
        const b = document.createElement("div"); b.id = "rnx-preview";
        b.textContent = "Hidden by Racenxt · only you and your team can see this page";
        b.style.cssText = "position:fixed;left:50%;top:10px;transform:translateX(-50%);z-index:9999;background:#FF5A1F;color:#fff;font:600 13px Barlow,system-ui,sans-serif;padding:7px 14px;border-radius:999px;box-shadow:0 6px 20px rgba(0,0,0,.4);white-space:nowrap";
        document.addEventListener("DOMContentLoaded", () => document.body.appendChild(b)); if (document.body) document.body.appendChild(b);
      }
      const [entries, overrides, sponsors] = await Promise.all([
        get(`entries?profile_id=eq.${prof.id}&select=*,series(*),vehicles(*)`),
        get(`event_overrides?profile_id=eq.${prof.id}&select=*`),
        get(`sponsors?profile_id=eq.${prof.id}&select=*&order=sort`)
      ]);
      const ors = entries.map(e => `and(series_id.eq.${e.series_id},year.eq.${e.year})`);
      ors.push(`owner_profile_id.eq.${prof.id}`);
      const events = await get(`events?or=(${ors.join(",")})&select=*,venues(*),vehicles(*)&order=start_date`);
      const ids = events.map(e => e.id);
      const sessions = ids.length ? await get(`session_times?event_id=in.(${ids.join(",")})&select=*&order=local_start`) : [];
      fetch(C.url + "/rest/v1/rpc/track_view", { method: "POST", headers: { ...H, "Content-Type": "application/json" }, body: JSON.stringify({ p_slug: slug }) }).catch(() => {});
      const R = build({ prof, entries, overrides, sponsors, events, sessions });
      if (sess && window.rnxEditInit) window.rnxEditInit(R);   // owner signed in: edit controls on top of the page
      return R;
    } catch (err) {
      console.error(err);
      message("Can’t load this page", "Please check your connection and try again.");
      return null;
    }
  };

  // Calendar files come from the "ics" function so iPhones open them directly
  const fn = C.url + "/functions/v1/ics";
  window.rnxIcsUrl = (slug, eventId, sessionIds) => `${fn}?p=${encodeURIComponent(slug)}&s=${sessionIds.join(",")}`;
  window.rnxSubUrl = (slug, kind) => fn.replace(/^https:/, "webcal:") + `?p=${encodeURIComponent(slug)}&k=${kind}`;

  const ICONS = {
    instagram: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="5" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="4" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="17.3" cy="6.7" r="1.2" fill="currentColor"/></svg>',
    facebook: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M13.5 22v-8h2.7l.4-3.2h-3.1V8.8c0-.9.3-1.6 1.6-1.6h1.7V4.4c-.3 0-1.3-.1-2.5-.1-2.5 0-4.1 1.5-4.1 4.2v2.3H7.4V14h2.8v8z"/></svg>',
    x: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M17.8 3h3.1l-6.8 7.8L22 21h-6.2l-4.9-6.4L5.3 21H2.2l7.3-8.3L2 3h6.4l4.4 5.8zm-1.1 16.2h1.7L7.4 4.7H5.6z"/></svg>',
    youtube: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M21.6 7.2a2.6 2.6 0 0 0-1.8-1.8C18.2 5 12 5 12 5s-6.2 0-7.8.4A2.6 2.6 0 0 0 2.4 7.2C2 8.8 2 12 2 12s0 3.2.4 4.8a2.6 2.6 0 0 0 1.8 1.8c1.6.4 7.8.4 7.8.4s6.2 0 7.8-.4a2.6 2.6 0 0 0 1.8-1.8c.4-1.6.4-4.8.4-4.8s0-3.2-.4-4.8zM10 15V9l5.2 3z"/></svg>',
    tiktok: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M16.6 3c.4 2.2 1.7 3.6 3.9 3.8v3.1c-1.4.1-2.7-.3-3.9-1v6.4c0 3.6-2.6 5.7-5.6 5.7A5.5 5.5 0 0 1 5.5 15.5c0-3.4 3-5.9 6.3-5.4v3.2c-1.5-.4-3.1.6-3.1 2.2 0 1.3 1 2.3 2.3 2.3 1.4 0 2.4-.9 2.4-2.7V3z"/></svg>',
    website: '<svg viewBox="0 0 24 24" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z"/></g></svg>'
  };
  ICONS.email = '<svg viewBox="0 0 24 24" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="M3.5 6.5l8.5 6.5 8.5-6.5"/></g></svg>';
  const NAMES = { instagram: "Instagram", facebook: "Facebook", x: "X", youtube: "YouTube", tiktok: "TikTok", website: "Website", email: "Email" };
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  // Fills the parts of the page that come from the profile (photo, logo, socials, sponsors, filter, legend)
  window.rnxDecorate = function (R) {
    const p = R.profile;
    const photo = document.getElementById("rnx-photo");
    if (photo) {
      if (p.hero_url || p.photo_url) {
        photo.src = p.hero_url || p.photo_url;
        // framing chosen by the athlete (focal point + zoom)
        const fp = p.photo_pos;
        if (fp && isFinite(fp.x) && isFinite(fp.y)) { photo.style.objectPosition = `${fp.x}% ${fp.y}%`; if (fp.z > 1) { photo.style.transform = `scale(${fp.z})`; photo.style.transformOrigin = `${fp.x}% ${fp.y}%`; } }
      } else photo.style.display = "none";
    }
    const lg = document.getElementById("rnx-logo");
    if (lg && p.logo_url) { lg.src = p.logo_url; lg.alt = p.display_name; lg.hidden = false; }
    const href = k => k === "email" ? (p.contact_email ? "mailto:" + p.contact_email : "") : (p.socials && p.socials[k]) || "";
    const soc = Object.keys(ICONS).filter(k => href(k));
    document.querySelectorAll(".rnx-socials").forEach(n => {
      n.innerHTML = soc.map(k => `<a href="${esc(href(k))}"${k === "email" ? "" : ' target="_blank" rel="noopener"'} aria-label="${NAMES[k]}" title="${NAMES[k]}">${ICONS[k]}</a>`).join("");
      if (!soc.length) n.hidden = true;
    });
    // partners: the first 6 under the header, all of them at the bottom of the page.
    // Every logo gets the same visual weight: wide logos are lower, square ones taller (equal area), all centred in equal slots.
    const spSrc = s => s.logo_url || (s.display === "white" ? (s.logo_white_url || s.logo_original_url) : (s.logo_original_url || s.logo_white_url)) || "";
    const slot = s => {
      const img = `<img class="rnx-sp${!s.logo_url && s.display === "white" && !s.logo_white_url ? " to-white" : ""}" src="${esc(spSrc(s))}" alt="${esc(s.name)}" loading="lazy">`;
      return s.link_url ? `<a class="pt-slot" href="${esc(s.link_url)}" target="_blank" rel="noopener" data-sp="${s.id}">${img}</a>` : `<div class="pt-slot">${img}</div>`;
    };
    const ps = R.sponsors.filter(s => spSrc(s));
    document.querySelectorAll(".partners").forEach(n => {
      const list = n.classList.contains("partners-foot") ? ps : ps.slice(0, 6);
      if (!list.length) { n.style.display = "none"; return; }
      n.classList.add("pt"); n.style.setProperty("--n", list.length);
      n.innerHTML = `<div class="pt-grid">${list.map(slot).join("")}</div>`;
    });
    // trim any empty edges left in the picture (keeps every logo truly centred) and measure its shape
    document.querySelectorAll(".partners.pt img.rnx-sp").forEach(img => {
      const fit = r => img.style.setProperty("--sr", Math.sqrt(Math.max(.2, Math.min(12, r))).toFixed(3));
      // measured on a separate copy, so the logo on the page is never put at risk
      const probe = new Image(); probe.crossOrigin = "anonymous";
      probe.onload = () => {
        try {
          const w = probe.naturalWidth, h = probe.naturalHeight; if (!w || !h) return;
          const c = document.createElement("canvas"), k = Math.min(1, 600 / Math.max(w, h)); c.width = Math.round(w * k); c.height = Math.round(h * k);
          const x = c.getContext("2d", { willReadFrequently: true }); x.drawImage(probe, 0, 0, c.width, c.height);
          const d = x.getImageData(0, 0, c.width, c.height).data; let x0 = c.width, y0 = c.height, x1 = -1, y1 = -1;
          for (let i = 3; i < d.length; i += 4) if (d[i] > 60) { const n = i >> 2, px = n % c.width, py = (n / c.width) | 0; if (px < x0) x0 = px; if (px > x1) x1 = px; if (py < y0) y0 = py; if (py > y1) y1 = py; }
          if (x1 < x0) return fit(w / h);
          const tw = x1 - x0 + 1, th = y1 - y0 + 1;
          if (tw < c.width - 2 || th < c.height - 2) { const t = document.createElement("canvas"); t.width = tw; t.height = th; t.getContext("2d").drawImage(c, x0, y0, tw, th, 0, 0, tw, th); img.src = t.toDataURL("image/png"); }
          fit(tw / th);
        } catch (e) { fit(w0()); }
      };
      const w0 = () => (img.naturalWidth && img.naturalHeight) ? img.naturalWidth / img.naturalHeight : 3;
      probe.onerror = () => { if (img.complete) fit(w0()); else img.addEventListener("load", () => fit(w0()), { once: true }); };
      probe.src = img.getAttribute("src");
    });
    document.addEventListener("click", e => {
      const a = e.target.closest("a[data-sp]"); if (!a) return;
      fetch(window.RNX_CONFIG.url + "/rest/v1/rpc/track_sponsor_click", { method: "POST", keepalive: true, headers: { apikey: window.RNX_CONFIG.key, Authorization: "Bearer " + window.RNX_CONFIG.key, "Content-Type": "application/json" }, body: JSON.stringify({ p_sponsor: a.dataset.sp }) }).catch(() => {});
    });
    const menu = document.getElementById("ff-menu");
    if (menu) menu.insertAdjacentHTML("beforeend", R.series.map(s => `<li role="option" tabindex="-1" data-f="${s.slug}" aria-selected="false"><span class="ff-logo">${R.logo[s.slug] ? `<img src="${esc(R.logo[s.slug])}" alt="">` : `<i class="ff-dot" style="background:${R.color[s.slug]}"></i>`}</span><span class="ff-name" data-i18n="n_${s.slug}"></span></li>`).join(""));
    const leg = document.getElementById("rnx-legend");
    if (leg) leg.innerHTML = R.series.map(s => `<span><i style="background:${R.color[s.slug]}"></i>${esc(s.name)}</span>`).join("");
    const extra = document.createElement("style");
    extra.textContent = `.partners.pt{display:block;padding:14px 12px}.partners.pt .pt-grid{display:flex;flex-wrap:wrap;justify-content:center;align-items:center;row-gap:6px}.partners.pt .pt-slot{flex:0 0 calc(100% / min(var(--n),3));display:flex;align-items:center;justify-content:center;height:52px;min-width:0;padding:4px 8px;border-radius:8px;box-sizing:border-box}.partners.pt .pt-slot img.rnx-sp{display:block;width:auto;height:clamp(16px,calc(38px / var(--sr,2)),40px);max-width:100%;object-fit:contain;opacity:.88;transition:opacity .15s}.partners.pt a.pt-slot:hover img.rnx-sp{opacity:1}.partners.pt a.pt-slot:focus-visible{outline:2px solid var(--lm,#FF5A1F);outline-offset:1px}@media (min-width:700px){.partners.pt .pt-slot{flex-basis:calc(100% / min(var(--n),6));height:60px;padding:4px 14px}.partners.pt .pt-slot img.rnx-sp{height:clamp(16px,calc(40px / var(--sr,2)),46px)}}.partners img.to-white{filter:brightness(0) invert(1)}.ff-dot{display:block;width:12px;height:12px;border-radius:50%;margin:auto}.ev-logo-txt{font:700 12px 'Barlow Condensed',sans-serif;letter-spacing:.08em;color:var(--c,#a9abb2)}`;
    document.head.appendChild(extra);
  };
})();
