# EEG Alma Center icon: a sibling of the VEATION mark (rounded square #262626, ink #E7E6E0, amber dot #F4B23A).
# The head seen from above with its nose (the EEG topomap symbol), a brain wave inside, an amber electrode on the ring.
# Geometry in a 100-unit box; rendered supersampled with Pillow; a bolder cut for 16–32 px.
# usage: python tools/make-icon.py assets   → icon.ico (16–256), icon.png (512), icon-1024.png, icon.svg, icon-sheet.png
# (only icon.ico, icon.png and icon.svg are kept in assets)
import sys, os, math
from PIL import Image, ImageDraw

out_dir = sys.argv[1]
BG, INK, DOT = (0x26, 0x26, 0x26, 255), (0xE7, 0xE6, 0xE0, 255), (0xF4, 0xB2, 0x3A, 255)

def stamp(d, pts, w, fill):
    # a perfectly round stroke: discs along a densely sampled path (thick Pillow lines notch at the joints)
    import math as _m
    out = [pts[0]]
    for a, b in zip(pts, pts[1:]):
        n = max(1, int(_m.hypot(b[0] - a[0], b[1] - a[1]) / (w * 0.08)))
        out += [(a[0] + (b[0] - a[0]) * i / n, a[1] + (b[1] - a[1]) * i / n) for i in range(1, n + 1)]
    for x, y in out: d.ellipse([x - w / 2, y - w / 2, x + w / 2, y + w / 2], fill=fill)

def bezier(p0, p1, p2, p3, n=24):
    return [(((1-t)**3)*p0[0] + 3*((1-t)**2)*t*p1[0] + 3*(1-t)*t*t*p2[0] + t**3*p3[0],
             ((1-t)**3)*p0[1] + 3*((1-t)**2)*t*p1[1] + 3*(1-t)*t*t*p2[1] + t**3*p3[1]) for t in [i/n for i in range(n+1)]]

def wave_points():
    # a smooth burst: low, up, down, up, settle (as in the SVG path below)
    segs = [((31, 55), (35, 55), (37, 45), (42, 45)), ((42, 45), (47, 45), (47, 63), (52, 63)),
            ((52, 63), (57, 63), (57, 47), (62, 47)), ((62, 47), (66, 47), (66, 55), (69, 55))]
    pts = []
    for s in segs: pts += bezier(*s)[(1 if pts else 0):]
    return pts

def draw(size, bold=False):
    S = 8                                    # supersampling
    W = size * S; k = W / 100.0
    im = Image.new('RGBA', (W, W), (0, 0, 0, 0)); d = ImageDraw.Draw(im)
    d.rounded_rectangle([0, 0, W - 1, W - 1], radius=22 * k, fill=BG)
    ring_w = (9.5 if bold else 7) * k; wave_w = (8.5 if bold else 6) * k
    cx, cy, r = 50 * k, 54 * k, (26 if bold else 27) * k
    # nose: a small triangle on top of the ring, drawn as a thick open stroke
    nose = [(43.5 * k, cy - r + 1.2 * k), (50 * k, cy - r - (9 if bold else 8.5) * k), (56.5 * k, cy - r + 1.2 * k)]
    stamp(d, nose, ring_w * 0.9, INK)
    d.ellipse([cx - r - ring_w / 2, cy - r - ring_w / 2, cx + r + ring_w / 2, cy + r + ring_w / 2], outline=INK, width=int(ring_w))
    # the wave (at the tiniest sizes a single bold bump: a whole burst would be a blur)
    if size <= 20: pts = [(x * k, y * k) for x, y in bezier((35, 58), (42, 58), (43, 44), (50, 44), 40) + bezier((50, 44), (57, 44), (58, 58), (65, 58), 40)[1:]]
    else:
        pts = [(x * k, (y + 0.5) * k) for x, y in wave_points()]
        if bold: pts = [(cx + (x - cx) * 1.0, cy + (y - cy) * 1.15) for x, y in pts]
    stamp(d, pts, wave_w, INK)
    # the amber electrode on the ring, front right, with a gap of background around it
    a = math.radians(42); ex, ey = cx + r * math.sin(a), cy - r * math.cos(a)
    er = (8.5 if bold else 6.8) * k; gap = (3 if bold else 2.6) * k
    d.ellipse([ex - er - gap, ey - er - gap, ex + er + gap, ey + er + gap], fill=BG)
    d.ellipse([ex - er, ey - er, ex + er, ey + er], fill=DOT)
    return im.resize((size, size), Image.LANCZOS)

big = draw(1024)
big.save(os.path.join(out_dir, 'icon-1024.png'))
draw(512).save(os.path.join(out_dir, 'icon.png'))
sizes = [16, 20, 24, 32, 40, 48, 64, 128, 256]
imgs = {s: draw(s, bold=s <= 32) for s in sizes}
imgs[256].save(os.path.join(out_dir, 'icon.ico'), sizes=[(s, s) for s in sizes], append_images=[imgs[s] for s in sizes if s != 256])
# a sheet to check the small sizes, each enlarged without smoothing
sheet = Image.new('RGBA', (len(sizes) * 136, 300), (17, 17, 17, 255))
x = 8
for s in sizes:
    sheet.paste(imgs[s], (x, 8), imgs[s]); z = imgs[s].resize((128, 128), Image.NEAREST); sheet.paste(z, (x, 160), z); x += 136
sheet.save(os.path.join(out_dir, 'icon-sheet.png'))

svg = f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><title>EEG Alma Center</title><rect width="100" height="100" rx="22" fill="#262626"/><circle cx="50" cy="54" r="27" fill="none" stroke="#E7E6E0" stroke-width="7"/><path d="M43.5 28.2 L50 18.5 L56.5 28.2" fill="none" stroke="#E7E6E0" stroke-width="6.3" stroke-linecap="round" stroke-linejoin="round"/><path d="M31 55.5 C35 55.5 37 45.5 42 45.5 C47 45.5 47 63.5 52 63.5 C57 63.5 57 47.5 62 47.5 C66 47.5 66 55.5 69 55.5" fill="none" stroke="#E7E6E0" stroke-width="6" stroke-linecap="round"/><circle cx="68.07" cy="33.93" r="9.4" fill="#262626"/><circle cx="68.07" cy="33.93" r="6.8" fill="#F4B23A"/></svg>'''
open(os.path.join(out_dir, 'icon.svg'), 'w', encoding='utf8').write(svg)
print('ok')
