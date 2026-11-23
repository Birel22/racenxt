"""Builds racenxt/docs/fan.html from the Louis Race Hub page, replacing hard-coded data with data from the database."""
import re, sys
src = open('/home/claude/louis-calendar/index.html', encoding='utf-8').read()
s = src

def rep(old, new, count=1):
    global s
    assert old in s, ("missing", old[:80])
    s = s.replace(old, new, count)

def cut(start_marker, end_marker, new, include_end=True):
    """replace text from start_marker through end_marker"""
    global s
    i = s.index(start_marker); j = s.index(end_marker, i) + (len(end_marker) if include_end else 0)
    s = s[:i] + new + s[j:]

# ---------- <head> ----------
s = re.sub(r'<title>.*?</title>', '<title>Race Hub</title>', s, count=1, flags=re.S)
s = re.sub(r'\n<meta (name|property)="(description|og:[^"]*|twitter:[^"]*)"[^>]*>', '', s)
s = re.sub(r'\n<link rel="(manifest|apple-touch-icon|icon)"[^>]*>', '', s)
rep('</head>', '<script src="config.js"></script>\n<script src="rnx-social.js"></script>\n<script src="rnx-ui.js"></script>\n<script src="rnx-edit.js"></script>\n<script src="rnx-data.js"></script>\n</head>')
# car photo: only when the user added one (each user adds their own livery)
rep('<img class="car-img" src="${c.img}" alt="${esc(c.name)}">', '${c.img ? `<img class="car-img" src="${c.img}" alt="${esc(c.name)}">` : ""}')

# ---------- markup ----------
cut('<img class="photo"', '<div class="lang"',
    '<img class="photo" id="rnx-photo" src="" alt="" data-i18n-alt="photoAlt">\n      <img class="logo" id="rnx-logo" src="" alt="" hidden>\n      <div class="lang"', include_end=True)
# remove the duplicated lang div opening we just re-added
s = s.replace('<div class="lang"<div class="lang"', '<div class="lang"')
s = re.sub(r'<nav class="socials"[^>]*>.*?</nav>', '<nav class="socials rnx-socials" data-i18n-aria="socials" aria-label="Social media"></nav>', s, flags=re.S)
s = re.sub(r'(<div class="partners" data-i18n-aria="partners" aria-label="Partners">).*?(</div>)', r'\1\2', s, count=1, flags=re.S)
s = re.sub(r'(<div class="partners partners-foot" data-i18n-aria="partners" aria-label="Partners">).*?(</div>)', r'\1\2', s, count=1, flags=re.S)
s = re.sub(r'(<li role="option" tabindex="-1" data-f="all".*?</li>).*?(\s*</ul>)', r'\1\2', s, count=1, flags=re.S)
s = re.sub(r'<div class="legend">.*?</div>', '<div class="legend" id="rnx-legend"></div>', s, count=1, flags=re.S)

# ---------- script: wrap in async boot ----------
rep('<script>\n// ===== Langue / Language =====', '<script>\n(async function boot(){\nconst RNX = await rnxLoad();\nif (!RNX) return;\n// ===== Langue / Language =====')
rep('pageCue();\n</script>', 'pageCue();\n})();\n</script>')

