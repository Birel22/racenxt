// Racenxt: shows who a social username belongs to, so users can confirm "this is me".
// Platforms don't allow public account search, so we look up the exact username as it's typed.
(function () {
  const C = window.RNX_CONFIG;
  const NAMES = { instagram: "Instagram", x: "X", tiktok: "TikTok", youtube: "YouTube", facebook: "Facebook" };
  // platforms whose public profile page tells us reliably whether an account exists
  const PROFILE = { instagram: u => `https://www.instagram.com/${u}`, x: u => `https://x.com/${u}`, tiktok: u => `https://www.tiktok.com/@${u}`, youtube: u => `https://www.youtube.com/@${u}`, facebook: u => `https://www.facebook.com/${u}` };
  const LOOKUP = { x: true, tiktok: true };
  const HOSTS = { instagram: /instagram\.com/i, x: /(x|twitter)\.com/i, tiktok: /tiktok\.com/i, youtube: /youtube\.com/i, facebook: /(facebook|fb)\.com/i };
  const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const CSS = `.rxs{margin-top:8px;font:14px/1.35 Barlow,system-ui,sans-serif;color:#a9abb2}
  .rxs:empty{display:none}
  .rxs-card{display:flex;align-items:center;gap:12px;padding:10px 12px;border-radius:12px;background:#15161b;border:1px solid #33363d}
  .rxs-card img{width:42px;height:42px;border-radius:50%;object-fit:cover;flex:none;background:#22242b}
  .rxs-card .t{flex:1;min-width:0;display:grid}
  .rxs-card b{color:#f4f4f2;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .rxs-card small{color:#7d808a}
  .rxs-yes{height:34px;padding:0 12px;border-radius:999px;border:1px solid #FF5A1F;background:#FF5A1F;color:#fff;font:600 13.5px Barlow,system-ui,sans-serif;cursor:pointer;white-space:nowrap}
  .rxs-card.ok{border-color:rgba(95,207,110,.5)}
  .rxs-ok{color:#5fcf6e;font-weight:600;white-space:nowrap}
  .rxs-dot{display:inline-block;width:14px;height:14px;border:2px solid #3b3e47;border-top-color:#FF5A1F;border-radius:50%;vertical-align:-2px;margin-right:6px;animation:rxs 0.9s linear infinite}
  @keyframes rxs{to{transform:rotate(360deg)}}
  @media (prefers-reduced-motion:reduce){.rxs-dot{animation-duration:3s}}
  .rxs a{color:#FF5A1F;font-weight:600;text-decoration:none}
  .rxs .no{color:#f2b20f}`;
  let styled = false;
  // username out of whatever was typed: "@name", "name" or a full profile link
  function userOf(platform, v) {
    v = (v || "").trim();
    if (/^https?:\/\//i.test(v) || HOSTS[platform].test(v)) {
      try { const u = new URL(/^https?:/i.test(v) ? v : "https://" + v); const seg = u.pathname.split("/").filter(Boolean)[0] || ""; return seg.replace(/^@/, ""); } catch (e) { return ""; }
    }
    return v.replace(/^@/, "");
  }
  window.rnxSocialWatch = function (input, platform, getToken) {
    if (!input || !NAMES[platform]) return;
    if (!styled) { const s = document.createElement("style"); s.textContent = CSS; document.head.appendChild(s); styled = true; }
    const box = document.createElement("div"); box.className = "rxs"; box.setAttribute("aria-live", "polite");
    input.insertAdjacentElement("afterend", box);
    let t, seq = 0;
    const run = async () => {
      const raw = (input.value || "").trim(), u = userOf(platform, raw), my = ++seq;
      const isLink = /^https?:\/\//i.test(raw) || HOSTS[platform].test(raw);
      // YouTube and Facebook can't be looked up reliably, and a pasted link needs no lookup: open it and confirm
      if (raw && (!LOOKUP[platform] || isLink)) {
        const open = isLink ? (/^https?:/i.test(raw) ? raw : "https://" + raw) : PROFILE[platform](u);
        if (!/^https?:\/\/[^\s<>"]+$/.test(open)) { box.innerHTML = ""; return; }
        box.innerHTML = `<div class="rxs-card"><span class="t"><b>${esc(open.replace(/^https?:\/\/(www\.)?/i, ""))}</b><small><a href="${esc(open)}" target="_blank" rel="noopener">Open it ↗</a> to check it's yours</small></span><button type="button" class="rxs-yes">This is me</button></div>`;
        box.querySelector(".rxs-yes").onclick = () => { box.querySelector(".rxs-card").classList.add("ok"); box.querySelector(".rxs-yes").outerHTML = `<span class="rxs-ok">✓ Confirmed</span>`; input.dataset.confirmed = "1"; };
        return;
      }
      if (!/^[A-Za-z0-9._-]{1,60}$/.test(u)) { box.innerHTML = ""; return; }
      box.innerHTML = `<span class="rxs-dot"></span>Looking for @${esc(u)} on ${NAMES[platform]}…`;
      let r = null;
      try {
        const tok = await getToken();
        const res = await fetch(`${C.url}/functions/v1/social?p=${platform}&u=${encodeURIComponent(u)}`, { headers: { apikey: C.key, Authorization: `Bearer ${tok || C.key}` } });
        r = res.ok ? await res.json() : { found: null, url: "" };
      } catch (e) { r = { found: null, url: "" }; }
      if (my !== seq) return;
      const open = r.url || "";
      if (r.found === true) {
        box.innerHTML = `<div class="rxs-card"><img src="${esc(r.image)}" alt="" referrerpolicy="no-referrer" onerror="this.style.visibility='hidden'"><span class="t"><b>${esc(r.name)}</b><small>@${esc(u)} · ${NAMES[platform]}</small></span><button type="button" class="rxs-yes">This is me</button></div>`;
        box.querySelector(".rxs-yes").onclick = () => { box.querySelector(".rxs-card").classList.add("ok"); box.querySelector(".rxs-yes").outerHTML = `<span class="rxs-ok">✓ Connected</span>`; input.dataset.confirmed = "1"; };
      } else if (r.found === false) {
        box.innerHTML = `<span class="no">No ${NAMES[platform]} account found for @${esc(u)}.</span> Check the spelling.`;
      } else {
        box.innerHTML = `${NAMES[platform]} doesn't let us check automatically. ${open ? `<a href="${esc(open)}" target="_blank" rel="noopener">Open @${esc(u)} ↗</a> to make sure it's you.` : ""}`;
      }
    };
    input.addEventListener("input", () => { clearTimeout(t); input.dataset.confirmed = ""; t = setTimeout(run, 650); });
    if (input.value.trim()) run();
  };
})();
