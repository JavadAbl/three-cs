// Task 153 — VLM the Twin Villas render shots: do the two facing villas,
// their window openings, the stair core and the basement/tunnel actually
// render as intended?
import ZAI from 'z-ai-web-dev-sdk'
import fs from 'fs'

const shots = [
  ['twin/shots/t153-street-facades.png', 'street + both facades', `First-person view from a web FPS. Expected: standing in a doorway/hall looking EAST across a ~16m outdoor street at the facing building's facade. Answer concisely: 1) Is an opposite building facade visible with rectangular WINDOW openings (dark holes or openings in the wall) arranged on more than one floor level? 2) How many window rows/levels can you count? 3) Is there a street/ground between camera and the facade? 4) Any rendering glitches — missing geometry, z-fighting stripes, floating boxes, holes where walls should be?`],
  ['twin/shots/t153-l1-window-duel.png', 'L1 window duel lane', `First-person view from a web FPS, standing at an upper-floor window looking through it. Expected: looking THROUGH a window opening (wall on left and right of the opening, sill below) across a street at the ENEMY building's aligned window at the same height. Answer concisely: 1) Is the view framed by a window opening (side walls + sill/lintel)? 2) Through the opening, is the opposite building's wall/window visible? 3) Roughly what fraction of the frame does the opening cover? 4) Any rendering glitches?`],
  ['twin/shots/t153-l0-window-room.png', 'ground window room', `First-person view inside a room in a web FPS. Expected: an interior room with a window opening in the far wall (sill ~1m up) looking onto a street, maybe a wooden crate in the room. Answer concisely: 1) Interior room visible with walls/floor rendering properly? 2) Window opening in the wall (not a full-height gap — sill below the opening)? 3) Through it — street/opposite building? 4) Any glitches (missing floor, see-through walls, black voids)?`],
  ['twin/shots/t153-hall-staircore.png', 'entry hall + stair core', `First-person view inside a building in a web FPS, looking WEST at a stair core. Expected: a hall with a wooden staircase rising, solid landing blocks, steps visible. Answer concisely: 1) Is a staircase with multiple steps visible? 2) Do the steps look like a solid climbable stair mass (not floating slabs)? 3) Room walls/floor/ceiling render properly? 4) Any glitches?`],
  ['twin/shots/t153-flight-a.png', 'on the stairs', `First-person view from ON a staircase in a web FPS, looking up the stairs. Expected: steps rising ahead, walls at the sides, maybe a landing above. Answer concisely: 1) Steps visible ahead rising? 2) Does it read as a proper staircase climb? 3) Any glitches — missing steps, gaps under feet, floating geometry?`],
  ['twin/shots/t153-basement.png', 'basement + tunnel mouth', `First-person view in a BASEMENT in a web FPS, looking east. Expected: an underground room (concrete/asphalt floor, darker) with an opening/tunnel mouth in the far wall leading into a corridor. Answer concisely: 1) Does it read as an underground basement (low ceiling, enclosed)? 2) Is a tunnel/corridor opening visible in the far wall? 3) Is the room lit well enough to see (not pitch black)? 4) Any glitches?`],
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
          { type: 'text', text: q },
        ] }],
      })
      out[f] = r.choices[0]?.message?.content ?? ''
      console.log(`\n=== ${f} (${desc}) ===\n${out[f].slice(0, 900)}`)
    } catch (e) { out[f] = 'ERROR: ' + e.message; console.log(f, 'ERROR', e.message) }
  }
  fs.writeFileSync('/home/z/my-project/scripts/twin/vlm-t153.json', JSON.stringify(out, null, 2))
}
main().catch(e => { console.error(e.message); process.exit(1) })
