// Task 99 — locate the 'two rectangles in the air' on aim depot via VLM
import ZAI from 'z-ai-web-dev-sdk'
import fs from 'fs'

const shots = [
  'aimdepot-t99-spawn.png',
  'aimdepot-t99-windowwall.png',
  'aimdepot-t99-mid.png',
]

const main = async () => {
  const zai = await ZAI.create()
  for (const f of shots) {
    const b64 = fs.readFileSync('/home/z/my-project/download/' + f).toString('base64')
    const r = await zai.chat.completions.createVision({
      model: 'glm-4.6v',
      messages: [{
        role: 'user', content: [
          { type: 'image_url', image_url: { url: `data:image/png;base64,${b64}` } },
          { type: 'text', text: 'This is a screenshot of a crate-yard FPS map (aim arena, 64x44, perimeter concrete walls 6m high with thin parapet cap strips at the top, window walls in the middle, wooden crates). A player reports seeing TWO RECTANGLE SHAPES FLOATING IN THE AIR. Look carefully: 1) Do you see any rectangle shapes that appear to float in mid-air (not attached to walls/ground, no visible support)? 2) If yes, describe each one precisely: position in the image (left/center/right, top/middle), approximate screen size, color/texture, and what it might be (cap strip end face, decal, quad, box). 3) Could these be the ENDS of thin cap strips at the wall tops viewed edge-on, or are they truly detached from geometry? Answer with specific pixel-region descriptions.' },
        ] },
      ],
    })
    console.log(`\n===== ${f} =====\n${r.choices[0]?.message?.content ?? ''}`)
  }
}
main().catch(e => { console.error(e.message); process.exit(1) })
