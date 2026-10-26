#!/usr/bin/env python3
"""Post-process AI-generated albedo textures into tileable PBR sets
(albedo + tangent-space normal + roughness) for the weapon viewmodels.

- Tileability: 2x2 mirrored quad at 2048, downscaled to 1024 -> perfectly
  seamless with RepeatWrapping; mirror symmetry is invisible on grunge tex.
- Normal map: gaussian-blurred luminance -> sobel -> tangent-space normal.
- Roughness map: per-material base +- luminance modulation, absolute values
  baked in (material.roughness stays 1.0).
"""
import os
import numpy as np
from PIL import Image, ImageFilter

RAW = '/home/z/my-project/scripts/texgen/raw'
OUT = '/home/z/my-project/public/assets/textures/weapons'
os.makedirs(OUT, exist_ok=True)

# name -> (normal_strength, blur_radius, rough_base, rough_lum_gain, rough_bias)
CFG = {
    'steel_blued':   (2.6, 1.2, 0.30, 0.18, 0.00),
    'polymer_black': (3.4, 1.0, 0.86, 0.10, 0.00),
    'wood_laminate': (2.4, 1.4, 0.55, 0.15, 0.00),
    'enamel_od':     (2.0, 1.6, 0.45, 0.14, 0.00),
    'metal_dark':    (2.2, 1.0, 0.62, 0.16, 0.00),
    'glove_fabric':  (3.0, 0.9, 0.90, 0.08, 0.00),
    'pcb_green':     (3.6, 0.8, 0.55, 0.20, 0.00),
    # Task 124 families
    'steel_stainless': (2.2, 1.1, 0.28, 0.16, 0.00),
    'wood_walnut':      (2.6, 1.4, 0.50, 0.16, 0.00),
    'polymer_fde':      (3.2, 1.0, 0.84, 0.10, 0.00),
}

# Task 124: optional OUT=<dir> override (staging per acceptance policy v3) and
# positional args to process only the named families
import sys
ONLY = [a for a in sys.argv[1:] if not a.startswith('/')]
OUT = next((a for a in sys.argv[1:] if a.startswith('/')), OUT)

def make_tileable(img: Image.Image) -> Image.Image:
    """2x2 mirrored quad -> seamless; keep detail via 2048 intermediate."""
    im = img.convert('RGB')
    w, h = im.size
    big = Image.new('RGB', (w * 2, h * 2))
    big.paste(im, (0, 0))
    big.paste(im.transpose(Image.FLIP_LEFT_RIGHT), (w, 0))
    big.paste(im.transpose(Image.FLIP_TOP_BOTTOM), (0, h))
    big.paste(im.transpose(Image.FLIP_LEFT_RIGHT).transpose(Image.FLIP_TOP_BOTTOM), (w, h))
    return big.resize((1024, 1024), Image.LANCZOS)

def sobel(lum: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Return dx, dy gradients via 3x3 sobel, boundary clamped."""
    p = np.pad(lum.astype(np.float32), 1, mode='edge')
    gx = (-p[:-2, :-2] - 2 * p[1:-1, :-2] - p[2:, :-2]
          + p[:-2, 2:] + 2 * p[1:-1, 2:] + p[2:, 2:])
    gy = (-p[:-2, :-2] - 2 * p[:-2, 1:-1] - p[:-2, 2:]
          + p[2:, :-2] + 2 * p[2:, 1:-1] + p[2:, 2:])
    return gx, gy

def normal_map(albedo: Image.Image, strength: float, blur: float) -> Image.Image:
    g = albedo.convert('L').filter(ImageFilter.GaussianBlur(blur))
    lum = np.asarray(g, dtype=np.float32) / 255.0
    gx, gy = sobel(lum)
    s = strength
    nx = -gx * s
    ny = -gy * s  # PIL y-down; flip at the end for OpenGL-style (+Y up)
    ny = -ny
    nz = np.ones_like(lum)
    norm = np.sqrt(nx * nx + ny * ny + nz * nz)
    nx /= norm; ny /= norm; nz /= norm
    out = np.stack([
        (nx * 0.5 + 0.5) * 255,
        (ny * 0.5 + 0.5) * 255,
        (nz * 0.5 + 0.5) * 255,
    ], axis=-1).clip(0, 255).astype(np.uint8)
    return Image.fromarray(out, 'RGB')

def roughness_map(albedo: Image.Image, base: float, gain: float, bias: float) -> Image.Image:
    g = albedo.convert('L').filter(ImageFilter.GaussianBlur(2.0))
    lum = np.asarray(g, dtype=np.float32) / 255.0
    r = base + (lum - 0.5) * gain + bias
    out = (np.clip(r, 0.05, 1.0) * 255).astype(np.uint8)
    return Image.fromarray(np.stack([out, out, out], axis=-1), 'RGB')

for name, (nstr, blur, rbase, rgain, rbias) in CFG.items():
    if ONLY and name not in ONLY:
        continue
    src = os.path.join(RAW, f'{name}.png')
    if not os.path.isfile(src):
        print('MISSING', name); continue
    albedo = make_tileable(Image.open(src))
    albedo.save(os.path.join(OUT, f'{name}.jpg'), quality=88, optimize=True)
    normal_map(albedo, nstr, blur).save(os.path.join(OUT, f'{name}_n.jpg'), quality=92, optimize=True)
    roughness_map(albedo, rbase, rgain, rbias).save(os.path.join(OUT, f'{name}_r.jpg'), quality=90, optimize=True)
    print('OK', name)

print('=== output ===')
for f in sorted(os.listdir(OUT)):
    print(f, os.path.getsize(os.path.join(OUT, f)))
