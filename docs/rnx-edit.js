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
  .rx-edit-b{position:absolute;left:14px;top:14px;z-index:6;display:inline-flex;align-items:center;gap:8px;height:40px;padding:0 15px 0 12px;border-radius:999px;border:1px solid rgba(255,255,255,.18);background:rgba(11,12,15,.62);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);color:#fff;font:600 14px Barlow,system-ui,sans-serif;cursor:pointer;box-shadow:0 6px 18px rgba(0,0,0,.35)}
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
  .rx-row-lg{height:32px;display:flex;align-items:center;justify-content:center}
  .rx-row-lg img{max-width:60px;max-height:32px;object-fit:contain}
  .rx-lgt{font:700 13px 'Barlow Condensed';color:#a9abb2;border:1px solid #3b3e47;border-radius:7px;padding:4px 6px}
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
  .rx-drop{display:flex;align-items:center;gap:14px;padding:14px;border:1.5px dashed #3b3e47;border-radius:14px;background:#0d0e11;cursor:pointer}
  .rx-drop.over,.rx-drop:hover{border-color:#FF5A1F}
  .rx-drop > div:last-child{display:grid;gap:2px} .rx-drop b{font-size:15px} .rx-drop small{font-size:13px;color:#8e919b}
  .rx-drop-pv{width:120px;height:64px;flex:none;border-radius:10px;background:#000;display:flex;align-items:center;justify-content:center;overflow:hidden;padding:6px}
  .rx-drop-pv img{max-width:100%;max-height:52px;object-fit:contain}
  .rx-drop-pv span{font-size:12px;color:#7d808a;text-align:center}
  .rx-lres-pv{height:84px;border-radius:12px;background:#000;border:1px solid #2a2c33;display:flex;align-items:center;justify-content:center;padding:12px}
  .rx-lres-pv img{max-width:80%;max-height:60px;object-fit:contain}
  .rx-lres-pv span{font-size:13px;color:#7d808a}
  #rx-lmode{margin-top:10px}
  .rx-seg.rx-seg-wrap{flex-wrap:wrap} .rx-seg.rx-seg-wrap button{flex:1 1 30%}
  .rx-srow{display:grid;grid-template-columns:118px 104px 1fr 40px;gap:8px;align-items:center}
  .rx-srow select{min-height:48px;padding:0 10px;background:#0d0e11;border:1px solid #3b3e47;border-radius:12px;color:#f4f4f2;font:15px Barlow,system-ui,sans-serif}
  .rx-srow .rx-sx{height:44px;width:40px;padding:0;justify-content:center;border-radius:10px}
  @media (max-width:420px){.rx-srow{grid-template-columns:1fr 1fr 40px}.rx-srow .rx-sl{grid-column:1/3;grid-row:2}}
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
  .rx-rd-t{display:grid;min-width:0} .rx-rd-t b{font-size:15px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis} .rx-rd-t small{color:#8e919b;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .rx-phrow{display:flex;align-items:center;gap:14px}
  .rx-phbtns{display:grid;gap:8px}
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
  .rx-scrim{position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:950;opacity:0;pointer-events:none;transition:opacity .2s}
  .rx-sheet{position:fixed;left:0;right:0;bottom:0;max-height:92vh;max-height:92dvh;z-index:951;background:#111216;color:#f4f4f2;border-top:1px solid #3b3e47;border-radius:22px 22px 0 0;display:flex;flex-direction:column;transform:translateY(105%);transition:transform .24s cubic-bezier(.2,.8,.2,1);font:16px/1.45 Barlow,system-ui,sans-serif;box-shadow:0 -20px 50px rgba(0,0,0,.5)}
  body.rx-on .rx-scrim{opacity:1;pointer-events:auto}
  body.rx-on .rx-sheet{transform:none}
  @media (min-width:760px){.rx-sheet{left:auto;top:0;width:520px;max-height:none;border-radius:0;border-top:0;border-left:1px solid #3b3e47;transform:translateX(105%)}}
  @media (prefers-reduced-motion:reduce){.rx-sheet,.rx-scrim{transition:none}}
  .rx-sh-h,.rx-sh-f{flex:none}
  .rx-sh-h{display:flex;align-items:center;gap:10px;padding:16px 18px;border-bottom:1px solid #2a2c33}
  .rx-sh-h b{flex:1;font:700 22px 'Barlow Condensed',sans-serif;text-transform:uppercase;letter-spacing:.02em}
  .rx-x{width:38px;height:38px;border-radius:50%;border:1px solid #3b3e47;background:#1b1c22;color:#f4f4f2;cursor:pointer;font-size:18px}
  body.rx-on{overflow:hidden}
  .rx-sh-b{grid-auto-rows:max-content;flex:1 1 auto;min-height:0;overflow-y:auto;-webkit-overflow-scrolling:touch;overscroll-behavior:contain;padding:18px;display:grid;gap:16px;align-content:start}
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
  body.rx-edit:not(.rx-view) #scroll-cue,body.rx-edit:not(.rx-view) #page-cue{display:none!important}`;

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
    let file = null, prev = p.hero_url || p.photo_url || "", pos = p.photo_pos || null, posChanged = false;
    const title = `${esc((p.first_name || "").toUpperCase())} <em>RACE HUB</em>`;
    const phHtml = () => `<div class="rx-phrow">${prev ? rnxPhotoThumb(prev, pos) : `<div class="rxt rx-noph">${CAM}</div>`}<div class="rx-phbtns"><button type="button" class="rx-b" id="rx-ph">${CAM.replace("<svg", '<svg width="16" height="16"')} ${prev ? "Change photo" : "Add photo"}</button>${prev ? `<button type="button" class="rx-b" id="rx-adj">${PEN.replace("<svg", '<svg width="15" height="15"')} Adjust</button>` : ""}</div></div>`;
    const r = await sheet("Edit profile", `
      <div class="rx-grp2">Photo</div><div id="rx-phw">${phHtml()}</div>
      <div class="rx-grp2">Name</div>
      <div class="rx-two"><div><label class="rx-f" for="rx-first">First name</label><input id="rx-first" value="${esc(p.first_name || "")}" autocomplete="given-name"></div>
      <div><label class="rx-f" for="rx-last">Last name</label><input id="rx-last" value="${esc(last)}" autocomplete="family-name"></div></div>
      <div class="rx-grp2">Links</div>
      ${SOCIALS.map(s => `<div><label class="rx-f" for="rx-s-${s.k}">${s.l}</label><input id="rx-s-${s.k}" value="${esc(handleOf(s.k, so[s.k]))}" autocomplete="off" autocapitalize="off" spellcheck="false"><div class="rx-help">${s.help}</div></div>`).join("")}
      <div><label class="rx-f" for="rx-web">Website</label><input id="rx-web" value="${esc(so.website || "")}" inputmode="url" autocapitalize="off"></div>
      <div><label class="rx-f" for="rx-mail">Contact email</label><input id="rx-mail" type="email" value="${esc(p.contact_email || "")}" inputmode="email"><div class="rx-help">Shown on your page for teams, media and partners.</div></div>`,
      { after() { if (window.rnxSocialWatch) SOCIALS.forEach(s => rnxSocialWatch($("#rx-s-" + s.k), s.k, token)); const bind = () => {
          $("#rx-ph").onclick = async () => { const f = await pickFile(); if (!f) return; file = f; prev = URL.createObjectURL(f); pos = (await rnxPhotoEditor(prev, null, title)) || { x: 50, y: 35, z: 1 }; posChanged = true; $("#rx-phw").innerHTML = phHtml(); bind(); };
          if ($("#rx-adj")) $("#rx-adj").onclick = async () => { const n = await rnxPhotoEditor(prev, pos, title); if (n) { pos = n; posChanged = true; $("#rx-phw").innerHTML = phHtml(); bind(); } };
        }; bind(); },
        collect() {
          if (!need("#rx-first", "Add your first name.") || !need("#rx-last", "Add your last name.")) return null;
          const mail = $("#rx-mail").value.trim(); if (mail && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(mail)) { alert("That contact email doesn't look right."); return null; }
          const socials = {}; SOCIALS.forEach(s => { const v = toUrl(s.k, $("#rx-s-" + s.k).value); if (v) socials[s.k] = v; });
          const webRaw = $("#rx-web").value.trim();
          if (webRaw && /@/.test(webRaw) && !/\//.test(webRaw.replace(/^https?:\/\//, ""))) { alert("That looks like an email address. Put it in Contact email, and your website address (like louisdeletraz.com) here."); $("#rx-web").focus(); return null; }
          const web = toUrl("website", webRaw); if (web) socials.website = web;
          const first = $("#rx-first").value.trim(), lastn = $("#rx-last").value.trim();
          return { first_name: first, last_name: lastn, display_name: `${first} ${lastn}`, socials, contact_email: mail || null, ...(posChanged ? { photo_pos: pos } : {}) };
        } });
    if (!r) return;
    save(async () => {
      if (file) { r.photo_url = await upload(await safePicture(file, false, 1800), `profiles/${p.id}-${Date.now()}.jpg`); r.hero_url = null; }
      await upd("profiles", p.id, { ...r, updated_at: new Date().toISOString() });
    }, "Profile saved");
  }
  let DISC = [];
  async function loadLists() {
    if (!SERIES.length) [SERIES, VEH, DISC] = await Promise.all([api("series?select=id,slug,name,short_name,sport,logo_url&order=name"), api("vehicles?select=*&order=name"), api("disciplines?select=key,name&order=sort,name").catch(() => [])]);
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
    editEntry({ series_id: r.id, series: r, year: pick.year, hide: pick.hide, color: COLORS.find(c => !R.entries.some(e => (e.color || "").toUpperCase() === c)) || COLORS[0] });
  }
  // which races you do: the whole season is ticked, untick the ones you skip. The season is asked only when two are published.
  async function pickRounds(s, en) {
    const evs = await api(`events?series_id=eq.${s.id}&${en ? `year=eq.${en.year}` : `end_date=gte.${TODAY}`}&select=id,year,round,name,start_date,end_date,venues(name,country)&order=start_date`);
    const taken = new Set(R.entries.filter(e => e.series_id === s.id && e.id !== en?.id).map(e => e.year));
    const years = [...new Set(evs.map(e => e.year))].filter(y => !taken.has(y));
    let year = en ? en.year : years[0];
    let hidden = new Set();
    if (en) { const ov = await api(`event_overrides?profile_id=eq.${R.profile.id}&hidden=eq.true&select=event_id`); hidden = new Set(ov.map(o => o.event_id)); }
    if (evs.length && year == null && !en) { alert(`${s.short_name} is already in your season. Tap it in "Your season" to change it.`); return null; }
    if (!evs.length || year == null) {
      if (en) return { year: en.year, hide: [] };
      let y = YEAR; while (taken.has(y)) y++;
      const ok = await sheet(`${s.short_name} ${y}`, `<div class="rx-help" style="font-size:15px;color:#d5d6d9">The ${esc(s.name)} calendar isn't published yet. Your races will appear on your page as soon as it is.</div>`, { ok: "Continue" });
      return ok ? { year: y, hide: [] } : null;
    }
    const fmt = (a, b) => { const A = new Date(a + "T12:00:00Z"), B = new Date(b + "T12:00:00Z"), m = x => x.toLocaleDateString("en-GB", { month: "short", timeZone: "UTC" }); return A.getUTCMonth() === B.getUTCMonth() ? `${A.getUTCDate()}–${B.getUTCDate()} ${m(A)}` : `${A.getUTCDate()} ${m(A)} – ${B.getUTCDate()} ${m(B)}`; };
    const list = () => evs.filter(e => e.year === year);
    const rows = () => list().map(e => `<button type="button" class="rx-rd" role="checkbox" data-ev="${e.id}" aria-checked="${!hidden.has(e.id)}"><i></i><span class="rx-rd-d">${fmt(e.start_date, e.end_date)}</span><span class="rx-rd-t"><b>${esc(e.name)}</b><small>${esc([e.venues?.name, e.venues?.country].filter(Boolean).join(", "))}</small></span></button>`).join("");
    const count = () => { const l = list(); return l.filter(e => !hidden.has(e.id)).length + " of " + l.length; };
    const r = await sheet(`Your ${s.short_name} season`, `
      ${!en && years.length > 1 ? `<div><label class="rx-f" id="rx-yl">Which season?</label><div class="rx-seg" role="radiogroup" aria-labelledby="rx-yl" id="rx-ys">${years.map(y => `<button type="button" role="radio" data-y="${y}" aria-checked="${y === year}">${y}</button>`).join("")}</div></div>` : ""}
      <button type="button" class="rx-full" id="rx-full" role="switch"><span><b>Full season</b><small id="rx-cnt">${count()} races</small></span><i class="rx-tog"></i></button>
      <div class="rx-help" style="margin-top:-6px">Not doing every round? Untick the races you skip.</div>
      <div class="rx-rds" id="rx-rds">${rows()}</div>`,
      { ok: en ? "Save" : "Continue", after() {
        const sync = () => { const l = list(), all = l.every(e => !hidden.has(e.id)); $("#rx-full").setAttribute("aria-checked", all); $("#rx-cnt").textContent = count() + " races"; };
        const bind = () => $$("#rx-rds .rx-rd").forEach(b => b.onclick = () => { const id = b.dataset.ev; hidden.has(id) ? hidden.delete(id) : hidden.add(id); b.setAttribute("aria-checked", !hidden.has(id)); sync(); });
        $("#rx-full").onclick = () => { const l = list(), all = l.every(e => !hidden.has(e.id)); l.forEach(e => all ? hidden.add(e.id) : hidden.delete(e.id)); $("#rx-rds").innerHTML = rows(); bind(); sync(); };
        $$("#rx-ys button").forEach(b => b.onclick = () => { year = +b.dataset.y; $$("#rx-ys button").forEach(x => x.setAttribute("aria-checked", x === b)); $("#rx-rds").innerHTML = rows(); bind(); sync(); });
        bind(); sync();
      }, collect() { if (!list().some(e => !hidden.has(e.id))) { alert("Keep at least one race."); return null; } return true; } });
    if (!r) return null;
    const ids = list().map(e => e.id);
    return { year, hide: ids.filter(id => hidden.has(id)), show: ids.filter(id => !hidden.has(id)) };
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
    const vbox = () => vehicle ? `<div class="rx-vchip"><b>${esc(vehicle.name)}</b><button type="button" class="rx-b" id="rx-vchg">Change</button></div>`
      : `<div class="rx-vp"><input id="rx-vq" autocomplete="off" aria-label="Search the car catalogue"><div class="rx-vl" id="rx-vl" hidden></div></div><div class="rx-help">Type to search the catalogue.</div>`;
    const phbox = () => `<div class="rx-carph">${photoUrl ? `<img src="${esc(photoUrl)}" alt="">` : `<div class="rx-none">No photo</div>`}<button type="button" class="rx-b" id="rx-ph">${photoUrl ? "Change photo" : "Add photo"}</button></div><div class="rx-help">A photo of your car, with your livery. Shown when fans tap the car.</div>`;
    const html = `
      <div style="display:flex;align-items:center;gap:14px"><div class="rx-lg" style="width:76px">${s?.logo_url ? `<img src="${esc(s.logo_url)}" alt="">` : `<span>${esc(s?.short_name || "")}</span>`}</div><div style="display:grid"><b style="font-size:17px">${esc(s?.name || "")}</b><small style="color:#8e919b">${year} season</small></div></div>
      ${isNew ? "" : `<button type="button" class="rx-full" id="rx-rounds"><span><b>Races</b><small>Choose the rounds you do</small></span>${CHEV}</button>`}
      <div class="rx-two" style="grid-template-columns:120px 1fr"><div><label class="rx-f" for="rx-num">Car number</label><input id="rx-num" value="${esc(en.car_number || "")}" inputmode="numeric" autocomplete="off"></div><div><label class="rx-f" for="rx-team">Team</label><input id="rx-team" value="${esc(en.team || "")}" autocomplete="off"></div></div>
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
        if ($("#rx-rounds")) $("#rx-rounds").onclick = async () => { sheetResolve = null; const sel = await pickRounds(s, en); if (sel) save(() => saveRounds(sel), "Races saved"); else editEntry(en); };
        $$("#rx-cs button").forEach(b => b.onclick = () => { color = b.dataset.c; $$("#rx-cs button").forEach(x => x.setAttribute("aria-checked", x === b)); });
        $("#rx-cc").oninput = e => { color = e.target.value.toUpperCase(); $$("#rx-cs button").forEach(x => x.setAttribute("aria-checked", "false")); };
        bindV(); bindPh();
        $("#rx-vnew").onclick = async () => { const draft = { car_number: $("#rx-num").value, team: $("#rx-team").value, teammates: $("#rx-mates").value.split(",").map(x => x.trim()).filter(Boolean) };
          sheetResolve = null; const v = await newVehicle(); editEntry({ ...en, ...draft, year, color, hide: rounds?.hide, vehicles: v || vehicle, vehicle_id: (v || vehicle)?.id || null }); };
      },
      collect() { return { year, color: /^#[0-9A-F]{6}$/i.test(color) ? color : COLORS[0], car_number: $("#rx-num").value.trim() || null, team: $("#rx-team").value.trim() || null, teammates: $("#rx-mates").value.split(",").map(x => x.trim()).filter(Boolean), vehicle_id: vehicle?.id || null }; } });
    if (!r) return;
    if (r.__delete) return save(() => api(`entries?id=eq.${en.id}`, { method: "DELETE" }), "Removed");
    save(async () => {
      if (photoFile) r.car_photo_url = await upload(await safePicture(photoFile, false, 1600), `cars/${R.profile.id}-${Date.now()}.jpg`);
      if (isNew) { await ins("entries", { profile_id: R.profile.id, series_id: en.series_id, ...r }); if (rounds) await saveRounds(rounds); }
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

  // ---------- partners ----------
  async function processLogo(file, mode){
    const img = await new Promise((res, rej) => { const u = URL.createObjectURL(file); const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = u; });
    const iw = img.naturalWidth || img.width || 900, ih = img.naturalHeight || img.height || 300;
    const scale = /svg/.test(file.type || "") ? 900 / Math.max(iw, ih) : Math.min(1, 900 / Math.max(iw, ih));
    const w = Math.max(1, Math.round(iw * scale)), h = Math.max(1, Math.round(ih * scale));
    const cv = document.createElement("canvas"); cv.width = w; cv.height = h;
    const cx = cv.getContext("2d", { willReadFrequently:true }); cx.drawImage(img, 0, 0, w, h);
    const d = cx.getImageData(0, 0, w, h), px = d.data;
    // background = most common colour around the border
    const border = []; const pick = (x, y) => { const k = (y * w + x) * 4; border.push([px[k], px[k+1], px[k+2], px[k+3]]); };
    for (let x = 0; x < w; x += Math.max(1, w >> 6)){ pick(x, 0); pick(x, h - 1); }
    for (let y = 0; y < h; y += Math.max(1, h >> 6)){ pick(0, y); pick(w - 1, y); }
    const transparentBg = border.filter(b => b[3] < 40).length > border.length * 0.5;
    const med = i => border.map(b => b[i]).sort((a, b) => a - b)[border.length >> 1];
    const bg = [med(0), med(1), med(2)];
    let minX = w, minY = h, maxX = 0, maxY = 0;
    for (let k = 0; k < px.length; k += 4){
      let a;
      if (transparentBg) a = px[k+3];
      else { const dist = Math.hypot(px[k] - bg[0], px[k+1] - bg[1], px[k+2] - bg[2]); a = Math.max(0, Math.min(255, (dist - 18) * 4)) * (px[k+3] / 255); }
      if (mode === "white"){ px[k] = px[k+1] = px[k+2] = 255; }
      px[k+3] = a;
      if (a > 24){ const i = k >> 2, x = i % w, y = (i / w) | 0; if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
    }
    cx.putImageData(d, 0, 0);
    if (maxX < minX){ minX = 0; minY = 0; maxX = w - 1; maxY = h - 1; }
    const pad = Math.round(Math.max(maxX - minX, maxY - minY) * 0.04);
    const ox = Math.max(0, minX - pad), oy = Math.max(0, minY - pad), ow = Math.min(w, maxX + pad + 1) - ox, oh = Math.min(h, maxY + pad + 1) - oy;
    const out = document.createElement("canvas"); out.width = ow; out.height = oh;
    out.getContext("2d").drawImage(cv, ox, oy, ow, oh, 0, 0, ow, oh);
    return await new Promise(res => out.toBlob(b => res(b), "image/png"));
  }
  
  // logo picker: tap to choose, drop a file, or paste a screenshot
  function logoDrop(current, mode) {
    const st = { file: null, mode: mode || "white", preview: current || "", cropper: null, blob: null };
    const html = `<div id="rx-lwrap"><div class="rx-drop" id="rx-drop" tabindex="0" role="button" aria-label="Add a logo"><div class="rx-drop-pv" id="rx-drop-pv">${st.preview ? `<img src="${esc(st.preview)}" alt="">` : `<span>No logo yet</span>`}</div><div><b>${st.preview ? "Change the logo" : "Add the logo"}</b><small>A file, a photo or a screenshot. We find the logo, cut it out and clean it up.</small></div></div></div>
      <div id="rx-lres" hidden><div class="rx-f" style="margin-top:4px">Result</div><div class="rx-lres-pv" id="rx-lres-pv"></div></div>
      <div class="rx-seg" role="radiogroup" aria-label="Logo colours" id="rx-lmode"><button type="button" role="radio" data-m="white" aria-checked="${st.mode === "white"}">White</button><button type="button" role="radio" data-m="original" aria-checked="${st.mode === "original"}">Original colours</button></div>`;
    let seq = 0;
    const render = async () => {
      const my = ++seq;
      if (!st.cropper) { const pv = $("#rx-drop-pv"); if (pv && st.preview) pv.innerHTML = `<img src="${esc(st.preview)}" alt="" style="${st.mode === "white" ? "filter:brightness(0) invert(1)" : ""}">`; return; }
      $("#rx-lres").hidden = false; $("#rx-lres-pv").innerHTML = "<span>Cleaning up…</span>";
      try { const cut = await st.cropper.crop(); const b = await processLogo(cut, st.mode); if (my !== seq) return; st.blob = b; $("#rx-lres-pv").innerHTML = `<img src="${URL.createObjectURL(b)}" alt="">`; }
      catch (e) { $("#rx-lres-pv").innerHTML = "<span>Couldn't read this image</span>"; st.blob = null; }
    };
    const take = async f => {
      if (!f || !f.type.startsWith("image/")) return;
      st.file = f; st.blob = null;
      $("#rx-lwrap").innerHTML = `<div id="rx-crop"></div><div style="text-align:right;margin-top:6px"><button type="button" class="rx-link" id="rx-lother">Choose another picture</button></div>`;
      $("#rx-lother").onclick = async () => take(await pickFile());
      st.cropper = window.rnxLogoCropper ? await rnxLogoCropper($("#rx-crop"), f, token) : null;
      if (st.cropper) st.cropper.onChange(render);
      render();
    };
    const onPaste = e => { if (!$("#rx-lmode")) return document.removeEventListener("paste", onPaste); const it = [...(e.clipboardData?.items || [])].find(x => x.type.startsWith("image/")); if (it) { e.preventDefault(); take(it.getAsFile()); } };
    return { html, st, after() {
      const dz = $("#rx-drop");
      dz.onclick = async () => take(await pickFile());
      dz.onkeydown = async e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); take(await pickFile()); } };
      dz.ondragover = e => { e.preventDefault(); dz.classList.add("over"); }; dz.ondragleave = () => dz.classList.remove("over");
      dz.ondrop = e => { e.preventDefault(); dz.classList.remove("over"); take(e.dataTransfer.files[0]); };
      document.addEventListener("paste", onPaste);
      $$("#rx-lmode button").forEach(b => b.onclick = () => { st.mode = b.dataset.m; $$("#rx-lmode button").forEach(x => x.setAttribute("aria-checked", x === b)); render(); });
      render();
    } };
  }
  async function editPartner(sp) {
    const isNew = !sp;
    const ld = logoDrop(sp ? (sp.logo_original_url || sp.logo_white_url) : "", sp?.display || "white");
    const r = await sheet(isNew ? "Add a partner" : "Edit partner", `
      <div><label class="rx-f">Logo</label>${ld.html}</div>
      <div><label class="rx-f" for="rx-pn">Partner name</label><input id="rx-pn" value="${esc(sp?.name || "")}" autocomplete="off"></div>
      <div><label class="rx-f" for="rx-pl">Link</label><input id="rx-pl" value="${esc(sp?.link_url || "")}" inputmode="url" autocapitalize="off" autocomplete="off"><div class="rx-help">Optional. Where fans go when they tap the logo.</div></div>`,
      { ok: isNew ? "Add partner" : "Save", del: !isNew && ROLE === "owner" ? "Remove" : null, delText: `Remove ${sp?.name || "this partner"} from your page?`, after: ld.after,
        collect() { if (isNew && !ld.st.file) { alert("Add the partner's logo."); return null; } if (ld.st.file && !ld.st.blob) { alert("One moment: the logo is still being cleaned up."); return null; } if (!need("#rx-pn", "Add the partner's name.")) return null; return { name: $("#rx-pn").value.trim(), link_url: toUrl("website", $("#rx-pl").value) || null, display: ld.st.mode }; } });
    if (!r) return;
    if (r.__delete) return save(() => api(`sponsors?id=eq.${sp.id}`, { method: "DELETE" }), "Partner removed");
    save(async () => {
      if (ld.st.file) {
        const stamp = Date.now(), cut = ld.st.cropper ? await ld.st.cropper.crop() : ld.st.file;
        r.logo_white_url = await upload(await processLogo(cut, "white"), `sponsors/${R.profile.id}-${stamp}-w.png`);
        r.logo_original_url = await upload(await processLogo(cut, "original"), `sponsors/${R.profile.id}-${stamp}-o.png`);
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
  const KINDS = [["test", "Test"], ["appearance", "Appearance"], ["simulator", "Simulator"], ["media", "Media"], ["other", "Other"]];
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
  const daysOf = (a, b) => { const out = []; if (!a || !b || b < a) return out; for (let t = new Date(a + "T12:00:00Z"); t <= new Date(b + "T12:00:00Z") && out.length < 14; t.setUTCDate(t.getUTCDate() + 1)) out.push(t.toISOString().slice(0, 10)); return out; };
  const dayLbl = d => new Date(d + "T12:00:00Z").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
  async function editEvent(ev) {
    const isNew = !ev; let kind = ev?.kind || "test";
    const ses = ev ? await api(`sessions?event_id=eq.${ev.id}&select=*&order=local_start`) : [];
    const v = ev?.venues || {};
    const row = (x, days) => `<div class="rx-srow"><select class="rx-sd" aria-label="Day">${(days.length ? days : [x.day || ""]).map(d => `<option value="${d}"${d === x.day ? " selected" : ""}>${d ? dayLbl(d) : "—"}</option>`).join("")}</select><input type="time" class="rx-st" value="${esc(x.time || "")}" aria-label="Time"><input class="rx-sl" value="${esc(x.label || "")}" aria-label="What" placeholder="What"><button type="button" class="rx-b rx-sx" aria-label="Remove">×</button></div>`;
    const r = await sheet(isNew ? "Add an event" : "Edit event", `
      <div><label class="rx-f" id="rx-kl">Type</label><div class="rx-seg rx-seg-wrap" role="radiogroup" aria-labelledby="rx-kl" id="rx-ks">${KINDS.map(([k, l]) => `<button type="button" role="radio" data-k="${k}" aria-checked="${k === kind}">${l}</button>`).join("")}</div></div>
      <div><label class="rx-f" for="rx-en">Name</label><input id="rx-en" value="${esc(ev?.name || "")}" autocomplete="off"><div class="rx-help">As fans should see it, for example: Rookie test, Fan zone autograph session.</div></div>
      <div class="rx-two"><div><label class="rx-f" for="rx-es">First day</label><input id="rx-es" type="date" value="${esc(ev?.start_date || "")}"></div><div><label class="rx-f" for="rx-ee">Last day</label><input id="rx-ee" type="date" value="${esc(ev?.end_date || "")}"></div></div>
      <div class="rx-two"><div><label class="rx-f" for="rx-ep">Place</label><input id="rx-ep" value="${esc(v.name || "")}" autocomplete="off"><div class="rx-help">Circuit, city or venue. Optional.</div></div><div><label class="rx-f" for="rx-ec">Country</label><input id="rx-ec" value="${esc(v.country || "")}" autocomplete="off"></div></div>
      <div><label class="rx-f" for="rx-eno">Note on the card</label><input id="rx-eno" value="${esc(ev?.note || "")}" autocomplete="off"><div class="rx-help">Optional.</div></div>
      <div><label class="rx-f">Times</label><div id="rx-srows" style="display:grid;gap:8px">${ses.map(x => row({ day: x.local_start.slice(0, 10), time: x.local_start.slice(11, 16), label: x.label }, daysOf(ev.start_date, ev.end_date))).join("")}</div><button type="button" class="rx-link" id="rx-sadd" style="margin-top:8px">+ Add a time</button><div class="rx-help">Optional. Local time at the place. Fans can add them to their calendar.</div></div>`,
      { ok: isNew ? "Add event" : "Save", del: !isNew && ROLE === "owner" ? "Delete" : null, delText: `Delete ${ev?.name || "this event"}?`,
        after() {
          $$("#rx-ks button").forEach(b => b.onclick = () => { kind = b.dataset.k; $$("#rx-ks button").forEach(x => x.setAttribute("aria-checked", x === b)); });
          const days = () => daysOf($("#rx-es").value, $("#rx-ee").value || $("#rx-es").value);
          $("#rx-es").addEventListener("change", () => { if (!$("#rx-ee").value || $("#rx-ee").value < $("#rx-es").value) $("#rx-ee").value = $("#rx-es").value; });
          $("#rx-sadd").onclick = () => { const d = days(); if (!d.length) return alert("Set the dates first."); $("#rx-srows").insertAdjacentHTML("beforeend", row({ day: d[0] }, d)); };
          $("#rx-srows").onclick = e => { if (e.target.closest(".rx-sx")) e.target.closest(".rx-srow").remove(); };
        },
        collect() {
          if (!need("#rx-en", "Give the event a name.") || !need("#rx-es", "Set the first day.")) return null;
          const s1 = $("#rx-es").value, s2 = $("#rx-ee").value || s1; if (s2 < s1) { alert("The last day is before the first day."); return null; }
          const times = $$("#rx-srows .rx-srow").map(x => ({ day: x.querySelector(".rx-sd").value, time: x.querySelector(".rx-st").value, label: x.querySelector(".rx-sl").value.trim() })).filter(x => x.time || x.label);
          if (times.some(x => !x.time || !x.label || !x.day)) { alert("Each time needs a day, an hour and what it is."); return null; }
          if (times.length && !$("#rx-ep").value.trim()) { alert("Add the place, so the times are in the right local time."); $("#rx-ep").focus(); return null; }
          return { kind, name: $("#rx-en").value.trim(), start_date: s1, end_date: s2, year: +s1.slice(0, 4), note: $("#rx-eno").value.trim() || null, place: $("#rx-ep").value.trim(), country: $("#rx-ec").value.trim(), times };
        } });
    if (!r) return;
    if (r.__delete) return save(() => api(`events?id=eq.${ev.id}`, { method: "DELETE" }), "Event deleted");
    save(async () => {
      const { place, country, times, ...row2 } = r;
      row2.venue_id = place ? await placeId(place, country) : null;
      let id = ev?.id;
      if (isNew) { const [n] = await ins("events", { ...row2, owner_profile_id: R.profile.id }); id = n.id; }
      else await upd("events", ev.id, { ...row2, updated_at: new Date().toISOString() });
      await api(`sessions?event_id=eq.${id}`, { method: "DELETE" });
      if (times.length) await ins("sessions", times.map(x => ({ event_id: id, type: "other", label: x.label, local_start: `${x.day}T${x.time}:00`, duration_min: 60 })));
    }, isNew ? "Event added" : "Saved");
  }

  // ---------- put the controls on the page ----------
  function mount() {
    const st = document.createElement("style"); st.textContent = CSS; document.head.appendChild(st);
    document.body.insertAdjacentHTML("beforeend", `<div class="rx-scrim" id="rx-scrim"></div><div class="rx-sheet" id="rx-sheet" role="dialog" aria-modal="true" aria-labelledby="rx-t"><div class="rx-sh-h"><b id="rx-t"></b><button class="rx-x" id="rx-x" aria-label="Close">×</button></div><div class="rx-sh-b" id="rx-b"></div><div class="rx-sh-f" id="rx-f"></div></div>`);
    $("#rx-x").onclick = () => closeSheet(null); $("#rx-scrim").onclick = () => closeSheet(null);
    document.addEventListener("keydown", e => { if (e.key === "Escape") { if (document.body.classList.contains("rx-on")) closeSheet(null); else closeMenu(); } });
    document.body.classList.add("rx-edit");
    document.getElementById("rnx-preview")?.remove();
    const p = R.profile, photo = p.hero_url || p.photo_url;
    const initials = ((p.first_name || "?")[0] + ((p.last_name || (p.display_name || "").split(" ").slice(1).join(" "))[0] || "")).toUpperCase();
    const avatar = (cls = "rx-av") => `<span class="${cls}" style="${photo ? `background-image:url('${esc(photo)}')` : ""}">${photo ? "" : esc(initials)}</span>`;

    // app bar
    const bar = document.createElement("header"); bar.className = "rx-app"; bar.setAttribute("aria-label", "Racenxt");
    bar.innerHTML = `<div class="rx-app-in"><span class="rx-brand">RACEN<span class="x">X</span>T</span><span class="rx-status ${p.published ? "live" : ""}"><i></i>${p.published ? "Live" : "Draft"}</span><span style="flex:1"></span>
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
      const eb = document.createElement("button"); eb.type = "button"; eb.className = "rx-edit-b rx-only"; eb.innerHTML = `${PEN} Edit profile`; eb.onclick = editProfile; hero.appendChild(eb);
    }

    // your season
    const lg = s => s?.logo_url ? `<img src="${esc(s.logo_url)}" alt="">` : `<span class="rx-lgt">${esc(s?.short_name || "")}</span>`;
    const strip = document.createElement("section"); strip.className = "rx-season rx-only"; strip.id = "rx-season";
    strip.innerHTML = `<div class="rx-season-h"><div><b>Your season</b><span>${R.entries.length ? `${R.entries.length} championship${R.entries.length > 1 ? "s" : ""}` : "Add the championships you race in"}</span></div><button class="rx-b pri" id="rx-add">${PLUS} Add</button></div>
      ${R.entries.length ? `<div class="rx-rows">${R.entries.map(e => { const d = [e.car_number ? "#" + esc(e.car_number) : "", esc(e.team || ""), esc(e.vehicles?.name || "")].filter(Boolean); return `<button class="rx-row" data-e="${e.id}" style="--c:${esc(e.color || "#8a8d96")}"><span class="rx-row-lg">${lg(e.series)}</span><span class="rx-row-t"><b>${esc(e.series?.name || "")}</b><small class="${d.length ? "" : "warn"}">${d.length ? d.join(" · ") : "Add your number, team and car"}</small></span><span class="rx-row-y">${e.year}</span>${CHEV}</button>`; }).join("")}</div>` : ""}`;
    const anchor = $("#cd") || $("#ffdd") || $("#list");
    anchor.parentNode.insertBefore(strip, anchor);
    $("#rx-add").onclick = addChampionship;

    // your own events
    const evs = [...(R.customEvents || [])].sort((a, b) => a.start_date.localeCompare(b.start_date));
    const kindL = Object.fromEntries(KINDS);
    const fmtR = (a, b) => { const A = new Date(a + "T12:00:00Z"), B = new Date(b + "T12:00:00Z"), m = x => x.toLocaleDateString("en-GB", { month: "short", timeZone: "UTC" }); return a === b ? `${A.getUTCDate()} ${m(A)}` : A.getUTCMonth() === B.getUTCMonth() ? `${A.getUTCDate()}–${B.getUTCDate()} ${m(A)}` : `${A.getUTCDate()} ${m(A)} – ${B.getUTCDate()} ${m(B)}`; };
    const evCard = document.createElement("section"); evCard.className = "rx-season rx-only"; evCard.id = "rx-events";
    evCard.innerHTML = `<div class="rx-season-h"><div><b>Your events</b><span>${evs.length ? `${evs.length} event${evs.length > 1 ? "s" : ""}` : "Tests, appearances, simulator days…"}</span></div><button class="rx-b" id="rx-eadd">${PLUS} Add</button></div>
      ${evs.length ? `<div class="rx-rows">${evs.map(e => `<button class="rx-row rx-row-ev" data-ev="${e.id}" style="--c:#8a8d96"><span class="rx-row-d">${fmtR(e.start_date, e.end_date)}<small>${e.start_date.slice(0, 4)}</small></span><span class="rx-row-t"><b>${esc(e.name)}</b><small>${esc([kindL[e.kind || "other"], e.venues?.name].filter(Boolean).join(" · "))}</small></span><span></span>${CHEV}</button>`).join("")}</div>` : ""}`;
    strip.insertAdjacentElement("afterend", evCard);
    $("#rx-eadd").onclick = () => editEvent();
    evCard.querySelectorAll("[data-ev]").forEach(b => b.onclick = () => editEvent(evs.find(x => x.id === b.dataset.ev)));

    // partners
    const sps = [...(R.sponsors || [])].sort((a, b) => (a.sort || 0) - (b.sort || 0));
    const spCard = document.createElement("section"); spCard.className = "rx-season rx-only"; spCard.id = "rx-partners";
    spCard.innerHTML = `<div class="rx-season-h"><div><b>Partners</b><span>${sps.length ? `${sps.length} logo${sps.length > 1 ? "s" : ""} on your page` : "Add your partners' logos"}</span></div><button class="rx-b" id="rx-padd">${PLUS} Add</button></div>
      ${sps.length ? `<div class="rx-rows">${sps.map((x, i) => `<div class="rx-prow"><button class="rx-prow-main" data-sp="${x.id}"><span class="rx-plogo"><img src="${esc(x.display === "white" ? (x.logo_white_url || x.logo_original_url) : (x.logo_original_url || x.logo_white_url))}" alt=""></span><span class="rx-row-t"><b>${esc(x.name)}</b><small>${x.link_url ? esc(x.link_url.replace(/^https?:\/\/(www\.)?/, "")) : "No link"}</small></span></button><span class="rx-ord"><button aria-label="Move up" data-up="${x.id}"${i ? "" : " disabled"}>▲</button><button aria-label="Move down" data-dn="${x.id}"${i < sps.length - 1 ? "" : " disabled"}>▼</button></span></div>`).join("")}</div>` : ""}`;
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
        <button role="menuitem" data-a="events">${CAL}Your events</button>
        <button role="menuitem" data-a="partners">${STAR}Partners</button>
        <button role="menuitem" data-a="preview">${EYE}Preview as a fan</button>
        <button role="menuitem" data-a="copy">${LINK}Copy page link</button>
        <hr>${others.length ? `<div class="rx-menu-l">Your other pages</div>${others.map(x => `<button role="menuitem" data-slug="${esc(x.profiles.slug)}" data-id="${x.profiles.id}">${USER}${esc(x.profiles.display_name)}</button>`).join("")}` : ""}
        <button role="menuitem" data-a="new">${PLUS}Create another page</button>
        <hr><button role="menuitem" data-a="out" class="rx-out">${OUT}Log out</button>`;
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
