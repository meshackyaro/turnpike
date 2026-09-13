"""Architecture diagram — the path one paid call takes through the system.

Blue is Hedera and orange is Arc everywhere, matching the dashboard and cover.
Arrows carry step numbers; the legend underneath says what each step is, since
full labels do not fit in the gaps between columns.
"""
import math
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

HERE = Path(__file__).parent
W, H = 1920, 1080

INK = (14, 16, 15)
PANEL = (24, 28, 27)
HAIR = (54, 60, 58)
PAPER = (236, 240, 238)
MUTED = (140, 152, 148)
HEDERA = (57, 135, 229)
ARC = (235, 104, 52)
CUSTODY = (47, 184, 47)
FLOW = (196, 204, 201)

ARCHIVO = HERE / "archivo.ttf"
MONO = HERE / "plexmono.ttf"
FALLBACK = "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf"


def sans(size, weight="SemiBold"):
    try:
        f = ImageFont.truetype(str(ARCHIVO), size)
        f.set_variation_by_name(weight)
        return f
    except Exception:
        return ImageFont.truetype(FALLBACK, size)


def mono(size):
    try:
        return ImageFont.truetype(str(MONO), size)
    except Exception:
        return ImageFont.truetype(FALLBACK, size)


img = Image.new("RGB", (W, H), INK)
d = ImageDraw.Draw(img)

# five columns, equal boxes, equal gaps
BW = 262
COL = [60, 444, 829, 1214, 1598]


def box(col, y, h, title, lines=(), accent=FLOW, tag=None):
    x = COL[col]
    d.rounded_rectangle([x, y, x + BW, y + h], radius=14, fill=PANEL, outline=HAIR, width=2)
    d.rounded_rectangle([x, y + 10, x + 5, y + h - 10], radius=3, fill=accent)
    ty = y + 16
    if tag:
        d.text((x + 22, ty), tag.upper(), font=mono(14), fill=MUTED)
        ty += 22
    d.text((x + 22, ty), title, font=sans(25), fill=PAPER)
    ty += 38
    for line in lines:
        d.text((x + 22, ty), line, font=mono(16), fill=MUTED)
        ty += 24
    return (x, y, BW, h)


def pt(b, side, t=0.5):
    x, y, w, h = b
    return {"l": (x, y + h * t), "r": (x + w, y + h * t),
            "t": (x + w * t, y), "b": (x + w * t, y + h)}[side]