# ---------- data blocks ----------
cut('// ===== Courses / Races =====', 'const CLOCK =', '''// ===== Courses / Races (from the database) =====
const P = RNX.profile, FIRST = RNX.first, SEASON = RNX.season;
for (const lg of ["en", "fr"]) {
  const t = I18N[lg], fn = esc0(FIRST);
  t.docTitle = `${FIRST} Race Hub`; t.title = `${fn} <em>Race Hub</em>`; t.photoAlt = P.display_name;
  t.eyebrow = `${P.display_name} · ${lg === "en" ? "Season" : "Saison"} ${SEASON}`;
  t.season = `${lg === "en" ? "Season" : "Saison"} ${SEASON}`;
  t.subTitle = lg === "en" ? `Subscribe to ${FIRST}’s calendar` : `S’abonner au calendrier de ${FIRST}`;
  t.shareText = lg === "en" ? `Follow ${FIRST} at {race}, {dates} 🏁` : `Suis ${FIRST} à {race}, {dates} 🏁`;
  for (const se of RNX.series) t["n_" + se.slug] = se.name;
}
const EVENTS = RNX.events;
const CLOCK =''', include_end=True)
rep('const LOGO = {alms:"lg-alms.png", imsa:"lg-imsa.png", elms:"lg-elms.png", lm:"lg-lm.png"};', 'const LOGO = RNX.logo;')
rep('const LABEL = {alms:"ALMS", imsa:"IMSA", elms:"ELMS", lm:"Le Mans"};', 'const LABEL = RNX.label;')
cut('// ===== Horaires / Schedules', '// TT-END', '// ===== Horaires / Schedules (from the database) =====\nconst TIMETABLES = RNX.timetables;')
s = re.sub(r'const OFFICIAL = \{[^\n]*\};', 'const OFFICIAL = RNX.official;', s, count=1)
rep('const ICS_BASE = "";', 'const ICS_BASE = "";')
s = re.sub(r'const SUB_URL = [^\n]*;', 'const SUB_URL = rnxSubUrl(P.slug, "all");', s, count=1)
rep('window.location.href = ICS_BASE + `ics/${ev.id}-m${mask}.ics`;',
    'window.location.href = rnxIcsUrl(P.slug, ev.uuid, ks.map(k => t.sessions[k].id));')
s = re.sub(r'const SUBS = \[[^\n]*\];', 'const SUBS = [["sub_all","sub_all_d","all"],["sub_qr","sub_qr_d","qr"],["sub_r","sub_r_d","r"]];', s, count=1)
rep('`<a class="sub-opt" href="webcal://birel22.github.io/louis-calendar/${f}">', '`<a class="sub-opt" href="${rnxSubUrl(P.slug, f)}">')
cut('const CAR_OF = {', 'function fillCar(series){', 'const CAR_OF = RNX.carOf;\nconst TEAM = RNX.team;\nconst CARS = RNX.cars;\nfunction fillCar(series){')
rep('const c = CARS[CAR_OF[series]], tm = TEAM[series];', 'const c = CARS[CAR_OF[series]], tm = TEAM[series]; if (!c) return;')
rep('${T("drivers")}: Louis Delétraz, ${tm.mates.map(esc).join(", ")}', '${T("drivers")}: ${[P.display_name, ...tm.mates].map(esc).join(", ")}')
rep('const PAGE_URL = "https://birel22.github.io/louis-calendar/";', 'const PAGE_URL = RNX.pageUrl;')
rep('navigator.share({title:"Louis Race Hub",', 'navigator.share({title:`${FIRST} Race Hub`,')
s = re.sub(r'const WATCH = \{[^\n]*\};', 'const WATCH = RNX.watch;', s, count=1)
rep('`🏁 *Louis Delétraz · ${L(ev.name)}*`', '`🏁 *${P.display_name} · ${L(ev.name)}*`')
# car button only when a vehicle exists for the series
s = s.replace('<button class="car-btn" data-series="${ev.series}" aria-label="${T("carSpecs")} – ${esc(CARS[CAR_OF[ev.series]].name)}"', '${CARS[CAR_OF[ev.series]] ? `<button class="car-btn" data-series="${ev.series}" aria-label="${T("carSpecs")} – ${esc(CARS[CAR_OF[ev.series]].name)}"')
s = s.replace('${CARICON}<span class="car-lbl">${T("carShort")}</span></button></div>', '${CARICON}<span class="car-lbl">${T("carShort")}</span></button>` : ""}</div>')
s = s.replace('<button class="watch ghost cd-car" data-series="${ev.series}" aria-label="${T("carSpecs")} – ${esc(CARS[CAR_OF[ev.series]].name)}">${CARICON}${T("carShort")}</button>',
              '${CARS[CAR_OF[ev.series]] ? `<button class="watch ghost cd-car" data-series="${ev.series}" aria-label="${T("carSpecs")} – ${esc(CARS[CAR_OF[ev.series]].name)}">${CARICON}${T("carShort")}</button>` : ""}')
