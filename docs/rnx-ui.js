// Racenxt shared UI pieces: photo framing (drag + zoom with live previews) and logo cropping (AI finds the logo, you adjust).
(function () {
  const C = window.RNX_CONFIG;
  const CSS = `
  .rxf{display:grid;gap:12px;font:14px Barlow,system-ui,sans-serif;color:#a9abb2}
  .rxf-views{display:flex;justify-self:center;gap:4px;margin:0 auto;padding:4px;border-radius:999px;background:#0d0e11;border:1px solid #3b3e47}
  .rxf-views button{height:32px;padding:0 14px;border:0;border-radius:999px;background:none;color:#a9abb2;font:600 13.5px Barlow,system-ui,sans-serif;cursor:pointer}
  .rxf-views button[aria-checked="true"]{background:#f4f4f2;color:#0b0c0f}
  .rxf-main.desk{aspect-ratio:16/8.6;max-width:100%}
  .rxf-main{position:relative;width:100%;max-width:340px;margin:0 auto;aspect-ratio:9/10;border-radius:16px;overflow:hidden;background:#000;touch-action:none;cursor:grab;border:1px solid #3b3e47}
  .rxf-main:active{cursor:grabbing}
  .rxf img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;user-select:none;-webkit-user-drag:none;pointer-events:none}
  .rxf-shade{position:absolute;left:0;right:0;bottom:0;height:38%;background:linear-gradient(to top,rgba(0,0,0,.75),transparent);pointer-events:none}
  .rxf-name{position:absolute;left:14px;bottom:12px;font:700 22px 'Barlow Condensed',sans-serif;color:#fff;text-transform:uppercase;pointer-events:none}
  .rxf-name em{font-style:normal;color:#FF5A1F}
  .rxf-hint{position:absolute;left:50%;top:12px;transform:translateX(-50%);background:rgba(0,0,0,.6);color:#fff;border-radius:999px;padding:6px 12px;font-size:13px;pointer-events:none;white-space:nowrap}
  .rxf-row{display:flex;align-items:center;gap:12px}
  .rxf-row input[type=range]{flex:1;accent-color:#FF5A1F;min-height:0;padding:0;border:0;background:none}
  /* editors (photo, logo): the house style, see DESIGN.md */
  .rxe{position:fixed;inset:0;z-index:1200;display:flex;align-items:flex-end;justify-content:center}
  .rxe-back{position:absolute;inset:0;background:rgba(5,6,8,.7);-webkit-backdrop-filter:blur(2px);backdrop-filter:blur(2px);opacity:0;transition:opacity .28s ease}
  .rxe-box{position:relative;width:100%;max-width:540px;max-height:96dvh;max-height:calc(var(--vvh,100dvh) - 8px);margin-bottom:var(--kb,0px);transition-property:transform,opacity,margin-bottom;background:#16181d;border:1px solid #2c2f37;border-bottom:0;border-radius:22px 22px 0 0;display:flex;flex-direction:column;color:#f2f2ef;font:16px Barlow,system-ui,sans-serif;box-shadow:0 -18px 50px rgba(0,0,0,.5);transform:translateY(100%);transition:transform .32s cubic-bezier(.2,.85,.25,1)}
  .rxe.on .rxe-back{opacity:1}.rxe.on .rxe-box{transform:none}
  @media (min-width:700px){.rxe{align-items:center}.rxe-box{border-bottom:1px solid #2c2f37;border-radius:22px;max-height:92dvh;transform:translateY(12px) scale(.97);opacity:0;transition:transform .24s cubic-bezier(.2,.85,.25,1),opacity .2s ease;box-shadow:0 24px 70px rgba(0,0,0,.55)}.rxe.on .rxe-box{opacity:1}}
  @media (prefers-reduced-motion:reduce){.rxe-box,.rxe-back{transition:opacity .15s ease !important}.rxe-box{transform:none !important}}
  .rxe-h{flex:none;display:flex;align-items:flex-start;gap:12px;padding:16px 20px 14px;border-bottom:1px solid #24262d}
  .rxe-h > div{flex:1;min-width:0}
  .rxe-h small{display:block;font:700 12px/1 'Barlow Condensed',sans-serif;letter-spacing:.16em;text-transform:uppercase;color:#FF5A1F}
  .rxe-h b{display:block;margin-top:6px;font:700 24px/1.1 'Barlow Condensed',sans-serif;text-transform:uppercase;letter-spacing:.01em}
  .rxe-x{flex:none;width:36px;height:36px;border-radius:50%;border:1px solid #2f323a;background:#1f2228;color:#9a9ca3;cursor:pointer;display:grid;place-items:center}
  .rxe-x svg{width:16px;height:16px}
  .rxe-b{flex:1 1 auto;min-height:0;overflow-y:auto;padding:16px 20px;display:grid;gap:16px;align-content:start}
  .rxe-f{flex:none;display:flex;gap:10px;padding:14px 20px calc(14px + env(safe-area-inset-bottom));border-top:1px solid #24262d}
  .rxe-f button{flex:1;height:48px;border-radius:14px;border:1px solid #2f323a;background:#1d2026;color:#f2f2ef;font:600 15px Barlow,system-ui,sans-serif;cursor:pointer}
  .rxe-f button.pri{background:#FF5A1F;border-color:#FF5A1F;color:#fff}
  .rxe-f button:disabled{opacity:.5;cursor:default}
  .rxe-lbl{font:700 12px/1 'Barlow Condensed',sans-serif;letter-spacing:.16em;text-transform:uppercase;color:#9a9ca3;margin-bottom:8px}
  .rxt{width:132px;aspect-ratio:16/10;border-radius:12px;overflow:hidden;position:relative;background:#15161b;border:1px solid #3b3e47;flex:none}
  .rxt img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
  .rxt.rxt-lg{background:#0d0e11;background-image:linear-gradient(45deg,#17191e 25%,transparent 25%,transparent 75%,#17191e 75%),linear-gradient(45deg,#17191e 25%,transparent 25%,transparent 75%,#17191e 75%);background-size:14px 14px;background-position:0 0,7px 7px}
  .rxt .rxt-logo{position:absolute;inset:14% 12%;width:76%;height:72%;object-fit:contain}
  .rxt-empty{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;border:1.5px dashed #3b3e47;border-radius:inherit;color:#8e919b;font:600 13px Barlow,system-ui,sans-serif;background:#15161b}
  .rxt-empty svg{width:22px;height:22px}
  .rxl-seg{display:grid;grid-template-columns:repeat(3,1fr);gap:4px;padding:4px;border-radius:14px;background:#0d0e11;border:1px solid #2a2d35}
  .rxl-seg button{min-height:44px;border:0;border-radius:10px;background:transparent;color:#9a9ca3;font:600 15px Barlow,system-ui,sans-serif;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;gap:8px;transition:background .15s,color .15s}
  .rxl-seg button i{width:16px;height:16px;border-radius:50%;border:1px solid #4a4d56;flex:none}
  .rxl-seg button[aria-checked="true"]{background:#23262d;color:#f2f2ef}
  .rxl-seg button:focus-visible,.rxf-views button:focus-visible{outline:2px solid #FF5A1F;outline-offset:2px}
  .rxl-stage{position:relative;height:min(36dvh,330px);width:auto;max-width:100%;margin:0 auto;aspect-ratio:3/4;border-radius:18px;overflow:hidden;background:#1d2026 center/cover no-repeat;border:1px solid #2c2f37}
  .rxl-stage.desk{height:auto;width:100%;max-height:min(36dvh,330px);aspect-ratio:16/8.6}
  .rxe-b.rxl-b{gap:14px;padding-top:14px;padding-bottom:14px}
  .rxl-stage > img.ph{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
  .rxl-stage::after{content:"";position:absolute;inset:0;background:linear-gradient(180deg,rgba(0,0,0,.28),transparent 30%,transparent 60%,rgba(0,0,0,.7))}
  .rxl-stage .lg{position:absolute;z-index:1;top:4.5%;left:6%;width:24%;max-height:16%;object-fit:contain;object-position:left top;filter:drop-shadow(0 2px 8px rgba(0,0,0,.4));transition:width .25s ease}
  .rxl-stage.desk .lg{width:16%;top:6%;left:3.5%;max-height:22%}
  .rxl-stage .nm{position:absolute;z-index:1;left:6%;bottom:5%;font:700 26px/1 'Barlow Condensed',sans-serif;color:#fff;text-transform:uppercase}
  .rxl-stage.desk .nm{left:3.5%;font-size:30px}
  .rxl-stage .nm em{font-style:normal;color:#FF5A1F}
  /* partner logos: preview in the partners bar of the page */
  .rxl-stage.pt{background:#0b0c0f;display:flex;align-items:center;justify-content:center;padding:0 6%;aspect-ratio:auto;height:min(24dvh,210px);width:72%}
  .rxl-stage.pt.desk{width:100%;max-height:none;height:min(24dvh,210px)}
  .rxl-b.fr .rxl-stage:not(.pt){height:min(26dvh,250px)}
  .rxl-stage.pt::after{display:none}
  .rxl-stage .pt-bar{width:100%;display:flex;flex-wrap:nowrap;align-items:center;justify-content:center;gap:16px;padding:14px 12px;border:1px solid #23262d;border-radius:12px;background:#121419}
  .rxl-stage .pt-bar span{display:none;font:600 9px 'Barlow Condensed',sans-serif;letter-spacing:.18em;text-transform:uppercase;color:#7d808a}
  .rxl-stage.desk .pt-bar span{display:block}
  .rxl-stage .pt-bar img{position:static;display:block;flex:0 1 auto;min-width:0;height:20px;width:auto;max-width:84px;max-height:none;object-fit:contain;opacity:.85;filter:none}
  .rxl-stage .pt-bar img.lg{opacity:1;outline:1.5px dashed rgba(255,90,31,.7);outline-offset:5px;border-radius:2px}
  .rxl-stage.desk .pt-bar{gap:22px;padding:12px 14px}
  .rxl-stage.desk .pt-bar img{height:18px;max-width:72px}
  .rxl-stage .busy{position:absolute;z-index:2;inset:0;display:grid;place-items:center;background:rgba(13,14,17,.55);color:#f2f2ef;font:600 14px Barlow,system-ui,sans-serif;text-align:center;padding:16px}
  .rxl-steps{display:flex;gap:8px;align-items:center;font:600 13.5px Barlow,system-ui,sans-serif;color:#8e919b}
  .rxl-steps b{color:#f2f2ef}
  .rxl-link{background:none;border:0;padding:0;color:#FF5A1F;font:600 14px Barlow,system-ui,sans-serif;cursor:pointer;text-decoration:underline;text-underline-offset:3px}
  .rxc{display:grid;gap:10px;font:14px Barlow,system-ui,sans-serif;color:#a9abb2}
  .rxc-stage{position:relative;width:100%;border-radius:12px;overflow:hidden;background:#0b0c0f;touch-action:none;user-select:none}
  .rxc-stage img{display:block;width:100%;height:auto;pointer-events:none;-webkit-user-drag:none}
  .rxc-box{position:absolute;border:2px solid #FF5A1F;box-shadow:0 0 0 9999px rgba(0,0,0,.6);cursor:move;border-radius:4px}
  .rxc-h{position:absolute;width:22px;height:22px;background:#FF5A1F;border:3px solid #fff;border-radius:50%}
  .rxc-h.tl{left:-12px;top:-12px;cursor:nwse-resize}.rxc-h.tr{right:-12px;top:-12px;cursor:nesw-resize}.rxc-h.bl{left:-12px;bottom:-12px;cursor:nesw-resize}.rxc-h.br{right:-12px;bottom:-12px;cursor:nwse-resize}
  .rxc-msg{display:flex;align-items:center;gap:8px}
  .rxc-dot{width:14px;height:14px;border:2px solid #3b3e47;border-top-color:#FF5A1F;border-radius:50%;animation:rxc .9s linear infinite;flex:none}
  @keyframes rxc{to{transform:rotate(360deg)}}
  @media (prefers-reduced-motion:reduce){.rxc-dot{animation-duration:3s}}`;
  let styled = false;
  const style = () => { if (styled) return; const s = document.createElement("style"); s.textContent = CSS; document.head.appendChild(s); styled = true; };
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  const XSVG = '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>';
  const edHead = (label, title) => `<div class="rxe-h"><div><small>${label}</small><b>${title}</b></div><button type="button" class="rxe-x" aria-label="Close">${XSVG}</button></div>`;

  // ---------- photo framing: drag to place your face, zoom, see phone and computer ----------
  window.rnxPhotoFramer = function (box, src, pos, title) {
    style();
    const st = { x: pos?.x ?? 50, y: pos?.y ?? 35, z: pos?.z ?? 1 };
    box.innerHTML = `<div class="rxf"><div class="rxf-views" role="radiogroup" aria-label="Preview on"><button type="button" role="radio" data-v="phone" aria-checked="true">Phone</button><button type="button" role="radio" data-v="desk" aria-checked="false">Computer</button></div>
      <div class="rxf-main" id="rxf-main"><img src="${esc(src)}" alt=""><div class="rxf-shade"></div><div class="rxf-name">${title || ""}</div><div class="rxf-hint">Drag to position</div></div>
      <div class="rxf-row"><span>Zoom</span><input type="range" min="1" max="2.5" step="0.01" value="${st.z}" aria-label="Zoom"></div></div>`;
    box.querySelectorAll(".rxf-views button").forEach(b => b.onclick = () => { box.querySelectorAll(".rxf-views button").forEach(x => x.setAttribute("aria-checked", x === b)); box.querySelector(".rxf-main").classList.toggle("desk", b.dataset.v === "desk"); });
    const imgs = box.querySelectorAll("img"), main = box.querySelector(".rxf-main"), range = box.querySelector("input[type=range]");
    const apply = () => imgs.forEach(im => { im.style.objectPosition = `${st.x}% ${st.y}%`; im.style.transform = `scale(${st.z})`; im.style.transformOrigin = `${st.x}% ${st.y}%`; });
    apply();
    let drag = null;
    main.addEventListener("pointerdown", e => { drag = { x: e.clientX, y: e.clientY, sx: st.x, sy: st.y }; main.setPointerCapture(e.pointerId); box.querySelector(".rxf-hint").style.display = "none"; });
    main.addEventListener("pointermove", e => {
      if (!drag) return; const r = main.getBoundingClientRect();
      st.x = clamp(drag.sx - (e.clientX - drag.x) / r.width * 100 * 1.6 / st.z, 0, 100);
      st.y = clamp(drag.sy - (e.clientY - drag.y) / r.height * 100 * 1.6 / st.z, 0, 100);
      apply();
    });
    const end = () => { drag = null; };
    main.addEventListener("pointerup", end); main.addEventListener("pointercancel", end);
    range.oninput = () => { st.z = +range.value; apply(); };
    return { get: () => ({ x: Math.round(st.x), y: Math.round(st.y), z: Math.round(st.z * 100) / 100 }) };
  };

  // full-screen photo editor on top of everything; resolves with the framing, or null if cancelled
  window.rnxPhotoEditor = function (src, pos, title) {
    style();
    return new Promise(res => {
      const ov = document.createElement("div"); ov.className = "rxe"; ov.setAttribute("role", "dialog"); ov.setAttribute("aria-modal", "true"); ov.setAttribute("aria-label", "Position your photo");
      ov.innerHTML = `<div class="rxe-back"></div><div class="rxe-box">${edHead("Your photo", "Position your photo")}<div class="rxe-b"><div id="rxe-fr"></div></div><div class="rxe-f"><button type="button" id="rxe-no">Cancel</button><button type="button" class="pri" id="rxe-ok">Done</button></div></div>`;
      document.body.appendChild(ov); requestAnimationFrame(() => requestAnimationFrame(() => ov.classList.add("on")));
      const fr = window.rnxPhotoFramer(ov.querySelector("#rxe-fr"), src, pos, title);
      ov.querySelector(".rxe-x").onclick = () => close(null);
      const close = v => { ov.classList.remove("on"); document.removeEventListener("keydown", key, true); setTimeout(() => ov.remove(), 300); res(v); };
      const key = e => { if (e.key === "Escape") { e.stopPropagation(); close(null); } };
      document.addEventListener("keydown", key, true);
      ov.querySelector("#rxe-no").onclick = () => close(null);
      ov.querySelector("#rxe-ok").onclick = () => close(fr.get());
      ov.querySelector("#rxe-ok").focus();
    });
  };
  // small preview of the framed photo
  window.rnxPhotoThumb = function (src, pos) {
    style();
    const p = pos || { x: 50, y: 35, z: 1 };
    return `<div class="rxt"><img src="${esc(src)}" alt="" style="object-position:${p.x}% ${p.y}%;transform:scale(${p.z || 1});transform-origin:${p.x}% ${p.y}%"></div>`;
  };

  // ---------- logo: AI finds it in a screenshot, you can adjust the box ----------
  async function small(file, max) {
    const img = await new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = URL.createObjectURL(file); });
    const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight)), cv = document.createElement("canvas");
    cv.width = Math.round(img.naturalWidth * k); cv.height = Math.round(img.naturalHeight * k);
    const cx = cv.getContext("2d"); cx.fillStyle = "#fff"; cx.fillRect(0, 0, cv.width, cv.height); cx.drawImage(img, 0, 0, cv.width, cv.height);
    return { img, cv, data: cv.toDataURL("image/jpeg", .85).split(",")[1] };
  }
  window.rnxLogoCropper = async function (box, file, getToken) {
    style();
    const { img, cv, data } = await small(file, 1024);
    const url = URL.createObjectURL(file);
    box.innerHTML = `<div class="rxc"><div class="rxc-stage"><img src="${url}" alt=""><div class="rxc-box" hidden><i class="rxc-h tl"></i><i class="rxc-h tr"></i><i class="rxc-h bl"></i><i class="rxc-h br"></i></div></div><div class="rxc-msg"><span class="rxc-dot"></span>Finding the logo…</div></div>`;
    const stage = box.querySelector(".rxc-stage"), frame = box.querySelector(".rxc-box"), msg = box.querySelector(".rxc-msg");
    const b = { l: .05, t: .05, r: .95, b: .95 };
    const draw = () => { frame.style.left = b.l * 100 + "%"; frame.style.top = b.t * 100 + "%"; frame.style.width = (b.r - b.l) * 100 + "%"; frame.style.height = (b.b - b.t) * 100 + "%"; };
    let changed = () => {};
    // the AI's box is approximate: push each side out until it no longer cuts through the logo
    const snap = () => {
      try {
        const W = cv.width, H = cv.height, px = cv.getContext("2d").getImageData(0, 0, W, H).data;
        const at = (x, y) => (y * W + x) * 4, edge = [];
        for (let x = 0; x < W; x += Math.max(1, W >> 6)) edge.push(at(x, 0), at(x, H - 1));
        for (let y = 0; y < H; y += Math.max(1, H >> 6)) edge.push(at(0, y), at(W - 1, y));
        const med = c => edge.map(i => px[i + c]).sort((a, z) => a - z)[edge.length >> 1];
        const bg = [med(0), med(1), med(2)];
        const ink = i => Math.abs(px[i] - bg[0]) + Math.abs(px[i + 1] - bg[1]) + Math.abs(px[i + 2] - bg[2]) > 60;
        let L = Math.floor(b.l * W), T = Math.floor(b.t * H), R = Math.min(W - 1, Math.ceil(b.r * W)), B = Math.min(H - 1, Math.ceil(b.b * H));
        const colHas = x => { for (let y = T; y <= B; y++) if (ink(at(x, y))) return true; return false; };
        const rowHas = y => { for (let x = L; x <= R; x++) if (ink(at(x, y))) return true; return false; };
        const maxGrow = Math.round(Math.max(W, H) * 0.25);
        for (let k = 0, moved = true; moved && k < 4; k++) {
          moved = false;
          for (let n = 0; n < maxGrow && L > 0 && colHas(L); n++) { L--; moved = true; }
          for (let n = 0; n < maxGrow && R < W - 1 && colHas(R); n++) { R++; moved = true; }
          for (let n = 0; n < maxGrow && T > 0 && rowHas(T); n++) { T--; moved = true; }
          for (let n = 0; n < maxGrow && B < H - 1 && rowHas(B); n++) { B++; moved = true; }
        }
        const m = 2;
        Object.assign(b, { l: clamp((L - m) / W, 0, 1), t: clamp((T - m) / H, 0, 1), r: clamp((R + 1 + m) / W, 0, 1), b: clamp((B + 1 + m) / H, 0, 1) });
      } catch (e) { /* keep the AI's box */ }
    };
    // ask the AI where the logo is
    try {
      const tok = await getToken();
      const r = await fetch(`${C.url}/functions/v1/logo-detect`, { method: "POST", headers: { apikey: C.key, Authorization: `Bearer ${tok}`, "Content-Type": "application/json" }, body: JSON.stringify({ image: data }) });
      const j = r.ok ? await r.json() : null;
      if (j && j.found && Array.isArray(j.box)) { const [l, t, rr, bb] = j.box.map(Number); if (rr > l && bb > t) { const pad = .015; Object.assign(b, { l: clamp(l - pad, 0, 1), t: clamp(t - pad, 0, 1), r: clamp(rr + pad, 0, 1), b: clamp(bb + pad, 0, 1) }); snap(); } msg.innerHTML = "Logo found. Adjust the box if needed."; }
      else msg.innerHTML = "Move the box around the logo.";
    } catch (e) { msg.innerHTML = "Move the box around the logo."; }
    frame.hidden = false; draw();
    // drag the box or its corners
    let d = null;
    frame.addEventListener("pointerdown", e => { e.preventDefault(); const h = e.target.classList.contains("rxc-h") ? [...e.target.classList].find(c => c.length === 2) : "move"; d = { h, x: e.clientX, y: e.clientY, s: { ...b } }; frame.setPointerCapture(e.pointerId); });
    frame.addEventListener("pointermove", e => {
      if (!d) return; const r = stage.getBoundingClientRect(), dx = (e.clientX - d.x) / r.width, dy = (e.clientY - d.y) / r.height, s = d.s, m = .03;
      if (d.h === "move") { const w = s.r - s.l, hh = s.b - s.t; b.l = clamp(s.l + dx, 0, 1 - w); b.t = clamp(s.t + dy, 0, 1 - hh); b.r = b.l + w; b.b = b.t + hh; }
      else { if (d.h.includes("l")) b.l = clamp(s.l + dx, 0, b.r - m); if (d.h.includes("r")) b.r = clamp(s.r + dx, b.l + m, 1); if (d.h.includes("t")) b.t = clamp(s.t + dy, 0, b.b - m); if (d.h.includes("b")) b.b = clamp(s.b + dy, b.t + m, 1); }
      draw();
    });
    const up = () => { if (d) { d = null; changed(); } };
    frame.addEventListener("pointerup", up); frame.addEventListener("pointercancel", up);
    return {
      onChange(fn) { changed = fn; },
      // the cropped part, full resolution
      async crop() {
        const W = img.naturalWidth, H = img.naturalHeight, sx = b.l * W, sy = b.t * H, sw = Math.max(1, (b.r - b.l) * W), sh = Math.max(1, (b.b - b.t) * H);
        // drawings (SVG) are redrawn sharp at a good size instead of their small native size
        const up = /svg/.test(file.type || "") ? Math.max(1, 1600 / Math.max(sw, sh)) : 1;
        const cv = document.createElement("canvas"); cv.width = Math.round(sw * up); cv.height = Math.round(sh * up);
        cv.getContext("2d").drawImage(img, sx, sy, sw, sh, 0, 0, cv.width, cv.height);
        return await new Promise(r => cv.toBlob(r, "image/png"));
      }
    };
  };

  // ---------- a logo prepared without the editor: the AI frames it (never cutting it), then cut out and trimmed ----------
  window.rnxAutoLogo = async function (file, getToken, mode) {
    mode = mode || "original";
    const c = await window.rnxLogoCropper(document.createElement("div"), file, getToken);
    const src = await window.rnxProcessLogo(await c.crop(), "original");
    return { src, out: mode === "original" ? src : await window.rnxProcessLogo(src, mode), mode };
  };
  // ---------- logos: cut out (background removed), trimmed, in original colours, white or black ----------
  window.rnxProcessLogo = async function (file, mode) {
    const img = await new Promise((res, rej) => { const im = new Image(); im.crossOrigin = "anonymous"; im.onload = () => res(im); im.onerror = rej; im.src = typeof file === "string" ? file : URL.createObjectURL(file); });
    const iw = img.naturalWidth || img.width || 900, ih = img.naturalHeight || img.height || 300;
    const k = /svg/.test((file && file.type) || "") || (typeof file === "string" && /\.svg(\?|$)/i.test(file)) ? 1200 / Math.max(iw, ih) : Math.min(1, 1200 / Math.max(iw, ih));
    const w = Math.max(1, Math.round(iw * k)), h = Math.max(1, Math.round(ih * k));
    const cv = document.createElement("canvas"); cv.width = w; cv.height = h;
    const cx = cv.getContext("2d", { willReadFrequently: true }); cx.drawImage(img, 0, 0, w, h);
    const d = cx.getImageData(0, 0, w, h), px = d.data;
    const border = []; const pick = (x, y) => { const i = (y * w + x) * 4; border.push([px[i], px[i + 1], px[i + 2], px[i + 3]]); };
    for (let x = 0; x < w; x += Math.max(1, w >> 6)) { pick(x, 0); pick(x, h - 1); }
    for (let y = 0; y < h; y += Math.max(1, h >> 6)) { pick(0, y); pick(w - 1, y); }
    const transparentBg = border.filter(b => b[3] < 40).length > border.length * 0.5;
    const solid = border.filter(b => b[3] >= 40), med = j => solid.map(b => b[j]).sort((a, c) => a - c)[solid.length >> 1] || 0;
    const bg = [med(0), med(1), med(2)];
    let minX = w, minY = h, maxX = -1, maxY = -1;
    for (let i = 0; i < px.length; i += 4) {
      const a = transparentBg ? px[i + 3] : Math.max(0, Math.min(255, (Math.hypot(px[i] - bg[0], px[i + 1] - bg[1], px[i + 2] - bg[2]) - 20) * 4)) * (px[i + 3] / 255);
      if (mode === "white") px[i] = px[i + 1] = px[i + 2] = 255;
      else if (mode === "black") px[i] = px[i + 1] = px[i + 2] = 0;
      px[i + 3] = a;
      if (a > 24) { const n = i >> 2, x = n % w, y = (n / w) | 0; if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
    }
    cx.putImageData(d, 0, 0);
    if (maxX < minX) throw new Error("No logo found in this picture");
    const pad = Math.round(Math.max(maxX - minX, maxY - minY) * 0.03);
    const ox = Math.max(0, minX - pad), oy = Math.max(0, minY - pad), ow = Math.min(w, maxX + pad + 1) - ox, oh = Math.min(h, maxY + pad + 1) - oy;
    const out = document.createElement("canvas"); out.width = ow; out.height = oh;
    out.getContext("2d").drawImage(cv, ox, oy, ow, oh, 0, 0, ow, oh);
    return await new Promise(r => out.toBlob(r, "image/png"));
  };

  // ---------- personal logo: small box like the photo, and a full editor (frame it, colour, phone / computer preview) ----------
  // small preview: the logo on top of the athlete's photo, or an empty "Your logo" box
  window.rnxLogoThumb = function (logo, label) {
    style(); label = label || "Your logo";
    return logo ? `<div class="rxt rxt-lg"><img class="rxt-logo" src="${esc(logo)}" alt="${esc(label)}"></div>`
      : `<div class="rxt"><span class="rxt-empty"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l2.6 5.6 6 .8-4.4 4.2 1.1 6L12 16.8 6.7 19.6l1.1-6L3.4 9.4l6-.8z"/></svg>${esc(label)}</span></div>`;
  };
  // opts: { file (new picture) | src (cut-out original already saved) | current (what fans see now), mode, photo, pos, title, getToken }
  // resolves with { src: Blob|null (new cut-out original), out: Blob, mode } or null if cancelled
  window.rnxLogoEditor = function (opts) {
    style();
    return new Promise(res => {
      const st = { mode: opts.mode || "original", src: null, out: null, cropper: null, seq: 0, busy: false, view: "phone" };
      const p = opts.pos || { x: 50, y: 35, z: 1 };
      const ov = document.createElement("div"); ov.className = "rxe"; ov.setAttribute("role", "dialog"); ov.setAttribute("aria-modal", "true"); ov.setAttribute("aria-labelledby", "rxl-h");
      ov.innerHTML = `<div class="rxe-back"></div><div class="rxe-box">${edHead(opts.label || "Your logo", opts.heading || (opts.file ? "Add your logo" : "Adjust your logo")).replace("<b>", '<b id="rxl-h">')}
        <div class="rxe-b rxl-b${opts.file ? " fr" : ""}">
          ${opts.file ? `<div id="rxl-frame"><div class="rxe-lbl">1 · Frame ${opts.partners ? "the" : "your"} logo</div><div id="rxl-crop"></div></div>` : ""}
          <div><div class="rxe-lbl">${opts.file ? "2 · " : ""}Colour</div><div class="rxl-seg" role="radiogroup" aria-label="Logo colour">${[["original", "Original", "conic-gradient(#FF5A1F,#2f7bff,#5fcf6e,#FF5A1F)"], ["white", "White", "#fff"], ["black", "Black", "#000"]].map(([m, l, c]) => `<button type="button" role="radio" data-m="${m}" aria-checked="${st.mode === m}"><i style="background:${c}"></i>${l}</button>`).join("")}</div></div>
          <div><div style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:10px"><div class="rxe-lbl" style="margin:0">${opts.file ? "3 · " : ""}Preview</div><div class="rxf-views" role="radiogroup" aria-label="Preview on" style="margin:0"><button type="button" role="radio" data-v="phone" aria-checked="true">Phone</button><button type="button" role="radio" data-v="desk" aria-checked="false">Computer</button></div></div>
            ${opts.partners ? `<div class="rxl-stage pt" id="rxl-stage"><div class="pt-bar"><span>${esc(opts.barLabel || "Partners")}</span>${opts.partners.map(u => u === "me" ? `<img class="lg" alt="" hidden>` : `<img src="${esc(u)}" alt="">`).join("")}</div></div>` : `<div class="rxl-stage" id="rxl-stage">${opts.photo ? `<img class="ph" src="${esc(opts.photo)}" alt="" style="object-position:${p.x}% ${p.y}%;transform:scale(${p.z || 1});transform-origin:${p.x}% ${p.y}%">` : ""}<img class="lg" alt="" hidden><div class="nm">${opts.title || ""}</div></div>`}</div>
        </div>
        <div class="rxe-f"><button type="button" id="rxl-no">Cancel</button><button type="button" class="pri" id="rxl-ok" disabled>Done</button></div></div>`;
      document.body.appendChild(ov); requestAnimationFrame(() => requestAnimationFrame(() => ov.classList.add("on")));
      const stage = ov.querySelector("#rxl-stage"), lg = stage.querySelector(".lg"), ok = ov.querySelector("#rxl-ok");
      const busy = msg => { stage.querySelector(".busy")?.remove(); if (msg) stage.insertAdjacentHTML("beforeend", `<div class="busy">${msg}</div>`); };
      const render = async () => {
        const my = ++st.seq; st.busy = true; ok.disabled = true; busy("Cleaning up your logo…");
        try {
          if (opts.file) { const cut = st.cropper ? await st.cropper.crop() : opts.file; st.src = await rnxProcessLogo(cut, "original"); }
          const base = st.src || opts.src || opts.current;
          const out = await rnxProcessLogo(base, st.mode);
          if (my !== st.seq) return;
          st.out = out; lg.src = URL.createObjectURL(out); lg.hidden = false; busy(""); ok.disabled = false;
        } catch (e) { if (my === st.seq) busy(e.message === "No logo found in this picture" ? "No logo found here: move the box around your logo" : "Couldn't read this picture. Try another one."); }
        finally { if (my === st.seq) st.busy = false; }
      };
      const close = v => { ov.classList.remove("on"); document.removeEventListener("keydown", key, true); setTimeout(() => ov.remove(), 300); res(v); };
      const key = e => {
        if (e.key === "Escape") { e.stopPropagation(); close(null); }
        if (e.key === "Tab") { const f = [...ov.querySelectorAll("button:not([disabled]),[tabindex='0']")]; const i = f.indexOf(document.activeElement); if (e.shiftKey && i <= 0) { e.preventDefault(); f[f.length - 1].focus(); } else if (!e.shiftKey && i === f.length - 1) { e.preventDefault(); f[0].focus(); } }
      };
      document.addEventListener("keydown", key, true);
      ov.querySelector(".rxe-x").onclick = () => close(null);
      ov.querySelector("#rxl-no").onclick = () => close(null);
      ok.onclick = () => { if (!st.busy && st.out) close({ src: opts.file ? st.src : null, out: st.out, mode: st.mode }); };
      ov.querySelectorAll(".rxl-seg button").forEach(b => b.onclick = () => { st.mode = b.dataset.m; ov.querySelectorAll(".rxl-seg button").forEach(x => x.setAttribute("aria-checked", x === b)); render(); });
      ov.querySelectorAll(".rxf-views button").forEach(b => b.onclick = () => { ov.querySelectorAll(".rxf-views button").forEach(x => x.setAttribute("aria-checked", x === b)); stage.classList.toggle("desk", b.dataset.v === "desk"); });
      ov.querySelector(".rxe-x").focus({ preventScroll: true });
      (async () => {
        if (opts.file && window.rnxLogoCropper) { st.cropper = await rnxLogoCropper(ov.querySelector("#rxl-crop"), opts.file, opts.getToken); st.cropper.onChange(render); }
        render();
      })();
    });
  };

  // the phone keyboard never hides what you're typing in:
  // sheets sit just above the keyboard, and the focused box scrolls into view
  (function keyboard() {
    if (window.__rnxKb) return; window.__rnxKb = 1;
    const vv = window.visualViewport, root = document.documentElement;
    const upd = () => {
      const h = vv ? vv.height : innerHeight, k = vv ? Math.max(0, Math.round(innerHeight - vv.height - vv.offsetTop)) : 0;
      root.style.setProperty("--kb", (k > 60 ? k : 0) + "px"); root.style.setProperty("--vvh", Math.round(h) + "px");
      root.classList.toggle("kb-open", k > 60);
    };
    if (vv) { vv.addEventListener("resize", upd); vv.addEventListener("scroll", upd); }
    upd();
    const typing = el => el && el.matches && el.matches('input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([type=file]):not([type=color]),textarea,select,[contenteditable="true"]');
    const show = el => {
      if (!el || !el.isConnected || document.activeElement !== el) return;
      const sm = matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
      // inside a small form (box + its buttons): show the whole form when it fits, else the box
      const box = el.closest(".rx-comp,[data-reveal]"), sc = el.closest(".rx-sh-b,.rxe-b,[data-scroll]");
      if (box && sc && box.offsetHeight <= sc.clientHeight - 8) {
        const r = box.getBoundingClientRect(), v = sc.getBoundingClientRect();
        if (r.bottom > v.bottom - 6) sc.scrollBy({ top: r.bottom - v.bottom + 10, behavior: sm });
        else if (r.top < v.top + 6) sc.scrollBy({ top: r.top - v.top - 10, behavior: sm });
        return;
      }
      el.scrollIntoView({ block: "center", behavior: sm });
    };
    document.addEventListener("focusin", e => {
      const el = e.target; if (!typing(el)) return;
      setTimeout(() => show(el), 320);
      if (vv) { const once = () => { vv.removeEventListener("resize", once); setTimeout(() => show(el), 60); }; vv.addEventListener("resize", once); setTimeout(() => vv.removeEventListener("resize", once), 1200); }
    });
    // something opening right under a tap (a calendar, a list): bring it into view too
    window.rnxReveal = el => setTimeout(() => el && el.isConnected && el.scrollIntoView({ block: "nearest", behavior: "smooth" }), 60);
  })();
})();
