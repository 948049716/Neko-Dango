#!/usr/bin/env python3
"""生成 2D 路线素材到 client/assets/textures/。

- cats/cat01..11.png：由 web-preview 已提取的正面精灵（webp）转 PNG。
- basket-back.png / basket-front.png（750×920）：按 UI_01 设计图绘制的藤编猫窝。
  坐标约定：图片对应 WorldRoot 局部空间 x∈[-375,375]、y∈[-40,880]（1lu=1px），
  容器内侧宽 640（x∈[-320,320]）、内底 y=0、篮口 y≈682。
  back 含篮体/猫耳/内衬/坐垫；front 只含篮筐边框、玻璃反光与底部猫爪（透明底，
  盖在猫层之上形成"猫在窝里"的纵深）。
"""
from pathlib import Path

from PIL import Image, ImageDraw, ImageOps

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "web-preview" / "assets"
OUT = ROOT / "client" / "assets" / "textures"
CATS = OUT / "cats"
CATS.mkdir(parents=True, exist_ok=True)

W, H = 750, 920
TOP = 880  # 图片上边缘对应的局部 y


def X(lx: float) -> float:
    return lx + 375


def Y(ly: float) -> float:
    return TOP - ly


def bbox(lx0, ly0, lx1, ly1):
    """局部坐标 (左,下,右,上) → 图片 bbox (左,上,右,下)。"""
    return [X(lx0), Y(ly1), X(lx1), Y(ly0)]


# ---------- 猫精灵 ----------
for i in range(1, 12):
    im = Image.open(SRC / f"cat{i:02d}.webp").convert("RGBA")
    im.save(CATS / f"cat{i:02d}.png", optimize=True)
    print(f"cat{i:02d}.png {im.size}")

# ---------- 藤编纹理（镜像平铺消除接缝） ----------
wicker = Image.open(SRC / "wicker.webp").convert("RGB")
tile = wicker.resize((300, 214))
tiled = Image.new("RGB", (W, H))
for yi, ty in enumerate(range(0, H, tile.height)):
    for xi, tx in enumerate(range(0, W, tile.width)):
        t = tile
        if xi % 2:
            t = ImageOps.mirror(t)
        if yi % 2:
            t = ImageOps.flip(t)
        tiled.paste(t, (tx, ty))

HONEY_DARK = (150, 96, 48)
CREAM_INNER_TOP = (250, 240, 222)
CREAM_INNER_BOT = (238, 219, 188)


def rounded_mask(box, radius):
    m = Image.new("L", (W, H), 0)
    d = ImageDraw.Draw(m)
    d.rounded_rectangle(box, radius=radius, fill=255)
    return m


OUTER = bbox(-352, -24, 352, 700)
INNER = bbox(-318, 10, 318, 680)

# ---------- back ----------
back = Image.new("RGBA", (W, H), (0, 0, 0, 0))

# 猫耳（篮口上方两角）
ear = Image.open(SRC / "ear.webp").convert("RGBA").resize((168, 159))
for cx, flip in [(-272, False), (272, True)]:
    e = ImageOps.mirror(ear) if flip else ear
    back.alpha_composite(e, (int(X(cx) - e.width / 2), int(Y(782) - e.height / 2)))

# 篮体（藤编）
back.paste(tiled, (0, 0), rounded_mask(OUTER, 46))
d = ImageDraw.Draw(back, "RGBA")
d.rounded_rectangle(OUTER, radius=46, outline=HONEY_DARK + (255,), width=8)

# 内衬（奶油色竖向渐变）
grad = Image.new("RGBA", (W, H), (0, 0, 0, 0))
gd = ImageDraw.Draw(grad)
y_top, y_bot = INNER[1], INNER[3]
for yy in range(int(y_top), int(y_bot)):
    t = (yy - y_top) / max(1, (y_bot - y_top))
    c = tuple(int(CREAM_INNER_TOP[k] + (CREAM_INNER_BOT[k] - CREAM_INNER_TOP[k]) * t) for k in range(3))
    gd.line([(INNER[0], yy), (INNER[2], yy)], fill=c + (255,))
back.paste(Image.alpha_composite(back, grad), (0, 0), rounded_mask(INNER, 34))
back = Image.alpha_composite(back, Image.new("RGBA", (W, H), (0, 0, 0, 0)))
d = ImageDraw.Draw(back, "RGBA")
d.rounded_rectangle(INNER, radius=34, outline=(176, 124, 70, 255), width=5)
# 内衬顶部内阴影
d.rounded_rectangle([INNER[0], INNER[1], INNER[2], INNER[1] + 26], radius=13, fill=(120, 84, 50, 46))

