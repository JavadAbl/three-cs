// Task 101 — VLM verdict on the 3D-model night sky (3 vantages)
import ZAI from 'z-ai-web-dev-sdk'
import fs from 'node:fs'

const SHOTS = [
  ['spawn', 'T-spawn panorama at eye level, yaw 0', 'scripts/.tmp/ns101-spawn.png'],
  ['mid', 'mid-yard (0,1.7,6) yaw 0 at eye level', 'scripts/.tmp/ns101-mid.png'],
  ['sky', 'same mid spot pitched UP ~40deg — sky field view', 'scripts/.tmp/ns101-sky.png'],
]

async function main() {
  const zai = await ZAI.create()
  let pass = 0
  for (const [name, where, path] of SHOTS) {
    const b64 = fs.readFileSync(path).toString('base64')
    const res = await zai.chat.completions.createVision({
      model: 'glm-4.6v',
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: `Screenshot from a night-time FPS aim map (scene: ${where}). The sky should now contain a REAL 3D moon (bright disc with lunar surface texture, soft glow halo) and a dense star field (thousands of small points of light, some tinted warm/blue, varying sizes). Judge strictly:
1) MOON: is a bright moon disc visible in frame? Does it look like a real textured moon (craters/maria mottling) rather than a flat white circle? Does it have a soft glow/halo around it? Roughly where in frame and how big (approx % of frame width)?
2) STARS: is the star field visible? Rate density (sparse/moderate/dense), describe brightness/size variety and any color tints.
3) ARTIFACTS: any square/blocky sprites, hard sprite borders, stars visibly BELOW the horizon or on the ground, duplicate moons, or leftover painted-looking disc? Any rendering bugs (z-fighting, stars through walls/moon)?
4) ARENA: is the play area still dark-but-readable (walls, crates, lanes distinguishable)?
End with verdict line exactly: PASS or FAIL, then one short reason.` },
          { type: 'image_url', image_url: { url: 'data:image/png;base64,' + b64 } },
        ],
      }],
    })
    const out = res.choices[0].message.content
    console.log(`===== ${name} (${where}) =====`)
    console.log(out)
    console.log()
    if (/PASS/.test(out.split('\n').reverse().join(' ').slice(0, 200))) pass++
  }
  console.log(`\n${pass}/${SHOTS.length} shots PASS`)
}
main().catch(e => { console.error(e.message); process.exit(1) })
