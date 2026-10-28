// Task 115 — VLM the isolated preview renders (ground truth of the model look).
import ZAI from 'z-ai-web-dev-sdk'
import fs from 'fs'

const shots = [
  ['t115-preview-rebel-front.png', 'front 3/4 view', `Isolated 3D character preview (dark background, ground grid, red pole = 1.79 m height reference). The model is the uploaded "leather rebel" character. Answer concisely: 1) Describe the character: clothing (leather jacket? street clothes? armor?), headgear (helmet? cap? bare head?), footwear, colors. 2) Does it read as a TERRORIST-style rebel/insurgent fighter (civilian look) rather than a military counter-terrorist soldier? 3) Pose: standing upright, arms hanging (A-pose)? Facing the camera or away? 4) Height vs the red reference pole (should be about equal, ~1.8 m)? 5) Any asset problems: missing textures (gray/white), black surfaces, inverted normals, holes?`],
  ['t115-preview-rebel-back.png', 'back view', `Isolated 3D character preview, back view (dark background, ground grid, red pole = 1.79 m reference). Describe: 1) back of the outfit (jacket details, backpack?), 2) facing direction relative to camera, 3) scale vs the red pole, 4) any asset problems.`],
  ['t115-preview-rebel-side.png', 'side view', `Isolated 3D character preview, side view (dark background, ground grid, red pole = 1.79 m reference). Describe: 1) profile of the outfit, 2) arms hanging at the sides?, 3) scale vs the red pole, 4) any asset problems.`],
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
      console.log(`\n=== ${f} (${desc}) ===\n${out[f].slice(0, 1400)}`)
    } catch (e) { out[f] = 'ERROR: ' + e.message; console.log(f, 'ERROR', e.message) }
  }
  fs.writeFileSync('/home/z/my-project/scripts/vlm-rebel-preview-t115.json', JSON.stringify(out, null, 2))
}
main().catch(e => { console.error(e.message); process.exit(1) })
