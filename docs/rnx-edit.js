// Racenxt: edit mode on the Race Hub page itself. Fans see the exact same page; the owner (signed in) gets
// small edit controls on top of it. Every change is saved to the database and the page reloads with it.
(function () {
  const C = window.RNX_CONFIG;
  const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
  const YEAR = new Date().getFullYear(), TODAY = new Date().toISOString().slice(0, 10);
  const COLORS = ["#FF5A1F", "#E8352F", "#F2B20F", "#5FCF6E", "#1FB5A8", "#2F80ED", "#7B61FF", "#D946EF", "#F4F4F2", "#8A8D96"];
  const VFIELDS = [["engine", "Engine"], ["hybrid", "Hybrid system"], ["power", "Power"], ["max_rpm", "Max rpm"], ["gearbox", "Gearbox"], ["weight", "Weight"], ["dimensions", "Dimensions"]];
  const DRIVE = { awd: "AWD", rwd: "RWD", fwd: "FWD" };
  const PEN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M14 6l4 4"/></svg>';
  const EYE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>';
  const PLUS = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>';
  const CHEV = '<svg class="rx-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg>';
  const FLAG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 21V4h11l-1.5 4L16 12H5"/></svg>';
  const LINK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/></svg>';
  const USER = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/></svg>';
  const OUT = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 4h4v16h-4M10 17l5-5-5-5M15 12H3"/></svg>';
  const CAL = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/></svg>';
  const STAR = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.8L12 16.8l-5.2 2.8 1-5.8-4.3-4.1 5.9-.8z"/></svg>';
  const CAM = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg>';

  // ---------- session ----------
  // One session for the whole site (admin, sign-up, the athlete's page), renewed by one page at a time.
  // Two copies of the same session would make the server think a key was stolen and sign the person out.
  const SKEY = "rnx_sess";
  const S = {
    get(){ try {
      let s = JSON.parse(localStorage.getItem(SKEY) || "null");
      if (!s){ // older copies: keep the most recent one only
        s = ["rnx_user_sess", "rnx_admin_sess"].map(k => { try { return JSON.parse(localStorage.getItem(k) || "null"); } catch(e){ return null; } }).filter(Boolean).sort((a, b) => b.expires_at - a.expires_at)[0] || null;
        if (s) localStorage.setItem(SKEY, JSON.stringify(s));
      }
      localStorage.removeItem("rnx_user_sess"); localStorage.removeItem("rnx_admin_sess");
      return s;
    } catch(e){ return null; } },
    set(v){ try { v ? localStorage.setItem(SKEY, JSON.stringify(v)) : localStorage.removeItem(SKEY); } catch(e){} }
  };
  let refreshing = null;
  async function token(){
    const s = S.get(); if (!s) return null;
    if (s.expires_at - 60 > Date.now()/1000) return s.access_token;
    if (!refreshing) refreshing = (async () => {
      const run = async () => {
        const cur = S.get(); if (!cur) return null;
        if (cur.expires_at - 60 > Date.now()/1000) return cur.access_token; // another tab already renewed it
        let r; try { r = await fetch(`${C.url}/auth/v1/token?grant_type=refresh_token`, { method:"POST", headers:{ apikey:C.key, "Content-Type":"application/json" }, body: JSON.stringify({ refresh_token: cur.refresh_token }) }); } catch(e){ return null; } // offline: stay signed in
        if (!r.ok){ const again = S.get(); if (again && again.refresh_token !== cur.refresh_token) return again.access_token; if (r.status === 400 || r.status === 401 || r.status === 403) S.set(null); return null; }
        const j = await r.json(); const n = { access_token:j.access_token, refresh_token:j.refresh_token, expires_at: Date.now()/1000 + j.expires_in }; S.set(n); return n.access_token;
      };
      try { return navigator.locks ? await navigator.locks.request("rnx-refresh", run) : await run(); } finally { setTimeout(() => { refreshing = null; }, 0); }
    })();
    return refreshing;
  }
  async function api(path, opt = {}) {
    const t = await token();
    // never write anonymously: the database would ignore it and the page would wrongly say "saved"
    if (!t && opt.method && opt.method !== "GET") throw new Error("You've been signed out. Sign in again, then redo this change.");
    const r = await fetch(`${C.url}/rest/v1/${path}`, { ...opt, headers: { apikey: C.key, Authorization: `Bearer ${t || C.key}`, "Content-Type": "application/json", Prefer: "return=representation", ...(opt.headers || {}) } });
    if (!r.ok) { let m = r.status + ""; try { const j = await r.json(); m = j.message || j.hint || m; } catch (e) {} throw new Error(m); }
    const txt = await r.text(); return txt ? JSON.parse(txt) : null;
  }
  const ins = (t, row) => api(t, { method: "POST", body: JSON.stringify(row) });
  const upd = async (t, id, row) => { const r = await api(`${t}?id=eq.${id}`, { method: "PATCH", body: JSON.stringify(row) }); if (Array.isArray(r) && !r.length) throw new Error("Nothing was changed. Reload the page and try again."); return r; };
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
  // the file input stays in the page while the picker is open (iPhone Safari drops it otherwise)
  const pickFile = () => new Promise(res => {
    const i = document.createElement("input"); i.type = "file"; i.accept = "image/*";
    i.style.cssText = "position:fixed;left:-9999px;top:0;width:1px;height:1px;opacity:0";
    document.body.appendChild(i);
    let done = false; const fin = f => { if (done) return; done = true; res(f); setTimeout(() => i.remove(), 1000); };
    i.addEventListener("change", () => fin(i.files[0] || null));
    i.addEventListener("cancel", () => fin(null));
    i.click();
  });
  // resize when the browser can read the picture; otherwise send it as it is
  const safePicture = async (f, sq, max) => { try { return await picture(f, sq, max); } catch (e) { return f; } };
  async function save(fn, msg) {
    busy(true);
    try { await fn(); busy(false, msg || "Saved"); setTimeout(() => location.reload(), 500); return true; }
    catch (e) { busy(false); alert("Couldn't save: " + e.message); return false; }
  }

  // ---------- styles (prefixed so they never touch the page's own) ----------
  const CSS = `
  body.rx-view .rx-only{display:none!important}
  .rx-app{position:fixed;top:0;left:0;right:0;z-index:900;padding-top:env(safe-area-inset-top);background:rgba(11,12,15,.82);backdrop-filter:saturate(1.4) blur(14px);-webkit-backdrop-filter:saturate(1.4) blur(14px);border-bottom:1px solid rgba(255,255,255,.07);font-family:Barlow,system-ui,sans-serif;color:#f4f4f2}
  .rx-app-in{max-width:980px;margin:0 auto;height:58px;padding:0 14px;display:flex;align-items:center;gap:10px}
  .rx-brand{font:800 italic 22px 'Barlow Condensed',sans-serif;letter-spacing:-.3px}
  .rx-brand .x{background:linear-gradient(90deg,#FF5A1F 50%,#f4f4f2 50%);-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;padding-right:1px}
  .rx-status{display:inline-flex;align-items:center;gap:6px;height:26px;padding:0 10px;border-radius:999px;border:1px solid rgba(242,178,15,.35);color:#f2b20f;font:600 12.5px Barlow,system-ui,sans-serif}
  .rx-status i{width:7px;height:7px;border-radius:50%;background:currentColor}
  .rx-status.live{border-color:rgba(95,207,110,.4);color:#5fcf6e}
  .rx-icon-b{height:38px;padding:0 12px;border-radius:12px;border:1px solid #33363d;background:#17181d;color:#f4f4f2;display:inline-flex;align-items:center;gap:7px;font:600 14px Barlow,system-ui,sans-serif;cursor:pointer}
  .rx-icon-b svg{width:18px;height:18px}
  .rx-icon-b:hover{border-color:#50545e}
  @media (max-width:420px){.rx-icon-b span{display:none}.rx-icon-b{width:38px;padding:0;justify-content:center}}
  .rx-av-b{width:40px;height:40px;padding:0;border-radius:50%;border:2px solid #33363d;background:none;cursor:pointer;overflow:hidden}
  .rx-av-b[aria-expanded="true"],.rx-av-b:hover{border-color:#FF5A1F}
  .rx-av{display:flex;width:100%;height:100%;border-radius:50%;background:#22242b center/cover no-repeat;align-items:center;justify-content:center;font:700 14px Barlow,system-ui,sans-serif;color:#cfd0d4}
  .rx-av.lg{width:46px;height:46px;flex:none;font-size:16px}
  body.rx-edit{padding-top:calc(58px + env(safe-area-inset-top))}
  body.rx-view{padding-top:0}
  body.rx-view .rx-app{display:none}
  .rx-exit{display:none;position:fixed;left:50%;bottom:calc(62px + env(safe-area-inset-bottom));transform:translateX(-50%);z-index:900;align-items:center;gap:8px;height:42px;padding:0 16px;border-radius:999px;border:1px solid #3b3e47;background:rgba(17,18,22,.9);backdrop-filter:blur(10px);color:#a9abb2;font:500 14px Barlow,system-ui,sans-serif;cursor:pointer;box-shadow:0 10px 30px rgba(0,0,0,.5);white-space:nowrap}
  .rx-exit b{color:#FF5A1F;font-weight:700}
  .rx-exit svg{width:17px;height:17px}
  body.rx-view .rx-exit{display:inline-flex}
  .rx-edit-b{position:relative;z-index:6;margin:0 0 12px;display:inline-flex;align-items:center;gap:8px;height:40px;padding:0 15px 0 12px;border-radius:999px;border:1px solid rgba(255,255,255,.18);background:rgba(11,12,15,.62);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);color:#fff;font:600 14px Barlow,system-ui,sans-serif;cursor:pointer;box-shadow:0 6px 18px rgba(0,0,0,.35)}
  .rx-edit-b svg{width:16px;height:16px;color:#FF5A1F}
  .rx-edit-b:hover{background:rgba(11,12,15,.8)}
  .rx-season{margin:18px 0 8px;border-radius:18px;background:#14151a;border:1px solid #2a2c33;overflow:hidden;font-family:Barlow,system-ui,sans-serif;color:#f4f4f2}
  .rx-season-h{display:flex;align-items:center;gap:12px;padding:16px}
  .rx-season-h > div{flex:1;display:grid}
  .rx-season-h b{font:700 19px 'Barlow Condensed',sans-serif;text-transform:uppercase;letter-spacing:.03em}
  .rx-season-h span{font-size:13.5px;color:#8e919b}
  .rx-season-h .rx-b svg{width:16px;height:16px}
  .rx-rows{border-top:1px solid #23252b}
  .rx-row{display:grid;grid-template-columns:64px 1fr auto 18px;gap:12px;align-items:center;width:100%;padding:12px 16px;border:0;border-bottom:1px solid #23252b;background:none;color:inherit;cursor:pointer;text-align:left;position:relative;font:inherit}
  .rx-row:last-child{border-bottom:0}
  .rx-row::before{content:"";position:absolute;left:0;top:12px;bottom:12px;width:3px;border-radius:0 3px 3px 0;background:var(--c)}
  .rx-row:hover{background:#181a20}
  .rx-row-lg{height:32px;width:64px;min-width:0;overflow:hidden;display:flex;align-items:center;justify-content:center}
  .rx-row-lg img{max-width:60px;max-height:32px;object-fit:contain}
  .rx-lgt{display:block;max-width:64px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font:700 13px 'Barlow Condensed';color:#a9abb2;border:1px solid #3b3e47;border-radius:7px;padding:4px 6px;box-sizing:border-box}
  .rx-row-t{display:grid;min-width:0}
  .rx-row-t b{font-size:15px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .rx-row-t small{font-size:13.5px;color:#a9abb2;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .rx-row-t small.warn{color:#f2b20f}
  .rx-row-y{font:700 14px 'Barlow Condensed';color:#7d808a}
  .rx-chev{width:18px;height:18px;color:#5d6069}
  .rx-menu{position:fixed;right:max(14px, calc((100vw - 980px) / 2 + 14px));top:calc(64px + env(safe-area-inset-top));z-index:960;width:min(300px,calc(100vw - 28px));background:#17181d;border:1px solid #33363d;border-radius:16px;padding:6px;font:15px Barlow,system-ui,sans-serif;color:#f4f4f2;box-shadow:0 20px 50px rgba(0,0,0,.55)}
  .rx-menu-h{display:flex;align-items:center;gap:12px;padding:10px 10px 12px}
  .rx-menu-h > div{display:grid;min-width:0}
  .rx-menu-h b{font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .rx-menu-h small{color:#7d808a;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .rx-menu button{display:flex;align-items:center;gap:12px;width:100%;padding:11px 10px;border:0;background:none;color:inherit;border-radius:10px;cursor:pointer;text-align:left;font:inherit}
  .rx-menu button svg{width:18px;height:18px;color:#a9abb2;flex:none}
  .rx-menu button:hover,.rx-menu button:focus-visible{background:#202228;outline:none}
  .rx-menu .rx-out,.rx-menu .rx-out svg{color:#ef5a52}
  .rx-menu hr{border:0;border-top:1px solid #2a2c33;margin:6px 4px}
  .rx-menu-l{font:700 11px Barlow;letter-spacing:.12em;text-transform:uppercase;color:#7d808a;padding:8px 10px 4px}
  .rx-season + .rx-season{margin-top:10px}
  .rx-row-d{font:700 15px 'Barlow Condensed';color:#f4f4f2;display:grid;line-height:1.1}
  .rx-row-d small{font-size:12px;color:#7d808a}
  .rx-prow{display:flex;align-items:center;border-bottom:1px solid #23252b}
  .rx-prow:last-child{border-bottom:0}
  .rx-prow-main{flex:1;min-width:0;display:grid;grid-template-columns:96px 1fr;gap:12px;align-items:center;padding:12px 6px 12px 16px;border:0;background:none;color:inherit;cursor:pointer;text-align:left;font:inherit}
  .rx-prow-main:hover{background:#181a20}
  .rx-plogo{height:40px;border-radius:8px;background:#0b0c0f;display:flex;align-items:center;justify-content:center;padding:6px}
  .rx-plogo img{max-width:100%;max-height:28px;object-fit:contain}
  .rx-ord{display:grid;gap:2px;padding:0 12px 0 4px}
  .rx-ord button{width:30px;height:22px;border:1px solid #33363d;border-radius:6px;background:#17181d;color:#a9abb2;font-size:9px;cursor:pointer}
  .rx-ord button:disabled{opacity:.3;cursor:default}
  .rx-seg.rx-seg-wrap{flex-wrap:wrap} .rx-seg.rx-seg-wrap button{flex:1 1 30%}
  .rx-sheet [hidden]{display:none !important}
  .rx-seg.rx-cls{display:grid;grid-template-columns:repeat(auto-fit,minmax(62px,1fr));gap:3px;padding:3px}
  .rx-seg.rx-cls button{height:36px;font-size:14px;padding:0 6px;white-space:nowrap}
  .rx-clsh{display:flex;align-items:baseline;justify-content:space-between;gap:10px;margin:0 0 6px} .rx-sheet .rx-clsh label.rx-f{margin:0} .rx-clsh small{font-size:12px;color:#8e919b;text-align:right}
  .rx-full{display:flex;align-items:center;gap:12px;width:100%;padding:14px;border-radius:14px;border:1px solid #3b3e47;background:#15161b;color:#f4f4f2;cursor:pointer;text-align:left;font:inherit}
  .rx-full span{flex:1;display:grid} .rx-full b{font-size:16px} .rx-full small{color:#8e919b;font-size:13.5px}
  .rx-tog{width:46px;height:28px;border-radius:999px;background:#3b3e47;position:relative;flex:none;transition:background .15s}
  .rx-tog::after{content:"";position:absolute;left:3px;top:3px;width:22px;height:22px;border-radius:50%;background:#fff;transition:transform .15s}
  .rx-full[aria-checked="true"] .rx-tog{background:#FF5A1F} .rx-full[aria-checked="true"] .rx-tog::after{transform:translateX(18px)}
  .rx-rds{display:grid;border:1px solid #2a2c33;border-radius:14px;overflow:hidden}
  .rx-rd{display:grid;grid-template-columns:24px 92px 1fr;gap:12px;align-items:center;padding:12px 14px;border:0;border-bottom:1px solid #23252b;background:#14151a;color:#f4f4f2;cursor:pointer;text-align:left;font:inherit}
  .rx-rd:last-child{border-bottom:0}
  .rx-rd i{width:22px;height:22px;border-radius:6px;border:2px solid #50545e;display:flex;align-items:center;justify-content:center}
  .rx-rd[aria-checked="true"] i{background:#FF5A1F;border-color:#FF5A1F}
  .rx-rd[aria-checked="true"] i::after{content:"✓";color:#fff;font-size:13px;font-weight:700;font-style:normal}
  .rx-rd[aria-checked="false"] .rx-rd-t,.rx-rd[aria-checked="false"] .rx-rd-d{opacity:.45}
  .rx-rd-d{font:700 15px 'Barlow Condensed'}
  .rx-rd.off{cursor:default;background:#111216} .rx-rd.off i{border-style:dashed;opacity:.5} .rx-rd.off .rx-rd-t b,.rx-rd.off .rx-rd-d{opacity:.45}
  .rx-rd-x{color:#ff6b5b !important;font-weight:600}
  .rx-rd-t{display:grid;min-width:0} .rx-rd-t b{font-size:15px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis} .rx-rd-t small{color:#8e919b;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .rx-phrow{display:flex;align-items:center;gap:14px}
  .rx-phbtns{display:grid;gap:8px}
  .rx-lgrow{display:grid;grid-template-columns:auto 1fr;column-gap:14px;row-gap:6px;align-items:center}
  .rx-lgrow .rx-lgbox{grid-column:1;grid-row:1}
  .rx-lgrow .rx-phbtns{grid-column:2;grid-row:1;justify-self:start}
  .rx-lgrow .rx-lgx{grid-column:1;grid-row:2;justify-self:center}
  .rx-noph{display:flex;align-items:center;justify-content:center;color:#7d808a} .rx-noph svg{width:24px;height:24px}
  .rx-grp2{font:700 12px Barlow;letter-spacing:.12em;text-transform:uppercase;color:#7d808a;margin-bottom:-6px}
  .rx-ph{width:100%;aspect-ratio:16/10;border-radius:16px;border:1.5px dashed #3b3e47;background:#15161b center/cover no-repeat;cursor:pointer;display:flex;align-items:center;justify-content:center;position:relative;overflow:hidden;padding:0;color:#f4f4f2}
  .rx-ph[style*="background-image"]{border-style:solid}
  .rx-ph-empty{display:grid;gap:6px;justify-items:center;color:#a9abb2;font:14px Barlow,system-ui,sans-serif} .rx-ph-empty svg{width:28px;height:28px;color:#FF5A1F} .rx-ph-empty b{color:#f4f4f2;font-size:16px} .rx-ph-empty small{font-size:13px}
  .rx-ph-chg{position:absolute;right:10px;bottom:10px;display:flex;gap:6px;align-items:center;background:rgba(11,12,15,.75);border-radius:999px;padding:7px 12px;font:600 13.5px Barlow,system-ui,sans-serif} .rx-ph-chg svg{width:15px;height:15px}
  .rx-b{height:38px;padding:0 14px;border-radius:999px;border:1px solid #3b3e47;background:#1b1c22;color:#f4f4f2;font:600 14px Barlow,system-ui,sans-serif;cursor:pointer;display:inline-flex;align-items:center;gap:6px;text-decoration:none}
  .rx-b:hover{border-color:#50545e}
  .rx-b.pri{background:#FF5A1F;border-color:#FF5A1F;color:#fff}
  .rx-b.bad{color:#e8352f}
  .rx-b:disabled{opacity:.45;cursor:not-allowed}
  .rx-photo-ph{width:100%;border-radius:inherit;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:6px;border:2px dashed #3b3e47;color:#a9abb2;font:600 14px Barlow,system-ui,sans-serif;background:#15161b;cursor:pointer}
  .rx-photo-ph svg{width:26px;height:26px}
  /* sheets: the house style (see DESIGN.md) */
  .rx-scrim{position:fixed;inset:0;background:rgba(5,6,8,.62);-webkit-backdrop-filter:blur(2px);backdrop-filter:blur(2px);z-index:950;opacity:0;pointer-events:none;transition:opacity .28s ease}
  html.kb-open .rx-sheet{bottom:var(--kb,0px);max-height:calc(var(--vvh,100dvh) - 8px);border-radius:16px 16px 0 0}
  /* keyboard up: the sheet gives all its room to what you're typing */
  html.kb-open .rx-grab,html.kb-open .rx-sh-h small{display:none}
  html.kb-open .rx-sh-h{padding:10px 16px;align-items:center}
  html.kb-open .rx-sh-h b{margin:0;font-size:17px}
  html.kb-open .rx-sh-h .rx-x{width:32px;height:32px}
  html.kb-open .rx-sh-f{display:none}
  html.kb-open .rx-sh-b{padding:12px 16px 16px;gap:12px}
  .rx-sheet{position:fixed;left:0;right:0;bottom:0;margin:0 auto;max-width:560px;max-height:92vh;max-height:92dvh;z-index:951;background:#16181d;color:#f2f2ef;border:1px solid #2c2f37;border-bottom:0;border-radius:22px 22px 0 0;display:flex;flex-direction:column;transform:translateY(105%);transition:transform .32s cubic-bezier(.2,.85,.25,1);font:16px/1.45 Barlow,system-ui,sans-serif;box-shadow:0 -18px 50px rgba(0,0,0,.5);visibility:hidden}
  body.rx-on .rx-scrim{opacity:1;pointer-events:auto}
  body.rx-on .rx-sheet{transform:none;visibility:visible}
  .rx-grab{display:block;width:40px;height:4px;border-radius:4px;background:#3a3d46;margin:10px auto 0;flex:none}
  @media (min-width:700px){
    .rx-sheet{top:50%;bottom:auto;border-bottom:1px solid #2c2f37;border-radius:22px;max-height:86vh;max-height:86dvh;transform:translateY(-46%) scale(.97);opacity:0;transition:transform .24s cubic-bezier(.2,.85,.25,1),opacity .2s ease,visibility 0s .24s;box-shadow:0 24px 70px rgba(0,0,0,.55)}
    body.rx-on .rx-sheet{transform:translateY(-50%);opacity:1;transition:transform .24s cubic-bezier(.2,.85,.25,1),opacity .2s ease}
    .rx-grab{display:none}
  }
  @media (prefers-reduced-motion:reduce){.rx-sheet,.rx-scrim{transition:opacity .15s ease !important}.rx-sheet{transform:none !important}@media (min-width:700px){.rx-sheet{transform:translateY(-50%) !important}}}
  .rx-sh-h,.rx-sh-f{flex:none}
  .rx-sh-h{display:flex;align-items:flex-start;gap:12px;padding:14px 20px 14px;border-bottom:1px solid #24262d}
  .rx-sh-h > div{flex:1;min-width:0}
  .rx-sh-h small{display:block;font:700 12px/1 'Barlow Condensed',sans-serif;letter-spacing:.16em;text-transform:uppercase;color:#FF5A1F}
  .rx-sh-h b{display:block;margin-top:6px;font:700 24px/1.1 'Barlow Condensed',sans-serif;text-transform:uppercase;letter-spacing:.01em}
  .rx-x{flex:none;width:36px;height:36px;border-radius:50%;border:1px solid #2f323a;background:#1f2228;color:#9a9ca3;cursor:pointer;display:grid;place-items:center;transition:background .15s,color .15s}
  .rx-x:hover{background:#2a2d34;color:#f2f2ef}
  .rx-x svg{width:16px;height:16px}
  body.rx-on{overflow:hidden}
  .rx-sh-b{grid-auto-rows:max-content;flex:1 1 auto;min-height:0;overflow-y:auto;-webkit-overflow-scrolling:touch;overscroll-behavior:contain;padding:18px 20px;display:grid;gap:16px;align-content:start}
  .rx-sh-f{display:flex;gap:10px;padding:14px 20px calc(14px + env(safe-area-inset-bottom));border-top:1px solid #24262d}
  .rx-sh-f .rx-b{flex:1;justify-content:center;height:48px;border-radius:14px;font-size:15px}
  .rx-sh-f .rx-b.bad{flex:none}
  .rx-sheet label.rx-f{display:block;font-size:14px;font-weight:600;color:#e9e9e6;margin:0 0 6px}
  .rx-sheet .rx-help{font-size:13px;color:#8e919b;margin-top:5px}
  .rx-sheet .rx-sug{display:flex;gap:12px;align-items:flex-start;padding:12px 14px;border:1px solid #2a2d35;border-radius:14px;background:#1d2026;cursor:pointer}
  .rx-sheet .rx-sug input{width:20px;height:20px;min-height:0;margin:2px 0 0;flex:none;accent-color:#FF5A1F} .rx-sheet .rx-sug span{display:grid;gap:3px} .rx-sheet .rx-sug b{font-size:15px;font-weight:600;color:#f2f2ef} .rx-sheet .rx-sug small{font-size:13px;color:#8e919b;line-height:1.4}
  .rx-sheet input:not([type=color]){width:100%;min-height:48px;padding:11px 14px;background:#0d0e11;border:1px solid #3b3e47;border-radius:12px;color:#f4f4f2;font:16px Barlow,system-ui,sans-serif;box-sizing:border-box}
  .rx-sheet input:focus,.rx-sheet button:focus-visible{outline:2px solid #FF5A1F;outline-offset:1px}
  .rx-two{display:grid;grid-template-columns:1fr 1fr;gap:12px}
  /* custom events: one-box dates, place search, schedule by day */
  .rx-field{width:100%;min-height:52px;display:flex;align-items:center;gap:10px;padding:0 14px;background:#0d0e11;border:1px solid #3b3e47;border-radius:12px;color:#f4f4f2;font:600 16px Barlow,system-ui,sans-serif;text-align:left;cursor:pointer}
  .rx-field svg{color:#FF5A1F;flex:none}
  .rx-field.empty{color:#8a8d96;font-weight:500}
  .rx-field span{flex:1;min-width:0}
  .rx-field em{flex:none;font-style:normal;font-size:13px;font-weight:600;color:#c9cad0;background:#1d2026;border:1px solid #2c2f37;border-radius:999px;padding:3px 9px}
  .rx-field em:empty{display:none}
  .rx-field.open{border-color:#FF5A1F}
  .rx-cal{margin-top:8px;padding:12px;background:#121419;border:1px solid #262930;border-radius:16px;animation:rxCalIn .22s cubic-bezier(.2,.85,.25,1)}
  @keyframes rxCalIn{from{opacity:0;transform:translateY(-4px)}to{opacity:1;transform:none}}
  .rx-cal-top{display:grid;gap:10px}
  .rx-cal-yr{display:flex;gap:4px;background:#0d0e11;border:1px solid #2c2f37;border-radius:11px;padding:3px}
  .rx-cal-yr button{flex:1;height:34px;border:0;border-radius:8px;background:none;color:#a9abb2;font:700 15px Barlow,system-ui,sans-serif;cursor:pointer}
  .rx-cal-yr button[aria-pressed="true"]{background:#2a2d35;color:#fff}
  .rx-cal-ms{display:flex;gap:6px;overflow-x:auto;scrollbar-width:none;padding:2px 0;scroll-behavior:smooth}
  .rx-cal-ms::-webkit-scrollbar{display:none}
  .rx-cal-ms button{flex:none;position:relative;min-width:50px;height:34px;padding:0 10px;border:1px solid #2c2f37;border-radius:999px;background:none;color:#c9cad0;font:600 14px Barlow,system-ui,sans-serif;cursor:pointer}
  .rx-cal-ms button[aria-pressed="true"]{background:#FF5A1F;border-color:#FF5A1F;color:#fff}
  .rx-cal-ms button.dot::after{content:"";position:absolute;top:4px;right:6px;width:5px;height:5px;border-radius:50%;background:#FF5A1F}
  .rx-cal-ms button.dot[aria-pressed="true"]::after{background:#fff}
  .rx-cal-h{display:flex;align-items:center;justify-content:space-between;margin:12px 0 6px}
  .rx-cal-h b{font:700 20px 'Barlow Condensed',Barlow,sans-serif;text-transform:uppercase;letter-spacing:.02em}
  .rx-cal-nav{width:40px;height:40px;border-radius:50%;border:1px solid #2c2f37;background:#1b1c22;color:#f4f4f2;display:grid;place-items:center;cursor:pointer}
  .rx-cal-nav svg{width:18px;height:18px}
  .rx-cal-g{display:grid;grid-template-columns:repeat(7,1fr);row-gap:4px}
  .rx-cal-g i{font:600 11px Barlow,system-ui,sans-serif;color:#6f727b;text-align:center;font-style:normal;padding:4px 0}
  .rx-cal-g button{height:42px;border:0;background:none;color:#e8e8e6;font:600 15px Barlow,system-ui,sans-serif;cursor:pointer;border-radius:12px;position:relative}
  .rx-cal-g button.t::after{content:"";position:absolute;left:50%;bottom:6px;width:4px;height:4px;margin-left:-2px;border-radius:50%;background:#FF5A1F}
  .rx-cal-g button.in{background:rgba(255,90,31,.16);border-radius:0}
  .rx-cal-g button.s,.rx-cal-g button.e{background:#FF5A1F;color:#fff}
  .rx-cal-g button.s{border-radius:12px 0 0 12px}.rx-cal-g button.e{border-radius:0 12px 12px 0}.rx-cal-g button.s.e{border-radius:12px}
  .rx-cal-g button.s.t::after,.rx-cal-g button.e.t::after{background:#fff}
  .rx-cal-hint{text-align:center;font-size:13px;color:#a9abb2;margin-top:8px}
  .rx-srch{position:relative}
  .rx-srch svg{position:absolute;left:14px;top:50%;margin-top:-9px;color:#8a8d96;pointer-events:none}
  .rx-sheet .rx-srch input{padding-left:42px}
  .rx-lres{margin-top:6px;background:#121419;border:1px solid #262930;border-radius:14px;overflow:hidden}
  .rx-lres button{width:100%;display:flex;align-items:center;gap:12px;padding:10px 12px;background:none;border:0;border-bottom:1px solid #1f2228;color:#f4f4f2;text-align:left;font:15px Barlow,system-ui,sans-serif;cursor:pointer}
  .rx-lres button:hover,.rx-lres button:focus-visible{background:#1b1d23;outline:none}
  .rx-lres .rx-lres-own{color:#FF5A1F;font-weight:600;font-size:14px;padding:12px}
  .rx-lres-m{padding:12px;font-size:14px;color:#a9abb2;border-bottom:1px solid #1f2228}
  .rx-lres-c{padding:6px 12px;font-size:11px;color:#62656e}
  .rx-loc{display:flex;align-items:center;gap:12px;padding:10px 12px;background:#1d2026;border:1px solid #2a2d35;border-radius:14px}
  .rx-loc-i{flex:none;width:36px;height:36px;border-radius:50%;display:grid;place-items:center;background:rgba(255,90,31,.12);color:#FF5A1F}
  .rx-loc-t{flex:1;min-width:0;display:grid;gap:2px}
  .rx-loc-t b{font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .rx-loc-t small{font-size:13px;color:#a9abb2;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .rx-sheet .rx-add-s{width:100%;height:48px;justify-content:center;border-radius:14px;border-style:dashed;margin-top:6px}
  .rx-sday{margin-top:12px;display:grid;gap:8px}
  .rx-sday-h{display:flex;align-items:center;justify-content:space-between}
  .rx-sday-h b{font:700 13px Barlow,system-ui,sans-serif;letter-spacing:.1em;text-transform:uppercase;color:#c9cad0}
  .rx-sheet .rx-help.warn{color:#f2b20f}
  .rx-srow2{width:100%;display:flex;align-items:center;gap:12px;padding:12px 12px 12px 14px;background:#1d2026;border:1px solid #2a2d35;border-radius:14px;color:#f4f4f2;text-align:left;cursor:pointer;font:15px Barlow,system-ui,sans-serif}
  .rx-srow2 .tm{flex:none;min-width:58px;font-weight:700;font-variant-numeric:tabular-nums;display:grid;line-height:1.15}
  .rx-srow2 .tm small{font-size:12px;font-weight:500;color:#8e919b}
  .rx-srow2 .lb{flex:1;min-width:0;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .rx-srow2 .rx-chev{width:18px;height:18px;color:#6f727b;flex:none}
  .rx-comp{margin-top:12px;display:grid;gap:12px;padding:14px;background:#121419;border:1px solid #FF5A1F;border-radius:16px;animation:rxCalIn .22s cubic-bezier(.2,.85,.25,1)}
  .rx-comp-t{font:700 12px Barlow,system-ui,sans-serif;letter-spacing:.12em;text-transform:uppercase;color:#FF5A1F}
  .rx-chips{display:flex;gap:6px;overflow-x:auto;scrollbar-width:none;margin:0 -2px;padding:0 2px}
  .rx-chips::-webkit-scrollbar{display:none}
  .rx-chips button{flex:none;min-width:62px;padding:7px 10px;border:1px solid #2c2f37;border-radius:12px;background:#0d0e11;color:#e8e8e6;font:700 14px Barlow,system-ui,sans-serif;display:grid;gap:1px;cursor:pointer}
  .rx-chips button small{font-size:11px;font-weight:600;color:#8e919b}
  .rx-chips button[aria-checked="true"]{background:#FF5A1F;border-color:#FF5A1F;color:#fff}
  .rx-chips button[aria-checked="true"] small{color:#ffe3d6}
  .rx-sheet .rx-cl{display:grid;gap:6px;min-width:0;font-size:13px;font-weight:600;color:#a9abb2}
  .rx-c2{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:10px}
  .rx-sheet .rx-cl select{width:100%;min-width:0;min-height:48px;padding:0 12px;background:#0d0e11;border:1px solid #3b3e47;border-radius:12px;color:#f4f4f2;font:600 16px Barlow,system-ui,sans-serif;-webkit-appearance:none;appearance:none;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%238a8d96' stroke-width='3' stroke-linecap='round'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E");background-repeat:no-repeat;background-position:right 12px center}
  .rx-comp-f{display:flex;align-items:center;gap:8px}
  .rx-comp-f .rx-b{height:42px;border-radius:12px;padding:0 16px}
  .rx-link.bad{color:#ff6b5e}
  .rx-vres{max-height:232px;overflow-y:auto}
  .rx-vres button[data-v]{padding:12px 14px;font-weight:600}
  .rx-mine{margin-top:12px}
  .rx-pcut{font:700 11px Barlow,system-ui,sans-serif;letter-spacing:.12em;text-transform:uppercase;color:#7d808a;padding:10px 4px 2px;border-top:1px dashed #33363e;margin-top:4px}
  .rx-mine small{display:block;font:700 11px Barlow,system-ui,sans-serif;letter-spacing:.12em;text-transform:uppercase;color:#7d808a;margin-bottom:6px}
  .rx-mine > div{display:flex;flex-wrap:wrap;gap:6px}
  .rx-mine button{display:inline-flex;align-items:center;gap:7px;max-width:100%;height:34px;padding:0 10px 0 3px;border:1px solid #2c2f37;border-radius:999px;background:#1b1c22;color:#e8e8e6;font:600 13px Barlow,system-ui,sans-serif;cursor:pointer}
  .rx-mine button img{width:38px;height:26px;border-radius:999px;object-fit:cover}
  .rx-mine button i{width:26px;height:26px;display:grid;place-items:center;color:#FF5A1F;font-style:normal}
  .rx-mine button i svg{width:15px;height:15px}
  .rx-mine button span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .rx-mycars{display:grid;gap:8px}
  .rx-mycars img,.rx-carc img{flex:none;width:56px;height:38px;border-radius:8px;object-fit:cover;background:#0d0e11}
  .rx-mycars .lic{flex:none;width:34px;height:34px;border-radius:50%;display:grid;place-items:center;background:rgba(255,90,31,.12);color:#FF5A1F}
  .rx-mycars .lb{display:grid;gap:1px}.rx-mycars .lb small{font-size:12.5px;font-weight:500;color:#8e919b}
  .rx-mycars .rx-plus{flex:none;color:#FF5A1F;display:grid}
  .rx-carc small .rx-link{font-size:13px}
  .rx-lrow .lic{flex:none;width:34px;height:34px;border-radius:50%;display:grid;place-items:center;background:rgba(255,90,31,.12);color:#FF5A1F}
  .rx-lrow .lb{display:grid;gap:1px}.rx-lrow .lb small{font-size:12.5px;font-weight:500;color:#8e919b;overflow:hidden;text-overflow:ellipsis}
  .rx-lrow + .rx-lrow{margin-top:8px}
  .rx-chips-t button{min-width:0;padding:9px 12px;display:block}
  .rx-evpen{display:inline-grid;place-items:center;vertical-align:middle;width:30px;height:30px;margin:-6px 0 -4px 2px;padding:0;border:0;border-radius:50%;background:none;color:#FF5A1F;cursor:pointer;-webkit-tap-highlight-color:transparent}
  .rx-evpen svg{width:16px;height:16px}
  .rx-evpen:hover,.rx-evpen:focus-visible{background:rgba(255,90,31,.14)}
  @keyframes rxShake{0%,100%{translate:0}25%{translate:-5px 0}75%{translate:5px 0}}
  .rx-shake{animation:rxShake .28s ease;border-color:#ff6b5e !important}
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
  .rx-lg{height:36px;max-width:76px;min-width:0;overflow:hidden;display:flex;align-items:center;justify-content:center}
  .rx-lg img{max-width:64px;max-height:36px;object-fit:contain}
  .rx-lg span{display:block;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font:700 13px 'Barlow Condensed';color:#a9abb2;border:1px solid #3b3e47;border-radius:8px;padding:5px 7px;box-sizing:border-box}
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
  @keyframes rxNudge{0%,100%{translate:0}20%{translate:-7px 0}40%{translate:6px 0}60%{translate:-4px 0}80%{translate:2px 0}}
  .rx-sheet.rx-nudge{animation:rxNudge .36s ease}
  @keyframes rxHint{0%,100%{box-shadow:none}40%{box-shadow:0 0 0 3px rgba(255,90,31,.45)}}
  .rx-sh-f.rx-hint .rx-b.pri,.rx-sh-f.rx-hint #rx-cancel{animation:rxHint .9s ease}
  @media (prefers-reduced-motion:reduce){.rx-sheet.rx-nudge,.rx-sh-f.rx-hint .rx-b{animation:none}}
  .rx-link{color:#FF5A1F;background:none;border:0;padding:0;font:600 13px Barlow,system-ui,sans-serif;cursor:pointer}
  .rx-toast{pointer-events:none;white-space:nowrap;position:fixed;left:50%;top:calc(16px + env(safe-area-inset-top));transform:translateX(-50%);z-index:999;background:#f4f4f2;color:#0b0c0f;padding:10px 16px;border-radius:12px;font:600 14px Barlow,system-ui,sans-serif;box-shadow:0 8px 24px rgba(0,0,0,.4)}
  body.rx-edit:not(.rx-view) #scroll-cue,body.rx-edit:not(.rx-view) #page-cue{display:none!important}`;

  let toastEl;
  function busy(on, msg) {
    if (on) { toastEl = toastEl || document.body.appendChild(Object.assign(document.createElement("div"), { className: "rx-toast", role: "status" })); toastEl.textContent = "Saving…"; toastEl.hidden = false; }
    else if (toastEl) { if (msg) { toastEl.textContent = msg; setTimeout(() => toastEl.hidden = true, 1600); } else toastEl.hidden = true; }
  }

  // ---------- sheet ----------
  let sheetResolve = null;
  let sheetOpener = null, sheetSnap = null, sheetDirty = null;
  // what the form looks like right now: typed values, choices, pictures
  const formPrint = () => { const b = $("#rx-b"); if (!b) return ""; return JSON.stringify([
    [...b.querySelectorAll("input,textarea,select")].map(i => [i.id, i.type === "checkbox" || i.type === "radio" ? i.checked : i.value]),
    [...b.querySelectorAll("[aria-checked]")].map(x => x.getAttribute("aria-checked")),
    [...b.querySelectorAll("img")].map(i => i.getAttribute("src") + "|" + (i.getAttribute("style") || ""))]); };
  const isDirty = () => !!sheetResolve && ((sheetDirty && sheetDirty()) || (sheetSnap != null && formPrint() !== sheetSnap));
  // tap outside, Esc or swipe down: only closes when nothing was changed. Otherwise Cancel or Save.
  function softClose() {
    if (!isDirty()) return closeSheet(null);
    const sh = $("#rx-sheet"); sh.classList.remove("rx-nudge"); void sh.offsetWidth; sh.classList.add("rx-nudge");
    const f = $("#rx-f"); f.classList.remove("rx-hint"); void f.offsetWidth; f.classList.add("rx-hint");
    busy(true); toastEl.textContent = "Save or cancel your changes"; setTimeout(() => toastEl.hidden = true, 1800);
  }
  function closeSheet(v) { document.body.classList.remove("rx-on"); if (sheetResolve) { const r = sheetResolve; sheetResolve = null; r(v); } if (sheetOpener && document.body.contains(sheetOpener)) setTimeout(() => sheetOpener.focus({ preventScroll: true }), 50); }
  function sheet(title, html, opts = {}) {
    return new Promise(resolve => {
      sheetResolve = resolve;
      if (!document.body.classList.contains("rx-on")) sheetOpener = document.activeElement;
      $("#rx-t").textContent = title;
      $("#rx-l").textContent = opts.label || "Your page";
      $("#rx-b").innerHTML = html;
      const f = $("#rx-f");
      f.hidden = opts.footer === false;
      f.innerHTML = opts.footer === false ? "" : `${opts.del ? `<button class="rx-b bad" id="rx-del">${esc(opts.del)}</button>` : ""}<button class="rx-b" id="rx-cancel">Cancel</button><button class="rx-b pri" id="rx-ok">${esc(opts.ok || "Save")}</button>`;
      if ($("#rx-cancel")) $("#rx-cancel").onclick = () => closeSheet(null);
      if ($("#rx-ok")) $("#rx-ok").onclick = () => { const v = opts.collect ? opts.collect() : true; if (v) closeSheet(v); };
      if ($("#rx-del")) $("#rx-del").onclick = () => { if (confirm(opts.delText || "Delete?")) closeSheet({ __delete: true }); };
      document.body.classList.add("rx-on");
      $("#rx-b").scrollTop = 0;
      setTimeout(() => $("#rx-x").focus({ preventScroll: true }), 60);
      sheetSnap = null; sheetDirty = opts.dirty || null;
      if (opts.after) opts.after();
      if (opts.footer !== false) sheetSnap = formPrint();
    });
  }
  const need = (sel, msg) => { const el = $(sel); if (el && !el.value.trim()) { el.focus(); alert(msg); return false; } return true; };

  // ---------- edit features ----------
  let R, ME, ROLE, MEMBERS = [], SERIES = [], VEH = [];
  const entryOf = slug => R.entries.find(e => e.series?.slug === slug);

  const SOCIALS = [
    { k: "instagram", l: "Instagram", base: "https://instagram.com/", help: "Your username, without the @" },
    { k: "x", l: "X (Twitter)", base: "https://x.com/", help: "Your username, without the @" },
    { k: "tiktok", l: "TikTok", base: "https://tiktok.com/@", help: "Your username, without the @" },
    { k: "youtube", l: "YouTube", base: "https://youtube.com/@", help: "Your channel name (the @name) or the channel link" },
    { k: "facebook", l: "Facebook", base: "https://facebook.com/", help: "The link to your page or profile: copy it from Facebook (facebook.com/…)" }
  ];
  // "name", "@name", "youtube.com/@name" or a full link -> a full link
  const toUrl = (k, v) => { v = (v || "").trim(); if (!v) return ""; if (/^https?:\/\//i.test(v)) return v; if (/^(www\.)?[a-z0-9-]+(\.[a-z0-9-]+)+\//i.test(v) || /^(www\.)?[a-z0-9-]+\.(com|be|me|tv|net|org)$/i.test(v)) return "https://" + v; const s = SOCIALS.find(x => x.k === k); return s ? s.base + v.replace(/^@/, "") : "https://" + v.replace(/^\/+/, ""); };
  const handleOf = (k, url) => { if (!url) return ""; const s = SOCIALS.find(x => x.k === k); return s && url.startsWith(s.base) ? url.slice(s.base.length) : url; };
  // one place for everything about you: photo, name, links, contact
  async function editProfile() {
    const p = R.profile, so = p.socials || {};
    const last = p.last_name || (p.display_name || "").replace(new RegExp("^" + (p.first_name || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s*"), "");
    let file = null, prev = p.hero_url || p.photo_url || "", pos = p.photo_pos || null, posChanged = false, phRemoved = false;
    // logo: what's saved, plus what the athlete prepared in the editor (saved with the profile)
    const LG = { url: p.logo_url || "", src: p.logo_src_url || "", mode: p.logo_style || "original", pending: null, removed: false };
    const lgUrl = () => LG.removed ? "" : LG.pending ? (LG.pending.url || (LG.pending.url = URL.createObjectURL(LG.pending.out))) : LG.url;
    const PAL_UNUSED = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3a9 9 0 1 0 0 18c1.1 0 1.6-.8 1.6-1.6 0-.5-.2-.8-.5-1.1-.3-.3-.5-.7-.5-1.1 0-.9.7-1.6 1.6-1.6H16a5 5 0 0 0 5-5C21 6.3 17 3 12 3z"/><circle cx="7.5" cy="11" r="1.2"/><circle cx="10.5" cy="7" r="1.2"/><circle cx="15" cy="7.5" r="1.2"/></svg>';
    const IMG = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="3"/><circle cx="9" cy="10" r="2"/><path d="M21 16l-5-5-9 9"/></svg>';
    const lgHtml = () => `<div class="rx-phrow rx-lgrow"><div class="rx-lgbox">${rnxLogoThumb(lgUrl(), "Your logo", prev, pos)}</div>${lgUrl() ? `<button type="button" class="rx-link rx-lgx" id="rx-lgx">Remove logo</button>` : ""}<div class="rx-phbtns"><button type="button" class="rx-b" id="rx-lg">${IMG} ${lgUrl() ? "Change logo" : "Add logo"}</button>${lgUrl() ? `<button type="button" class="rx-b" id="rx-lgc">${PEN.replace("<svg", '<svg width="15" height="15"')} Adjust</button>` : ""}</div></div>`;
    const title = `${esc((p.first_name || "").toUpperCase())} <em>RACE HUB</em>`;
    const phHtml = () => `<div class="rx-phrow rx-lgrow"><div class="rx-lgbox">${prev ? rnxPhotoThumb(prev, pos) : `<div class="rxt"><span class="rxt-empty">${CAM}Your photo</span></div>`}</div>${prev ? `<button type="button" class="rx-link rx-lgx" id="rx-phx">Remove photo</button>` : ""}<div class="rx-phbtns"><button type="button" class="rx-b" id="rx-ph">${CAM.replace("<svg", '<svg width="16" height="16"')} ${prev ? "Change photo" : "Add photo"}</button>${prev ? `<button type="button" class="rx-b" id="rx-adj">${PEN.replace("<svg", '<svg width="15" height="15"')} Adjust</button>` : ""}</div></div>`;
    const r = await sheet("Edit profile", `
      <div class="rx-grp2">Photo</div><div id="rx-phw">${phHtml()}</div>
      <div class="rx-grp2">Logo</div><div id="rx-lgw">${lgHtml()}</div><div class="rx-help" style="margin-top:-6px">A logo file, a photo or a screenshot: we find your logo and remove the background.</div>
      <div class="rx-grp2">Name</div>
      <div class="rx-two"><div><label class="rx-f" for="rx-first">First name</label><input id="rx-first" value="${esc(p.first_name || "")}" autocomplete="given-name"></div>
      <div><label class="rx-f" for="rx-last">Last name</label><input id="rx-last" value="${esc(last)}" autocomplete="family-name"></div></div>
      <div class="rx-grp2">Links</div>
      ${SOCIALS.map(s => `<div><label class="rx-f" for="rx-s-${s.k}">${s.l}</label><input id="rx-s-${s.k}" value="${esc(handleOf(s.k, so[s.k]))}" autocomplete="off" autocapitalize="off" spellcheck="false"><div class="rx-help">${s.help}</div></div>`).join("")}
      <div><label class="rx-f" for="rx-web">Website</label><input id="rx-web" value="${esc(so.website || "")}" inputmode="url" autocapitalize="off"></div>
      <div><label class="rx-f" for="rx-mail">Contact email</label><input id="rx-mail" type="email" value="${esc(p.contact_email || "")}" inputmode="email"><div class="rx-help">Shown on your page for teams, media and partners.</div></div>`,
      { after() { if (window.rnxSocialWatch) SOCIALS.forEach(s => rnxSocialWatch($("#rx-s-" + s.k), s.k, token)); const bind = () => {
          $("#rx-ph").onclick = async () => { const f = await pickFile(); if (!f) return; file = f; phRemoved = false; prev = URL.createObjectURL(f); pos = (await rnxPhotoEditor(prev, null, title)) || { x: 50, y: 35, z: 1 }; posChanged = true; $("#rx-phw").innerHTML = phHtml(); bind(); };
          if ($("#rx-adj")) $("#rx-adj").onclick = async () => { const n = await rnxPhotoEditor(prev, pos, title); if (n) { pos = n; posChanged = true; $("#rx-phw").innerHTML = phHtml(); bind(); } };
          if ($("#rx-phx")) $("#rx-phx").onclick = () => { file = null; prev = ""; pos = null; phRemoved = true; $("#rx-phw").innerHTML = phHtml(); bind(); };
          $("#rx-lgw").innerHTML = lgHtml(); bindLg();
        };
        const bindLg = () => {
          const ed = o => rnxLogoEditor({ photo: prev, pos, title, getToken: token, ...o });
          $("#rx-lg").onclick = async () => { const f = await pickFile(); if (!f) return; const r = await ed({ file: f, mode: LG.pending?.mode || LG.mode }); if (r) { LG.pending = r; LG.removed = false; } $("#rx-lgw").innerHTML = lgHtml(); bindLg(); };
          if ($("#rx-lgc")) $("#rx-lgc").onclick = async () => { const r = await ed({ src: LG.pending?.src || LG.src || "", current: lgUrl(), mode: LG.pending?.mode || LG.mode }); if (r) LG.pending = { src: LG.pending?.src || null, out: r.out, mode: r.mode }; $("#rx-lgw").innerHTML = lgHtml(); bindLg(); };
          if ($("#rx-lgx")) $("#rx-lgx").onclick = () => { LG.removed = true; LG.pending = null; $("#rx-lgw").innerHTML = lgHtml(); bindLg(); };
        };
        bind(); },
        collect() {
          if (!need("#rx-first", "Add your first name.") || !need("#rx-last", "Add your last name.")) return null;
          const mail = $("#rx-mail").value.trim(); if (mail && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(mail)) { alert("That contact email doesn't look right."); return null; }
          const socials = {}; SOCIALS.forEach(s => { const v = toUrl(s.k, $("#rx-s-" + s.k).value); if (v) socials[s.k] = v; });
          const webRaw = $("#rx-web").value.trim();
          if (webRaw && /@/.test(webRaw) && !/\//.test(webRaw.replace(/^https?:\/\//, ""))) { alert("That looks like an email address. Put it in Contact email, and your website address (like louisdeletraz.com) here."); $("#rx-web").focus(); return null; }
          const web = toUrl("website", webRaw); if (web) socials.website = web;
          const first = $("#rx-first").value.trim(), lastn = $("#rx-last").value.trim();
          return { first_name: first, last_name: lastn, display_name: `${first} ${lastn}`, socials, contact_email: mail || null, ...(posChanged ? { photo_pos: pos } : {}), ...(phRemoved && !file ? { photo_url: null, hero_url: null, photo_pos: null } : {}) };
        } });
    if (!r) return;
    save(async () => {
      if (file) { r.photo_url = await upload(await safePicture(file, false, 1800), `profiles/${p.id}-${Date.now()}.jpg`); r.hero_url = null; }
      // logo: the cut-out original is kept, so the colour can change later without uploading again
      if (LG.removed) Object.assign(r, { logo_url: null, logo_src_url: null, logo_style: "original" });
      else if (LG.pending) {
        const stamp = Date.now(), L = LG.pending;
        if (L.src) r.logo_src_url = await upload(L.src, `profiles/${p.id}-logo-${stamp}-src.png`);
        else if (!p.logo_src_url && p.logo_url) r.logo_src_url = p.logo_url;
        r.logo_url = await upload(L.out, `profiles/${p.id}-logo-${stamp}-${L.mode}.png`);
        r.logo_style = L.mode;
      }
      await upd("profiles", p.id, { ...r, updated_at: new Date().toISOString() });
    }, "Profile saved");
  }
  let DISC = [];
  async function loadLists() {
    if (!SERIES.length) [SERIES, VEH, DISC] = await Promise.all([api("series?select=id,slug,name,short_name,sport,logo_url,classes&order=name"), api("vehicles?select=*&order=name"), api("disciplines?select=key,name&order=sort,name").catch(() => [])]);
  }
  async function addChampionship() {
    await loadLists();
    const SP = DISC.length ? Object.fromEntries(DISC.map(d => [d.key, d.name])) : { sportscars: "Sportscars", formula: "Formula", motorbikes: "Motorbikes" };
    const lg = s => s.logo_url ? `<img src="${esc(s.logo_url)}" alt="">` : `<span>${esc(s.short_name.slice(0, 5))}</span>`;
    const groups = Object.keys(SP).map(k => [k, SERIES.filter(s => s.sport === k)]).filter(g => g[1].length);
    const r = await sheet("Add a championship", `<div><label class="rx-f" for="rx-q">Search</label><input id="rx-q" type="search" autocomplete="off"></div>
      <div id="rx-list" style="display:grid;gap:8px">${groups.map(([k, l]) => `<div class="rx-grp" data-g>${SP[k]}</div>${l.map(s => `<button class="rx-pick" data-s="${s.id}" data-k="${k}"><div class="rx-lg">${lg(s)}</div><div>${esc(s.name)}<small>${esc(s.short_name !== s.name ? s.short_name : "")}</small></div></button>`).join("")}`).join("")}</div>
      <div class="rx-help" style="text-align:center">Can't find yours? Write to us and we'll add it.</div>`, { footer: false, after() {
        $("#rx-q").oninput = e => { const q = e.target.value.trim().toLowerCase(); $$("#rx-list .rx-pick").forEach(b => { const s = SERIES.find(x => x.id === b.dataset.s); b.hidden = q && !(s.name + " " + s.short_name).toLowerCase().includes(q); }); $$("#rx-list [data-g]").forEach(g => { let n = g.nextElementSibling, any = false; while (n && !n.matches("[data-g]")) { if (!n.hidden) any = true; n = n.nextElementSibling; } g.hidden = !any; }); };
        $$("#rx-list .rx-pick").forEach(b => b.onclick = () => closeSheet(SERIES.find(x => x.id === b.dataset.s)));
      } });
    if (!r) return;
    const pick = await pickRounds(r, null);
    if (!pick) return;
    editEntry({ series_id: r.id, series: r, year: pick.year, hide: pick.hide, category: pick.category || null, color: COLORS.find(c => !R.entries.some(e => (e.color || "").toUpperCase() === c)) || COLORS[0] });
  }
  // which races you do: the whole season is ticked, untick the ones you skip. The season is asked only when two are published.
  async function pickRounds(s, en) {
    const evs = await api(`events?series_id=eq.${s.id}&${en ? `year=eq.${en.year}` : `end_date=gte.${TODAY}`}&select=id,year,round,name,start_date,end_date,classes,venues(name,country)&order=start_date`);
    // shared calendar (e.g. IMSA): the athlete's class decides which races are theirs
    const ck = c => String(c || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    const CLS = (s.classes || []).length > 1 ? s.classes : [];
    let cls = CLS.find(c => ck(c) === ck(en?.category)) || null;
    const forCls = e => !CLS.length || !cls || !(e.classes || []).length || e.classes.some(c => ck(c) === ck(cls));
    const clsSeg = () => CLS.length ? `<div><div class="rx-clsh"><label class="rx-f" id="rx-kl">Your class</label><small>Your page shows only its races</small></div><div class="rx-seg rx-cls" role="radiogroup" aria-labelledby="rx-kl" id="rx-ks">${CLS.map(c => `<button type="button" role="radio" data-k="${esc(c)}" aria-checked="${c === cls}">${esc(c)}</button>`).join("")}</div></div>` : "";
    const needCls = () => { if (CLS.length && !cls) { alert("Choose your class."); return true; } return false; };
    const taken = new Set(R.entries.filter(e => e.series_id === s.id && e.id !== en?.id).map(e => e.year));
    const years = [...new Set(evs.map(e => e.year))].filter(y => !taken.has(y));
    let year = en ? en.year : years[0];
    let hidden = new Set();
    if (en) { const ov = await api(`event_overrides?profile_id=eq.${R.profile.id}&hidden=eq.true&select=event_id`); hidden = new Set(ov.map(o => o.event_id)); }
    if (evs.length && year == null && !en) { alert(`${s.short_name} is already in your season. Tap it in "Your season" to change it.`); return null; }
    if (!evs.length || year == null) {
      let y = en ? en.year : YEAR; while (!en && taken.has(y)) y++;
      if (en && !CLS.length) return { year: en.year, hide: [] };
      const ok = await sheet(`${s.short_name} ${y}`, `${clsSeg()}<div class="rx-help" style="font-size:15px;color:#d5d6d9">The ${esc(s.name)} calendar isn't published yet. Your races will appear on your page as soon as it is.</div>`, { ok: en ? "Save" : "Continue",
        after() { $$("#rx-ks button").forEach(b => b.onclick = () => { cls = b.dataset.k; $$("#rx-ks button").forEach(x => x.setAttribute("aria-checked", x === b)); }); },
        collect() { return needCls() ? null : true; } });
      return ok ? { year: y, hide: [], category: cls } : null;
    }
    const fmt = (a, b) => { const A = new Date(a + "T12:00:00Z"), B = new Date(b + "T12:00:00Z"), m = x => x.toLocaleDateString("en-GB", { month: "short", timeZone: "UTC" }); return A.getUTCMonth() === B.getUTCMonth() ? `${A.getUTCDate()}–${B.getUTCDate()} ${m(A)}` : `${A.getUTCDate()} ${m(A)} – ${B.getUTCDate()} ${m(B)}`; };
    const list = () => evs.filter(e => e.year === year && forCls(e));
    // races of the season your class doesn't do: shown greyed, with the classes that do race there in red
    const rows = () => CLS.length && !cls ? `<div class="rx-help" style="text-align:center;padding:14px 0">Choose your class to see its races.</div>` : evs.filter(e => e.year === year).map(e => forCls(e)
      ? `<button type="button" class="rx-rd" role="checkbox" data-ev="${e.id}" aria-checked="${!hidden.has(e.id)}"><i></i><span class="rx-rd-d">${fmt(e.start_date, e.end_date)}</span><span class="rx-rd-t"><b>${esc(e.name)}</b><small>${esc([e.venues?.name, e.venues?.country].filter(Boolean).join(", "))}</small></span></button>`
      : `<div class="rx-rd off" aria-disabled="true"><i></i><span class="rx-rd-d">${fmt(e.start_date, e.end_date)}</span><span class="rx-rd-t"><b>${esc(e.name)}</b><small class="rx-rd-x">Only ${esc(e.classes.join(" · "))}</small></span></div>`).join("");
    const count = () => { const l = list(); return l.filter(e => !hidden.has(e.id)).length + " of " + l.length; };
    const r = await sheet(`Your ${s.short_name} season`, `
      ${clsSeg()}
      ${!en && years.length > 1 ? `<div><label class="rx-f" id="rx-yl">Which season?</label><div class="rx-seg" role="radiogroup" aria-labelledby="rx-yl" id="rx-ys">${years.map(y => `<button type="button" role="radio" data-y="${y}" aria-checked="${y === year}">${y}</button>`).join("")}</div></div>` : ""}
      <button type="button" class="rx-full" id="rx-full" role="switch"${CLS.length && !cls ? " hidden" : ""}><span><b>Full season</b><small id="rx-cnt">${count()} races</small></span><i class="rx-tog"></i></button>
      <div class="rx-help" id="rx-rhelp" style="margin-top:-6px"${CLS.length && !cls ? " hidden" : ""}>Not doing every round? Untick the races you skip.</div>
      <div class="rx-rds" id="rx-rds"${CLS.length && !cls ? " hidden" : ""}>${rows()}</div>`,
      { ok: en ? "Save" : "Continue", after() {
        const sync = () => { const l = list(), all = l.every(e => !hidden.has(e.id)); $("#rx-full").setAttribute("aria-checked", all); $("#rx-cnt").textContent = count() + " races"; };
        const bind = () => $$("#rx-rds .rx-rd[data-ev]").forEach(b => b.onclick = () => { const id = b.dataset.ev; hidden.has(id) ? hidden.delete(id) : hidden.add(id); b.setAttribute("aria-checked", !hidden.has(id)); sync(); });
        $("#rx-full").onclick = () => { const l = list(), all = l.every(e => !hidden.has(e.id)); l.forEach(e => all ? hidden.add(e.id) : hidden.delete(e.id)); $("#rx-rds").innerHTML = rows(); bind(); sync(); };
        $$("#rx-ks button").forEach(b => b.onclick = () => { cls = b.dataset.k; $$("#rx-ks button").forEach(x => x.setAttribute("aria-checked", x === b)); ["#rx-full", "#rx-rhelp", "#rx-rds"].forEach(q => { if ($(q)) $(q).hidden = false; }); $("#rx-rds").innerHTML = rows(); bind(); sync(); });
        $$("#rx-ys button").forEach(b => b.onclick = () => { year = +b.dataset.y; $$("#rx-ys button").forEach(x => x.setAttribute("aria-checked", x === b)); $("#rx-rds").innerHTML = rows(); bind(); sync(); });
        bind(); sync();
      }, collect() { if (needCls()) return null; if (list().length && !list().some(e => !hidden.has(e.id))) { alert("Keep at least one race."); return null; } return true; } });
    if (!r) return null;
    const ids = list().map(e => e.id);
    return { year, hide: ids.filter(id => hidden.has(id)), show: ids.filter(id => !hidden.has(id)), category: cls };
  }
  async function saveRounds(sel) {
    const rows = [...sel.hide.map(id => ({ profile_id: R.profile.id, event_id: id, hidden: true })), ...(sel.show || []).map(id => ({ profile_id: R.profile.id, event_id: id, hidden: false }))];
    if (rows.length) await api("event_overrides", { method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify(rows) });
  }
  async function editEntry(en) {
    await loadLists();
    const isNew = !en.id, s = en.series || SERIES.find(x => x.id === en.series_id);
    let year = en.year, color = (en.color || COLORS[0]).toUpperCase(), vehicle = en.vehicles || VEH.find(v => v.id === en.vehicle_id) || null;
    let photoFile = null, photoUrl = en.car_photo_url || "", rounds = en.hide ? { year, hide: en.hide, show: [] } : null;
    const vbox = () => vehicle ? `<div class="rx-vchip"><b>${esc(vehicle.name)}</b><button type="button" class="rx-b" id="rx-vchg">Change</button></div>` : `<div id="rx-vpk"></div>`;
    const phbox = () => `<div class="rx-carph">${photoUrl ? `<img src="${esc(photoUrl)}" alt="">` : `<div class="rx-none">No photo</div>`}<button type="button" class="rx-b" id="rx-ph">${photoUrl ? "Change photo" : "Add photo"}</button></div><div class="rx-help">A photo of your vehicle, with your livery. Shown when fans tap it.</div>`;
    const html = `
      <div style="display:flex;align-items:center;gap:14px"><div class="rx-lg" style="width:76px">${s?.logo_url ? `<img src="${esc(s.logo_url)}" alt="">` : `<span>${esc(s?.short_name || "")}</span>`}</div><div style="display:grid"><b style="font-size:17px">${esc(s?.name || "")}</b><small style="color:#8e919b">${year} season${(s?.classes || []).length > 1 && en.category ? " · " + esc(en.category) : ""}</small></div></div>
      ${isNew ? "" : `<button type="button" class="rx-full" id="rx-rounds"><span><b>${(s?.classes || []).length > 1 ? "Class and races" : "Races"}</b><small>${(s?.classes || []).length > 1 ? (en.category ? esc(en.category) + " · choose the rounds you do" : "Choose your class") : "Choose the rounds you do"}</small></span>${CHEV}</button>`}
      <div class="rx-two" style="grid-template-columns:120px 1fr"><div><label class="rx-f" for="rx-num">Car number</label><input id="rx-num" value="${esc(en.car_number || "")}" inputmode="numeric" autocomplete="off"></div><div><label class="rx-f" for="rx-team">Team</label><input id="rx-team" value="${esc(en.team || "")}" autocomplete="off"></div></div>
      <div><label class="rx-f" for="rx-mates">Teammates</label><input id="rx-mates" value="${esc((en.teammates || []).join(", "))}" autocomplete="off"><div class="rx-help">Separate names with commas.</div></div>
      <div><label class="rx-f">Vehicle</label><div id="rx-vbox">${vbox()}</div></div>
      <div><label class="rx-f">Vehicle photo</label><div id="rx-phbox">${phbox()}</div></div>
      <div><label class="rx-f" id="rx-cl">Colour</label><div class="rx-sw" role="radiogroup" aria-labelledby="rx-cl" id="rx-cs">${COLORS.filter(c => c === color || !R.entries.some(x => x.id !== en.id && (x.color || "").toUpperCase() === c)).map(c => `<button type="button" role="radio" aria-label="${c}" data-c="${c}" aria-checked="${c === color}" style="background:${c}"></button>`).join("")}<label title="Custom colour"><input type="color" id="rx-cc" value="${esc(color)}" aria-label="Custom colour"></label></div></div>`;
    const bindV = () => {
      if ($("#rx-vchg")) $("#rx-vchg").onclick = () => { vehicle = null; $("#rx-vbox").innerHTML = vbox(); bindV(); $("#rx-vq2")?.focus(); };
      if ($("#rx-vpk")) vehPicker($("#rx-vpk"), { onPick: v => { vehicle = v; $("#rx-vbox").innerHTML = vbox(); bindV(); } });
      return;
      const q = $("#rx-vq"); if (!q) return; const l = $("#rx-vl");
      const show = () => { const t = q.value.trim().toLowerCase(); const hits = VEH.filter(v => !t || v.name.toLowerCase().includes(t)).slice(0, 12);
        l.innerHTML = hits.map(v => `<button type="button" data-v="${v.id}">${esc(v.name)}${v.engine ? `<br><small>${esc(v.engine)}</small>` : ""}</button>`).join("") || `<div class="rx-help" style="padding:8px 12px">No car found. Use "Add your car".</div>`;
        l.hidden = false; l.querySelectorAll("[data-v]").forEach(b => b.onmousedown = ev => { ev.preventDefault(); vehicle = VEH.find(v => v.id === b.dataset.v); $("#rx-vbox").innerHTML = vbox(); bindV(); }); };
      q.onfocus = show; q.oninput = show; q.onblur = () => setTimeout(() => l.hidden = true, 120);
    };
    const bindPh = () => { $("#rx-ph").onclick = async () => { const f = await pickFile(); if (!f) return; photoFile = f; photoUrl = URL.createObjectURL(f); $("#rx-phbox").innerHTML = phbox(); bindPh(); }; };
    const r = await sheet(isNew ? "Your entry" : "Edit entry", html, { ok: isNew ? "Add to my season" : "Save", del: !isNew && ROLE === "owner" ? "Remove" : null, delText: `Remove ${s?.name} ${year} from your page?`,
      after() {
        if ($("#rx-rounds")) $("#rx-rounds").onclick = async () => { sheetResolve = null; const sel = await pickRounds(s, en); if (sel) save(async () => { await saveRounds(sel); if (sel.category && sel.category !== en.category) await upd("entries", en.id, { category: sel.category }); }, "Races saved"); else editEntry(en); };
        $$("#rx-cs button").forEach(b => b.onclick = () => { color = b.dataset.c; $$("#rx-cs button").forEach(x => x.setAttribute("aria-checked", x === b)); });
        $("#rx-cc").oninput = e => { color = e.target.value.toUpperCase(); $$("#rx-cs button").forEach(x => x.setAttribute("aria-checked", "false")); };
        bindV(); bindPh();
        if ($("#rx-vnew")) $("#rx-vnew").onclick = async () => { const draft = { car_number: $("#rx-num").value, team: $("#rx-team").value, teammates: $("#rx-mates").value.split(",").map(x => x.trim()).filter(Boolean) };
          sheetResolve = null; const v = await newVehicle(); editEntry({ ...en, ...draft, year, color, hide: rounds?.hide, vehicles: v || vehicle, vehicle_id: (v || vehicle)?.id || null }); };
      },
      collect() { return { year, color: /^#[0-9A-F]{6}$/i.test(color) ? color : COLORS[0], car_number: $("#rx-num").value.trim() || null, team: $("#rx-team").value.trim() || null, teammates: $("#rx-mates").value.split(",").map(x => x.trim()).filter(Boolean), vehicle_id: vehicle?.id || null }; } });
    if (!r) return;
    if (r.__delete) return save(() => api(`entries?id=eq.${en.id}`, { method: "DELETE" }), "Removed");
    save(async () => {
      if (photoFile) r.car_photo_url = await upload(await safePicture(photoFile, false, 1600), `cars/${R.profile.id}-${Date.now()}.jpg`);
      if (isNew) { await ins("entries", { profile_id: R.profile.id, series_id: en.series_id, ...(en.category ? { category: en.category } : {}), ...r }); if (rounds) await saveRounds(rounds); }
      else await upd("entries", en.id, r);
    }, isNew ? "Added to your season" : "Saved");
  }
  // ---------- vehicle picker: one search box, names only (A→Z), create it if it isn't there; your vehicles below ----------
  // vehPicker(host, { mine:[{v, photo, from}], onPick(v, photo) })
  function vehPicker(host, o) {
    const sorted = () => [...VEH].sort((a, b) => a.name.localeCompare(b.name, "en", { sensitivity: "base" }));
    let creating = null;
    const draw = () => {
      if (creating != null) {
        host.innerHTML = `<div class="rx-comp" id="rx-vcomp"><b class="rx-comp-t">New vehicle</b>
          <label class="rx-cl">Name<input id="rx-vn" value="${esc(creating)}" autocomplete="off" data-form-type="other" maxlength="80"></label>
          <button type="button" class="rx-link" id="rx-vmore" style="justify-self:start">+ Add specs (optional)</button>
          <div id="rx-vspecs" hidden style="display:grid;gap:10px">${VFIELDS.map(([k, l]) => `<label class="rx-cl">${l}<input id="rx-vf-${k}" autocomplete="off" data-form-type="other"></label>`).join("")}</div>
          <div class="rx-help" style="margin:0">Our team checks it before it joins the catalogue for everyone.</div>
          <div class="rx-comp-f"><span style="flex:1"></span><button type="button" class="rx-b" id="rx-vcx">Cancel</button><button type="button" class="rx-b pri" id="rx-vok">Create vehicle</button></div></div>`;
        $("#rx-vmore").onclick = () => { $("#rx-vspecs").hidden = false; $("#rx-vmore").remove(); $("#rx-vf-engine").focus(); };
        $("#rx-vcx").onclick = () => { creating = null; draw(); };
        $("#rx-vok").onclick = async () => {
          const name = $("#rx-vn").value.trim(); if (!name) { $("#rx-vn").focus(); return; }
          const row = { name }; VFIELDS.forEach(([k]) => { const x = $("#rx-vf-" + k); if (x && x.value.trim()) row[k] = x.value.trim(); });
          $("#rx-vok").disabled = true;
          try { const [v] = await ins("vehicles", { ...row, status: "pending", created_by_profile: R.profile.id }); VEH.push(v); creating = null; o.onPick(v, ""); }
          catch (e) { $("#rx-vok").disabled = false; alert("Couldn't create the vehicle: " + e.message); }
        };
        $("#rx-vn").focus(); return;
      }
      host.innerHTML = `<div class="rx-srch">${CARI}<input id="rx-vq2" autocomplete="off" placeholder="Search a vehicle" aria-label="Search a vehicle" role="combobox" aria-expanded="false" aria-controls="rx-vres" data-form-type="other"></div><div class="rx-lres rx-vres" id="rx-vres" role="listbox" hidden></div>
        ${o.mine && o.mine.length ? `<div class="rx-mine"><small>Your vehicles</small><div>${o.mine.map((m, i) => `<button type="button" data-mc="${i}" title="${esc(m.v.name)}">${m.photo ? `<img src="${esc(m.photo)}" alt="">` : `<i>${CARI}</i>`}<span>${esc(m.v.name)}</span></button>`).join("")}</div></div>` : ""}`;
      host.querySelectorAll("[data-mc]").forEach(b => b.onclick = () => { const m = o.mine[+b.dataset.mc]; o.onPick(m.v, m.photo); });
      const q = $("#rx-vq2"), box = $("#rx-vres");
      const show = () => {
        const t = q.value.trim(), tl = t.toLowerCase();
        const hits = sorted().filter(v => !tl || v.name.toLowerCase().includes(tl));
        const exact = hits.some(v => v.name.toLowerCase() === tl);
        box.innerHTML = hits.map(v => `<button type="button" role="option" data-v="${v.id}">${esc(v.name)}</button>`).join("")
          + (t && !exact ? `<button type="button" class="rx-lres-own" data-new="1">+ Create “${esc(t)}”</button>` : "")
          + (!hits.length && !t ? `<div class="rx-lres-m">No vehicles yet. Type a name to create one.</div>` : "");
        box.hidden = false; q.setAttribute("aria-expanded", "true");
        box.querySelectorAll("[data-v]").forEach(b => b.onmousedown = e => { e.preventDefault(); o.onPick(VEH.find(v => v.id === b.dataset.v), ""); });
        const nb = box.querySelector("[data-new]"); if (nb) nb.onmousedown = e => { e.preventDefault(); creating = t; draw(); window.rnxReveal?.($("#rx-vcomp")); };
      };
      q.onfocus = show; q.oninput = show; q.onblur = () => setTimeout(() => { if (box.isConnected) { box.hidden = true; q.setAttribute("aria-expanded", "false"); } }, 150);
    };
    draw();
  }

  async function newVehicle() {
    let drive = "";
    const fld = ([k, l]) => `<div><label class="rx-f" for="rx-v-${k}">${l}</label><input id="rx-v-${k}" autocomplete="off"></div>`;
    const r = await sheet("Add your car", `<div class="rx-help" style="margin:0">Fill in what you know. Leave a box empty if it doesn't apply. It's on your page right away.</div>
      <div><label class="rx-f" for="rx-v-name">Name</label><input id="rx-v-name" autocomplete="off"></div>
      ${VFIELDS.slice(0, 3).map(fld).join("")}
      <div><label class="rx-f" id="rx-dl">Drivetrain</label><div class="rx-seg" role="radiogroup" aria-labelledby="rx-dl" id="rx-ds">${Object.entries(DRIVE).map(([k, l]) => `<button type="button" role="radio" data-d="${k}" aria-checked="false">${l}</button>`).join("")}</div></div>
      <div class="rx-two">${VFIELDS.slice(3, 5).map(fld).join("")}</div><div class="rx-two">${VFIELDS.slice(5).map(fld).join("")}</div>
      <label class="rx-sug"><input type="checkbox" id="rx-v-sug"><span><b>Suggest this car for the Racenxt library</b><small>We'll review it and add it for everyone. Standard cars only, not modified ones. Either way, it's on your page right away.</small></span></label>`,
      { ok: "Add car", after() { $$("#rx-ds button").forEach(b => b.onclick = () => { drive = drive === b.dataset.d ? "" : b.dataset.d; $$("#rx-ds button").forEach(x => x.setAttribute("aria-checked", x.dataset.d === drive)); }); },
        collect() { if (!need("#rx-v-name", "Give the car a name.")) return null; const row = { name: $("#rx-v-name").value.trim(), drivetrain: drive || null }; VFIELDS.forEach(([k]) => row[k] = $("#rx-v-" + k).value.trim() || null); row.suggested = !!$("#rx-v-sug")?.checked; return row; } });
    if (!r) return null;
    try { const [v] = await ins("vehicles", { ...r, status: "pending", created_by_profile: R.profile.id }); VEH.push(v); return v; }
    catch (e) { alert("Couldn't add the car: " + e.message); return null; }
  }

  // ---------- partners ----------
  // what fans see for a partner (new logos have logo_url; older ones a white or original version)
  const spLogo = x => x.logo_url || (x.display === "white" ? (x.logo_white_url || x.logo_original_url) : (x.logo_original_url || x.logo_white_url)) || "";
  // partner: same logo box + editor as the athlete's own logo
  async function editPartner(sp) {
    const isNew = !sp;
    const PL = { url: sp ? spLogo(sp) : "", src: sp?.logo_original_url || "", mode: sp?.display || "white", pending: null };
    const plUrl = () => PL.pending ? (PL.pending.url || (PL.pending.url = URL.createObjectURL(PL.pending.out))) : PL.url;
    const IMG = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="3"/><circle cx="9" cy="10" r="2"/><path d="M21 16l-5-5-9 9"/></svg>';
    const plHtml = () => `<div class="rx-phrow rx-lgrow"><div class="rx-lgbox">${rnxLogoThumb(plUrl(), "Partner logo")}</div><div class="rx-phbtns"><button type="button" class="rx-b" id="rx-plg">${IMG} ${plUrl() ? "Change logo" : "Add logo"}</button>${plUrl() ? `<button type="button" class="rx-b" id="rx-plc">${PEN.replace("<svg", '<svg width="15" height="15"')} Adjust</button>` : ""}</div></div>`;
    // the partners bar as fans see it, with this logo in its place
    const others = [...R.sponsors].sort((a, b) => (a.sort || 0) - (b.sort || 0));
    const bar = () => { const l = others.map(x => x.id === sp?.id ? "me" : spLogo(x)).filter(Boolean); if (!l.includes("me")) l.push("me"); return l.slice(0, 6); };
    const ed = o => rnxLogoEditor({ label: "Partner logo", heading: o.file ? "Add the logo" : "Adjust the logo", partners: bar(), getToken: token, ...o });
    const r = await sheet(isNew ? "Add a partner" : "Edit partner", `
      <div class="rx-grp2">Logo</div><div id="rx-plw">${plHtml()}</div><div class="rx-help" style="margin-top:-6px">A logo file, a photo or a screenshot: we find the logo and remove the background. Works best on a plain background.</div>
      <div><label class="rx-f" for="rx-pn">Partner name</label><input id="rx-pn" value="${esc(sp?.name || "")}" autocomplete="off"></div>
      <div><label class="rx-f" for="rx-pl">Link</label><input id="rx-pl" value="${esc(sp?.link_url || "")}" inputmode="url" autocapitalize="off" autocomplete="off"><div class="rx-help">Optional. Where fans go when they tap the logo.</div></div>`,
      { ok: isNew ? "Add partner" : "Save", del: !isNew && ROLE === "owner" ? "Remove" : null, delText: `Remove ${sp?.name || "this partner"} from your page?`,
        after() { const bind = () => {
          $("#rx-plg").onclick = async () => { const f = await pickFile(); if (!f) return; const x = await ed({ file: f, mode: PL.pending?.mode || PL.mode }); if (x) PL.pending = x; $("#rx-plw").innerHTML = plHtml(); bind(); };
          if ($("#rx-plc")) $("#rx-plc").onclick = async () => { const x = await ed({ src: PL.pending?.src || PL.src || "", current: plUrl(), mode: PL.pending?.mode || PL.mode }); if (x) PL.pending = { src: PL.pending?.src || null, out: x.out, mode: x.mode }; $("#rx-plw").innerHTML = plHtml(); bind(); };
        }; bind(); },
        collect() { if (!plUrl()) { alert("Add the partner's logo."); return null; } if (!need("#rx-pn", "Add the partner's name.")) return null; return { name: $("#rx-pn").value.trim(), link_url: toUrl("website", $("#rx-pl").value) || null }; } });
    if (!r) return;
    if (r.__delete) return save(() => api(`sponsors?id=eq.${sp.id}`, { method: "DELETE" }), "Partner removed");
    save(async () => {
      if (PL.pending) {
        const stamp = Date.now(), L = PL.pending;
        if (L.src) r.logo_original_url = await upload(L.src, `sponsors/${R.profile.id}-${stamp}-src.png`);
        r.logo_url = await upload(L.out, `sponsors/${R.profile.id}-${stamp}-${L.mode}.png`);
        r.logo_white_url = L.mode === "white" ? r.logo_url : null;
        r.display = L.mode;
      }
      if (isNew) await ins("sponsors", { ...r, profile_id: R.profile.id, sort: (R.sponsors.reduce((m, x) => Math.max(m, x.sort || 0), 0) + 1) });
      else await upd("sponsors", sp.id, r);
    }, isNew ? "Partner added" : "Saved");
  }
  async function movePartner(id, dir) {
    const list = [...R.sponsors].sort((a, b) => (a.sort || 0) - (b.sort || 0)), i = list.findIndex(x => x.id === id), j = i + dir;
    if (j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    save(() => Promise.all(list.map((x, k) => upd("sponsors", x.id, { sort: k + 1 }))), "Order saved");
  }

  // ---------- your own events (tests, appearances…) ----------
  let tzLib = null;
  const loadTz = () => tzLib || (tzLib = new Promise(res => { const s = document.createElement("script"); s.src = "https://cdn.jsdelivr.net/npm/tz-lookup@6.1.25/tz.js"; s.onload = () => res(window.tzlookup || null); s.onerror = () => res(null); document.head.appendChild(s); }));
  async function placeId(name, country) {
    name = (name || "").trim(); if (!name) return null;
    const [hit] = await api(`venues?name=ilike.${encodeURIComponent(name.replace(/[%*,()]/g, ""))}&select=id&limit=1`);
    if (hit) return hit.id;
    let lat = null, lng = null, tz = null, cc = null, city = null;
    try {
      const g = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&addressdetails=1&q=${encodeURIComponent([name, country].filter(Boolean).join(", "))}`, { headers: { "Accept-Language": "en" } }).then(r => r.json());
      if (g[0]) { lat = +g[0].lat; lng = +g[0].lon; const a = g[0].address || {}; city = a.town || a.city || a.village || a.county || null; cc = (a.country_code || "").toUpperCase() || null; if (!country && a.country) country = a.country; }
      const lib = await loadTz(); if (lib && lat != null) tz = lib(lat, lng);
    } catch (e) {}
    if (!tz) tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    const [v] = await ins("venues", { name, city, country: country || "", country_code: cc, lat, lng, timezone: tz });
    return v.id;
  }
  const daysOf = (a, b) => { const out = []; if (!a || !b || b < a) return out; for (let t = new Date(a + "T12:00:00Z"); t <= new Date(b + "T12:00:00Z") && out.length < 31; t.setUTCDate(t.getUTCDate() + 1)) out.push(t.toISOString().slice(0, 10)); return out; };
  const dayLbl = d => new Date(d + "T12:00:00Z").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
  const flag = cc => cc && /^[A-Za-z]{2}$/.test(cc) ? String.fromCodePoint(...[...cc.toUpperCase()].map(c => 127397 + c.charCodeAt(0))) : "";
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const MONTHS_L = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const iso = (y, m, d) => `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  const WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const rangeText = (a, b) => {
    if (!a) return "";
    b = b || a;
    const A = new Date(a + "T12:00:00Z"), B = new Date(b + "T12:00:00Z"), d = x => `${WD[x.getUTCDay()]} ${x.getUTCDate()}`, mo = x => MONTHS[x.getUTCMonth()];
    if (a === b) return `${d(A)} ${mo(A)} ${A.getUTCFullYear()}`;
    if (A.getUTCFullYear() !== B.getUTCFullYear()) return `${d(A)} ${mo(A)} ${A.getUTCFullYear()} – ${d(B)} ${mo(B)} ${B.getUTCFullYear()}`;
    return A.getUTCMonth() === B.getUTCMonth() ? `${d(A)} – ${d(B)} ${mo(B)} ${B.getUTCFullYear()}` : `${d(A)} ${mo(A)} – ${d(B)} ${mo(B)} ${B.getUTCFullYear()}`;
  };
  // one-box date range: tap the first day, then the last day
  function rangeCal(box, st) {
    const today = new Date().toISOString().slice(0, 10), Y = +today.slice(0, 4);
    let view = st.start ? [+st.start.slice(0, 4), +st.start.slice(5, 7) - 1] : [Y, +today.slice(5, 7) - 1];
    const draw = () => {
      const [y, m] = view, first = new Date(Date.UTC(y, m, 1)), lead = (first.getUTCDay() + 6) % 7, n = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
      const years = [...new Set([Y, Y + 1, y])].sort();
      const inR = d => st.start && d >= st.start && d <= (st.end || st.start);
      const has = mm => st.start && (iso(y, mm, 31) >= st.start) && (iso(y, mm, 1) <= (st.end || st.start));
      let cells = ""; for (let i = 0; i < lead; i++) cells += `<span></span>`;
      for (let d = 1; d <= n; d++) {
        const k = iso(y, m, d), s = k === st.start, e = k === (st.end || st.start);
        cells += `<button type="button" data-d="${k}" class="${inR(k) ? "in" : ""}${s ? " s" : ""}${e ? " e" : ""}${k === today ? " t" : ""}" aria-pressed="${inR(k)}" aria-label="${dayLbl(k)} ${y}">${d}</button>`;
      }
      box.innerHTML = `<div class="rx-cal-top"><div class="rx-cal-yr" role="group" aria-label="Year">${years.map(v => `<button type="button" data-y="${v}" aria-pressed="${v === y}">${v}</button>`).join("")}</div>
        <div class="rx-cal-ms">${MONTHS.map((t, i) => `<button type="button" data-m="${i}" aria-pressed="${i === m}" class="${has(i) ? "dot" : ""}">${t}</button>`).join("")}</div></div>
        <div class="rx-cal-h"><button type="button" class="rx-cal-nav" data-nav="-1" aria-label="Previous month"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M15 6l-6 6 6 6"/></svg></button><b>${MONTHS_L[m]} ${y}</b><button type="button" class="rx-cal-nav" data-nav="1" aria-label="Next month"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg></button></div>
        <div class="rx-cal-g">${["M", "T", "W", "T", "F", "S", "S"].map(w => `<i>${w}</i>`).join("")}${cells}</div>
        <div class="rx-cal-hint">${!st.start ? "Tap the first day" : st.picking ? "Tap the last day, or" : "Tap a day to choose again"}${st.start ? ` <button type="button" class="rx-link" data-done="1">Done</button>` : ""}</div>`;
      const ms = box.querySelector('.rx-cal-ms [aria-pressed="true"]'); if (ms) ms.parentNode.scrollLeft = ms.offsetLeft - ms.parentNode.clientWidth / 2 + ms.clientWidth / 2;
    };
    box.onclick = e => {
      const b = e.target.closest("button"); if (!b) return;
      if (b.dataset.y) view = [+b.dataset.y, view[1]];
      else if (b.dataset.m) view = [view[0], +b.dataset.m];
      else if (b.dataset.nav) { let [y, m] = view; m += +b.dataset.nav; if (m < 0) { m = 11; y--; } if (m > 11) { m = 0; y++; } view = [y, m]; }
      else if (b.dataset.d) {
        const d = b.dataset.d;
        if (!st.start || !st.picking) { st.start = d; st.end = d; st.picking = true; }
        else if (d < st.start) { st.start = d; st.end = d; }
        else { st.end = d; st.picking = false; }
        st.onChange();
      }
      draw();
    };
    draw();
    return { draw, show: d => { if (d) view = [+d.slice(0, 4), +d.slice(5, 7) - 1]; draw(); } };
  }
  // place search (OpenStreetMap): type and pick, the city and country fill in by themselves
  // Google Places first (through our server, the key stays secret); OpenStreetMap if Google isn't set up or fails
  let gSess = null, gOff = false;
  const gCall = async body => { const r = await fetch(`${C.url}/functions/v1/places`, { method: "POST", headers: { apikey: C.key, Authorization: `Bearer ${await token()}`, "Content-Type": "application/json" }, body: JSON.stringify({ ...body, s: gSess }) }); const j = await r.json().catch(() => ({})); if (!r.ok || j.error) throw new Error(j.error || "places"); return j; };
  async function placeSearch(q) {
    if (!gOff) {
      try {
        gSess = gSess || (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random());
        const j = await gCall({ action: "auto", q });
        return j.list.map(x => ({ gid: x.id, name: x.name, sub: x.sub, city: "", country: "", cc: "" }));
      } catch (e) { if (String(e.message) === "no_key") gOff = true; }
    }
    return osmSearch(q);
  }
  // after a Google pick: city, country, flag and position
  async function placeDetails(x) {
    if (!x.gid) return x;
    try { const d = await gCall({ action: "details", id: x.gid }); gSess = null; return { name: x.name, city: d.city, country: d.country, cc: d.cc, lat: d.lat, lng: d.lng, sub: x.sub }; }
    catch (e) { gSess = null; const [o] = await osmSearch([x.name, x.sub].filter(Boolean).join(", ")).catch(() => []); return o ? { ...o, name: x.name } : { name: x.name, city: "", country: (x.sub.split(",").pop() || "").trim(), cc: "" }; }
  }
  async function osmSearch(q) {
    const r = await fetch(`https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&limit=7&lang=en`).then(r => r.json());
    const seen = new Set();
    return (r.features || []).map(f => {
      const p = f.properties || {}, [lng, lat] = f.geometry?.coordinates || [];
      const street = [p.street, p.housenumber].filter(Boolean).join(" ");
      const name = p.name || street || p.city || "";
      const city = p.city || p.town || p.village || p.county || (["city", "town", "village"].includes(p.osm_value) ? p.name : "") || "";
      const sub = [street && street !== name ? street : "", city && city !== name ? city : "", p.country].filter(Boolean).join(", ");
      return { name, city, country: p.country || "", cc: (p.countrycode || "").toUpperCase(), lat, lng, sub };
    }).filter(x => x.name && !seen.has(x.name + x.sub) && seen.add(x.name + x.sub));
  }
  async function venueFor(loc) {
    if (!loc || !loc.name) return null;
    if (loc.id) return loc.id;
    if (loc.lat == null) return placeId(loc.name, loc.country || "");
    const [hit] = await api(`venues?name=eq.${encodeURIComponent(loc.name)}&country=eq.${encodeURIComponent(loc.country || "")}&select=id&limit=1`);
    if (hit) return hit.id;
    let tz = null; try { const lib = await loadTz(); if (lib) tz = lib(loc.lat, loc.lng); } catch (e) {}
    const [v] = await ins("venues", { name: loc.name, city: loc.city || null, country: loc.country || "", country_code: loc.cc || null, lat: loc.lat, lng: loc.lng, timezone: tz || Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC" });
    return v.id;
  }
  const LI = {
    tv: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="6" width="18" height="12" rx="2.5"/><path d="M10 10l4 2-4 2z" fill="currentColor"/></svg>',
    timing: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 2M10 2h4M12 2v3"/></svg>',
    ticket: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 8a2 2 0 0 0 2-2h14a2 2 0 0 0 2 2v2a2 2 0 0 0 0 4v2a2 2 0 0 0-2 2H5a2 2 0 0 0-2-2v-2a2 2 0 0 0 0-4z"/><path d="M14 6v12" stroke-dasharray="2 2"/></svg>',
    flag: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 21V4M5 4h11l-2 4 2 4H5"/></svg>',
    link: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/></svg>'
  };
  const CARI = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 15l1.6-4.2A2 2 0 0 1 6.5 9.5h8.3a2 2 0 0 1 1.5.7L19 13l1.6.5A1.5 1.5 0 0 1 21.7 15v1.5H3z"/><circle cx="7.5" cy="16.5" r="1.8"/><circle cx="17" cy="16.5" r="1.8"/></svg>';
  const KEY = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="8" cy="15" r="4"/><path d="M11 12l9-9M17 6l3 3M14 9l2 2"/></svg>';
  const PIN = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/></svg>';
  const CALI = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="3"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>';
  // custom events: anything that isn't in an official championship calendar (tests, media, autograph sessions...)
  async function editEvent(ev) {
    const isNew = !ev;
    await loadLists();
    // car: optional. Quick picks = the athlete's own championship cars (with their livery photo)
    let car = ev?.vehicle_id ? { v: ev.vehicles || VEH.find(x => x.id === ev.vehicle_id), photo: ev.car_photo_url || "" } : null, carFile = null;
    const mine = []; for (const e of R.entries) if (e.vehicles && !mine.some(m => m.v.id === e.vehicles.id && m.photo === (e.car_photo_url || ""))) mine.push({ v: e.vehicles, photo: e.car_photo_url || "", from: `${e.series?.short_name || ""} ${e.year}`.trim() });
    const ses = ev ? await api(`sessions?event_id=eq.${ev.id}&select=*&order=local_start`) : [];
    const v = ev?.venues || null;
    const D = { start: ev?.start_date || "", end: ev?.end_date || "", picking: false, onChange: () => {} };
    let loc = v && v.name ? { id: ev.venue_id, name: v.name, city: v.city || "", country: v.country || "", cc: v.country_code || "" } : null;
    const hm = (t, add) => { const [h, m] = t.split(":").map(Number), x = (h * 60 + m + add) % 1440; return `${String(Math.floor(x / 60)).padStart(2, "0")}:${String(x % 60).padStart(2, "0")}`; };
    let LK = (ev?.links || []).filter(l => l && l.url).map(l => ({ label: l.label || "", url: l.url })), lcomp = null;
    let S = ses.map(x => ({ day: x.local_start.slice(0, 10), start: x.local_start.slice(11, 16), end: x.duration_min && x.duration_min !== 60 ? hm(x.local_start.slice(11, 16), x.duration_min) : "", label: x.label }));
    const X = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';
    const r = await sheet(isNew ? "Add a custom event" : "Edit custom event", `
      <div><label class="rx-f" for="rx-en">Name</label><input id="rx-en" value="${esc(ev?.name || "")}" autocomplete="off" autocorrect="off" data-form-type="other" data-1p-ignore enterkeyhint="done" maxlength="80" placeholder="e.g. Autograph session"><div class="rx-help">As fans will see it: a test, a media day, an autograph session…</div></div>
      <div><label class="rx-f" id="rx-dl">Dates</label><input type="hidden" id="rx-es" value="${esc(D.start)}"><input type="hidden" id="rx-ee" value="${esc(D.end)}">
        <button type="button" class="rx-field" id="rx-dbtn" aria-labelledby="rx-dl rx-dtx" aria-expanded="false">${CALI}<span id="rx-dtx"></span><em id="rx-dn"></em></button>
        <div class="rx-cal" id="rx-cal" hidden></div></div>
      <div><label class="rx-f" for="rx-eq">Location</label><input type="hidden" id="rx-eloc" value="">
        <div id="rx-lw"></div><div class="rx-help">Search a circuit, a venue, a city or an address. Optional.</div></div>
      <div><label class="rx-f">Vehicle</label><input type="hidden" id="rx-ecar" value=""><div id="rx-carw"></div></div>
      <div><label class="rx-f" for="rx-eno">Note on the card</label><input id="rx-eno" value="${esc(ev?.note || "")}" autocomplete="off" maxlength="90" placeholder="e.g. Free entry · Fan zone stand 4"><div class="rx-help">Optional. Shown under the event on your page.</div></div>
      <div><label class="rx-f">Links</label><input type="hidden" id="rx-ljson" value=""><div id="rx-lkw"></div></div>
      <div><label class="rx-f">Schedule</label><input type="hidden" id="rx-sjson" value=""><div id="rx-sw"></div></div>`,
      { ok: isNew ? "Add event" : "Save", del: !isNew && ROLE === "owner" ? "Delete" : null, delText: `Delete ${ev?.name || "this event"}?`,
        after() {
          // dates
          const cal = rangeCal($("#rx-cal"), D);
          const dText = () => { $("#rx-dtx").textContent = D.start ? rangeText(D.start, D.end) : "Choose the dates"; const n = daysOf(D.start, D.end || D.start).length; $("#rx-dn").textContent = n ? `${n} day${n > 1 ? "s" : ""}` : ""; $("#rx-dbtn").classList.toggle("empty", !D.start); $("#rx-es").value = D.start; $("#rx-ee").value = D.end || D.start; };
          const openCal = on => { $("#rx-cal").hidden = !on; $("#rx-dbtn").setAttribute("aria-expanded", on); $("#rx-dbtn").classList.toggle("open", on); if (on) { cal.show(D.start); window.rnxReveal?.($("#rx-cal")); } };
          D.onChange = () => { dText(); if (comp !== null && comp < 0) comp = null; drawSched(); if (!D.picking) setTimeout(() => openCal(false), 380); };
          $("#rx-cal").addEventListener("click", e => { if (e.target.closest("[data-done]")) { D.picking = false; openCal(false); $("#rx-dbtn").focus(); } });
          $("#rx-dbtn").onclick = () => openCal($("#rx-cal").hidden);
          dText();
          // location
          let tmr = null, seq = 0;
          const drawLoc = () => {
            $("#rx-eloc").value = loc ? JSON.stringify([loc.name, loc.city, loc.country]) : "";
            $("#rx-lw").innerHTML = loc
              ? `<div class="rx-loc"><span class="rx-loc-i">${PIN}</span><span class="rx-loc-t"><b>${esc(loc.name)}</b><small>${esc([loc.city !== loc.name ? loc.city : "", loc.country].filter(Boolean).join(", "))} ${flag(loc.cc)}</small></span><button type="button" class="rx-link" id="rx-lch">Change</button></div>`
              : `<div class="rx-srch">${PIN}<input id="rx-eq" autocomplete="off" placeholder="Search a place" role="combobox" aria-expanded="false" aria-controls="rx-lres" aria-autocomplete="list"></div><div class="rx-lres" id="rx-lres" role="listbox" hidden></div>`;
            if (loc) { $("#rx-lch").onclick = () => { loc = null; drawLoc(); $("#rx-eq").focus(); }; return; }
            const q = $("#rx-eq"), box = $("#rx-lres");
            const show = (list, text) => {
              box.hidden = false; q.setAttribute("aria-expanded", "true");
              box.innerHTML = (list.length ? list.map((x, i) => `<button type="button" role="option" data-i="${i}"><span class="rx-loc-i">${PIN}</span><span class="rx-loc-t"><b>${esc(x.name)}</b><small>${esc(x.sub)} ${flag(x.cc)}</small></span></button>`).join("") : `<div class="rx-lres-m">${text}</div>`)
                + `<button type="button" class="rx-lres-own" data-own="1">Use “${esc(q.value.trim())}” as it is</button><div class="rx-lres-c">${list.some(x => x.gid) ? "Powered by Google" : "Places © OpenStreetMap"}</div>`;
              box.querySelectorAll("[data-i]").forEach(b => b.onclick = async () => { const x = list[+b.dataset.i]; if (x.gid) { b.disabled = true; b.querySelector("small").textContent = "Getting the address…"; } loc = await placeDetails(x); drawLoc(); });
              box.querySelector("[data-own]").onclick = () => { loc = { name: q.value.trim(), city: "", country: "", cc: "" }; drawLoc(); };
            };
            q.oninput = () => {
              clearTimeout(tmr); const t = q.value.trim();
              if (t.length < 2) { box.hidden = true; q.setAttribute("aria-expanded", "false"); return; }
              tmr = setTimeout(async () => { const my = ++seq; show([], "Searching…"); try { const l = await placeSearch(t); if (my === seq) show(l, "No place found. Try another spelling, or use it as it is."); } catch (e) { if (my === seq) show([], "Search isn't available right now."); } }, 260);
            };
            q.onkeydown = e => { if (e.key === "ArrowDown") { e.preventDefault(); box.querySelector("button")?.focus(); } };
            box.onkeydown = e => { const bs = [...box.querySelectorAll("button")], i = bs.indexOf(document.activeElement); if (e.key === "ArrowDown") { e.preventDefault(); bs[Math.min(bs.length - 1, i + 1)]?.focus(); } if (e.key === "ArrowUp") { e.preventDefault(); (i > 0 ? bs[i - 1] : q).focus(); } };
          };
          drawLoc();
          // car
          const drawCar = () => {
            $("#rx-ecar").value = car ? car.v.id + "|" + (carFile ? "new" : car.photo) : "";
            if (car) {
              const img = carFile ? URL.createObjectURL(carFile) : car.photo;
              $("#rx-carw").innerHTML = `<div class="rx-loc rx-carc">${img ? `<img src="${esc(img)}" alt="">` : `<span class="rx-loc-i">${CARI}</span>`}<span class="rx-loc-t"><b>${esc(car.v.name)}</b><small><button type="button" class="rx-link" id="rx-ecph">${img ? "Change photo" : "Add photo"}</button></small></span><button type="button" class="rx-link" id="rx-ecx">Remove</button></div><div class="rx-help">Fans see it next to Schedule on the card.</div>`;
              $("#rx-ecx").onclick = () => { car = null; carFile = null; drawCar(); };
              $("#rx-ecph").onclick = async () => { const f = await pickFile(); if (f) { carFile = f; drawCar(); } };
              return;
            }
            vehPicker($("#rx-carw"), { mine, onPick: (v, photo) => { car = { v, photo }; carFile = null; drawCar(); } });
          };
          drawCar();
          // links: Where to watch, Live timing, Tickets... or anything
          const linkIcon = l => { const t = (l || "").toLowerCase(); return /watch|stream|tv|live stream|broadcast/.test(t) ? LI.tv : /timing|live tim|tracker/.test(t) ? LI.timing : /ticket/.test(t) ? LI.ticket : /result|standing/.test(t) ? LI.flag : LI.link; };
          const host = u => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch (e) { return u; } };
          function drawLinks() {
            $("#rx-ljson").value = JSON.stringify(LK);
            let h = LK.map((l, i) => i === lcomp ? "" : `<button type="button" class="rx-srow2 rx-lrow" data-l="${i}"><span class="lic">${linkIcon(l.label)}</span><span class="lb">${esc(l.label)}<small>${esc(host(l.url))}</small></span>${CHEV}</button>`).join("");
            if (lcomp !== null) {
              const l = lcomp >= 0 ? LK[lcomp] : { label: "", url: "" };
              h += `<div class="rx-comp" id="rx-lcomp"><b class="rx-comp-t">${lcomp >= 0 ? "Change link" : "New link"}</b>
                <label class="rx-cl">Button text<input id="rx-lname" value="${esc(l.label)}" maxlength="30" placeholder="e.g. Watch live, Live timing, Tickets" autocomplete="off" autocorrect="off" enterkeyhint="next" data-form-type="other" data-1p-ignore></label>
                <label class="rx-cl">Link<input id="rx-lurl" type="url" value="${esc(l.url)}" inputmode="url" autocapitalize="off" autocomplete="off" autocorrect="off" spellcheck="false" placeholder="https://" enterkeyhint="done" data-form-type="other" data-1p-ignore></label>
                <div class="rx-comp-f">${lcomp >= 0 ? `<button type="button" class="rx-link bad" id="rx-lrm">Remove</button>` : ""}<span style="flex:1"></span><button type="button" class="rx-b" id="rx-lcx">Cancel</button><button type="button" class="rx-b pri" id="rx-lok">${lcomp >= 0 ? "Save link" : "Add link"}</button></div></div>`;
            } else if (LK.length < 8) h += `<button type="button" class="rx-b rx-add-s" id="rx-lon">${PLUS.replace("<svg", '<svg width="16" height="16"')} ${LK.length ? "Add another link" : "Add a link"}</button>`;
            h += `<div class="rx-help">${LK.length ? "Shown as buttons on the event card. Tap one to change it." : "Optional. Any link you want, shown as a button on the event card."}</div>`;
            $("#rx-lkw").innerHTML = h;
            if ($("#rx-lon")) $("#rx-lon").onclick = () => { lcomp = -1; drawLinks(); $("#rx-lname").focus(); window.rnxReveal?.($("#rx-lcomp")); };
            $$("#rx-lkw [data-l]").forEach(b => b.onclick = () => { lcomp = +b.dataset.l; drawLinks(); window.rnxReveal?.($("#rx-lcomp")); });
            if (lcomp === null) return;
            $("#rx-lname").onkeydown = e => { if (e.key === "Enter") { e.preventDefault(); $("#rx-lurl").focus(); } };
            $("#rx-lurl").onkeydown = e => { if (e.key === "Enter") { e.preventDefault(); $("#rx-lok").click(); } };
            $("#rx-lcx").onclick = () => { lcomp = null; drawLinks(); };
            if ($("#rx-lrm")) $("#rx-lrm").onclick = () => { LK.splice(lcomp, 1); lcomp = null; drawLinks(); };
            $("#rx-lok").onclick = () => {
              const bad = el => { el.classList.remove("rx-shake"); void el.offsetWidth; el.classList.add("rx-shake"); el.focus(); };
              const name = $("#rx-lname").value.trim(), raw = $("#rx-lurl").value.trim();
              if (!name) return bad($("#rx-lname"));
              const url = /^https?:\/\//i.test(raw) ? raw : raw ? "https://" + raw.replace(/^\/+/, "") : "";
              if (!/^https?:\/\/[^\s/]+\.[^\s]{2,}/i.test(url)) return bad($("#rx-lurl"));
              const item = { label: name, url };
              if (lcomp >= 0) LK[lcomp] = item; else LK.push(item);
              lcomp = null; drawLinks();
            };
          }
          drawLinks();
          // schedule: a clean list, and one small form to add or change a time
          let comp = null; // null = closed, -1 = new time, n = editing S[n]
          const TIMES = []; for (let m = 0; m < 1440; m += 15) TIMES.push(`${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`);
          const opts = (sel, first) => { const l = sel && !TIMES.includes(sel) ? [...TIMES, sel].sort() : TIMES; return (first ? `<option value="">${first}</option>` : "") + l.map(t => `<option${t === sel ? " selected" : ""}>${t}</option>`).join(""); };
          const sortS = () => S.sort((a, b) => (a.day + a.start).localeCompare(b.day + b.start));
          function drawSched() {
            const days = daysOf(D.start, D.end || D.start);
            $("#rx-sjson").value = JSON.stringify(S);
            const off = S.filter(x => !days.includes(x.day));
            const list = days.filter(d => S.some(x => x.day === d)).map(d => `<div class="rx-sday"><div class="rx-sday-h"><b>${dayLbl(d)}</b></div>${S.map((x, i) => x.day === d && i !== comp ? `<button type="button" class="rx-srow2" data-e="${i}"><span class="tm">${esc(x.start)}${x.end ? `<small>– ${esc(x.end)}</small>` : ""}</span><span class="lb">${esc(x.label)}</span>${CHEV}</button>` : "").join("")}</div>`).join("");
            let html = list + (off.length ? `<div class="rx-help warn">${off.length} time${off.length > 1 ? "s are" : " is"} outside the new dates and won't be saved.</div>` : "");
            if (comp !== null) {
              const x = comp >= 0 ? S[comp] : { day: (S.length && days.includes(S[S.length - 1].day) ? S[S.length - 1].day : days[0]), start: S.length ? S[S.length - 1].end || hm(S[S.length - 1].start, 60) : "09:00", end: "", label: "" };
              html += `<div class="rx-comp" id="rx-comp"><b class="rx-comp-t">${comp >= 0 ? "Change time" : "New time"}</b>
                ${days.length > 1 ? `<div class="rx-chips" role="radiogroup" aria-label="Day">${days.map(d => `<button type="button" role="radio" data-day="${d}" aria-checked="${d === x.day}">${dayLbl(d).replace(/ \w+$/, "")}<small>${MONTHS[+d.slice(5, 7) - 1]}</small></button>`).join("")}</div>` : ""}
                <label class="rx-cl">What<input id="rx-cw" value="${esc(x.label)}" placeholder="e.g. Autograph session" maxlength="60" autocomplete="off" enterkeyhint="done" data-form-type="other" data-1p-ignore></label>
                <div class="rx-c2"><label class="rx-cl">Starts<select id="rx-cs">${opts(x.start, "Choose")}</select></label><label class="rx-cl">Ends<select id="rx-ce">${opts(x.end, "No end time")}</select></label></div>
                <div class="rx-comp-f">${comp >= 0 ? `<button type="button" class="rx-link bad" id="rx-crm">Remove</button>` : ""}<span style="flex:1"></span><button type="button" class="rx-b" id="rx-ccx">Cancel</button><button type="button" class="rx-b pri" id="rx-cok">${comp >= 0 ? "Save time" : "Add time"}</button></div></div>`;
            } else if (days.length) {
              html += `<button type="button" class="rx-b rx-add-s" id="rx-son">${PLUS.replace("<svg", '<svg width="16" height="16"')} ${S.length ? "Add another time" : "Add a time"}</button>`;
            }
            html += `<div class="rx-help">${days.length ? (S.length ? "Local time at the place. Tap a time to change it." : "Optional. Times fans can add to their calendar.") : "Choose the dates first."}</div>`;
            $("#rx-sw").innerHTML = html;
            if ($("#rx-son")) $("#rx-son").onclick = () => { comp = -1; drawSched(); $("#rx-cw").focus(); $("#rx-comp").scrollIntoView({ block: "nearest", behavior: "smooth" }); };
            $$("#rx-sw [data-e]").forEach(b => b.onclick = () => { comp = +b.dataset.e; drawSched(); $("#rx-comp").scrollIntoView({ block: "nearest", behavior: "smooth" }); });
            if (comp === null) return;
            let day = comp >= 0 ? S[comp].day : $('#rx-comp [aria-checked="true"]')?.dataset.day || days[0];
            $$("#rx-comp [data-day]").forEach(b => b.onclick = () => { day = b.dataset.day; $$("#rx-comp [data-day]").forEach(o => o.setAttribute("aria-checked", o === b)); });
            $("#rx-cs").onchange = () => { const s = $("#rx-cs").value, e = $("#rx-ce").value; if (e && s && e <= s) $("#rx-ce").value = ""; };
            $("#rx-cw").onkeydown = e => { if (e.key === "Enter") { e.preventDefault(); $("#rx-cw").blur(); } };
            $("#rx-ccx").onclick = () => { comp = null; drawSched(); };
            if ($("#rx-crm")) $("#rx-crm").onclick = () => { S.splice(comp, 1); comp = null; drawSched(); };
            $("#rx-cok").onclick = () => {
              const w = $("#rx-cw").value.trim(), s = $("#rx-cs").value, e = $("#rx-ce").value;
              const bad = el => { el.classList.remove("rx-shake"); void el.offsetWidth; el.classList.add("rx-shake"); el.focus(); };
              if (!w) return bad($("#rx-cw"));
              if (!s) return bad($("#rx-cs"));
              const item = { day, start: s, end: e, label: w };
              if (comp >= 0) S[comp] = item; else S.push(item);
              sortS(); comp = null; drawSched();
            };
          }
          drawSched();
        },
        collect() {
          if (!need("#rx-en", "Give the event a name.")) return null;
          if (!D.start) { alert("Choose the dates."); $("#rx-dbtn").focus(); return null; }
          const days = daysOf(D.start, D.end || D.start);
          if ($("#rx-lcomp")) { alert("Add or cancel the link you're editing first."); window.rnxReveal?.($("#rx-lcomp")); return null; }
          if ($("#rx-comp")) { alert("Add or cancel the time you're editing in the schedule first."); $("#rx-comp").scrollIntoView({ block: "nearest" }); return null; }
          const times = S.filter(x => days.includes(x.day));
          if (times.length && !loc) { alert("Add the location, so the times are in the right local time."); $("#rx-eq")?.focus(); return null; }
          return { name: $("#rx-en").value.trim(), start_date: D.start, end_date: D.end || D.start, year: +D.start.slice(0, 4), note: $("#rx-eno").value.trim() || null, links: LK, vehicle_id: car?.v?.id || null, car_photo_url: car ? car.photo || null : null, loc, times };
        } });
    if (!r) return;
    if (r.__delete) return save(() => api(`events?id=eq.${ev.id}`, { method: "DELETE" }), "Event deleted");
    save(async () => {
      const { loc: L, times, ...row2 } = r;
      row2.venue_id = await venueFor(L);
      if (row2.vehicle_id && carFile) row2.car_photo_url = await upload(await safePicture(carFile, false, 1600), `cars/${R.profile.id}-${Date.now()}.jpg`);
      let id = ev?.id;
      if (isNew) { const [n] = await ins("events", { ...row2, kind: "other", owner_profile_id: R.profile.id }); id = n.id; }
      else await upd("events", ev.id, { ...row2, updated_at: new Date().toISOString() });
      await api(`sessions?event_id=eq.${id}`, { method: "DELETE" });
      const mins = x => { if (!x.end) return 60; const [a, b] = [x.start, x.end].map(t => { const [h, m] = t.split(":").map(Number); return h * 60 + m; }); return ((b - a) + 1440) % 1440 || 60; };
      if (times.length) await ins("sessions", times.map(x => ({ event_id: id, type: "other", label: x.label.trim(), local_start: `${x.day}T${x.start}:00`, duration_min: mins(x) })));
    }, isNew ? "Event added" : "Saved");
  }

  // ---------- put the controls on the page ----------
  function mount() {
    const st = document.createElement("style"); st.textContent = CSS; document.head.appendChild(st);
    document.body.insertAdjacentHTML("beforeend", `<div class="rx-scrim" id="rx-scrim"></div><div class="rx-sheet" id="rx-sheet" role="dialog" aria-modal="true" aria-labelledby="rx-t"><span class="rx-grab" aria-hidden="true"></span><div class="rx-sh-h"><div><small id="rx-l">Your page</small><b id="rx-t"></b></div><button class="rx-x" id="rx-x" aria-label="Close"><svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg></button></div><div class="rx-sh-b" id="rx-b"></div><div class="rx-sh-f" id="rx-f"></div></div>`);
    $("#rx-x").onclick = () => closeSheet(null); $("#rx-scrim").onclick = () => softClose();
    // phones: pull the sheet down by its header to close it
    { const sh = $("#rx-sheet"); let y0 = null, dy = 0;
      sh.addEventListener("touchstart", e => { if (!e.target.closest(".rx-sh-h,.rx-grab") || e.target.closest("button")) return; y0 = e.touches[0].clientY; dy = 0; sh.style.transition = "none"; }, { passive: true });
      sh.addEventListener("touchmove", e => { if (y0 == null) return; dy = Math.max(0, e.touches[0].clientY - y0); sh.style.transform = `translateY(${dy}px)`; }, { passive: true });
      sh.addEventListener("touchend", () => { if (y0 == null) return; sh.style.transition = ""; sh.style.transform = ""; if (dy > 90) softClose(); y0 = null; }); }
    // keep Tab inside an open sheet
    document.addEventListener("keydown", e => { if (e.key !== "Tab" || !document.body.classList.contains("rx-on")) return; const f = [...$("#rx-sheet").querySelectorAll("a[href],button:not([disabled]),input,select,textarea,[tabindex='0']")].filter(x => x.offsetParent); if (!f.length) return; const i = f.indexOf(document.activeElement); if (e.shiftKey && i <= 0) { e.preventDefault(); f[f.length - 1].focus(); } else if (!e.shiftKey && i === f.length - 1) { e.preventDefault(); f[0].focus(); } });
    document.addEventListener("keydown", e => { if (e.key === "Escape") { if (document.body.classList.contains("rx-on")) softClose(); else closeMenu(); } });
    document.body.classList.add("rx-edit");
    document.getElementById("rnx-preview")?.remove();
    const p = R.profile, photo = p.hero_url || p.photo_url;
    const initials = ((p.first_name || "?")[0] + ((p.last_name || (p.display_name || "").split(" ").slice(1).join(" "))[0] || "")).toUpperCase();
    const avatar = (cls = "rx-av") => `<span class="${cls}" style="${photo ? `background-image:url('${esc(photo)}')` : ""}">${photo ? "" : esc(initials)}</span>`;

    // app bar
    const bar = document.createElement("header"); bar.className = "rx-app"; bar.setAttribute("aria-label", "Racenxt");
    bar.innerHTML = `<div class="rx-app-in"><span class="rx-brand">RACEN<span class="x">X</span>T</span>${p.published ? "" : `<span class="rx-status"><i></i>Hidden</span>`}<span style="flex:1"></span>
      <button class="rx-icon-b" id="rx-prev" aria-label="Preview as a fan">${EYE}<span>Preview</span></button>
      <button class="rx-av-b" id="rx-me" aria-haspopup="menu" aria-expanded="false" aria-label="Account menu">${avatar()}</button></div>`;
    document.body.prepend(bar);
    const exit = document.createElement("button"); exit.className = "rx-exit"; exit.innerHTML = `${EYE} Fan preview · <b>Back to editing</b>`;
    document.body.appendChild(exit);
    const preview = on => { document.body.classList.toggle("rx-view", on); window.scrollTo({ top: 0 }); };
    $("#rx-prev").onclick = () => preview(true); exit.onclick = () => preview(false);

    // one edit button on the hero
    const hero = $(".hero");
    if (hero) {
      if (getComputedStyle(hero).position === "static") hero.style.position = "relative";
      if (!photo) { const ph = document.createElement("button"); ph.type = "button"; ph.className = "rx-photo-ph rx-only"; ph.innerHTML = `${CAM}<span>Add your photo</span>`; ph.onclick = editProfile; ph.style.cssText = "position:absolute;inset:0;border-radius:inherit;padding-bottom:18%"; hero.prepend(ph); }
      const eb = document.createElement("button"); eb.type = "button"; eb.className = "rx-edit-b rx-only"; eb.innerHTML = `${PEN} Edit profile`; eb.onclick = editProfile;
      // just above "NAME RACE HUB", so the top-left corner stays free for the athlete's logo
      const ht = hero.querySelector(".hero-text"); if (ht) ht.prepend(eb); else hero.appendChild(eb);
    }

    // your season
    const lg = s => s?.logo_url ? `<img src="${esc(s.logo_url)}" alt="">` : `<span class="rx-lgt">${esc(s?.short_name || "")}</span>`;
    const strip = document.createElement("section"); strip.className = "rx-season rx-only"; strip.id = "rx-season";
    strip.innerHTML = `<div class="rx-season-h"><div><b>Your season</b><span>${R.entries.length ? `${R.entries.length} championship${R.entries.length > 1 ? "s" : ""}` : "Add the championships you race in"}</span></div><button class="rx-b pri" id="rx-add">${PLUS} Add</button></div>
      ${R.entries.length ? `<div class="rx-rows">${R.entries.map(e => { const d = [(e.series?.classes || []).length > 1 && e.category ? esc(e.category) : "", e.car_number ? "#" + esc(e.car_number) : "", esc(e.team || ""), esc(e.vehicles?.name || "")].filter(Boolean); return `<button class="rx-row" data-e="${e.id}" style="--c:${esc(e.color || "#8a8d96")}"><span class="rx-row-lg">${lg(e.series)}</span><span class="rx-row-t"><b>${esc(e.series?.name || "")}</b><small class="${d.length ? "" : "warn"}">${d.length ? d.join(" · ") : "Add your number, team and car"}</small></span><span class="rx-row-y">${e.year}</span>${CHEV}</button>`; }).join("")}</div>` : ""}`;
    const anchor = $("#cd") || $("#ffdd") || $("#list");
    anchor.parentNode.insertBefore(strip, anchor);
    $("#rx-add").onclick = addChampionship;

    // your own events
    const evs = [...(R.customEvents || [])].sort((a, b) => a.start_date.localeCompare(b.start_date));
    const fmtR = (a, b) => { const A = new Date(a + "T12:00:00Z"), B = new Date(b + "T12:00:00Z"), m = x => x.toLocaleDateString("en-GB", { month: "short", timeZone: "UTC" }); return a === b ? `${A.getUTCDate()} ${m(A)}` : A.getUTCMonth() === B.getUTCMonth() ? `${A.getUTCDate()}–${B.getUTCDate()} ${m(A)}` : `${A.getUTCDate()} ${m(A)} – ${B.getUTCDate()} ${m(B)}`; };
    const evCard = document.createElement("section"); evCard.className = "rx-season rx-only"; evCard.id = "rx-events";
    evCard.innerHTML = `<div class="rx-season-h"><div><b>Custom events</b><span>${evs.length ? `${evs.length} event${evs.length > 1 ? "s" : ""}` : "Tests, media days, autograph sessions…"}</span></div><button class="rx-b" id="rx-eadd">${PLUS} Add</button></div>
      ${evs.length ? `<div class="rx-rows">${evs.map(e => `<button class="rx-row rx-row-ev" data-ev="${e.id}" style="--c:#8a8d96"><span class="rx-row-d">${fmtR(e.start_date, e.end_date)}<small>${e.start_date.slice(0, 4)}</small></span><span class="rx-row-t"><b>${esc(e.name)}</b><small>${esc([e.venues?.name, e.venues?.country].filter(Boolean).join(", ") || "No location")}</small></span><span></span>${CHEV}</button>`).join("")}</div>` : ""}`;
    strip.insertAdjacentElement("afterend", evCard);
    $("#rx-eadd").onclick = () => editEvent();
    evCard.querySelectorAll("[data-ev]").forEach(b => b.onclick = () => editEvent(evs.find(x => x.id === b.dataset.ev)));

    // custom event cards on the page: a pencil to edit them right there
    const pens = () => document.querySelectorAll("#list article.ev").forEach(a => {
      if (a.querySelector(".rx-evpen")) return;
      const ce = evs.find(x => "race-" + (x.ext_key || x.id.slice(0, 8)) === a.id); if (!ce) return;
      const b = document.createElement("button"); b.className = "rx-evpen rx-only"; b.type = "button"; b.setAttribute("aria-label", `Edit ${ce.name}`); b.title = "Edit event";
      b.innerHTML = PEN; b.onclick = e => { e.stopPropagation(); editEvent(ce); };
      a.querySelector(".ev-name")?.appendChild(b);
    });
    pens(); const lst = $("#list"); if (lst) new MutationObserver(pens).observe(lst, { childList: true });

    // partners
    const sps = [...(R.sponsors || [])].sort((a, b) => (a.sort || 0) - (b.sort || 0));
    const spCard = document.createElement("section"); spCard.className = "rx-season rx-only"; spCard.id = "rx-partners";
    spCard.innerHTML = `<div class="rx-season-h"><div><b>Partners</b><span>${sps.length ? (sps.length > 6 ? "The first 6 show at the top, all at the bottom" : `${sps.length} logo${sps.length > 1 ? "s" : ""} on your page`) : "Add your partners' logos"}</span></div><button class="rx-b" id="rx-padd">${PLUS} Add</button></div>
      ${sps.length ? `<div class="rx-rows">${sps.map((x, i) => `${i === 6 ? `<div class="rx-pcut">Below: bottom of the page only</div>` : ""}<div class="rx-prow"><button class="rx-prow-main" data-sp="${x.id}"><span class="rx-plogo"><img src="${esc(spLogo(x))}" alt=""></span><span class="rx-row-t"><b>${esc(x.name)}</b><small>${x.link_url ? esc(x.link_url.replace(/^https?:\/\/(www\.)?/, "")) : "No link"}</small></span></button><span class="rx-ord"><button aria-label="Move up" data-up="${x.id}"${i ? "" : " disabled"}>▲</button><button aria-label="Move down" data-dn="${x.id}"${i < sps.length - 1 ? "" : " disabled"}>▼</button></span></div>`).join("")}</div>` : ""}`;
    evCard.insertAdjacentElement("afterend", spCard);
    $("#rx-padd").onclick = () => editPartner();
    spCard.querySelectorAll("[data-sp]").forEach(b => b.onclick = () => editPartner(sps.find(x => x.id === b.dataset.sp)));
    spCard.querySelectorAll("[data-up]").forEach(b => b.onclick = () => movePartner(b.dataset.up, -1));
    spCard.querySelectorAll("[data-dn]").forEach(b => b.onclick = () => movePartner(b.dataset.dn, 1));
    strip.querySelectorAll("[data-e]").forEach(b => b.onclick = () => editEntry(R.entries.find(x => x.id === b.dataset.e)));

    // car window: your car photo + entry
    document.addEventListener("click", e => {
      const b = e.target.closest(".car-btn, .cd-car"); if (!b || document.body.classList.contains("rx-view")) return;
      setTimeout(() => { const en = entryOf(b.dataset.series), body = $("#tt-body"); if (!en || !body) return; body.insertAdjacentHTML("afterbegin", `<div class="rx-only" style="display:flex;gap:8px;justify-content:center;margin:0 0 14px;flex-wrap:wrap"><button class="rx-b pri" id="rx-carph">${CAM.replace("<svg", '<svg width="16" height="16"')} ${en.car_photo_url ? "Change car photo" : "Add your car photo"}</button><button class="rx-b" id="rx-caredit">${PEN.replace("<svg", '<svg width="15" height="15"')} Edit entry</button></div>`);
        $("#rx-caredit").onclick = () => { $("#tt-close")?.click(); editEntry(en); };
        $("#rx-carph").onclick = async () => { const f = await pickFile(); if (!f) return; save(async () => { const u = await upload(await safePicture(f, false, 1600), `cars/${R.profile.id}-${Date.now()}.jpg`); await upd("entries", en.id, { car_photo_url: u }); }, "Car photo saved"); }; }, 0);
    }, true);

    // account menu
    const url = location.origin + location.pathname;
    function closeMenu() { $(".rx-menu")?.remove(); $("#rx-me")?.setAttribute("aria-expanded", "false"); }
    window.__rxCloseMenu = closeMenu;
    $("#rx-me").onclick = ev => {
      ev.stopPropagation(); if ($(".rx-menu")) return closeMenu();
      const m = document.createElement("div"); m.className = "rx-menu"; m.setAttribute("role", "menu");
      const others = MEMBERS.filter(x => x.profiles.id !== p.id);
      m.innerHTML = `<div class="rx-menu-h">${avatar("rx-av lg")}<div><b>${esc(p.display_name)}</b><small>${esc(ME.email || "")}</small></div></div>
        <button role="menuitem" data-a="profile">${PEN}Edit profile</button>
        <button role="menuitem" data-a="season">${FLAG}Your season</button>
        <button role="menuitem" data-a="events">${CAL}Custom events</button>
        <button role="menuitem" data-a="partners">${STAR}Partners</button>
        <button role="menuitem" data-a="preview">${EYE}Preview as a fan</button>
        <button role="menuitem" data-a="copy">${LINK}Copy page link</button>
        <hr>${others.length ? `<div class="rx-menu-l">Your other pages</div>${others.map(x => `<button role="menuitem" data-slug="${esc(x.profiles.slug)}" data-id="${x.profiles.id}">${USER}${esc(x.profiles.display_name)}</button>`).join("")}` : ""}
        <button role="menuitem" data-a="new">${PLUS}Create another page</button>
        <hr><button role="menuitem" data-a="pw">${KEY}Security</button>
        <button role="menuitem" data-a="out" class="rx-out">${OUT}Log out</button>`;
      document.body.appendChild(m); $("#rx-me").setAttribute("aria-expanded", "true");
      m.querySelector("button")?.focus();
      m.onclick = async e2 => {
        const b = e2.target.closest("button"); if (!b) return; closeMenu();
        if (b.dataset.slug) { localStorage.setItem("rnx_profile", b.dataset.id); location.href = (window.RNX_BASE || "/") + b.dataset.slug; return; }
        const a = b.dataset.a;
        if (a === "profile") editProfile();
        if (["season", "events", "partners"].includes(a)) $("#rx-" + a).scrollIntoView({ behavior: "smooth", block: "center" });
        if (a === "preview") preview(true);
        if (a === "copy") { try { await navigator.clipboard.writeText(url); busy(true); busy(false, "Link copied"); } catch (er) { prompt("Your page link:", url); } }
        if (a === "new") location.href = (window.RNX_BASE || "/") + "app.html?new=1";
        if (a === "pw") { if (!window.rnxSetPassword) await new Promise((ok, no) => { const sc = document.createElement("script"); sc.src = (window.RNX_BASE || "/") + "rnx-auth.js"; sc.onload = ok; sc.onerror = no; document.head.appendChild(sc); }); window.rnxSecurity({ getToken: token, onSession: s2 => S.set(s2), email: ME.email }); }
        if (a === "out") { S.set(null); localStorage.removeItem("rnx_profile"); location.reload(); }
      };
      setTimeout(() => document.addEventListener("click", function off(e3) { if (!m.contains(e3.target)) { closeMenu(); document.removeEventListener("click", off); } }), 0);
    };
    if (!R.entries.length) setTimeout(addChampionship, 500);
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
