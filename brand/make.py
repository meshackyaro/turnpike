"""Generates the logo and cover image.

Fonts are not committed. Fetch them once:
  curl -sL -o brand/archivo.ttf \
    "https://github.com/google/fonts/raw/main/ofl/archivo/Archivo%5Bwdth%2Cwght%5D.ttf"
  curl -sL -o brand/plexmono.ttf \
    "https://github.com/google/fonts/raw/main/ofl/ibmplexmono/IBMPlexMono-SemiBold.ttf"
Without them it falls back to Liberation Sans.


The mark is two lanes meeting at a dashed centre line: the two settlement routes
the project exists to choose between, and the road they run on. Colours are the
same validated blue and orange the dashboard uses for Hedera and Arc, so the
brand and the data encoding are one thing rather than two.
"""
from PIL import Image, ImageDraw, ImageFont
from pathlib import Path

HERE = Path(__file__).parent
HEDERA = (42, 120, 214)
ARC = (235, 104, 52)
INK = (14, 16, 15)
PAPER = (244, 246, 245)
MUTED = (138, 151, 147)

ARCHIVO = HERE / "archivo.ttf"
MONO = HERE / "plexmono.ttf"
FALLBACK = Path("/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf")


def font(size, mono=False, weight="Bold"):
    path = MONO if mono and MONO.exists() else (ARCHIVO if ARCHIVO.exists() else FALLBACK)
    try:
        f = ImageFont.truetype(str(path), size)
        # Archivo is variable. Its axes are [Weight, Width] — passing them the
        # other way round silently yields Thin, so select by name instead.
        if not mono and path == ARCHIVO:
            try:
                f.set_variation_by_name(weight)
            except Exception:
                pass
        return f
    except Exception:
        return ImageFont.load_default()


def lanes(draw, box, scale=1.0, dash_on=True):
    """Two diagonal lanes divided by a dashed centre line."""
    x0, y0, x1, y1 = box
    w, h = x1 - x0, y1 - y0

    # Lower-left lane (Hedera) and upper-right lane (Arc), split on the diagonal.
    draw.polygon([(x0, y1), (x1, y0), (x1, y1)], fill=ARC)
    draw.polygon([(x0, y0), (x1, y0), (x0, y1)], fill=HEDERA)

    if not dash_on:
        return
    # Dashes along the diagonal, drawn as short rotated segments.
    steps = 7
    thickness = max(2, int(w * 0.035 * scale))
    for i in range(steps):
        t0 = i / steps + 0.03
        t1 = t0 + (1 / steps) * 0.45
        ax, ay = x0 + w * t0, y1 - h * t0
        bx, by = x0 + w * t1, y1 - h * t1
        draw.line([(ax, ay), (bx, by)], fill=PAPER, width=thickness)


def rounded_mask(size, radius):
    m = Image.new("L", (size, size), 0)
    ImageDraw.Draw(m).rounded_rectangle([0, 0, size - 1, size - 1], radius=radius, fill=255)
    return m


def make_logo(size=512):
    img = Image.new("RGB", (size, size), INK)
    d = ImageDraw.Draw(img)
    lanes(d, (0, 0, size, size))
    img.putalpha(rounded_mask(size, int(size * 0.22)))
    out = HERE / f"logo-{size}.png"
    img.save(out)
    return out


def make_cover(w=1280, h=720):
    """16:9 as the submission form asks for."""
    img = Image.new("RGB", (w, h), INK)
    d = ImageDraw.Draw(img)

    # The mark, large, sitting on the right third.
    m = int(h * 0.66)
    tile = Image.new("RGB", (m, m), INK)
    lanes(ImageDraw.Draw(tile), (0, 0, m, m), scale=1.2)
    tile.putalpha(rounded_mask(m, int(m * 0.22)))
    img.paste(tile, (w - m - 84, (h - m) // 2), tile)

    x = 86
    d.text((x, 188), "Turnpike", font=font(112, weight="ExtraBold"), fill=PAPER)
    d.text((x, 332), "a toll road for AI agents", font=font(36, weight="Medium"), fill=MUTED)

    # The claim, in the dashboard's mono, carrying the route colours through.
    y = 432
    d.rectangle([x, y + 6, x + 5, y + 32], fill=HEDERA)
    d.text((x + 22, y), "Hedera", font=font(27, mono=True), fill=PAPER)
    d.rectangle([x + 150, y + 6, x + 155, y + 32], fill=ARC)
    d.text((x + 172, y), "Arc", font=font(27, mono=True), fill=PAPER)
    d.text((x, y + 56), "two routes in one 402 —", font=font(25, mono=True), fill=MUTED)
    d.text((x, y + 92), "the buyer's signed policy picks one", font=font(25, mono=True), fill=MUTED)

    out = HERE / "cover.png"
    img.save(out)
    return out


if __name__ == "__main__":
    for s in (512, 1024):
        print("wrote", make_logo(s).name)
    print("wrote", make_cover().name)
