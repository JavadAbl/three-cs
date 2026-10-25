// Task 112 — VLM verification of the staged soldier_character.glb as the CT
// character model (auto-rigged by usermodel.ts, team-tinted bluish for CT).
import ZAI from 'z-ai-web-dev-sdk'
import fs from 'fs'

const files = [
  ['t112-ct-1.png', 'CT player vantage, dust2 spawn'],
  ['t112-ct-2.png', 'CT player vantage, mid-area'],
  ['t112-ct-3.png', 'CT player vantage, later'],
  ['t112-ct-4.png', 'CT player vantage, last'],
]

const main = async () => {
  const zai = await ZAI.create()
  const out = { task: 112, subject: 'soldier_character.glb as CT character — live VLM verification', shots: {} }
  for (const [f, desc] of files) {
    try {
      const b64 = fs.readFileSync('/home/z/my-project/download/' + f).toString('base64')
      const r = await zai.chat.completions.createVision({
        model: 'glm-4.6v',
        messages: [
          { role: 'user', content: [
            { type: 'image_url', image_url: { url: `data:image/png;base64,${b64}` } },
            { type: 'text', text: `Live screenshot from a web FPS (map Dust2). The characters were just swapped to a new "soldier in equipment" model (auto-rigged, team-tinted: CT = light blue tint, T = tan tint). Vantage: ${desc}. Answer concisely: 1) Are any character models (soldiers) visible in this frame? How many, and are they CT (bluish) or T (tan)? 2) Do they look like proper humanoid soldiers: upright, correct proportions (not giant/dwarfed vs the map), limbs attached correctly, no missing/stretched geometry? 3) Do they read as COUNTER-TERRORIST style (military soldier with vest/equipment) rather than terrorist? 4) Any visual bugs: floating limbs, inverted pose, wrong scale, z-fighting, black/missing textures?` },
          ] },
        ],
      })
      const verdict = r.choices[0]?.message?.content ?? ''
      out.shots[f] = verdict.slice(0, 1200)
      console.log(`\n=== ${f} (${desc}) ===\n${verdict}`)
    } catch (e) { out.shots[f] = 'ERROR: ' + e.message; console.log(f, 'ERROR', e.message) }
  }
  fs.writeFileSync('/home/z/my-project/scripts/vlm-soldier-t112.json', JSON.stringify(out, null, 2))
}
main().catch(e => { console.error(e.message); process.exit(1) })