s = s.replace('<a class="watch" href="${WATCH[ev.series]}"', '${(ev.watch || WATCH[ev.series]) ? `<a class="watch" href="${ev.watch || WATCH[ev.series]}"')
s = s.replace('${T("watch")}</a></div>`;', '${T("watch")}</a>` : ""}</div>`;')
rep('<img class="ev-logo${ev.series===\'lm\'?\' sq\':\'\'}" src="${LOGO[ev.series]}" alt="${LABEL[ev.series]}">',
    '${LOGO[ev.series] ? `<img class="ev-logo${RNX.square[ev.series]?\' sq\':\'\'}" src="${LOGO[ev.series]}" alt="${LABEL[ev.series]}">` : `<span class="ev-logo-txt">${esc(LABEL[ev.series])}</span>`}')
# where to watch: official stream (championship) + TV broadcasters (this race's page, or the championship's list)
s = s.replace('${(ev.watch || WATCH[ev.series]) ? `<a class="watch" href="${ev.watch || WATCH[ev.series]}" target="_blank" rel="noopener"><svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M7 4.5v15l13-7.5z"/></svg>${T("watch")}</a>` : ""}', '${watchLinks(ev)}')
assert '${watchLinks(ev)}' in s, "watch button not found"
rep('const WATCH = RNX.watch;', open('/home/claude/racenxt/tools/fan_watch.js').read().strip())
rep('en:{docTitle:', 'en:{wTitle:"Where to watch", wStream:"Official stream", wTv:"TV broadcast", wSubRace:"Channels for this race", wSubAll:"Channels in your country", wOpens:"Opens the official website", wClose:"Close", docTitle:')
rep('fr:{docTitle:', 'fr:{wTitle:"Où regarder", wStream:"Stream officiel", wTv:"Diffusion TV", wSubRace:"Chaînes pour cette course", wSubAll:"Chaînes dans ton pays", wOpens:"Ouvre le site officiel", wClose:"Fermer", docTitle:')
s = s.replace('</style>', open('/home/claude/racenxt/tools/fan_watch.css').read() + open('/home/claude/racenxt/tools/fan_ui.css').read() + '</style>', 1)
# close the schedule sheet with a short exit animation (reopening cancels it)
s = s.replace('document.getElementById("tt").hidden = false;', 'document.getElementById("tt").classList.remove("closing"); document.getElementById("tt").hidden = false;')
rep('function closeTT(){ ttOpenIdx = null; document.getElementById("tt").hidden = true; unlockScroll(); if (ttLastFocus) ttLastFocus.focus(); }', 'function closeTT(){ ttOpenIdx = null; const tt = document.getElementById("tt"); tt.classList.add("closing"); setTimeout(() => { if (tt.classList.contains("closing")) { tt.hidden = true; tt.classList.remove("closing"); } }, 240); unlockScroll(); if (ttLastFocus) ttLastFocus.focus(); }')
# single-day events (the athlete's own: tests, appearances) and no race length
rep("return {big:`${a.getDate()}–${b.getDate()}`,", "return {big: a.getTime()===b.getTime() ? `${a.getDate()}` : `${a.getDate()}–${b.getDate()}`,")
rep('<span class="ev-dur" title="${T("raceLength")}">${CLOCK}${esc(ev.dur)}</span>', '${ev.dur ? `<span class="ev-dur" title="${T("raceLength")}">${CLOCK}${esc(ev.dur)}</span>` : ""}')
# small helper used by the I18N patch
rep('const T = k => I18N[LANG][k];', 'const T = k => I18N[LANG][k];\nconst esc0 = s => String(s).replace(/[&<>"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",\'"\':"&quot;"}[c]));')
rep('// ===== Langue / Language =====\nconst I18N', '// ===== Langue / Language =====\nrnxDecorate(RNX);\nconst I18N')

