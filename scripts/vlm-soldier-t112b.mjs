// Task 112b — VLM check of the rapid-teleport shots (character visibility)
import ZAI from 'z-ai-web-dev-sdk'
import fs from 'fs'

const files = ['t112-a.png', 't112-b.png', 't112-c.png', 't112-ct-close2.png', 't112-ct-close1.png']

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
            { type: 'text', text: `Screenshot from a web FPS (Dust2). Character models were swapped to a "soldier in equipment" model. 1) How many humanoid soldier characters are visible in this frame? 2) Describe one in detail: pose, scale vs the map, colors (bluish=CT / tan=T), clothing/equipment (helmet? vest? backpack?). 3) Any rigging bugs: limbs detached, folded, stretched, character tilted/floating/sunken into ground? 4) Does it read as a counter-terrorist soldier? Concise.` },
          ] },
        ],
      })
      console.log(`\n=== ${f} ===\n${(r.choices[0]?.message?.content ?? '').slice(0, 900)}`)
    } catch (e) { console.log(f, 'ERROR', e.message) }
  }
}
main().catch(e => { console.error(e.message); process.exit(1) })
