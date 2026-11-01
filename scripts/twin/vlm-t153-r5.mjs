import ZAI from 'z-ai-web-dev-sdk'
import fs from 'fs'
const PRE = `First-person screenshot from a web FPS. Ignore any HUD/UI elements. Judge only the 3D world. `
const shots = [
  ['twin/shots/t153-r7-l1-window-duel.png', 'L1 window duel', `The camera stands at a first-floor (2nd storey) window of a villa, looking through the opening across a ~16m outdoor street at the MIRROR-IMAGE villa. Answer concisely: 1) Is the view framed by a window opening (side walls + sill below + lintel above)? 2) Through the opening: is the OPPOSITE BUILDING's facade visible (its windows aligned at the same height)? 3) Is any part of the street/ground between the buildings visible at the bottom of the opening? 4) Any rendering glitches?`],
  ['twin/shots/t153-r7-l2-window-duel.png', 'L2 window duel', `Same but the TOP floor window. Answer concisely: 1) Window opening frames the view? 2) Through it: opposite building's top-floor window/facade visible (aligned), or sky above it? 3) Does it read as two facing multi-storey buildings? 4) Any glitches?`],
  ['twin/shots/t153-NOPE', 'ground window room', `The camera stands inside a ground-floor room ~4.5m from a window (sill ~1m, opening above) looking out. Answer concisely: 1) Interior room renders (walls/floor/ceiling, maybe a crate)? 2) Window with sill below the opening? 3) Through the window: the street and the OPPOSITE building's ground facade/window visible? 4) Any glitches (voids, missing geometry)?`],
]
const main = async () => {
  const zai = await ZAI.create()
  for (const [f, desc, q] of shots) {
    try {
      const b64 = fs.readFileSync('/home/z/my-project/scripts/' + f).toString('base64')
      const r = await zai.chat.completions.createVision({ model: 'glm-4.6v', messages: [{ role: 'user', content: [
        { type: 'image_url', image_url: { url: `data:image/png;base64,${b64}` } }, { type: 'text', text: PRE + q }] }] })
      console.log(`\n=== ${f} (${desc}) ===\n${(r.choices[0]?.message?.content ?? '').slice(0, 800)}`)
    } catch (e) { console.log(f, 'ERROR', e.message) }
  }
}
main().catch(e => { console.error(e.message); process.exit(1) })
