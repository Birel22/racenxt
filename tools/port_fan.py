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
rep('en:{docTitle:', 'en:{wTitle:"Where to watch", wLinks:"Links", searchEv:"Search events", searchPh:"Search an event, a place…", noEv:"No event found", wStream:"Official stream", wTv:"TV broadcast", wSubRace:"Channels for this race", wSubAll:"Channels in your country", wOpens:"Opens the official website", wClose:"Close", docTitle:')
rep('fr:{docTitle:', 'fr:{wTitle:"Où regarder", wLinks:"Liens", searchEv:"Chercher un événement", searchPh:"Chercher un événement, un lieu…", noEv:"Aucun événement trouvé", wStream:"Stream officiel", wTv:"Diffusion TV", wSubRace:"Chaînes pour cette course", wSubAll:"Chaînes dans ton pays", wOpens:"Ouvre le site officiel", wClose:"Fermer", docTitle:')
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


# custom events: their own car, and one small link icon (opens the links popup) after Schedule / Car
s = s.replace('CARS[CAR_OF[ev.series]]', 'CARS[CAR_OF[ev.carKey || ev.series]]')
rep('class="car-btn" data-series="${ev.series}"', 'class="car-btn" data-series="${ev.carKey || ev.series}"')
rep('class="watch ghost cd-car" data-series="${ev.series}"', 'class="watch ghost cd-car" data-series="${ev.carKey || ev.series}"')
rep('<span class="car-lbl">${T("carShort")}</span></button>` : ""}</div>', '<span class="car-lbl">${T("carShort")}</span></button>` : ""}${linkBtn(ev)}</div>')

# "events" rather than "races" (custom events are on the page too), and a search next to the filter
rep('allChamps:"All races"', 'allChamps:"All events"'); rep('allChamps:"Toutes les courses"', 'allChamps:"Tous les événements"')
rep('raceWord:"Race"', 'raceWord:"Event"'); rep('raceWord:"Course"', 'raceWord:"Événement"')
rep('nextRace:"Next race"', 'nextRace:"Next event"'); rep('nextRace:"Prochaine course"', 'nextRace:"Prochain événement"')
rep('moreRaces:"More races"', 'moreRaces:"More events"'); rep('moreRaces:"Plus de courses"', 'moreRaces:"Plus d’événements"')
rep('d="M6 9l6 6 6-6"/></svg></button>', 'd="M6 9l6 6 6-6"/></svg></button><button type="button" class="ff-sbtn" id="ff-sbtn" aria-label="Search events"><svg viewBox="0 0 24 24" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/></g></svg></button></div><div class="ff-search" id="ff-search" hidden><svg viewBox="0 0 24 24" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/></g></svg><input id="ff-q" type="search" enterkeyhint="search" autocomplete="off" autocorrect="off" spellcheck="false" aria-label="Search events"><button type="button" id="ff-qx" aria-label="Close"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg></button></div>')
rep('<button type="button" class="ff-btn" id="ff-btn"', '<div class="ff-l"><button type="button" class="ff-btn" id="ff-btn"')
rep('const shown = EVENTS.filter(e => filter==="all" || e.series===filter);', 'const shown = EVENTS.filter(e => (filter==="all" || e.series===filter) && evMatch(e)); ffSearchSync();')
rep('    </section>`; }).join("");', '    </section>`; }).join("") + (Q && !shown.length ? `<p class="ff-none">${T("noEv")}</p>` : "");')
rep('let filter = "all";', open('/home/claude/racenxt/tools/fan_search.js').read().strip() + '\nlet filter = "all";')
open('/home/claude/racenxt/docs/fan.html', 'w', encoding='utf-8').write(s)
# GitHub Pages serves 404.html for any unknown path, e.g. /louis -> fan page for "louis"
s404 = s.replace('<meta charset="utf-8">', '<meta charset="utf-8">\n<base href="/">', 1)
open('/home/claude/racenxt/docs/404.html', 'w', encoding='utf-8').write(s404)
import subprocess; subprocess.run(['python3', '/home/claude/racenxt/tools/stamp.py'])
subprocess.run(['python3', '/home/claude/racenxt/tools/previews.py', 'refresh'])  # athletes' pages with their link preview
print("ok", len(s))
