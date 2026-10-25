// Task 115 ACCEPTANCE — inspect the post-acceptance live screenshot: does the
// game render normally (T teammates as leather-jacket rebels, CT as soldiers),
// weapons in hands, no monster-scale regression?
import ZAI from 'z-ai-web-dev-sdk'
import fs from 'fs'

const files = process.argv.slice(2).length ? process.argv.slice(2) : ['/tmp/accept-t115-live.png']

const main = async () => {
  const zai = await ZAI.create()
  for (const f of files) {
    try {
      const b64 = fs.readFileSync(f).toString('base64')
      const r = await zai.chat.completions.createVision({
        model: 'glm-4.6v',
        messages: [
          { role: 'user', content: [
            { type: 'image_url', image_url: { url: `data:image/png;base64,${b64}` } },
            { type: 'text', text: `Screenshot from a web FPS game (Aim Depot map, first-person view, player on TERRORIST side). Answer concisely: 1) Are any teammate/enemy characters visible? What do they look like (clothing, gear)? 2) Human-scale or oversized/monster-scale? 3) If a weapon is visible on a character, is it held in the hands or floating away from them? 4) Any spiky/exploded/stretched geometry? 5) One-line verdict.` },
          ] },
        ],
      })
      console.log(`\n=== ${f} ===\n${(r.choices[0]?.message?.content ?? '').slice(0, 800)}`)
    } catch (e) { console.log(f, 'ERROR', e.message) }
  }
}
main()
