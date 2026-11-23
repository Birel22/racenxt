"""Link previews for shared Race Hub pages (WhatsApp, iMessage, X...).

Apps that show a preview read the page's HTML without running its scripts, so each
published athlete gets a real page at docs/<slug>/index.html (the fan page with its own
title, description and picture) and a 1200x630 picture at docs/<slug>/og.jpg:
the athlete's photo, their logo and "<FIRST> RACE HUB".

  python3 tools/previews.py           build pages for every published athlete (GitHub Action)
  python3 tools/previews.py refresh   re-copy the fan page into the existing pages (after port_fan.py)
"""
import hashlib, html, io, json, os, pathlib, re, shutil, sys, urllib.request

ROOT = pathlib.Path(__file__).resolve().parent.parent
DOCS = ROOT / "docs"
SITE = os.environ.get("RNX_SITE", "https://louisdeletraz.app").rstrip("/")
MARK_A, MARK_B = "<!--rnx-og-->", "<!--/rnx-og-->"
ACCENT = (255, 90, 31)
W, H = 1200, 630


def page_with(meta):
    """the fan page (404.html) with this athlete's title and preview tags"""
    s = (DOCS / "404.html").read_text(encoding="utf-8")
    s = re.sub(r"<title>.*?</title>\n?", "", s, count=1)
    return s.replace('<base href="/">', '<base href="/">\n' + MARK_A + "\n" + meta + "\n" + MARK_B, 1)


def pages():
    for d in DOCS.iterdir():
        f = d / "index.html"
        if d.is_dir() and f.exists() and MARK_A in f.read_text(encoding="utf-8"):
            yield d, f


def refresh():
    n = 0
    for d, f in pages():
        s = f.read_text(encoding="utf-8")
        meta = s[s.index(MARK_A) + len(MARK_A):s.index(MARK_B)].strip()
        new = page_with(meta)
        if new != s:
            f.write_text(new, encoding="utf-8"); n += 1
    print("previews refreshed:", n)


# ---------- picture ----------
def font(kind, size):
    from PIL import ImageFont
    names = {"bold": ["BarlowCondensed-Bold.ttf", "LiberationSansNarrow-Bold.ttf", "DejaVuSansCondensed-Bold.ttf"],
             "med": ["BarlowCondensed-Medium.ttf", "LiberationSansNarrow-Regular.ttf", "DejaVuSansCondensed.ttf"]}[kind]
    dirs = [os.environ.get("RNX_FONTS", "/tmp/fonts"), str(ROOT / "tools" / "fonts"), "/usr/share/fonts/truetype/liberation", "/usr/share/fonts/truetype/dejavu"]
    for n in names:
        for d in dirs:
            p = os.path.join(d, n)
            if os.path.exists(p):
                return ImageFont.truetype(p, size)
    return ImageFont.load_default(size)


