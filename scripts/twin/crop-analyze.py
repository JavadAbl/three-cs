from PIL import Image
import sys
# analyze the through-window band of the duel shots
for name in ['t153-r3-l1-window-duel', 't153-r3-l2-window-duel', 't153-r3-l0-window-room']:
    im = Image.open(f'scripts/twin/shots/{name}.png').convert('RGB')
    W, H = im.size
    # central band (the window opening region)
    crop = im.crop((int(W*0.30), int(H*0.22), int(W*0.70), int(H*0.62)))
    crop.save(f'scripts/twin/shots/crop-{name}.png')
    # sample a vertical strip down the middle: report avg color per horizontal band
    px = im.load()
    print(f'== {name} ({W}x{H}) — middle-column bands (y: avg RGB) ==')
    for y0 in range(0, H, H//12):
        rs = gs = bs = n = 0
        for y in range(y0, min(y0 + H//12, H)):
            r, g, b = px[W//2, y]
            rs += r; gs += g; bs += b; n += 1
        print(f'  y {y0:4d}-{y0+H//12:4d}: rgb({rs//n:3d},{gs//n:3d},{bs//n:3d})')
