// Task 147 — VLM the B close-up burst (immediate capture, 2 m standoff).
import ZAI from 'z-ai-web-dev-sdk'
import fs from 'fs'

const shots = [
  ['t147/t147-B-close1.png', 'B close 1', `First-person view from a web FPS on a tropical island map. An enemy character should be standing ~2 meters ahead of the camera, centered. Answer concisely: 1) humanoid enemy visible in frame? 2) outfit: leather jacket / street clothes / cap or beanie — or military helmet + tactical vest? 3) does it read as a civilian rebel rather than a soldier? 4) weapon in its hands?`],
  ['t147/t147-B-close2.png', 'B close 2', `First-person view from a web FPS on a tropical island map. An enemy character should be ~2 meters ahead, centered. Concisely: 1) enemy visible? 2) outfit description; 3) civilian rebel vs military soldier; 4) weapon.`],
  ['t147/t147-B-close3.png', 'B close 3', `First-person view from a web FPS on a tropical island map. An enemy character should be ~2 meters ahead, centered. Concisely: 1) enemy visible? 2) outfit description; 3) civilian rebel vs military soldier; 4) weapon.`],
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
  fs.writeFileSync('/home/z/my-project/scripts/t147/vlm-t147-close.json', JSON.stringify(out, null, 2))
}
main().catch(e => { console.error(e.message); process.exit(1) })
