const WATCH = RNX.watch, TV = RNX.tv || {};
const PLAY = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M7 4.5v15l13-7.5z"/></svg>';
const hostOf = u => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch(e){ return ""; } };
// Where to watch: the championship's official stream + TV broadcasters (this race's own page if it has one, else the full list)
function watchLinks(ev){
  const st = WATCH[ev.series] || "", tv = ev.watch || TV[ev.series] || "";
  if (!st && !tv) return "";
  if (!st || !tv) return `<a class="watch" href="${esc0(st || tv)}" target="_blank" rel="noopener">${PLAY}${T("watch")}</a>`;
  return `<span class="wdrop"><button type="button" class="watch wbtn" aria-haspopup="true" aria-expanded="false">${PLAY}${T("watch")}</button><span class="wmenu" role="menu" hidden>`
    + `<a role="menuitem" href="${esc0(st)}" target="_blank" rel="noopener"><b>${T("wStream")}</b><small>${esc0(hostOf(st))}</small></a>`
    + `<a role="menuitem" href="${esc0(tv)}" target="_blank" rel="noopener"><b>${ev.watch ? T("wTvRace") : T("wTv")}</b><small>${T("wTvSub")}</small></a></span></span>`;
}
document.addEventListener("click", e => {
  const b = e.target.closest(".wbtn");
  document.querySelectorAll(".wmenu").forEach(m => { if (!b || m.previousElementSibling !== b){ m.hidden = true; m.previousElementSibling.setAttribute("aria-expanded", "false"); } });
  if (b){ const m = b.nextElementSibling; m.hidden = !m.hidden; b.setAttribute("aria-expanded", String(!m.hidden)); if (!m.hidden) m.querySelector("a").focus(); }
});
document.addEventListener("keydown", e => { if (e.key === "Escape") document.querySelectorAll(".wmenu:not([hidden])").forEach(m => { m.hidden = true; m.previousElementSibling.setAttribute("aria-expanded", "false"); m.previousElementSibling.focus(); }); });
