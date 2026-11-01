// Task 153 (run 2) — VLM the corrected-height Twin Villas shots.
// NOTE for interpretation: a red "GAME SERVER UNREACHABLE" dialog is EXPECTED
// local-only noise (the sandbox browser cannot reach :3003 — the platform
// proxy is a deployed-env feature); instruct the model to ignore it.
import ZAI from 'z-ai-web-dev-sdk'
import fs from 'fs'

const PRE = `You are looking at a first-person screenshot from a web FPS game. IMPORTANT: ignore any red "GAME SERVER UNREACHABLE" dialog overlay and any HUD elements — they are expected test noise. Judge only the 3D world rendering. `

const shots = [
  ['twin/shots/t153-r3-street-facade.png', 'street + full east facade', `The camera stands on an outdoor street facing the facade of a 3-storey villa ~13m away. Answer concisely: 1) Is a multi-storey building facade visible? 2) Count the rows of window openings (dark rectangular openings) — expect 3 rows above the ground plus ground-level openings/door. 3) Is a ground-floor doorway visible? 4) Does the street surface and the enclosing walls render properly? 5) Any geometry glitches (holes in walls, floating boxes, z-fighting)?`],
  ['twin/shots/t153-r3-l1-window-duel.png', 'L1 window duel lane', `The camera stands at an upper-floor window looking through the opening across a street at the ENEMY villa. Answer concisely: 1) Is the view framed by a window opening (side wall pieces + sill below + lintel above)? 2) Through the opening, is the opposite building visible (its wall/window/interior)? 3) Is this clearly a cross-street view (outdoor gap between the buildings)? 4) Any glitches?`],
  ['twin/shots/t153-r3-l2-window-duel.png', 'L2 window duel lane', `Same as before but one floor higher (top floor window). Answer concisely: 1) Window opening framing the view? 2) Opposite building or sky visible through it? 3) Does it read as the top storey of a building? 4) Any glitches?`],
  ['twin/shots/t153-r3-l0-window-room.png', 'ground window room', `The camera stands inside a ground-floor room ~4.5m from a window (sill ~waist height, opening above it) looking out onto a street. Answer concisely: 1) Interior room renders (walls, floor, ceiling)? 2) Window opening with a sill BELOW it (not a floor-to-ceiling gap)? 3) Through the window — street ground and/or opposite building visible? 4) Any glitches (black voids, missing geometry)?`],
  ['twin/shots/t153-r3-hall-staircore.png', 'entry hall + stair core', `The camera stands in an entry hall looking at a stair core. Answer concisely: 1) A wooden staircase with many small steps visible? 2) Solid landing blocks where the stairs turn? 3) Walls/floor/ceiling render properly with textures? 4) Any glitches?`],
  ['twin/shots/t153-r3-flight-a.png', 'mid-staircase', `The camera stands ON a staircase looking up the climb. Answer concisely: 1) Steps rising ahead with correct perspective? 2) Solid stair mass (no floating steps, no gaps)? 3) Any glitches?`],
]

const main = async () => {
  const zai = await ZAI.create()
  const out = {}
  for (const [f, desc, q] of shots) {
    try {
      const b64 = fs.readFileSync('/home/z/my-project/scripts/' + f).toString('base64')
      const r = await zai.chat.completions.createVision({
        model: 'glm-4.6v',
        messages: [{ role: 'user', content: [
          { type: 'image_url', image_url: { url: `data:image/png;base64,${b64}` } },
          { type: 'text', text: PRE + q },
        ] }],
      })
      out[f] = r.choices[0]?.message?.content ?? ''
      console.log(`\n=== ${f} (${desc}) ===\n${out[f].slice(0, 800)}`)
    } catch (e) { out[f] = 'ERROR: ' + e.message; console.log(f, 'ERROR', e.message) }
  }
  fs.writeFileSync('/home/z/my-project/scripts/twin/vlm-t153-r3.json', JSON.stringify(out, null, 2))
}
main().catch(e => { console.error(e.message); process.exit(1) })
