// ===== Search an event (the small magnifier next to the filter) =====
let Q = "";
const evNorm = s => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const SER_NAME = Object.fromEntries((RNX.series || []).map(s => [s.slug, s.name]));
const evMatch = e => {
  if (!Q) return true;
  const hay = evNorm([L(e.name), L(e.where), L(e.country), SER_NAME[e.series], LABEL[e.series], e.note ? L(e.note) : ""].join(" "));
  return evNorm(Q).split(/\s+/).filter(Boolean).every(w => hay.includes(w));
};
function ffSearchSync(){
  const q = document.getElementById("ff-q"); if (q) q.placeholder = T("searchPh");
  const b = document.getElementById("ff-sbtn"); if (b) { b.setAttribute("aria-label", T("searchEv")); b.title = T("searchEv"); }
}
(function(){
  const dd = document.getElementById("ffdd"), btn = document.getElementById("ff-sbtn"), box = document.getElementById("ff-search"), q = document.getElementById("ff-q"), x = document.getElementById("ff-qx");
  if (!btn) return;
  let t = null;
  const open = () => { dd.classList.add("searching"); box.hidden = false; q.focus(); };
  const close = () => { dd.classList.remove("searching"); box.hidden = true; if (Q) { Q = ""; q.value = ""; render(); } btn.focus(); };
  btn.addEventListener("click", open);
  x.addEventListener("click", () => { if (q.value) { q.value = ""; Q = ""; render(); q.focus(); } else close(); });
  q.addEventListener("input", () => { clearTimeout(t); t = setTimeout(() => { Q = q.value.trim(); render(); }, 120); });
  q.addEventListener("keydown", e => { if (e.key === "Escape") { e.preventDefault(); close(); } if (e.key === "Enter") { e.preventDefault(); q.blur(); } });
})();
