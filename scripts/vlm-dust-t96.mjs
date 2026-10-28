// Task 96 — VLM verification of the dust normal-map rollout (3 live shots)
import ZAI from 'z-ai-web-dev-sdk'
import fs from 'fs'

const files = [
  ['dust-t96-spawn.png', 'T-spawn panorama'],
  ['dust-t96-wall180.png', 'wall relief close-up (plaster wall dead ahead)'],
  ['dust-t96-pano0.png', 'spawn-area panorama sweep'],
]

const main = async () => {
  const zai = await ZAI.create()
  const out = { task: 96, subject: 'plain-dust normal-map rollout — live VLM verification', shots: {} }
  for (const [f, desc] of files) {
    const b64 = fs.readFileSync('/home/z/my-project/download/' + f).toString('base64')
    const r = await zai.chat.completions.createVision({
      model: 'glm-4.6v',
      messages: [
        { role: 'user', content: [
          { type: 'image_url', image_url: { url: `data:image/png;base64,${b64}` } },
          { type: 'text', text: `Live screenshot from a web FPS (map "Dust", desert theme). Vantage: ${desc}. This map just received real normal maps (surface relief upgrade; albedo/height look unchanged by design). Answer concisely: 1) Do surfaces show believable 3D relief (wall cracks, brick depth, sand ruts, wood grain)? 2) Any rendering bugs: missing/black textures, z-fighting, holes, seams, stretched UVs? 3) Overall: does relief read as genuinely 3D rather than flat decals?` },
        ] },
      ],
    })
    const verdict = r.choices[0]?.message?.content ?? ''
    out.shots[f] = verdict.slice(0, 900)
    console.log(`\n=== ${f} (${desc}) ===\n${verdict}`)
  }
  fs.writeFileSync('/home/z/my-project/scripts/vlm-dust-t96.json', JSON.stringify(out, null, 2))
}
main().catch(e => { console.error(e.message); process.exit(1) })
