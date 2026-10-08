#!/usr/bin/env python3
"""Render the ShopFlow app icons from the logo mark in icons.js.

The mark is a rounded square with a check inside (viewBox 24x24):
    rect x=3 y=3 w=18 h=18 rx=5.5   +   path m8 12.5 l2.8 2.8 L16 9

Everything is drawn at 4x and downsampled, which is the cheapest way to get
clean antialiased strokes out of PIL. Run from the repo root:
    python3 tools/make-icons.py
"""
from PIL import Image, ImageDraw

ACCENT = (0, 113, 227, 255)      # --accent, the light-theme value
WHITE = (255, 255, 255, 255)
SS = 4                            # supersample factor


def draw_mark(d, size, scale, stroke_scale=1.0):
    """Draw the 24-unit logo mark centred on a `size` canvas."""
    u = size * scale / 24.0                      # one viewBox unit in pixels
    ox = oy = (size - 24 * u) / 2                # centre the viewBox
    w = max(1, round(1.7 * u * stroke_scale))    # the SVG's stroke-width

    def P(x, y):
        return (ox + x * u, oy + y * u)

    x0, y0 = P(3, 3)
    x1, y1 = P(21, 21)
    d.rounded_rectangle([x0, y0, x1, y1], radius=5.5 * u, outline=WHITE, width=w)
    d.line([P(8, 12.5), P(10.8, 15.3), P(16, 9)], fill=WHITE, width=w, joint="curve")
    # PIL leaves square line ends; round them by hand so the check matches the SVG
    r = w / 2
    for (cx, cy) in (P(8, 12.5), P(10.8, 15.3), P(16, 9)):
        d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=WHITE)


def render(path, size, scale, maskable=False):
    S = size * SS
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    if maskable:
        d.rectangle([0, 0, S, S], fill=ACCENT)          # full bleed, OS crops it
    else:
        d.rounded_rectangle([0, 0, S - 1, S - 1], radius=S * 0.2237, fill=ACCENT)
    draw_mark(d, S, scale)
    img.resize((size, size), Image.LANCZOS).save(path)
    print(f"   {path}  {size}x{size}{' maskable' if maskable else ''}")


if __name__ == "__main__":
    print("→ Rendering app icons")
    render("icons/icon-192.png", 192, 0.74)
    render("icons/icon-512.png", 512, 0.74)
    render("icons/icon-maskable-512.png", 512, 0.58, maskable=True)
    render("icons/apple-touch-icon.png", 180, 0.78)   # iOS masks the corners itself
