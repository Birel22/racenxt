// Racenxt fan page: loads an athlete's data from the database and maps it to the page's structures.
(function () {
  const C = window.RNX_CONFIG;
  const H = { apikey: C.key, Authorization: "Bearer " + C.key };
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
    const series = [], logo = {}, label = {}, official = {}, watch = {}, carOf = {}, cars = {}, team = {}, color = {}, square = {};
    for (const en of entries) {
      const s = en.series; if (!s) continue;
      if (!series.find(x => x.slug === s.slug)) series.push(s);
      logo[s.slug] = s.logo_url || ""; label[s.slug] = s.short_name; official[s.slug] = s.website_url || "";
      watch[s.slug] = s.watch_url || ""; color[s.slug] = en.color || "#8a8d96"; square[s.slug] = s.slug === "wec";
      team[s.slug] = { num: en.car_number || "", team: en.team || "", mates: en.teammates || [] };
      if (en.vehicles) {
        const v = en.vehicles; carOf[s.slug] = v.id;
        cars[v.id] = { name: v.name, img: v.photo_url || "", specs: (v.specs || []).map(x => [x.label, x.value]) };
      }
    }
    // custom events (no championship)
    if (events.some(e => !e.series_id)) {
      series.push({ slug: "custom", name: "Other events", short_name: "Event" });
      logo.custom = ""; label.custom = "Event"; official.custom = ""; watch.custom = ""; color.custom = "#8a8d96"; team.custom = null;
    }
    const slugOfSeries = Object.fromEntries(entries.filter(e => e.series).map(e => [e.series_id, e.series.slug]));
    const byEvent = {};
    for (const s of sessions) (byEvent[s.event_id] = byEvent[s.event_id] || []).push(s);
    const EVENTS = [], TT = {};
    for (const e of events) {
      if (hidden.has(e.id)) continue;
      const sl = e.series_id ? slugOfSeries[e.series_id] : "custom";
      if (!sl) continue;
      const v = e.venues || {};
      const id = e.ext_key || e.id.slice(0, 8);
      EVENTS.push({
        s: e.start_date, e: e.end_date, series: sl, id, uuid: e.id, name: e.name, dur: e.duration_label || "",
        where: v.name ? (v.city ? `${v.name} · ${v.city}` : v.name) : "", country: v.country || "", flag: flagOf(v.country_code),
        note: notes[e.id] || e.note || undefined, watch: e.watch_url || ""
      });
      const ss = byEvent[e.id];
      if (ss && ss.length) {
        TT[id] = {
          src: official[sl] || "", tz: ss[0].timezone, missing: [],
          title: `${label[sl]} ${e.name}`, loc: [v.name, v.city, v.country].filter(Boolean).join(", "),
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
      profile: prof, first, season, series, events: EVENTS, timetables: TT, logo, label, official, watch, carOf, cars, team, color, square,
      sponsors, pageUrl: location.origin + location.pathname
    };
  }

  window.rnxLoad = async function () {
    const slug = slugFromUrl();
    if (!slug) { message("Race Hub", "Open an athlete's page, for example racenxt.com/louis"); return null; }
    try {
      const [prof] = await get(`profiles?slug=eq.${encodeURIComponent(slug)}&select=*`);
      if (!prof || !prof.published) { message("Page not found", "This Race Hub doesn’t exist or isn’t published yet."); return null; }
      const [entries, overrides, sponsors] = await Promise.all([
        get(`entries?profile_id=eq.${prof.id}&select=*,series(*),vehicles(*)`),
        get(`event_overrides?profile_id=eq.${prof.id}&select=*`),
        get(`sponsors?profile_id=eq.${prof.id}&select=*&order=sort`)
      ]);
      const ors = entries.map(e => `and(series_id.eq.${e.series_id},year.eq.${e.year})`);
      ors.push(`owner_profile_id.eq.${prof.id}`);
      const events = await get(`events?or=(${ors.join(",")})&select=*,venues(*)&order=start_date`);
      const ids = events.map(e => e.id);
      const sessions = ids.length ? await get(`session_times?event_id=in.(${ids.join(",")})&select=*&order=local_start`) : [];
      fetch(C.url + "/rest/v1/rpc/track_view", { method: "POST", headers: { ...H, "Content-Type": "application/json" }, body: JSON.stringify({ p_slug: slug }) }).catch(() => {});
      return build({ prof, entries, overrides, sponsors, events, sessions });
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
  const NAMES = { instagram: "Instagram", facebook: "Facebook", x: "X", youtube: "YouTube", tiktok: "TikTok", website: "Website" };
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  // Fills the parts of the page that come from the profile (photo, logo, socials, sponsors, filter, legend)
  window.rnxDecorate = function (R) {
    const p = R.profile;
    const photo = document.getElementById("rnx-photo");
    if (photo) { if (p.hero_url || p.photo_url) photo.src = p.hero_url || p.photo_url; else photo.style.display = "none"; }
    const lg = document.getElementById("rnx-logo");
    if (lg && p.logo_url) { lg.src = p.logo_url; lg.alt = p.display_name; lg.hidden = false; }
    const soc = Object.keys(ICONS).filter(k => p.socials && p.socials[k]);
    document.querySelectorAll(".rnx-socials").forEach(n => {
      n.innerHTML = soc.map(k => `<a href="${esc(p.socials[k])}" target="_blank" rel="noopener" aria-label="${NAMES[k]}" title="${NAMES[k]}">${ICONS[k]}</a>`).join("");
      if (!soc.length) n.hidden = true;
    });
    const sp = R.sponsors.map(s => {
      const src = s.display === "white" ? (s.logo_white_url || s.logo_original_url) : (s.logo_original_url || s.logo_white_url);
      const img = `<img class="rnx-sp${s.display === "white" && !s.logo_white_url ? " to-white" : ""}" src="${esc(src || "")}" alt="${esc(s.name)}">`;
      return s.link_url ? `<a href="${esc(s.link_url)}" target="_blank" rel="noopener" data-sp="${s.id}">${img}</a>` : `<span class="rnx-sp-wrap">${img}</span>`;
    }).join("");
    document.querySelectorAll(".partners").forEach(n => { n.innerHTML = sp; if (!R.sponsors.length) n.style.display = "none"; });
    document.addEventListener("click", e => {
      const a = e.target.closest("a[data-sp]"); if (!a) return;
      fetch(window.RNX_CONFIG.url + "/rest/v1/rpc/track_sponsor_click", { method: "POST", keepalive: true, headers: { apikey: window.RNX_CONFIG.key, Authorization: "Bearer " + window.RNX_CONFIG.key, "Content-Type": "application/json" }, body: JSON.stringify({ p_sponsor: a.dataset.sp }) }).catch(() => {});
    });
    const menu = document.getElementById("ff-menu");
    if (menu) menu.insertAdjacentHTML("beforeend", R.series.map(s => `<li role="option" tabindex="-1" data-f="${s.slug}" aria-selected="false"><span class="ff-logo">${R.logo[s.slug] ? `<img src="${esc(R.logo[s.slug])}" alt="">` : `<i class="ff-dot" style="background:${R.color[s.slug]}"></i>`}</span><span class="ff-name" data-i18n="n_${s.slug}"></span></li>`).join(""));
    const leg = document.getElementById("rnx-legend");
    if (leg) leg.innerHTML = R.series.map(s => `<span><i style="background:${R.color[s.slug]}"></i>${esc(s.name)}</span>`).join("");
    const extra = document.createElement("style");
    extra.textContent = `.partners img.rnx-sp{display:block;height:30px;width:auto;max-width:130px;object-fit:contain;opacity:.85}.partners a:hover img.rnx-sp{opacity:1}.partners img.to-white{filter:brightness(0) invert(1)}.ff-dot{display:block;width:12px;height:12px;border-radius:50%;margin:auto}.ev-logo-txt{font:700 12px 'Barlow Condensed',sans-serif;letter-spacing:.08em;color:var(--c,#a9abb2)}`;
    document.head.appendChild(extra);
  };
})();
