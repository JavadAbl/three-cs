// Task 100b — VLM close-up of the moon (yaw-225 shot) + final spawn re-check
import ZAI from 'z-ai-web-dev-sdk'
import fs from 'fs'

const main = async () => {
  const zai = await ZAI.create()
  for (const f of ['aimdepot-t100d-spawn.png', 'aimdepot-t100d-mid.png']) {
    const b64 = fs.readFileSync('/home/z/my-project/download/' + f).toString('base64')
    const r = await zai.chat.completions.createVision({
      model: 'glm-4.6v',
      messages: [{
        role: 'user', content: [
          { type: 'image_url', image_url: { url: `data:image/png;base64,${b64}` } },
          { type: 'text', text: 'Night-time FPS map screenshot. QUESTION SET: 1) Is there a MOON visible? Describe it: does it have a visible disc, a soft halo/glow around it, and subtle surface shading (craters)? 2) Are stars visible? 3) Does the scene read as a believable moonlit night (cool blue moonlight, dark but readable arena)? 4) Rate the atmosphere 1-10.' },
        ] },
      ],
    })
    console.log(`\n===== ${f} =====\n${(r.choices[0]?.message?.content ?? '').slice(0, 700)}`)
  }
}
main().catch(e => { console.error(e.message); process.exit(1) })