def arrow(p, q, color, dashed=False, width=3):
    (x1, y1), (x2, y2) = p, q
    ang = math.atan2(y2 - y1, x2 - x1)
    head = 15
    end = (x2 - head * 0.85 * math.cos(ang), y2 - head * 0.85 * math.sin(ang))
    if dashed:
        n = max(1, int(math.dist(p, end) // 16))
        for i in range(n):
            a, b = i / n, (i + 0.55) / n
            d.line([(x1 + (end[0] - x1) * a, y1 + (end[1] - y1) * a),
                    (x1 + (end[0] - x1) * b, y1 + (end[1] - y1) * b)], fill=color, width=width)
    else:
        d.line([p, end], fill=color, width=width)
    d.polygon([(x2, y2),
               (x2 - head * math.cos(ang - 0.42), y2 - head * math.sin(ang - 0.42)),
               (x2 - head * math.cos(ang + 0.42), y2 - head * math.sin(ang + 0.42))], fill=color)


def badges(cx, cy, steps, color):
    r = 15
    total = len(steps) * (2 * r) + (len(steps) - 1) * 6
    x = cx - total / 2
    d.rounded_rectangle([x - 6, cy - r - 5, x + total + 6, cy + r + 5], radius=r + 5, fill=INK)
    for s in steps:
        c = x + r
        d.ellipse([c - r, cy - r, c + r, cy + r], fill=color)
        d.text((c, cy + 1), str(s), font=sans(17, "Bold"), fill=INK, anchor="mm")
        x += 2 * r + 6


def tag(cx, cy, text, color=MUTED):
    f = mono(15)
    tw = d.textlength(text, font=f)
    d.rounded_rectangle([cx - tw / 2 - 8, cy - 13, cx + tw / 2 + 8, cy + 13], radius=6, fill=INK)
    d.text((cx, cy), text, font=f, fill=color, anchor="mm")


# ── title ────────────────────────────────────────────────────────────────
tf = sans(44, "ExtraBold")
d.text((60, 40), "Turnpike", font=tf, fill=PAPER)
d.text((60 + d.textlength("Turnpike", font=tf) + 22, 56),
       "one 402, two routes, a spend ceiling the agent cannot move",
       font=sans(25, "Medium"), fill=MUTED)
d.line([(60, 116), (W - 60, 116)], fill=HAIR, width=2)

# ── boxes ────────────────────────────────────────────────────────────────
claude = box(0, 150, 122, "Claude Opus 5", ["Anthropic API"], tag="model")
tricia = box(0, 350, 170, "Tricia", ["buying agent", "search_services", "call_service"], tag="agent")
ledger = box(0, 610, 170, "Ledger signer", ["Speculos emulator", "Ethereum app", "signs spend policy"],
             accent=CUSTODY, tag="custody")

wallet = box(1, 320, 250, "@turnpike/wallet",
             ["verify signed policy", "spend caps", "route selector", "sign payment",
              "one key, both chains"], tag="buyer")
dash = box(1, 700, 140, "Dashboard", ["receipts log", "live over SSE"], tag="view")

seller = box(2, 310, 250, "Forecast seller",
             ["1. check symbol and", "   fetch price first", "2. x402 paywall",
              "   offers 2 routes", "3. serve forecast"], tag="service")
gecko = box(2, 720, 120, "CoinGecko", ["hourly prices, 7d"], tag="price feed")

x402 = box(3, 210, 150, "x402.org", ["facilitator", "verify + settle"], accent=HEDERA, tag="hedera route")
circle = box(3, 540, 150, "Circle Gateway", ["facilitator", "verify + settle"], accent=ARC, tag="arc route")

hedera = box(4, 210, 150, "Hedera testnet", ["TransferTransaction", "gas: facilitator"], accent=HEDERA, tag="chain")
arc = box(4, 540, 150, "Arc testnet", ["batched debit from", "Gateway balance"], accent=ARC, tag="chain")

# ── arrows ───────────────────────────────────────────────────────────────
# agent <-> model
arrow(pt(tricia, "t"), pt(claude, "b"), MUTED, width=2)
tag(pt(tricia, "t")[0] + 70, (pt(claude, "b")[1] + pt(tricia, "t")[1]) / 2, "tool use")

# agent -> wallet
arrow(pt(tricia, "r"), pt(wallet, "l", 0.43), FLOW)
badges((pt(tricia, "r")[0] + pt(wallet, "l")[0]) / 2, pt(tricia, "r")[1] - 26, [1], FLOW)

# custody -> wallet (dashed: authority, not traffic)
arrow(pt(ledger, "r", 0.35), pt(wallet, "l", 0.86), CUSTODY, dashed=True)
tag((pt(ledger, "r")[0] + pt(wallet, "l")[0]) / 2 + 4, 690, "signed policy", CUSTODY)

# wallet <-> seller, request above, response below
y_req, y_res = 425, 525
arrow((pt(wallet, "r")[0], y_req), (pt(seller, "l")[0], y_req), FLOW)
badges((pt(wallet, "r")[0] + pt(seller, "l")[0]) / 2, y_req - 27, [2, 5], FLOW)
arrow((pt(seller, "l")[0], y_res), (pt(wallet, "r")[0], y_res), FLOW)
badges((pt(wallet, "r")[0] + pt(seller, "l")[0]) / 2, y_res + 27, [3, 8], FLOW)

# step 4 happens inside the wallet, on the route-selector line
badges(COL[1] + 184, 457, [4], FLOW)

# wallet -> dashboard
arrow(pt(wallet, "b"), pt(dash, "t"), MUTED, width=2)
tag(pt(wallet, "b")[0] + 64, (pt(wallet, "b")[1] + pt(dash, "t")[1]) / 2, "receipt")

# seller -> price feed
arrow(pt(seller, "b"), pt(gecko, "t"), MUTED, width=2)
tag(pt(seller, "b")[0] + 92, (pt(seller, "b")[1] + pt(gecko, "t")[1]) / 2, "before payment")

# seller -> facilitators
arrow(pt(seller, "r", 0.25), pt(x402, "l"), HEDERA)
badges((pt(seller, "r")[0] + pt(x402, "l")[0]) / 2 + 6, 330, [6], HEDERA)
arrow(pt(seller, "r", 0.75), pt(circle, "l"), ARC)
badges((pt(seller, "r")[0] + pt(circle, "l")[0]) / 2 + 6, 588, [6], ARC)

# facilitators -> chains
arrow(pt(x402, "r"), pt(hedera, "l"), HEDERA)
badges((pt(x402, "r")[0] + pt(hedera, "l")[0]) / 2, pt(x402, "r")[1] - 27, [7], HEDERA)
arrow(pt(circle, "r"), pt(arc, "l"), ARC)
badges((pt(circle, "r")[0] + pt(arc, "l")[0]) / 2, pt(circle, "r")[1] - 27, [7], ARC)

# the fork: exactly one route settles per call
fork_x = (COL[3] + COL[4] + BW) / 2
d.line([(COL[3] + 30, 450), (COL[4] + BW - 30, 450)], fill=HAIR, width=2)
tag(fork_x, 450, "one route per call — never both")

# ── legend ───────────────────────────────────────────────────────────────
d.line([(60, 878), (W - 60, 878)], fill=HAIR, width=2)
steps = [
    (1, "Tricia asks the wallet for data", FLOW),
    (2, "wallet requests the resource", FLOW),
    (3, "402 offers Hedera and Arc at once", FLOW),
    (4, "policy picks a route, wallet signs", FLOW),
    (5, "retry with the payment signature", FLOW),
    (6, "facilitator verifies and settles", HEDERA),
    (7, "settles on the chosen chain", ARC),
    (8, "200 + forecast, receipt to dashboard", FLOW),
]
cols, colw = 4, (W - 120) / 4
for i, (n, text, color) in enumerate(steps):
    cx = 60 + (i % cols) * colw
    cy = 918 + (i // cols) * 58
    r = 14
    d.ellipse([cx, cy - r, cx + 2 * r, cy + r], fill=color)
    d.text((cx + r, cy + 1), str(n), font=sans(16, "Bold"), fill=INK, anchor="mm")
    d.text((cx + 2 * r + 12, cy), text, font=mono(17), fill=PAPER, anchor="lm")

out = HERE / "architecture.png"
img.save(out)
print("wrote", out.name, f"{W}x{H}")
