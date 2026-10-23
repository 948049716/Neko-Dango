"""从四视图设定表提取正面视图精灵（去背景、裁切、WebP）+ 藤编纹理。

用法：python3 tools_extract_sprites.py
产物：web-preview/assets/{cat01..cat11, prop1..prop4, ear, wicker}.webp
"""
from collections import deque
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

ROOT = Path.home() / "workspace" / "neko-dango"
TURN = ROOT / "art" / "turnarounds"
OUT = ROOT / "web-preview" / "assets"
OUT.mkdir(parents=True, exist_ok=True)


def flood_background(rgb: np.ndarray, thresh: float) -> np.ndarray:
    """从四边洪水填充颜色接近背景的像素，返回背景掩码。"""
    h, w, _ = rgb.shape
    corners = np.concatenate(
        [
            rgb[:24, :24].reshape(-1, 3),
            rgb[:24, -24:].reshape(-1, 3),
            rgb[-24:, :24].reshape(-1, 3),
            rgb[-24:, -24:].reshape(-1, 3),
        ]
    )
    bg = np.median(corners, axis=0)
    dist = np.sqrt(((rgb.astype(np.float32) - bg) ** 2).sum(axis=2))
    cand = dist < thresh
    seen = np.zeros((h, w), dtype=bool)
    dq: deque[tuple[int, int]] = deque()
    for x in range(w):
        for y in (0, h - 1):
            if cand[y, x] and not seen[y, x]:
                seen[y, x] = True
                dq.append((y, x))
    for y in range(h):
        for x in (0, w - 1):
            if cand[y, x] and not seen[y, x]:
                seen[y, x] = True
                dq.append((y, x))
    while dq:
        y, x = dq.popleft()
        for ny, nx in ((y - 1, x), (y + 1, x), (y, x - 1), (y, x + 1)):
            if 0 <= ny < h and 0 <= nx < w and cand[ny, nx] and not seen[ny, nx]:
                seen[ny, nx] = True
                dq.append((ny, nx))
    return seen


def extract_front(sheet: Path, out: Path, max_dim: int = 640, thresh: float = 30.0) -> None:
    from scipy import ndimage

    im = Image.open(sheet).convert("RGB")
    w, h = im.size
    # 内缩裁切避开四视图的分隔线
    quad = im.crop((6, 6, w // 2 - 6, h // 2 - 6))
    rgb = np.asarray(quad)
    bgmask = flood_background(rgb, thresh)
    alpha = np.where(bgmask, 0, 255).astype(np.uint8)
    # 只保留最大连通主体（及其 5% 以上的大部件），去掉 FRONT 标签文字等残留
    lab, n = ndimage.label(alpha > 12)
    if n > 0:
        sizes = ndimage.sum(alpha > 12, lab, range(1, n + 1))
        largest = sizes.max()
        keep = np.isin(lab, [i + 1 for i, s in enumerate(sizes) if s >= max(0.05 * largest, 60)])
        alpha = np.where(keep, alpha, 0).astype(np.uint8)
    alpha_im = Image.fromarray(alpha, "L").filter(ImageFilter.GaussianBlur(0.9))
    rgba = quad.convert("RGBA")
    rgba.putalpha(alpha_im)
    bbox = alpha_im.point(lambda v: 255 if v > 12 else 0).getbbox()
    if bbox is None:
        raise RuntimeError(f"{sheet.name}: 未能提取主体")
    pad = 8
    box = (
        max(0, bbox[0] - pad),
        max(0, bbox[1] - pad),
        min(rgba.width, bbox[2] + pad),
        min(rgba.height, bbox[3] + pad),
    )
    sprite = rgba.crop(box)
    sprite.thumbnail((max_dim, max_dim), Image.LANCZOS)
    sprite.save(out, "WEBP", quality=90, method=6)
    print(f"{sheet.name} -> {out.name} {sprite.size}")


def main() -> None:
    for lv in range(1, 12):
        if lv == 6 and (TURN / "CAT_L06_v2.png").exists():
            sheet = TURN / "CAT_L06_v2.png"
        else:
            sheet = TURN / f"CAT_L{lv:02d}.png"
        extract_front(sheet, OUT / f"cat{lv:02d}.webp")
    props = [
        ("PROP_TEASER_v2.png", "prop1.webp"),
        ("PROP_TREAT.png", "prop2.webp"),
        ("PROP_WILD.png", "prop3.webp"),
        ("PROP_BLOWER.png", "prop4.webp"),
    ]
    for src, dst in props:
        extract_front(TURN / src, OUT / dst, max_dim=384, thresh=30.0)
    # 猫耳：从 ENV_WICKER 正面左上区域裁切提取
    env = Image.open(TURN / "ENV_WICKER.png").convert("RGB")
    ear_crop = env.crop((70, 40, 260, 250))
    rgb = np.asarray(ear_crop)
    bgmask = flood_background(rgb, 30.0)
    alpha = np.where(bgmask, 0, 255).astype(np.uint8)
    alpha_im = Image.fromarray(alpha, "L").filter(ImageFilter.GaussianBlur(0.9))
    rgba = ear_crop.convert("RGBA")
    rgba.putalpha(alpha_im)
    bbox = alpha_im.point(lambda v: 255 if v > 12 else 0).getbbox()
    if bbox:
        ear = rgba.crop(bbox)
        ear.thumbnail((256, 256), Image.LANCZOS)
        ear.save(OUT / "ear.webp", "WEBP", quality=90, method=6)
        print(f"ENV_WICKER ear -> ear.webp {ear.size}")
    # 藤编纹理：背面视图中段的干净编织面
    tex = env.crop((760, 260, 1180, 560))
    tex.thumbnail((512, 512), Image.LANCZOS)
    tex.save(OUT / "wicker.webp", "WEBP", quality=88, method=6)
    print(f"wicker texture -> wicker.webp {tex.size}")


if __name__ == "__main__":
    main()