def fetch(url):
    req = urllib.request.Request(url, headers={"User-Agent": "racenxt-previews"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.read()


def picture(p, season):
    from PIL import Image, ImageDraw
    img = Image.new("RGB", (W, H), (13, 14, 17))
    photo = p.get("hero_url") or p.get("photo_url")
    if photo:
        try:
            ph = Image.open(io.BytesIO(fetch(photo))).convert("RGB")
            pos = p.get("photo_pos") or {}
            x, y, z = float(pos.get("x", 50)), float(pos.get("y", 35)), float(pos.get("z", 1) or 1)
            # same framing as the page: cover, focal point x/y %, zoom z around that point
            k = max(W / ph.width, H / ph.height)
            sw, sh = ph.width * k, ph.height * k
            left, top = (W - sw) * x / 100, (H - sh) * y / 100
            ox, oy = W * x / 100, H * y / 100
            left, top, sw, sh = ox + (left - ox) * z, oy + (top - oy) * z, sw * z, sh * z
            ph = ph.resize((max(1, round(sw)), max(1, round(sh))), Image.LANCZOS)
            img.paste(ph, (round(left), round(top)))
        except Exception as e:
            print("photo skipped for", p["slug"], e)
    # dark fade on the left and bottom so the title reads on any photo
    shade = Image.new("L", (W, H))
    px = shade.load()
    for i in range(W):
        a = max(0.0, 1 - i / (W * 0.68)) ** 1.4 * 235
        for j in range(H):
            b = max(0.0, (j - H * 0.55) / (H * 0.45)) * 150
            px[i, j] = int(min(245, a + b))
    img = Image.composite(Image.new("RGB", (W, H), (11, 12, 15)), img, shade)
    d = ImageDraw.Draw(img)
    # logo, top left
    if p.get("logo_url"):
        try:
            lg = Image.open(io.BytesIO(fetch(p["logo_url"]))).convert("RGBA")
            lg.thumbnail((280, 110), Image.LANCZOS)
            img.paste(lg, (64, 56), lg)
        except Exception as e:
            print("logo skipped for", p["slug"], e)
    first = (p.get("first_name") or (p.get("display_name") or "").split(" ")[0] or "").upper()
    size = 150
    while size > 80 and max(d.textlength(first, font=font("bold", size)), d.textlength("RACE HUB", font=font("bold", size))) > 700:
        size -= 6
    fb = font("bold", size)
    base = 486  # baseline of "RACE HUB"
    d.text((62, base - round(size * 0.9)), first, font=fb, fill=(244, 244, 242), anchor="ls")
    d.text((62, base), "RACE HUB", font=fb, fill=ACCENT, anchor="ls")
    sub = f"{season} season · schedules · live · where to watch" if season else "Race calendar · schedules · live · where to watch"
    d.text((65, 552), sub, font=font("med", 34), fill=(233, 233, 230), anchor="ls")
    out = io.BytesIO()
    img.save(out, "JPEG", quality=86, optimize=True, progressive=True)
    return out.getvalue()


def build():
    cfg = (DOCS / "config.js").read_text(encoding="utf-8")
    url = re.search(r'url:\s*"([^"]+)"', cfg).group(1)
    key = re.search(r'key:\s*"([^"]+)"', cfg).group(1)

    def get(path):
        req = urllib.request.Request(f"{url}/rest/v1/{path}", headers={"apikey": key, "Authorization": f"Bearer {key}"})
        with urllib.request.urlopen(req, timeout=30) as r:
            return json.loads(r.read())

    profs = get("profiles?published=eq.true&select=id,slug,first_name,display_name,photo_url,hero_url,photo_pos,logo_url")
    import datetime
    this_year = datetime.date.today().year
    keep = set()
    for p in profs:
        slug = (p.get("slug") or "").lower()
        if not re.fullmatch(r"[a-z0-9][a-z0-9-]{1,60}", slug):
            continue
        keep.add(slug)
        years = [e["year"] for e in get(f"entries?profile_id=eq.{p['id']}&select=year") if e.get("year")]
        years = [y for y in years if y <= this_year + 1] or years
        season = max(years) if years else None
        jpg = picture(p, season)
        d = DOCS / slug
        d.mkdir(exist_ok=True)
        f = d / "og.jpg"
        if not f.exists() or f.read_bytes() != jpg:
            f.write_bytes(jpg)
        v = hashlib.sha1(jpg).hexdigest()[:8]
        first = p.get("first_name") or (p.get("display_name") or "").split(" ")[0]
        name = p.get("display_name") or first
        title = f"{first} Race Hub"
        desc = f"Follow {name}’s {season} season: race dates, schedules in your time zone, live sessions and where to watch." if season else f"Follow {name}: race dates, schedules in your time zone, live sessions and where to watch."
        e = lambda s: html.escape(s, quote=True)
        page = f"{SITE}/{slug}/"
        meta = "\n".join([
            f"<title>{e(title)}</title>",
            f'<meta name="description" content="{e(desc)}">',
            '<meta property="og:type" content="website">',
            f'<meta property="og:site_name" content="{e(title)}">',
            f'<meta property="og:title" content="{e(title)}">',
            f'<meta property="og:description" content="{e(desc)}">',
            f'<meta property="og:url" content="{page}">',
            f'<meta property="og:image" content="{page}og.jpg?v={v}">',
            '<meta property="og:image:width" content="1200">',
            '<meta property="og:image:height" content="630">',
            '<meta name="twitter:card" content="summary_large_image">',
            f'<meta name="twitter:title" content="{e(title)}">',
            f'<meta name="twitter:description" content="{e(desc)}">',
            f'<meta name="twitter:image" content="{page}og.jpg?v={v}">',
        ])
        new = page_with(meta)
        idx = d / "index.html"
        if not idx.exists() or idx.read_text(encoding="utf-8") != new:
            idx.write_text(new, encoding="utf-8")
    # pages no longer published go away
    for d, f in list(pages()):
        if d.name not in keep:
            shutil.rmtree(d)
            print("removed", d.name)
    print("previews:", sorted(keep))


if __name__ == "__main__":
    refresh() if sys.argv[1:] == ["refresh"] else build()