s = s.replace("@louisdeletraz-calendar", "@racenxt")
for bad in ["louis-calendar", "Louis Delétraz", "louisdeletraz"]:
    for m in re.finditer(re.escape(bad), s):
        print("leftover:", bad, s[max(0,m.start()-60):m.end()+40].replace("\n"," "))
# months are grouped by year too (a custom event in Nov 2026 doesn't hide among Nov 2027 races)
rep("shown.forEach(e => { const m = d(e.s).getMonth(); (groups[m] ||= []).push(e); });\n  list.innerHTML = Object.keys(groups).map(Number).sort((a,b)=>a-b).map(m => `",
    "shown.forEach(e => { const k = e.s.slice(0,7); (groups[k] ||= []).push(e); });\n  const multiY = new Set(Object.keys(groups).map(k => k.slice(0,4))).size > 1;\n  list.innerHTML = Object.keys(groups).sort().map(k => { const m = +k.slice(5,7)-1, yr = +k.slice(0,4); return `")
rep("<h2>${MONTHS[LANG][m]}</h2>", '<h2>${MONTHS[LANG][m]}${multiY && yr !== SEASON ? ` <span class="yr">${yr}</span>` : ""}</h2>')
rep('    </section>`).join("");', '    </section>`; }).join("");')
rep('${groups[m].map(ev =>', '${groups[k].map(ev =>')
# a custom event's own links (Where to watch, Live timing...) as buttons on its card
rep("${ev.note?`<div class=\"note\">${esc(L(ev.note))}</div>`:''}",
    "${ev.note?`<div class=\"note\">${esc(L(ev.note))}</div>`:''}${ev.links && ev.links.length ? `<div class=\"ev-links\">${ev.links.map(l => `<a class=\"ev-link\" href=\"${esc(l.url)}\" target=\"_blank\" rel=\"noopener\">${linkIco(l.label)}<span>${esc(l.label)}</span><svg class=\"ext\" viewBox=\"0 0 24 24\" aria-hidden=\"true\"><path d=\"M7 17L17 7M9 7h8v8\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2.2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/></svg></a>`).join(\"\")}</div>` : \"\"}")
rep("let filter = \"all\";", """const LICO = {
  tv: '<svg viewBox="0 0 24 24" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="6" width="18" height="12" rx="2.5"/><path d="M10 10l4 2-4 2z" fill="currentColor"/></g></svg>',
  timing: '<svg viewBox="0 0 24 24" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 2M10 2h4M12 2v3"/></g></svg>',
  ticket: '<svg viewBox="0 0 24 24" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M3 8a2 2 0 0 0 2-2h14a2 2 0 0 0 2 2v2a2 2 0 0 0 0 4v2a2 2 0 0 0-2 2H5a2 2 0 0 0-2-2v-2a2 2 0 0 0 0-4z"/></g></svg>',
  flag: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 21V4M5 4h11l-2 4 2 4H5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  link: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>'
};
const linkIco = l => { const t = (l || "").toLowerCase(); return /watch|stream|tv|broadcast/.test(t) ? LICO.tv : /timing|tracker/.test(t) ? LICO.timing : /ticket/.test(t) ? LICO.ticket : /result|standing/.test(t) ? LICO.flag : LICO.link; };
let filter = "all";""")

open('/home/claude/racenxt/docs/fan.html', 'w', encoding='utf-8').write(s)
# GitHub Pages serves 404.html for any unknown path, e.g. /racenxt/louis -> fan page for "louis"
s404 = s.replace('<meta charset="utf-8">', '<meta charset="utf-8">\n<base href="/racenxt/">', 1)
open('/home/claude/racenxt/docs/404.html', 'w', encoding='utf-8').write(s404)
import subprocess; subprocess.run(['python3', '/home/claude/racenxt/tools/stamp.py'])
subprocess.run(['python3', '/home/claude/racenxt/tools/previews.py', 'refresh'])  # athletes' pages with their link preview
print("ok", len(s))
