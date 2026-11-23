// Racenxt shared UI pieces: photo framing (drag + zoom with live previews) and logo cropping (AI finds the logo, you adjust).
(function () {
  const C = window.RNX_CONFIG;
  const CSS = `
  .rxf{display:grid;gap:12px;font:14px Barlow,system-ui,sans-serif;color:#a9abb2}
  .rxf-main{position:relative;width:100%;max-width:340px;margin:0 auto;aspect-ratio:9/10;border-radius:16px;overflow:hidden;background:#000;touch-action:none;cursor:grab;border:1px solid #3b3e47}
  .rxf-main:active{cursor:grabbing}
  .rxf img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;user-select:none;-webkit-user-drag:none;pointer-events:none}
  .rxf-shade{position:absolute;left:0;right:0;bottom:0;height:38%;background:linear-gradient(to top,rgba(0,0,0,.75),transparent);pointer-events:none}
  .rxf-name{position:absolute;left:14px;bottom:12px;font:700 22px 'Barlow Condensed',sans-serif;color:#fff;text-transform:uppercase;pointer-events:none}
  .rxf-name em{font-style:normal;color:#FF5A1F}
  .rxf-hint{position:absolute;left:50%;top:12px;transform:translateX(-50%);background:rgba(0,0,0,.6);color:#fff;border-radius:999px;padding:6px 12px;font-size:13px;pointer-events:none;white-space:nowrap}
  .rxf-row{display:flex;align-items:center;gap:12px}
  .rxf-row input[type=range]{flex:1;accent-color:#FF5A1F;min-height:0;padding:0;border:0;background:none}
  .rxf-desk{position:relative;width:100%;max-width:340px;margin:0 auto;aspect-ratio:16/8.6;border-radius:12px;overflow:hidden;background:#000;border:1px solid #3b3e47}
  .rxf-lbl{text-align:center;font-size:12.5px;color:#7d808a}
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

  // ---------- photo framing: drag to place your face, zoom, see phone and computer ----------
  window.rnxPhotoFramer = function (box, src, pos, title) {
    style();
    const st = { x: pos?.x ?? 50, y: pos?.y ?? 35, z: pos?.z ?? 1 };
    box.innerHTML = `<div class="rxf"><div class="rxf-main" id="rxf-main"><img src="${esc(src)}" alt=""><div class="rxf-shade"></div><div class="rxf-name">${title || ""}</div><div class="rxf-hint">Drag to position</div></div>
      <div class="rxf-row"><span>Zoom</span><input type="range" min="1" max="2.5" step="0.01" value="${st.z}" aria-label="Zoom"></div>
      <div class="rxf-desk"><img src="${esc(src)}" alt=""><div class="rxf-shade"></div></div><div class="rxf-lbl">On a computer</div></div>`;
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
})();
