// Task 113 — ground-truth VLM: is the soldier BODY standing at the framed
// spot (single transform) or is there a floating gun / displaced body
// (double root transform on skinned meshes)?
import ZAI from 'z-ai-web-dev-sdk'
import fs from 'fs'

const files = process.argv.slice(2).length ? process.argv.slice(2) : ['t113-gt-near.png']

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
            { type: 'text', text: `First-person FPS screenshot (crosshair center). The camera is framed ~3 m from where a soldier character is REPORTED to stand. Answer precisely: 1) Is a full soldier BODY (torso+legs+head) visible within ~4 m of the crosshair? 2) Is any weapon/gun visible floating in mid-air WITHOUT a body holding it? 3) Is there a soldier body visible far away in the distance instead? 4) Verdict: body AT the crosshair (close), or gun-without-body / body only far away?` },
          ] },
        ],
      })
      console.log(`\n=== ${f} ===\n${(r.choices[0]?.message?.content ?? '').slice(0, 900)}`)
    } catch (e) { console.log(f, 'ERROR', e.message) }
  }
}
main().catch(e => { console.error(e.message); process.exit(1) })
