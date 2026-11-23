const WATCH = RNX.watch, TV = RNX.tv || {};
const PLAY = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M7 4.5v15l13-7.5z"/></svg>';
const W_ICON = {
  stream: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9.2" fill="none" stroke="currentColor" stroke-width="1.6"/><path fill="currentColor" d="M10 8.3v7.4l6.2-3.7z"/></svg>',
  tv: '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="2.8" y="6" width="18.4" height="12.4" rx="2.4"/><path d="M8.5 21h7M9 2.8l3 3.2 3-3.2"/></svg>',
  out: '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg>',
  x: '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>'
};
const hostOf = u => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch(e){ return ""; } };
// Where to watch: the championship's Official stream + TV broadcast (this race's own page if it has one, else the channels by country)
const LKI = {
  link: '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/></svg>',
  timing: '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 2M10 2h4M12 2v3"/></svg>',
  ticket: '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M3 8a2 2 0 0 0 2-2h14a2 2 0 0 0 2 2v2a2 2 0 0 0 0 4v2a2 2 0 0 0-2 2H5a2 2 0 0 0-2-2v-2a2 2 0 0 0 0-4z"/></svg>'
};
const lkIcon = l => { const t = (l || "").toLowerCase(); return /watch|stream|tv|broadcast|live$/.test(t) ? W_ICON.stream : /timing|tracker/.test(t) ? LKI.timing : /ticket/.test(t) ? LKI.ticket : LKI.link; };
// the small link icon on a custom event's card: opens its links in the same popup
const linkBtn = ev => ev.links && ev.links.length ? `<button type="button" class="lk-btn wbtn" data-i="${EVENTS.indexOf(ev)}" aria-haspopup="dialog" aria-label="${T("wLinks")} – ${esc0(L(ev.name))}" title="${T("wLinks")}">${LKI.link}</button>` : "";
function watchLinks(ev){
  const st = WATCH[ev.series] || "", tv = ev.watch || TV[ev.series] || "";
  if (!st && !tv) return ev.links && ev.links.length ? `<button type="button" class="watch wbtn" data-i="${EVENTS.indexOf(ev)}" aria-haspopup="dialog">${LKI.link}${T("wLinks")}</button>` : "";
  return `<button type="button" class="watch wbtn" data-i="${EVENTS.indexOf(ev)}" aria-haspopup="dialog">${PLAY}${T("watch")}</button>`;
}
let wLast = null;
function openWatch(ev, from){
  const st = WATCH[ev.series] || "", tv = ev.watch || TV[ev.series] || "";
  const row = (href, icon, title, sub) => `<a class="ws-row" href="${esc0(href)}" target="_blank" rel="noopener"><span class="ws-ic">${W_ICON[icon]}</span><span class="ws-t"><b>${title}</b><small>${esc0(sub)}</small></span><span class="ws-go">${W_ICON.out}</span></a>`;
  const el = document.createElement("div");
  el.className = "ws"; el.setAttribute("role", "dialog"); el.setAttribute("aria-modal", "true"); el.setAttribute("aria-labelledby", "ws-h");
  el.style.setProperty("--c", (RNX.color && RNX.color[ev.series]) || "#ff6a1f");
  el.innerHTML = `<div class="ws-back" data-close></div><div class="ws-card"><span class="ws-grab" aria-hidden="true"></span>
    <div class="ws-head"><div><small>${st || tv ? T("wTitle") : T("wLinks")}</small><h3 id="ws-h">${esc0(L(ev.name))}</h3></div><button type="button" class="ws-x" data-close aria-label="${T("wClose")}">${W_ICON.x}</button></div>
    <div class="ws-list">${st ? row(st, "stream", T("wStream"), hostOf(st)) : ""}${tv ? row(tv, "tv", T("wTv"), ev.watch ? T("wSubRace") : T("wSubAll")) : ""}${(ev.links || []).map(l => `<a class="ws-row" href="${esc0(l.url)}" target="_blank" rel="noopener"><span class="ws-ic">${lkIcon(l.label)}</span><span class="ws-t"><b>${esc0(l.label)}</b><small>${esc0(hostOf(l.url))}</small></span><span class="ws-go">${W_ICON.out}</span></a>`).join("")}</div>
    ${st || tv ? `<p class="ws-note">${T("wOpens")}</p>` : ""}</div>`;
  document.body.appendChild(el);
  wLast = from || null;
  document.documentElement.classList.add("ws-lock");
  requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add("on")));
  el.querySelector(".ws-row, .ws-x").focus({ preventScroll: true });
  const close = () => { el.classList.remove("on"); document.documentElement.classList.remove("ws-lock"); document.removeEventListener("keydown", key, true); setTimeout(() => el.remove(), 320); if (wLast) wLast.focus({ preventScroll: true }); };
  const key = e => {
    if (e.key === "Escape"){ e.stopPropagation(); close(); }
    if (e.key === "Tab"){ const f = [...el.querySelectorAll("a,button")]; const i = f.indexOf(document.activeElement); if (e.shiftKey && i <= 0){ e.preventDefault(); f[f.length - 1].focus(); } else if (!e.shiftKey && i === f.length - 1){ e.preventDefault(); f[0].focus(); } }
  };
  document.addEventListener("keydown", key, true);
  el.addEventListener("click", e => { if (e.target.closest("[data-close]")) close(); else if (e.target.closest(".ws-row")) setTimeout(close, 150); });
  // swipe down to close on phones
  const card = el.querySelector(".ws-card"); let y0 = null, dy = 0;
  card.addEventListener("touchstart", e => { if (card.scrollTop <= 0) { y0 = e.touches[0].clientY; dy = 0; card.style.transition = "none"; } }, { passive: true });
  card.addEventListener("touchmove", e => { if (y0 == null) return; dy = Math.max(0, e.touches[0].clientY - y0); card.style.transform = `translateY(${dy}px)`; }, { passive: true });
  card.addEventListener("touchend", () => { if (y0 == null) return; card.style.transition = ""; card.style.transform = ""; if (dy > 90) close(); y0 = null; });
}
document.addEventListener("click", e => { const b = e.target.closest(".wbtn"); if (b) openWatch(EVENTS[+b.dataset.i], b); });
