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
  .rxe-box{position:relative;width:100%;max-width:540px;max-height:96dvh;background:#16181d;border:1px solid #2c2f37;border-bottom:0;border-radius:22px 22px 0 0;display:flex;flex-direction:column;color:#f2f2ef;font:16px Barlow,system-ui,sans-serif;box-shadow:0 -18px 50px rgba(0,0,0,.5);transform:translateY(100%);transition:transform .32s cubic-bezier(.2,.85,.25,1)}
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
    return { img, data: cv.toDataURL("image/jpeg", .85).split(",")[1] };
  }
  window.rnxLogoCropper = async function (box, file, getToken) {
    style();
    const { img, data } = await small(file, 1024);
    const url = URL.createObjectURL(file);
    box.innerHTML = `<div class="rxc"><div class="rxc-stage"><img src="${url}" alt=""><div class="rxc-box" hidden><i class="rxc-h tl"></i><i class="rxc-h tr"></i><i class="rxc-h bl"></i><i class="rxc-h br"></i></div></div><div class="rxc-msg"><span class="rxc-dot"></span>Finding the logo…</div></div>`;
    const stage = box.querySelector(".rxc-stage"), frame = box.querySelector(".rxc-box"), msg = box.querySelector(".rxc-msg");
    const b = { l: .05, t: .05, r: .95, b: .95 };
    const draw = () => { frame.style.left = b.l * 100 + "%"; frame.style.top = b.t * 100 + "%"; frame.style.width = (b.r - b.l) * 100 + "%"; frame.style.height = (b.b - b.t) * 100 + "%"; };
    let changed = () => {};
    // ask the AI where the logo is
    try {
      const tok = await getToken();
      const r = await fetch(`${C.url}/functions/v1/logo-detect`, { method: "POST", headers: { apikey: C.key, Authorization: `Bearer ${tok}`, "Content-Type": "application/json" }, body: JSON.stringify({ image: data }) });
      const j = r.ok ? await r.json() : null;
      if (j && j.found && Array.isArray(j.box)) { const [l, t, rr, bb] = j.box.map(Number); if (rr > l && bb > t) { const pad = .015; Object.assign(b, { l: clamp(l - pad, 0, 1), t: clamp(t - pad, 0, 1), r: clamp(rr + pad, 0, 1), b: clamp(bb + pad, 0, 1) }); } msg.innerHTML = "Logo found. Adjust the box if needed."; }
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
        const W = img.naturalWidth, H = img.naturalHeight, sx = Math.round(b.l * W), sy = Math.round(b.t * H), sw = Math.max(1, Math.round((b.r - b.l) * W)), sh = Math.max(1, Math.round((b.b - b.t) * H));
        const cv = document.createElement("canvas"); cv.width = sw; cv.height = sh;
        cv.getContext("2d").drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
        return await new Promise(r => cv.toBlob(r, "image/png"));
      }
    };
  };

  // ---------- logos: cut out (background removed), trimmed, in original colours, white or black ----------
  window.rnxProcessLogo = async function (file, mode) {
    const img = await new Promise((res, rej) => { const im = new Image(); im.crossOrigin = "anonymous"; im.onload = () => res(im); im.onerror = rej; im.src = typeof file === "string" ? file : URL.createObjectURL(file); });
    const iw = img.naturalWidth || img.width || 900, ih = img.naturalHeight || img.height || 300;
    const k = /svg/.test((file && file.type) || "") ? 1200 / Math.max(iw, ih) : Math.min(1, 1200 / Math.max(iw, ih));
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
  window.rnxLogoThumb = function (logo) {
    style();
    return logo ? `<div class="rxt rxt-lg"><img class="rxt-logo" src="${esc(logo)}" alt="Your logo"></div>`
      : `<div class="rxt"><span class="rxt-empty"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l2.6 5.6 6 .8-4.4 4.2 1.1 6L12 16.8 6.7 19.6l1.1-6L3.4 9.4l6-.8z"/></svg>Your logo</span></div>`;
  };
  // opts: { file (new picture) | src (cut-out original already saved) | current (what fans see now), mode, photo, pos, title, getToken }
  // resolves with { src: Blob|null (new cut-out original), out: Blob, mode } or null if cancelled
  window.rnxLogoEditor = function (opts) {
    style();
    return new Promise(res => {
      const st = { mode: opts.mode || "original", src: null, out: null, cropper: null, seq: 0, busy: false, view: "phone" };
      const p = opts.pos || { x: 50, y: 35, z: 1 };
      const ov = document.createElement("div"); ov.className = "rxe"; ov.setAttribute("role", "dialog"); ov.setAttribute("aria-modal", "true"); ov.setAttribute("aria-labelledby", "rxl-h");
      ov.innerHTML = `<div class="rxe-back"></div><div class="rxe-box">${edHead("Your logo", opts.file ? "Add your logo" : "Adjust your logo").replace("<b>", '<b id="rxl-h">')}
        <div class="rxe-b rxl-b">
          ${opts.file ? `<div id="rxl-frame"><div class="rxe-lbl">1 · Frame your logo</div><div id="rxl-crop"></div></div>` : ""}
          <div><div class="rxe-lbl">${opts.file ? "2 · " : ""}Colour</div><div class="rxl-seg" role="radiogroup" aria-label="Logo colour">${[["original", "Original", "conic-gradient(#FF5A1F,#2f7bff,#5fcf6e,#FF5A1F)"], ["white", "White", "#fff"], ["black", "Black", "#000"]].map(([m, l, c]) => `<button type="button" role="radio" data-m="${m}" aria-checked="${st.mode === m}"><i style="background:${c}"></i>${l}</button>`).join("")}</div></div>
          <div><div style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:10px"><div class="rxe-lbl" style="margin:0">${opts.file ? "3 · " : ""}Preview</div><div class="rxf-views" role="radiogroup" aria-label="Preview on" style="margin:0"><button type="button" role="radio" data-v="phone" aria-checked="true">Phone</button><button type="button" role="radio" data-v="desk" aria-checked="false">Computer</button></div></div>
            <div class="rxl-stage" id="rxl-stage">${opts.photo ? `<img class="ph" src="${esc(opts.photo)}" alt="" style="object-position:${p.x}% ${p.y}%;transform:scale(${p.z || 1});transform-origin:${p.x}% ${p.y}%">` : ""}<img class="lg" alt="" hidden><div class="nm">${opts.title || ""}</div></div></div>
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
})();
