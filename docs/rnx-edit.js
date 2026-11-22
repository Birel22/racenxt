// Racenxt: edit mode on the Race Hub page itself. Fans see the exact same page; the owner (signed in) gets
// small edit controls on top of it. Every change is saved to the database and the page reloads with it.
(function () {
  const C = window.RNX_CONFIG;
  const KEY = "rnx_user_sess";
  const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
  const YEAR = new Date().getFullYear(), TODAY = new Date().toISOString().slice(0, 10);
  const COLORS = ["#FF5A1F", "#E8352F", "#F2B20F", "#5FCF6E", "#1FB5A8", "#2F80ED", "#7B61FF", "#D946EF", "#F4F4F2", "#8A8D96"];
  const VFIELDS = [["engine", "Engine"], ["hybrid", "Hybrid system"], ["power", "Power"], ["max_rpm", "Max rpm"], ["gearbox", "Gearbox"], ["weight", "Weight"], ["dimensions", "Dimensions"]];
  const DRIVE = { awd: "AWD", rwd: "RWD", fwd: "FWD" };
  const PEN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M14 6l4 4"/></svg>';
  const CAM = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg>';

  // ---------- session ----------
  const S = {
    get() { try { return JSON.parse(localStorage.getItem(KEY) || localStorage.getItem("rnx_admin_sess") || "null"); } catch (e) { return null; } },
    set(v) { try { v ? localStorage.setItem(KEY, JSON.stringify(v)) : (localStorage.removeItem(KEY), localStorage.removeItem("rnx_admin_sess")); } catch (e) {} }
  };
  async function token() {
    let s = S.get(); if (!s) return null;
    if (s.expires_at - 60 < Date.now() / 1000) {
      const r = await fetch(`${C.url}/auth/v1/token?grant_type=refresh_token`, { method: "POST", headers: { apikey: C.key, "Content-Type": "application/json" }, body: JSON.stringify({ refresh_token: s.refresh_token }) });
      if (!r.ok) { S.set(null); return null; }
      const j = await r.json(); s = { access_token: j.access_token, refresh_token: j.refresh_token, expires_at: Date.now() / 1000 + j.expires_in }; S.set(s);
    }
    return s.access_token;
  }
  async function api(path, opt = {}) {
    const t = await token();
    const r = await fetch(`${C.url}/rest/v1/${path}`, { ...opt, headers: { apikey: C.key, Authorization: `Bearer ${t || C.key}`, "Content-Type": "application/json", Prefer: "return=representation", ...(opt.headers || {}) } });
    if (!r.ok) { let m = r.status + ""; try { const j = await r.json(); m = j.message || j.hint || m; } catch (e) {} throw new Error(m); }
    const txt = await r.text(); return txt ? JSON.parse(txt) : null;
  }
  const ins = (t, row) => api(t, { method: "POST", body: JSON.stringify(row) });
  const upd = (t, id, row) => api(`${t}?id=eq.${id}`, { method: "PATCH", body: JSON.stringify(row) });
  async function upload(blob, path) {
    const t = await token();
    const r = await fetch(`${C.url}/storage/v1/object/media/${path}`, { method: "POST", headers: { apikey: C.key, Authorization: `Bearer ${t}`, "Content-Type": blob.type || "image/jpeg" }, body: blob });
    if (!r.ok) { let m = ""; try { m = (await r.json()).message || ""; } catch (e) {} throw new Error(`upload failed (${r.status}${m ? ": " + m : ""})`); }
    return `${C.url}/storage/v1/object/public/media/${path}`;
  }
  // resize a picture (square for the profile photo, keep the shape for car photos)
  async function picture(file, square, max) {
    const img = await new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = URL.createObjectURL(file); });
    let sx = 0, sy = 0, sw = img.naturalWidth, sh = img.naturalHeight;
    if (square) { const s = Math.min(sw, sh); sx = (sw - s) / 2; sy = (sh - s) / 2; sw = sh = s; }
    const k = Math.min(1, max / Math.max(sw, sh)), cv = document.createElement("canvas");
    cv.width = Math.round(sw * k); cv.height = Math.round(sh * k);
    cv.getContext("2d").drawImage(img, sx, sy, sw, sh, 0, 0, cv.width, cv.height);
    return await new Promise(r => cv.toBlob(r, "image/jpeg", .88));
  }
  const pickFile = () => new Promise(res => { const i = document.createElement("input"); i.type = "file"; i.accept = "image/*"; i.onchange = () => res(i.files[0] || null); i.click(); });
  async function save(fn, msg) {
    busy(true);
    try { await fn(); busy(false, msg || "Saved"); setTimeout(() => location.reload(), 500); return true; }
    catch (e) { busy(false); alert("Couldn't save: " + e.message); return false; }
  }

  // ---------- styles (prefixed so they never touch the page's own) ----------
  const CSS = `
  .rx-pen{position:absolute;z-index:6;width:34px;height:34px;border-radius:50%;border:0;background:#FF5A1F;color:#fff;display:flex;align-items:center;justify-content:center;cursor:pointer;box-shadow:0 4px 14px rgba(0,0,0,.45)}
  .rx-pen svg{width:16px;height:16px}
  body.rx-view .rx-only{display:none!important}
  .rx-bar{position:fixed;left:50%;bottom:calc(14px + env(safe-area-inset-bottom));transform:translateX(-50%);z-index:900;display:flex;align-items:center;gap:6px;padding:6px;border-radius:999px;background:rgba(17,18,22,.94);border:1px solid #3b3e47;box-shadow:0 12px 34px rgba(0,0,0,.55);backdrop-filter:blur(10px);font:600 14px Barlow,system-ui,sans-serif;color:#f4f4f2;white-space:nowrap}
  .rx-bar .rx-st{padding:0 10px 0 12px;display:flex;align-items:center;gap:8px}
  .rx-bar .rx-st i{width:8px;height:8px;border-radius:50%;background:#FF5A1F}
  .rx-b{height:38px;padding:0 14px;border-radius:999px;border:1px solid #3b3e47;background:#1b1c22;color:#f4f4f2;font:600 14px Barlow,system-ui,sans-serif;cursor:pointer;display:inline-flex;align-items:center;gap:6px;text-decoration:none}
  .rx-b:hover{border-color:#50545e}
  .rx-b.pri{background:#FF5A1F;border-color:#FF5A1F;color:#fff}
  .rx-b.bad{color:#e8352f}
  .rx-b:disabled{opacity:.45;cursor:not-allowed}
  .rx-season{margin:18px 0 6px;padding:14px;border:1.5px dashed #3b3e47;border-radius:16px;font-family:Barlow,system-ui,sans-serif}
  .rx-season h4{margin:0 0 10px;font:700 13px Barlow;letter-spacing:.12em;text-transform:uppercase;color:#a9abb2;display:flex;align-items:center}
  .rx-season h4 span{flex:1}
  .rx-chips{display:flex;flex-wrap:wrap;gap:8px}
  .rx-chip{display:flex;align-items:center;gap:8px;height:44px;padding:0 12px 0 10px;border-radius:12px;border:1px solid #3b3e47;background:#15161b;color:#f4f4f2;cursor:pointer;font:600 14px Barlow,system-ui,sans-serif}
  .rx-chip i{width:4px;height:24px;border-radius:2px;background:var(--c)}
  .rx-chip img{height:22px;max-width:64px;object-fit:contain}
  .rx-chip small{color:#7d808a;font-weight:600}
  .rx-photo-ph{width:100%;border-radius:inherit;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:6px;border:2px dashed #3b3e47;color:#a9abb2;font:600 14px Barlow,system-ui,sans-serif;background:#15161b;cursor:pointer}
  .rx-photo-ph svg{width:26px;height:26px}
  .rx-scrim{position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:950;opacity:0;pointer-events:none;transition:opacity .2s}
  .rx-sheet{position:fixed;left:0;right:0;bottom:0;max-height:92vh;z-index:951;background:#111216;color:#f4f4f2;border-top:1px solid #3b3e47;border-radius:22px 22px 0 0;display:flex;flex-direction:column;transform:translateY(105%);transition:transform .24s cubic-bezier(.2,.8,.2,1);font:16px/1.45 Barlow,system-ui,sans-serif;box-shadow:0 -20px 50px rgba(0,0,0,.5)}
  body.rx-on .rx-scrim{opacity:1;pointer-events:auto}
  body.rx-on .rx-sheet{transform:none}
  @media (min-width:760px){.rx-sheet{left:auto;top:0;width:520px;max-height:none;border-radius:0;border-top:0;border-left:1px solid #3b3e47;transform:translateX(105%)}}
  @media (prefers-reduced-motion:reduce){.rx-sheet,.rx-scrim{transition:none}}
  .rx-sh-h{display:flex;align-items:center;gap:10px;padding:16px 18px;border-bottom:1px solid #2a2c33}
  .rx-sh-h b{flex:1;font:700 22px 'Barlow Condensed',sans-serif;text-transform:uppercase;letter-spacing:.02em}
  .rx-x{width:38px;height:38px;border-radius:50%;border:1px solid #3b3e47;background:#1b1c22;color:#f4f4f2;cursor:pointer;font-size:18px}
  .rx-sh-b{flex:1;overflow:auto;padding:18px;display:grid;gap:16px;align-content:start}
  .rx-sh-f{display:flex;gap:10px;padding:14px 18px calc(14px + env(safe-area-inset-bottom));border-top:1px solid #2a2c33}
  .rx-sh-f .rx-b{flex:1;justify-content:center;height:46px;border-radius:12px}
  .rx-sh-f .rx-b.bad{flex:none}
  .rx-sheet label.rx-f{display:block;font-size:14px;font-weight:600;color:#e9e9e6;margin:0 0 6px}
  .rx-sheet .rx-help{font-size:13px;color:#8e919b;margin-top:5px}
  .rx-sheet input:not([type=color]){width:100%;min-height:48px;padding:11px 14px;background:#0d0e11;border:1px solid #3b3e47;border-radius:12px;color:#f4f4f2;font:16px Barlow,system-ui,sans-serif;box-sizing:border-box}
  .rx-sheet input:focus,.rx-sheet button:focus-visible{outline:2px solid #FF5A1F;outline-offset:1px}
  .rx-two{display:grid;grid-template-columns:1fr 1fr;gap:12px}
  .rx-seg{display:flex;background:#0d0e11;border:1px solid #3b3e47;border-radius:12px;padding:4px;gap:4px}
  .rx-seg button{flex:1;height:40px;border:0;border-radius:9px;background:none;color:#a9abb2;font:700 15px Barlow,system-ui,sans-serif;cursor:pointer}
  .rx-seg button[aria-checked="true"]{background:#FF5A1F;color:#fff}
  .rx-sw{display:flex;flex-wrap:wrap;gap:10px;align-items:center}
  .rx-sw button{width:38px;height:38px;border-radius:50%;border:2px solid transparent;cursor:pointer;padding:0}
  .rx-sw button[aria-checked="true"]{border-color:#f4f4f2;transform:scale(1.08)}
  .rx-sw label{width:38px;height:38px;border-radius:50%;border:2px dashed #3b3e47;overflow:hidden;cursor:pointer;display:block}
  .rx-sw input{opacity:0;width:100%;height:100%;border:0;padding:0;cursor:pointer}
  .rx-pick{display:grid;grid-template-columns:64px 1fr;gap:12px;align-items:center;width:100%;padding:12px;border-radius:14px;background:#15161b;border:1px solid #2a2c33;color:#f4f4f2;cursor:pointer;text-align:left;font:600 15px Barlow,system-ui,sans-serif}
  .rx-pick:hover{border-color:#3b3e47}
  .rx-pick small{display:block;color:#7d808a;font-weight:500}
  .rx-lg{height:36px;display:flex;align-items:center;justify-content:center}
  .rx-lg img{max-width:64px;max-height:36px;object-fit:contain}
  .rx-lg span{font:700 13px 'Barlow Condensed';color:#a9abb2;border:1px solid #3b3e47;border-radius:8px;padding:5px 7px}
  .rx-grp{font:700 12px Barlow;letter-spacing:.12em;text-transform:uppercase;color:#7d808a;margin:6px 0 0}
  .rx-vp{position:relative}
  .rx-vl{position:absolute;left:0;right:0;top:calc(100% + 6px);z-index:5;background:#1b1c22;border:1px solid #3b3e47;border-radius:12px;padding:6px;max-height:240px;overflow:auto;box-shadow:0 12px 30px rgba(0,0,0,.45)}
  .rx-vl button{display:block;width:100%;text-align:left;padding:10px 12px;border:0;border-radius:8px;background:none;color:#f4f4f2;cursor:pointer;font:15px Barlow,system-ui,sans-serif}
  .rx-vl button:hover{background:#15161b}
  .rx-vl small{color:#7d808a}
  .rx-vchip{display:flex;align-items:center;gap:10px;padding:10px 12px;background:#0d0e11;border:1px solid #3b3e47;border-radius:12px}
  .rx-vchip b{flex:1}
  .rx-carph{display:flex;align-items:center;gap:12px}
  .rx-carph img{width:120px;height:68px;object-fit:cover;border-radius:10px;border:1px solid #3b3e47}
  .rx-carph .rx-none{width:120px;height:68px;border-radius:10px;border:1.5px dashed #3b3e47;display:flex;align-items:center;justify-content:center;color:#7d808a;font-size:13px}
  .rx-link{color:#FF5A1F;background:none;border:0;padding:0;font:600 13px Barlow,system-ui,sans-serif;cursor:pointer}
  .rx-toast{position:fixed;left:50%;top:calc(16px + env(safe-area-inset-top));transform:translateX(-50%);z-index:999;background:#f4f4f2;color:#0b0c0f;padding:10px 16px;border-radius:12px;font:600 14px Barlow,system-ui,sans-serif;box-shadow:0 8px 24px rgba(0,0,0,.4)}
  .rx-menu{position:fixed;left:50%;bottom:calc(70px + env(safe-area-inset-bottom));transform:translateX(-50%);z-index:960;min-width:250px;background:#1b1c22;border:1px solid #3b3e47;border-radius:14px;padding:6px;font:15px Barlow,system-ui,sans-serif;color:#f4f4f2;box-shadow:0 16px 40px rgba(0,0,0,.5)}
  .rx-menu button{display:flex;width:100%;padding:11px 12px;border:0;background:none;color:inherit;border-radius:10px;cursor:pointer;text-align:left;font:inherit}
  .rx-menu button:hover{background:#15161b}
  .rx-menu .on::after{content:"✓";margin-left:auto;color:#FF5A1F}
  .rx-menu hr{border:0;border-top:1px solid #2a2c33;margin:6px 0}
  body.rx-edit .wrap{padding-bottom:90px}
  body.rx-edit:not(.rx-view) #scroll-cue,body.rx-edit:not(.rx-view) #page-cue{display:none!important}
  @media (min-width:760px){.rx-bar{left:auto;right:18px;transform:none}.rx-menu{left:auto;right:18px;transform:none}}`;

  let toastEl;
  function busy(on, msg) {
    if (on) { toastEl = toastEl || document.body.appendChild(Object.assign(document.createElement("div"), { className: "rx-toast", role: "status" })); toastEl.textContent = "Saving…"; toastEl.hidden = false; }
    else if (toastEl) { if (msg) { toastEl.textContent = msg; setTimeout(() => toastEl.hidden = true, 1600); } else toastEl.hidden = true; }
  }

  // ---------- sheet ----------
  let sheetResolve = null;
  function closeSheet(v) { document.body.classList.remove("rx-on"); if (sheetResolve) { const r = sheetResolve; sheetResolve = null; r(v); } }
  function sheet(title, html, opts = {}) {
    return new Promise(resolve => {
      sheetResolve = resolve;
      $("#rx-t").textContent = title;
      $("#rx-b").innerHTML = html;
      const f = $("#rx-f");
      f.hidden = opts.footer === false;
      f.innerHTML = opts.footer === false ? "" : `${opts.del ? `<button class="rx-b bad" id="rx-del">${esc(opts.del)}</button>` : ""}<button class="rx-b" id="rx-cancel">Cancel</button><button class="rx-b pri" id="rx-ok">${esc(opts.ok || "Save")}</button>`;
      if ($("#rx-cancel")) $("#rx-cancel").onclick = () => closeSheet(null);
      if ($("#rx-ok")) $("#rx-ok").onclick = () => { const v = opts.collect ? opts.collect() : true; if (v) closeSheet(v); };
      if ($("#rx-del")) $("#rx-del").onclick = () => { if (confirm(opts.delText || "Delete?")) closeSheet({ __delete: true }); };
      document.body.classList.add("rx-on");
      $("#rx-b").scrollTop = 0;
      if (opts.after) opts.after();
    });
  }
  const need = (sel, msg) => { const el = $(sel); if (el && !el.value.trim()) { el.focus(); alert(msg); return false; } return true; };

  // ---------- edit features ----------
  let R, ME, ROLE, MEMBERS = [], SERIES = [], VEH = [];
  const entryOf = slug => R.entries.find(e => e.series?.slug === slug);

  async function editPhoto() {
    const f = await pickFile(); if (!f) return;
    save(async () => { const b = await picture(f, false, 1800); const u = await upload(b, `profiles/${R.profile.id}-${Date.now()}.jpg`); await upd("profiles", R.profile.id, { photo_url: u, hero_url: null, updated_at: new Date().toISOString() }); }, "Photo updated");
  }
  async function editName() {
    const p = R.profile;
    const r = await sheet("Name", `
      <div class="rx-two"><div><label class="rx-f" for="rx-first">First name</label><input id="rx-first" value="${esc(p.first_name || "")}"></div>
      <div><label class="rx-f" for="rx-full">Full name</label><input id="rx-full" value="${esc(p.display_name)}"></div></div>
      <div class="rx-help">Your page title is "${esc((p.first_name || "Name").toUpperCase())} RACE HUB".</div>`,
      { collect() { if (!need("#rx-first", "Add a first name.") || !need("#rx-full", "Add your full name.")) return null; return { first_name: $("#rx-first").value.trim(), display_name: $("#rx-full").value.trim() }; } });
    if (r) save(() => upd("profiles", p.id, { ...r, updated_at: new Date().toISOString() }));
  }
  async function loadLists() {
    if (!SERIES.length) [SERIES, VEH] = await Promise.all([api("series?select=id,slug,name,short_name,sport,logo_url&order=name"), api("vehicles?select=*&order=name")]);
  }
  async function addChampionship() {
    await loadLists();
    const SP = { sportscars: "Sportscars", formula: "Formula", motorbikes: "Motorbikes" };
    const lg = s => s.logo_url ? `<img src="${esc(s.logo_url)}" alt="">` : `<span>${esc(s.short_name.slice(0, 5))}</span>`;
    const groups = Object.keys(SP).map(k => [k, SERIES.filter(s => s.sport === k)]).filter(g => g[1].length);
    const r = await sheet("Add a championship", `<div><label class="rx-f" for="rx-q">Search</label><input id="rx-q" type="search" autocomplete="off"></div>
      <div id="rx-list" style="display:grid;gap:8px">${groups.map(([k, l]) => `<div class="rx-grp" data-g>${SP[k]}</div>${l.map(s => `<button class="rx-pick" data-s="${s.id}" data-k="${k}"><div class="rx-lg">${lg(s)}</div><div>${esc(s.name)}<small>${esc(s.short_name !== s.name ? s.short_name : "")}</small></div></button>`).join("")}`).join("")}</div>
      <div class="rx-help" style="text-align:center">Can't find yours? Write to us and we'll add it.</div>`, { footer: false, after() {
        $("#rx-q").oninput = e => { const q = e.target.value.trim().toLowerCase(); $$("#rx-list .rx-pick").forEach(b => { const s = SERIES.find(x => x.id === b.dataset.s); b.hidden = q && !(s.name + " " + s.short_name).toLowerCase().includes(q); }); $$("#rx-list [data-g]").forEach(g => { let n = g.nextElementSibling, any = false; while (n && !n.matches("[data-g]")) { if (!n.hidden) any = true; n = n.nextElementSibling; } g.hidden = !any; }); };
        $$("#rx-list .rx-pick").forEach(b => b.onclick = () => closeSheet(SERIES.find(x => x.id === b.dataset.s)));
      } });
    if (!r) return;
    let yr = YEAR;
    try { const up = await api(`events?series_id=eq.${r.id}&end_date=gte.${TODAY}&select=year&order=start_date&limit=1`); if (up[0]) yr = up[0].year; } catch (e) {}
    if (R.entries.some(e => e.series_id === r.id && e.year === yr)) yr++;
    editEntry({ series_id: r.id, series: r, year: yr, color: COLORS.find(c => !R.entries.some(e => (e.color || "").toUpperCase() === c)) || COLORS[0] });
  }
  async function editEntry(en) {
    await loadLists();
    const isNew = !en.id, s = en.series || SERIES.find(x => x.id === en.series_id);
    let year = en.year, color = (en.color || COLORS[0]).toUpperCase(), vehicle = en.vehicles || VEH.find(v => v.id === en.vehicle_id) || null;
    let photoFile = null, photoUrl = en.car_photo_url || "";
    const years = [...new Set([YEAR, YEAR + 1, year])].sort();
    const vbox = () => vehicle ? `<div class="rx-vchip"><b>${esc(vehicle.name)}</b><button type="button" class="rx-b" id="rx-vchg">Change</button></div>`
      : `<div class="rx-vp"><input id="rx-vq" autocomplete="off" aria-label="Search the car catalogue"><div class="rx-vl" id="rx-vl" hidden></div></div><div class="rx-help">Type to search the catalogue.</div>`;
    const phbox = () => `<div class="rx-carph">${photoUrl ? `<img src="${esc(photoUrl)}" alt="">` : `<div class="rx-none">No photo</div>`}<button type="button" class="rx-b" id="rx-ph">${photoUrl ? "Change photo" : "Add photo"}</button></div><div class="rx-help">A photo of your car, with your livery. Shown when fans tap the car.</div>`;
    const html = `
      <div style="display:flex;align-items:center;gap:14px"><div class="rx-lg" style="width:76px">${s?.logo_url ? `<img src="${esc(s.logo_url)}" alt="">` : `<span>${esc(s?.short_name || "")}</span>`}</div><b style="font-size:17px">${esc(s?.name || "")}</b></div>
      <div><label class="rx-f" id="rx-yl">Season</label><div class="rx-seg" role="radiogroup" aria-labelledby="rx-yl" id="rx-ys">${years.map(y => `<button type="button" role="radio" data-y="${y}" aria-checked="${y === year}">${y}</button>`).join("")}</div></div>
      <div class="rx-two"><div><label class="rx-f" for="rx-num">Car number</label><input id="rx-num" value="${esc(en.car_number || "")}" inputmode="numeric" autocomplete="off"></div><div><label class="rx-f" for="rx-cat">Class</label><input id="rx-cat" value="${esc(en.category || "")}" autocomplete="off"></div></div>
      <div><label class="rx-f" for="rx-team">Team</label><input id="rx-team" value="${esc(en.team || "")}" autocomplete="off"></div>
      <div><label class="rx-f" for="rx-mates">Teammates</label><input id="rx-mates" value="${esc((en.teammates || []).join(", "))}" autocomplete="off"><div class="rx-help">Separate names with commas.</div></div>
      <div><label class="rx-f">Car</label><div id="rx-vbox">${vbox()}</div><div class="rx-help">Not in the catalogue? <button type="button" class="rx-link" id="rx-vnew">Add your car</button></div></div>
      <div><label class="rx-f">Car photo</label><div id="rx-phbox">${phbox()}</div></div>
      <div><label class="rx-f" id="rx-cl">Colour</label><div class="rx-sw" role="radiogroup" aria-labelledby="rx-cl" id="rx-cs">${COLORS.map(c => `<button type="button" role="radio" aria-label="${c}" data-c="${c}" aria-checked="${c === color}" style="background:${c}"></button>`).join("")}<label title="Custom colour"><input type="color" id="rx-cc" value="${esc(color)}" aria-label="Custom colour"></label></div></div>`;
    const bindV = () => {
      if ($("#rx-vchg")) $("#rx-vchg").onclick = () => { vehicle = null; $("#rx-vbox").innerHTML = vbox(); bindV(); $("#rx-vq").focus(); };
      const q = $("#rx-vq"); if (!q) return; const l = $("#rx-vl");
      const show = () => { const t = q.value.trim().toLowerCase(); const hits = VEH.filter(v => !t || v.name.toLowerCase().includes(t)).slice(0, 12);
        l.innerHTML = hits.map(v => `<button type="button" data-v="${v.id}">${esc(v.name)}${v.engine ? `<br><small>${esc(v.engine)}</small>` : ""}</button>`).join("") || `<div class="rx-help" style="padding:8px 12px">No car found. Use "Add your car".</div>`;
        l.hidden = false; l.querySelectorAll("[data-v]").forEach(b => b.onmousedown = ev => { ev.preventDefault(); vehicle = VEH.find(v => v.id === b.dataset.v); $("#rx-vbox").innerHTML = vbox(); bindV(); }); };
      q.onfocus = show; q.oninput = show; q.onblur = () => setTimeout(() => l.hidden = true, 120);
    };
    const bindPh = () => { $("#rx-ph").onclick = async () => { const f = await pickFile(); if (!f) return; photoFile = f; photoUrl = URL.createObjectURL(f); $("#rx-phbox").innerHTML = phbox(); bindPh(); }; };
    const r = await sheet(isNew ? "Your entry" : "Edit entry", html, { ok: isNew ? "Add to my season" : "Save", del: !isNew && ROLE === "owner" ? "Remove" : null, delText: `Remove ${s?.name} ${year} from your page?`,
      after() {
        $$("#rx-ys button").forEach(b => b.onclick = () => { year = +b.dataset.y; $$("#rx-ys button").forEach(x => x.setAttribute("aria-checked", x === b)); });
        $$("#rx-cs button").forEach(b => b.onclick = () => { color = b.dataset.c; $$("#rx-cs button").forEach(x => x.setAttribute("aria-checked", x === b)); });
        $("#rx-cc").oninput = e => { color = e.target.value.toUpperCase(); $$("#rx-cs button").forEach(x => x.setAttribute("aria-checked", "false")); };
        bindV(); bindPh();
        $("#rx-vnew").onclick = async () => { const draft = { car_number: $("#rx-num").value, category: $("#rx-cat").value, team: $("#rx-team").value, teammates: $("#rx-mates").value.split(",").map(x => x.trim()).filter(Boolean) };
          sheetResolve = null; const v = await newVehicle(); editEntry({ ...en, ...draft, year, color, vehicles: v || vehicle, vehicle_id: (v || vehicle)?.id || null }); };
      },
      collect() { return { year, color: /^#[0-9A-F]{6}$/i.test(color) ? color : COLORS[0], car_number: $("#rx-num").value.trim() || null, category: $("#rx-cat").value.trim() || null, team: $("#rx-team").value.trim() || null, teammates: $("#rx-mates").value.split(",").map(x => x.trim()).filter(Boolean), vehicle_id: vehicle?.id || null }; } });
    if (!r) return;
    if (r.__delete) return save(() => api(`entries?id=eq.${en.id}`, { method: "DELETE" }), "Removed");
    save(async () => {
      if (photoFile) r.car_photo_url = await upload(await picture(photoFile, false, 1600), `cars/${R.profile.id}-${Date.now()}.jpg`);
      if (isNew) await ins("entries", { profile_id: R.profile.id, series_id: en.series_id, ...r });
      else await upd("entries", en.id, r);
    }, isNew ? "Added to your season" : "Saved");
  }
  async function newVehicle() {
    let drive = "";
    const fld = ([k, l]) => `<div><label class="rx-f" for="rx-v-${k}">${l}</label><input id="rx-v-${k}" autocomplete="off"></div>`;
    const r = await sheet("Add your car", `<div class="rx-help" style="margin:0">Fill in what you know. Leave a box empty if it doesn't apply. Our team checks it before it joins the catalogue for everyone.</div>
      <div><label class="rx-f" for="rx-v-name">Name</label><input id="rx-v-name" autocomplete="off"></div>
      ${VFIELDS.slice(0, 3).map(fld).join("")}
      <div><label class="rx-f" id="rx-dl">Drivetrain</label><div class="rx-seg" role="radiogroup" aria-labelledby="rx-dl" id="rx-ds">${Object.entries(DRIVE).map(([k, l]) => `<button type="button" role="radio" data-d="${k}" aria-checked="false">${l}</button>`).join("")}</div></div>
      <div class="rx-two">${VFIELDS.slice(3, 5).map(fld).join("")}</div><div class="rx-two">${VFIELDS.slice(5).map(fld).join("")}</div>`,
      { ok: "Add car", after() { $$("#rx-ds button").forEach(b => b.onclick = () => { drive = drive === b.dataset.d ? "" : b.dataset.d; $$("#rx-ds button").forEach(x => x.setAttribute("aria-checked", x.dataset.d === drive)); }); },
        collect() { if (!need("#rx-v-name", "Give the car a name.")) return null; const row = { name: $("#rx-v-name").value.trim(), drivetrain: drive || null }; VFIELDS.forEach(([k]) => row[k] = $("#rx-v-" + k).value.trim() || null); return row; } });
    if (!r) return null;
    try { const [v] = await ins("vehicles", { ...r, status: "pending", created_by_profile: R.profile.id }); VEH.push(v); return v; }
    catch (e) { alert("Couldn't add the car: " + e.message); return null; }
  }

  // ---------- put the controls on the page ----------
  function mount() {
    const st = document.createElement("style"); st.textContent = CSS; document.head.appendChild(st);
    document.body.insertAdjacentHTML("beforeend", `<div class="rx-scrim" id="rx-scrim"></div><div class="rx-sheet" id="rx-sheet" role="dialog" aria-modal="true" aria-labelledby="rx-t"><div class="rx-sh-h"><b id="rx-t"></b><button class="rx-x" id="rx-x" aria-label="Close">×</button></div><div class="rx-sh-b" id="rx-b"></div><div class="rx-sh-f" id="rx-f"></div></div>`);
    $("#rx-x").onclick = () => closeSheet(null); $("#rx-scrim").onclick = () => closeSheet(null);
    document.addEventListener("keydown", e => { if (e.key === "Escape" && document.body.classList.contains("rx-on")) closeSheet(null); });
    document.body.classList.add("rx-edit");
    document.getElementById("rnx-preview")?.remove();   // the edit bar already says "Draft"

    // photo
    const photo = $("#rnx-photo"), hero = $(".hero");
    if (hero) {
      if (!R.profile.photo_url && !R.profile.hero_url && photo) {
        const ph = document.createElement("button"); ph.type = "button"; ph.className = "rx-photo-ph rx-only"; ph.innerHTML = `${CAM}<span>Add your photo</span>`; ph.onclick = editPhoto;
        photo.insertAdjacentElement("afterend", ph);
        ph.style.cssText = "position:absolute;inset:0;width:auto;aspect-ratio:auto;border-radius:inherit;justify-content:flex-start;padding-top:22%";
      }
      const pen = document.createElement("button"); pen.type = "button"; pen.className = "rx-pen rx-only"; pen.setAttribute("aria-label", "Change photo"); pen.innerHTML = CAM; pen.onclick = editPhoto;
      if (getComputedStyle(hero).position === "static") hero.style.position = "relative";
      pen.style.cssText = "top:12px;left:12px"; hero.appendChild(pen);
    }
    // name
    const h1 = $(".hero-text h1");
    if (h1) { const pen = document.createElement("button"); pen.type = "button"; pen.className = "rx-pen rx-only"; pen.setAttribute("aria-label", "Edit name"); pen.innerHTML = PEN; pen.onclick = editName; pen.style.cssText = "position:relative;display:inline-flex;vertical-align:middle;margin-left:10px;width:30px;height:30px"; h1.appendChild(pen); }
    // season strip above the race list
    const lg = s => s?.logo_url ? `<img src="${esc(s.logo_url)}" alt="">` : `<b>${esc(s?.short_name || "")}</b>`;
    const strip = document.createElement("section"); strip.className = "rx-season rx-only";
    strip.innerHTML = `<h4><span>Your season</span><button class="rx-b pri" id="rx-add">+ Add championship</button></h4>${R.entries.length ? `<div class="rx-chips">${R.entries.map(e => `<button class="rx-chip" data-e="${e.id}" style="--c:${esc(e.color || "#8a8d96")}"><i></i>${lg(e.series)}<span>${e.car_number ? "#" + esc(e.car_number) : ""}</span><small>${e.year}</small>${PEN.replace("<svg", '<svg width="14" height="14"')}</button>`).join("")}</div>` : `<div class="rx-help" style="color:#a9abb2;font-size:14px">Add the championships you race in: your calendar, schedules and where to watch fill in by themselves.</div>`}`;
    const anchor = $("#ffdd") || $("#list");
    anchor.parentNode.insertBefore(strip, anchor);
    $("#rx-add").onclick = addChampionship;
    strip.querySelectorAll("[data-e]").forEach(b => b.onclick = () => editEntry(R.entries.find(x => x.id === b.dataset.e)));
    // car modal: change the photo of your car
    document.addEventListener("click", e => {
      const b = e.target.closest(".car-btn, .cd-car"); if (!b || document.body.classList.contains("rx-view")) return;
      setTimeout(() => { const en = entryOf(b.dataset.series), body = $("#tt-body"); if (!en || !body) return; body.insertAdjacentHTML("afterbegin", `<div class="rx-only" style="display:flex;gap:8px;justify-content:center;margin:0 0 14px"><button class="rx-b pri" id="rx-carph">${CAM.replace("<svg", '<svg width="16" height="16"')} ${en.car_photo_url ? "Change car photo" : "Add your car photo"}</button><button class="rx-b" id="rx-caredit">${PEN.replace("<svg", '<svg width="15" height="15"')} Edit entry</button></div>`);
        $("#rx-caredit").onclick = () => { $("#tt-close")?.click(); editEntry(en); };
        $("#rx-carph").onclick = async () => { const f = await pickFile(); if (!f) return; save(async () => { const u = await upload(await picture(f, false, 1600), `cars/${R.profile.id}-${Date.now()}.jpg`); await upd("entries", en.id, { car_photo_url: u }); }, "Car photo saved"); }; }, 0);
    }, true);
    // bottom bar
    const bar = document.createElement("div"); bar.className = "rx-bar";
    bar.innerHTML = `<span class="rx-st"><i></i><span id="rx-mode">Editing</span>${R.profile.published ? "" : " · Draft"}</span><button class="rx-b" id="rx-view">View as fan</button><button class="rx-b" id="rx-more" aria-label="More">•••</button>`;
    document.body.appendChild(bar);
    $("#rx-view").onclick = () => { const v = document.body.classList.toggle("rx-view"); $("#rx-view").textContent = v ? "Edit" : "View as fan"; $("#rx-mode").textContent = v ? "Fan view" : "Editing"; };
    $("#rx-more").onclick = ev => {
      ev.stopPropagation(); if ($(".rx-menu")) return $(".rx-menu").remove();
      const m = document.createElement("div"); m.className = "rx-menu";
      m.innerHTML = `${MEMBERS.map(x => `<button data-slug="${esc(x.profiles.slug)}" class="${x.profiles.id === R.profile.id ? "on" : ""}">${esc(x.profiles.display_name)}</button>`).join("")}<hr><button id="rx-copy">Copy page link</button><button id="rx-new">+ Create another page</button><button id="rx-out">Sign out</button><div style="font-size:12px;color:#7d808a;padding:6px 12px">${esc(ME.email || "")}</div>`;
      document.body.appendChild(m);
      m.querySelectorAll("[data-slug]").forEach(b => b.onclick = () => { localStorage.setItem("rnx_profile", MEMBERS.find(x => x.profiles.slug === b.dataset.slug).profiles.id); location.href = (window.RNX_BASE || "/") + b.dataset.slug; });
      $("#rx-copy").onclick = async () => { m.remove(); const u = location.origin + location.pathname; try { await navigator.clipboard.writeText(u); busy(true); busy(false, "Link copied"); } catch (e) { prompt("Your page link:", u); } };
      $("#rx-new").onclick = () => { location.href = (window.RNX_BASE || "/") + "app.html?new=1"; };
      $("#rx-out").onclick = () => { S.set(null); localStorage.removeItem("rnx_profile"); location.reload(); };
      setTimeout(() => document.addEventListener("click", function off(e2) { if (!m.contains(e2.target)) { m.remove(); document.removeEventListener("click", off); } }), 0);
    };
    if (!R.entries.length) setTimeout(addChampionship, 400);
  }

  window.rnxEditInit = async function (raw) {
    R = raw;
    if (!S.get() || !(await token())) return;
    try {
      ME = await fetch(`${C.url}/auth/v1/user`, { headers: { apikey: C.key, Authorization: `Bearer ${await token()}` } }).then(r => r.ok ? r.json() : null);
      if (!ME) return;
      MEMBERS = await api(`profile_members?user_id=eq.${ME.id}&select=role,profiles(id,slug,display_name)&order=created_at`);
      const m = MEMBERS.find(x => x.profiles?.id === R.profile.id);
      if (!m) return;   // signed in, but not this page's owner or editor: plain fan view
      ROLE = m.role;
      const go = () => mount();
      document.readyState === "loading" ? document.addEventListener("DOMContentLoaded", go) : setTimeout(go, 0);
    } catch (e) { console.warn("edit mode unavailable", e); }
  };
})();
