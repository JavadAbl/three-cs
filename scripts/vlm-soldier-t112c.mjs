// Task 112c — VLM check of clean live-bot shots
import ZAI from 'z-ai-web-dev-sdk'
import fs from 'fs'

const files = ['t112-u1.png', 't112-u2.png', 't112-u3.png']

const main = async () => {
  const zai = await ZAI.create()
  for (const f of files) {
    try {
      const b64 = fs.readFileSync('/home/z/my-project/download/' + f).toString('base64')
      const r = await zai.chat.completions.createVision({
        model: 'glm-4.6v',
        messages: [
          { role: 'user', content: [
            { type: 'image_url', image_url: { url: `data:image/png;base64,${b64}` } },
            { type: 'text', text: `Screenshot from a web FPS (Dust2, first-person CT player). Characters use a new "soldier in equipment" model. Answer concisely: 1) How many humanoid soldiers are visible? Standing/lying? 2) Describe the closest one: pose (standing upright?), scale vs crates/walls (human ~1.8m), color (bluish=CT), gear (helmet, vest, backpack). 3) Rigging bugs: detached/stretched/spiky limbs, folded pose, floating or sunken? 4) One-line verdict: does it read as a proper counter-terrorist soldier character?` },
          ] },
        ],
      })
      console.log(`\n=== ${f} ===\n${(r.choices[0]?.message?.content ?? '').slice(0, 1000)}`)
    } catch (e) { console.log(f, 'ERROR', e.message) }
  }
}
main().catch(e => { console.error(e.message); process.exit(1) })
