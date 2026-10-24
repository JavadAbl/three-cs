// Task 101 — VLM check of the two textures extracted from the user's GLBs
import ZAI from 'z-ai-web-dev-sdk'
import fs from 'node:fs'

async function main() {
  const zai = await ZAI.create()
  const b64 = (p) => fs.readFileSync(p).toString('base64')
  const res = await zai.chat.completions.createVision({
    model: 'glm-4.6v',
    messages: [{
      role: 'user',
      content: [
        { type: 'text', text: 'Two textures from a night-sky asset pack. Image 1 = moon diffuse (equirect 1024x512). Image 2 = star sprite. Answer briefly: (1) Is image 1 a proper moon surface map — grey cratered, roughly uniform brightness (usable as a self-lit moon)?  (2) Is image 2 a soft radial glow sprite suitable for additive star points — describe its shape/color, any hard edges or borders that would look wrong when tiled as a point sprite?  (3) Any alpha channel issue visible (fully black corners vs transparent)?' },
        { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,' + b64('/tmp/moon_tex.jpg') } },
        { type: 'image_url', image_url: { url: 'data:image/png;base64,' + b64('/tmp/star_sprite.png') } },
      ],
    }],
  })
  console.log(res.choices[0].message.content)
}
main().catch(e => { console.error(e.message); process.exit(1) })
