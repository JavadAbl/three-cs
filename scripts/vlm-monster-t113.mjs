// Task 113 — re-inspect the Task-112 "PASS" screenshot (t112-u2.png) with fresh
// eyes, plus the two dead-body shots, asking specifically about MONSTER signs:
// giant scale, supine pose, spiky/exploded geometry. This tells us whether the
// 06:52 verification ever actually saw the v2 bake through the game's pipeline.
import ZAI from 'z-ai-web-dev-sdk'
import fs from 'fs'

const files = process.argv.slice(2).length ? process.argv.slice(2) : ['t112-u2.png']

const main = async () => {
  const zai = await ZAI.create()
  for (const f of files) {
    try {
      const p = fs.existsSync('/home/z/my-project/download/' + f)
        ? '/home/z/my-project/download/' + f
        : '/home/z/my-project/scripts/' + f
      const b64 = fs.readFileSync(p).toString('base64')
      const r = await zai.chat.completions.createVision({
        model: 'glm-4.6v',
        messages: [
          { role: 'user', content: [
            { type: 'image_url', image_url: { url: `data:image/png;base64,${b64}` } },
            { type: 'text', text: `Screenshot from a web FPS game (Dust2 map, first-person view). Answer concisely: 1) Are any soldier characters visible? Standing upright or lying supine? 2) Do they read as GIANT/oversized (much taller than a door/crate ~1m) or human-scale? 3) Any spiky, exploded, stretched or deformed geometry on them? 4) One-line verdict: normal CT soldier, or a "big monster"?` },
          ] },
        ],
      })
      console.log(`\n=== ${f} ===\n${(r.choices[0]?.message?.content ?? '').slice(0, 800)}`)
    } catch (e) { console.log(f, 'ERROR', e.message) }
  }
}
main().catch(e => { console.error(e.message); process.exit(1) })