# 底部坐垫（珊瑚粉 + 爪印）
cush = bbox(-300, -4, 300, 58)
d.rounded_rectangle(cush, radius=28, fill=(238, 164, 155, 255))
d.rounded_rectangle([cush[0] + 12, cush[1] + 8, cush[2] - 12, cush[3] - 14], radius=20, fill=(246, 186, 178, 255))
cx, cy = X(0), Y(24)
d.ellipse([cx - 21, cy - 13, cx + 21, cy + 13], fill=(214, 120, 112, 255))
for ox, oy in [(-30, -14), (-11, -22), (11, -22), (30, -14)]:
    d.ellipse([cx + ox - 7, cy + oy - 6, cx + ox + 7, cy + oy + 6], fill=(214, 120, 112, 255))
back.save(OUT / "basket-back.png", optimize=True)
print("basket-back.png", back.size)

# ---------- front ----------
front = Image.new("RGBA", (W, H), (0, 0, 0, 0))
ring = rounded_mask(OUTER, 46)
inner_m = rounded_mask(INNER, 34)
ring_px = ring.load()
inner_px = inner_m.load()
ring_only = Image.new("L", (W, H), 0)
ro = ring_only.load()
for yy in range(H):
    for xx in range(W):
        ro[xx, yy] = 255 if (ring_px[xx, yy] and not inner_px[xx, yy]) else 0
front.paste(tiled, (0, 0), ring_only)
d = ImageDraw.Draw(front, "RGBA")
d.rounded_rectangle(OUTER, radius=46, outline=HONEY_DARK + (255,), width=7)
d.rounded_rectangle(INNER, radius=34, outline=(146, 92, 44, 255), width=5)
# 篮底加深一条编纹阴影
d.rounded_rectangle([OUTER[0], OUTER[3] - 44, OUTER[2], OUTER[3]], radius=20, fill=(120, 74, 36, 52))
# 玻璃高光（左上斜向，裁剪在内框内）
glass = Image.new("RGBA", (W, H), (0, 0, 0, 0))
gd = ImageDraw.Draw(glass)
gd.polygon(
    [(X(-215), Y(680)), (X(-30), Y(680)), (X(-205), Y(60)), (X(-318), Y(60))],
    fill=(255, 255, 255, 34),
)
front = Image.alpha_composite(front, Image.composite(glass, Image.new("RGBA", (W, H), (0, 0, 0, 0)), inner_m))
d = ImageDraw.Draw(front, "RGBA")
# 底部两只猫爪（奶油色 + 粉肉垫）
for cx_l in (-262, 262):
    px, py = X(cx_l), Y(-26)
    d.ellipse([px - 78, py - 36, px + 78, py + 36], fill=(250, 240, 222, 255), outline=(214, 178, 138, 255), width=4)
    d.ellipse([px - 20, py + 2, px + 20, py + 26], fill=(233, 150, 145, 255))
    for ox, oy in [(-34, -16), (-12, -24), (12, -24), (34, -16)]:
        d.ellipse([px + ox - 8, py + oy - 7, px + ox + 8, py + oy + 7], fill=(233, 150, 145, 255))
front.save(OUT / "basket-front.png", optimize=True)
print("basket-front.png", front.size)

# ---------- QA 合成图（不进仓库，仅本地检查；坐标与场景一致） ----------
# 设计画布 750×1334（上原点）；容器底在 BY=1150，篮图上边缘对应局部 y=880 → 屏幕 270
qa = Image.new("RGBA", (W, 1334), (246, 233, 212, 255))
qa.alpha_composite(back, (0, 270))
for name, lx, r in [("cat01", -250, 26), ("cat03", -140, 44), ("cat05", 30, 70), ("cat02", 190, 34), ("cat04", 268, 56)]:
    im = Image.open(CATS / f"{name}.png")
    scale = (r * 2) / im.width
    im = im.resize((int(im.width * scale), int(im.height * scale)))
    # 猫静置于篮底：中心局部 (lx, r) → 屏幕中心 (375+lx, 1150-r)
    qa.alpha_composite(im, (int(375 + lx - im.width / 2), int(1150 - r - im.height / 2)))
qa.alpha_composite(front, (0, 270))
qa.convert("RGB").save(ROOT / "web-preview" / "basket-qa.png")
print("QA 合成图已生成 web-preview/basket-qa.png")
