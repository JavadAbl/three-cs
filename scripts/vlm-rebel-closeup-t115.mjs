// Task 115 — close-up VLM: rebel IDENTITY read (leather jacket etc) + hands.
import ZAI from 'z-ai-web-dev-sdk'
import fs from 'fs'

const main = async () => {
  const zai = await ZAI.create()
  const b64 = fs.readFileSync('/home/z/my-project/scripts/t115c-t-closeup.png').toString('base64')
  const r = await zai.chat.completions.createVision({
    model: 'glm-4.6v',
    messages: [
      { role: 'user', content: [
        { type: 'image_url', image_url: { url: `data:image/png;base64,${b64}` } },
        { type: 'text', text: `Live screenshot from a web FPS (aim map). Expected in frame: an enemy TERRORIST bot ~2 m away rendered with a NEW character model — a "leather rebel" style fighter (civilian: leather jacket / street clothes, NO military helmet, NO tactical vest, NO backpack) holding a pistol two-handed. Answer concisely: 1) Is a character model visible in the frame and filling a reasonable part of it? If it's a death screen or no character, say so and stop. 2) Does it read as a LEATHER-CLAD REBEL (civilian fighter) — describe the clothing you see. 3) Human scale ~1.8 m and grounded? 4) Both hands on the pistol (two-hand hold), or gun floating? 5) Any bugs: spikes, stretched limbs, missing/black textures, clipping through floor?` },
      ] },
    ],
  })
  console.log(r.choices[0]?.message?.content ?? '')
  fs.writeFileSync('/home/z/my-project/scripts/vlm-rebel-closeup-t115.json', JSON.stringify({ verdict: r.choices[0]?.message?.content }, null, 2))
}
main().catch(e => { console.error(e.message); process.exit(1) })
