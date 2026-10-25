// Task 112d — VLM pose inspection of the staged model (spinner preview)
import ZAI from 'z-ai-web-dev-sdk'
import fs from 'fs'

const main = async () => {
  const zai = await ZAI.create()
  for (const f of ['t112-fp-1.png', 't112-fp-2.png', 't112-fp-3.png']) {
    try {
      const b64 = fs.readFileSync('/home/z/my-project/download/' + f).toString('base64')
      const r = await zai.chat.completions.createVision({
        model: 'glm-4.6v',
        messages: [
          { role: 'user', content: [
            { type: 'image_url', image_url: { url: `data:image/png;base64,${b64}` } },
            { type: 'text', text: `A 3D soldier character model rotating on a turntable (dark background, grid floor). The model was rotated from its original lying orientation to stand upright (longest axis = up); it has NOT been rigged yet. Describe precisely: 1) Overall pose: standing/lying? upright or upside-down? 2) ARMS: where are they — hanging at sides, A-pose (~30-45 deg out), T-pose (horizontal), or behind the body? Straight or bent elbows? 3) LEGS: together/apart? 4) FACING: does the model face toward or away from the camera in this frame (front = face/vest visible)? 5) Gear: helmet, vest, backpack, gun in hands? 6) Any visible mesh problems (holes, doubles)?` },
          ] },
        ],
      })
      console.log(`\n=== ${f} ===\n${(r.choices[0]?.message?.content ?? '').slice(0, 1100)}`)
    } catch (e) { console.log(f, 'ERROR', e.message) }
  }
}
main().catch(e => { console.error(e.message); process.exit(1) })
