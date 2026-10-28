// Task 115 — VLM the burst close-ups (rebel identity + hands).
import ZAI from 'z-ai-web-dev-sdk'
import fs from 'fs'

const files = process.argv.slice(2).length ? process.argv.slice(2) : ['t115d-z1.png', 't115d-z2.png', 't115d-z3.png']

const main = async () => {
  const zai = await ZAI.create()
  for (const f of files) {
    try {
      const b64 = fs.readFileSync('/home/z/my-project/scripts/' + f).toString('base64')
      const r = await zai.chat.completions.createVision({
        model: 'glm-4.6v',
        messages: [
          { role: 'user', content: [
            { type: 'image_url', image_url: { url: `data:image/png;base64,${b64}` } },
            { type: 'text', text: `Live screenshot from a web FPS (aim map). Expected: an enemy TERRORIST bot rendered with a NEW "leather rebel" model (civilian fighter: leather jacket / street clothes, NO helmet, NO tactical vest) at 2-4 m, holding a rifle or pistol. Answer concisely: 1) Is an enemy character clearly visible in frame (not a death screen)? How far (close 2-4 m / mid / far)? 2) Describe its clothing — leather/civilian rebel or military soldier? 3) Human scale and grounded? 4) Hands on the weapon (right on grip, left supporting) or gun floating / hands empty? 5) Any bugs: spikes, stretched limbs, missing textures, floor clipping?` },
          ] },
        ],
      })
      console.log(`\n=== ${f} ===\n` + (r.choices[0]?.message?.content ?? '').slice(0, 1300))
    } catch (e) { console.log(f, 'ERROR', e.message) }
  }
}
main().catch(e => { console.error(e.message); process.exit(1) })
