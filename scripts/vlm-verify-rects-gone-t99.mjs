// Task 99 AFTER — verify the floating rectangles are gone
import ZAI from 'z-ai-web-dev-sdk'
import fs from 'fs'

const pairs = [
  ['BEFORE', 'aimdepot-t99-spawn.png'],
  ['AFTER', 'aimdepot-t99-final-spawn.png'],
  ['AFTER', 'aimdepot-t99-final-windowwall.png'],
  ['AFTER', 'aimdepot-t99-final-mid.png'],
]

const main = async () => {
  const zai = await ZAI.create()
  for (const [tag, f] of pairs) {
    const b64 = fs.readFileSync('/home/z/my-project/download/' + f).toString('base64')
    const r = await zai.chat.completions.createVision({
      model: 'glm-4.6v',
      messages: [{
        role: 'user', content: [
          { type: 'image_url', image_url: { url: `data:image/png;base64,${b64}` } },
          { type: 'text', text: 'Screenshot of a crate-yard FPS map (perimeter concrete walls, window walls mid-field, wooden crates). Earlier this map had thin parapet cap slabs on top of the perimeter walls that read as FLOATING RECTANGLES in mid-air. QUESTION: In THIS image, do you see any rectangle shapes floating in mid-air, detached from walls/ground, with no visible support? Answer strictly: YES (describe each: position, size, texture) or NO (state what the wall-top edges look like now — clean straight lines against the sky or not).' },
        ] },
      ],
    })
    console.log(`\n===== ${tag}: ${f} =====\n${(r.choices[0]?.message?.content ?? '').slice(0, 600)}`)
  }
}
main().catch(e => { console.error(e.message); process.exit(1) })
