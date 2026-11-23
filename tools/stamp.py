"""Adds a version to every script link in the pages (e.g. rnx-edit.js?v=20261123-0150),
so phones load the new code on a normal refresh instead of a cached copy. Run before each push."""
import re, time, pathlib
v = time.strftime("%Y%m%d-%H%M%S")
for f in ["fan.html", "404.html", "app.html", "admin.html", "index.html"]:
    p = pathlib.Path(__file__).resolve().parent.parent / "docs" / f
    if not p.exists(): continue
    s = p.read_text(encoding="utf-8")
    s2 = re.sub(r'(<script src="(?:config|rnx-[a-z-]+)\.js)(?:\?v=[0-9-]+)?"', rf'\1?v={v}"', s)
    if s2 != s: p.write_text(s2, encoding="utf-8")
print("stamped", v)
