#!/bin/bash
# Generate real weapon PBR albedo textures via z-ai image CLI
set -u
RAW=/home/z/my-project/scripts/texgen/raw
mkdir -p "$RAW"

gen() {
  local name="$1"; local prompt="$2"
  local out="$RAW/$name.png"
  if [ -s "$out" ]; then echo "skip $name (exists)"; return 0; fi
  for attempt in 1 2 3; do
    echo ">>> generating $name (attempt $attempt)"
    z-ai image -p "$prompt" -o "$out" -s 1024x1024 && [ -s "$out" ] && { echo "OK $name"; return 0; }
    sleep 3
  done
  echo "FAIL $name"; return 1
}

gen steel_blued "Seamless tileable texture of dark blued gun steel, fine horizontal machining marks, faint hairline scratches and holster wear, subtle oil sheen, dark gunmetal gray, photorealistic PBR albedo map, flat even studio lighting, no shadows, no vignette, top-down macro photograph, high detail"

gen polymer_black "Seamless tileable texture of matte black polymer plastic, pistol grip stippled pebble grain, fine speckled anti-slip texture, deep charcoal black, photorealistic PBR albedo map, flat even lighting, no shadows, no vignette, top-down macro photograph, high detail"

gen wood_laminate "Seamless tileable texture of AK-47 laminate wood gun stock, layered birch veneer stripes in amber orange-brown with visible thin glue lines between layers, warm honey tone, photorealistic PBR albedo map, flat even lighting, no shadows, top-down macro photograph, high detail"

gen enamel_od "Seamless tileable texture of olive drab green military rifle finish, baked enamel with subtle hammertone ripple, scattered fine scratches and small chips revealing dark metal underneath, muted olive green, photorealistic PBR albedo map, flat even lighting, no shadows, top-down macro photograph, high detail"

gen metal_dark "Seamless tileable texture of dark parkerized phosphate gun metal, fine matte granular grain, subtle rub wear on edges, dark graphite gray, photorealistic PBR albedo map, flat even lighting, no shadows, top-down macro photograph, high detail"

gen glove_fabric "Seamless tileable texture of black tactical shooting glove fabric, woven nylon with stitched quilting seams, subtle synthetic leather patches, dark charcoal, photorealistic PBR albedo map, flat even lighting, no shadows, top-down macro photograph, high detail"

gen pcb_green "Seamless tileable texture of green printed circuit board, dark green solder mask, gold copper traces, small microchips and electronic components evenly spread, photorealistic PBR albedo map, flat even lighting, no shadows, top-down macro photograph, high detail"

gen steel_stainless "Seamless tileable texture of brushed stainless steel gun slide, fine vertical machining brush marks, subtle holster rub wear scratches, faint fingerprint smudges, bright silver steel, photorealistic PBR albedo map, flat even lighting, no shadows, top-down macro photograph, high detail"

gen wood_walnut "Seamless tileable texture of dark walnut gun stock wood, deep chocolate brown grain with fine straight fibers, oil-finished sheen, subtle handling wear, photorealistic PBR albedo map, flat even lighting, no shadows, top-down macro photograph, high detail"

gen polymer_fde "Seamless tileable texture of flat dark earth tan polymer plastic, matte FDE tactical firearm furniture, fine speckled anti-slip pebble texture, muted desert brown, photorealistic PBR albedo map, flat even lighting, no shadows, top-down macro photograph, high detail"

echo "=== done ==="
ls -la "$RAW"
