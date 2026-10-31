// Task 147 — VLM the A/B gameplay bursts: phase A (rebel starved → T on the
// soldier fallback = the reported bug) vs phase B (rebel landed late →
// fallback players re-skinned to the real rebel = the fix).
import ZAI from 'z-ai-web-dev-sdk'
import fs from 'fs'

const shots = [
  ['t147/t147-A-fallback.png', 'A1 — fallback state', `First-person view from a web FPS on a tropical island map. Look for an enemy character standing/walking near the center of the frame (may be small, a few meters ahead). Answer concisely: 1) Is a humanoid enemy character visible in the frame? Where? 2) If yes, describe the outfit: military helmet? tactical vest with pouches? camo? What overall look — military counter-terrorist soldier or leather-jacket/street-clothes civilian rebel? 3) Outfit colors (bluish-grey soldier tones vs tan/beige)? 4) Weapon in its hands?`],
  ['t147/t147-A-fallback3.png', 'A2 — fallback state (later frame)', `First-person view from a web FPS on a tropical island map. Look for an enemy character near the center (may be small). Concisely: 1) humanoid enemy visible? 2) outfit look — military soldier (helmet/vest/camo) or civilian street-clothes rebel? 3) colors? 4) any rendering problems with the character?`],
  ['t147/t147-B-rebel.png', 'B1 — rebel re-skin', `First-person view from a web FPS on a tropical island map. Look for an enemy character standing/walking near the center of the frame. Answer concisely: 1) Is a humanoid enemy character visible? 2) If yes, describe the outfit: leather jacket? t-shirt? cap/beanie or military helmet? 3) Does it read as a civilian rebel/insurgent rather than a military soldier? 4) Weapon in its hands?`],
  ['t147/t147-B-rebel3.png', 'B2 — rebel re-skin (later frame)', `First-person view from a web FPS on a tropical island map. Look for an enemy character near the center (may be small). Concisely: 1) humanoid enemy visible? 2) outfit — military soldier or civilian rebel (street clothes/cap)? 3) any rendering problems?`],
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
      console.log(`\n=== ${f} (${desc}) ===\n${out[f].slice(0, 1000)}`)
    } catch (e) { out[f] = 'ERROR: ' + e.message; console.log(f, 'ERROR', e.message) }
  }
  fs.writeFileSync('/home/z/my-project/scripts/t147/vlm-t147.json', JSON.stringify(out, null, 2))
}
main().catch(e => { console.error(e.message); process.exit(1) })
