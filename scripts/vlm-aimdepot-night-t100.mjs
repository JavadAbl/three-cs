// Task 100 — VLM verification of the moonlit night AIM DEPOT
import ZAI from 'z-ai-web-dev-sdk'
import fs from 'fs'

const shots = [
  'aimdepot-t100-night-spawn.png',
  'aimdepot-t100-night-windowwall.png',
  'aimdepot-t100-night-mid.png',
]

const main = async () => {
  const zai = await ZAI.create()
  const out = { task: 100, subject: 'aimdepot moonlit night — live VLM verification', shots: {} }
  for (const f of shots) {
    const b64 = fs.readFileSync('/home/z/my-project/download/' + f).toString('base64')
    const r = await zai.chat.completions.createVision({
      model: 'glm-4.6v',
      messages: [{
        role: 'user', content: [
          { type: 'image_url', image_url: { url: `data:image/png;base64,${b64}` } },
          { type: 'text', text: 'Live screenshot of a crate-yard FPS map that was just converted to a NIGHT setting (design goal: moonlit night with moon and stars). Answer concisely: 1) Does it read as NIGHT? Describe the sky: do you see a MOON (bright disc with halo) and STARS (small white points)? 2) Is the arena still PLAYABLE-readable: can you clearly distinguish the ground, walls, crates and lane walls (not pitch-black mush)? 3) Any visual bugs: banding, z-fighting, missing textures, floating geometry? 4) Rate the night atmosphere 1-10 and say what would improve it most.' },
        ] },
      ],
    })
    const v = (r.choices[0]?.message?.content ?? '').slice(0, 800)
    out.shots[f] = v
    console.log(`\n===== ${f} =====\n${v}`)
  }
  fs.writeFileSync('/home/z/my-project/scripts/vlm-aimdepot-night-t100.json', JSON.stringify(out, null, 2))
}
main().catch(e => { console.error(e.message); process.exit(1) })
