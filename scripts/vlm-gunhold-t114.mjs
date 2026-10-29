// Task 114 — diagnose "characters are not holding the weapon in hands".
// Ask VLM specifically about the weapon-to-hand relationship on visible characters.
import ZAI from 'z-ai-web-dev-sdk'
import fs from 'fs'

const files = process.argv.slice(2).length ? process.argv.slice(2) : ['t114-gunhold-stand.png']

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
            { type: 'text', text: `Screenshot from a web FPS game (aim depot map, first-person view). Look at every visible soldier character OTHER than the first-person hands/gun at the bottom. For EACH visible character answer:
1) Does the character hold a weapon? If yes, WHERE is the weapon relative to its BODY (in hands / floating in air away from body / inside/through the body / at hip or chest without hands on it)?
2) Are the character's ARMS posed as if holding a weapon (bent, hands forward) or hanging straight down at the sides?
3) Does the weapon touch or overlap either hand?
4) Any other weapon-body misalignment (weapon clipped into torso, pointing wrong direction, detached from the figure)?
Be blunt and specific. End with one line: VERDICT: HOLDS-WEAPON-IN-HANDS or WEAPON-NOT-IN-HANDS for each character seen.` },
          ] },
        ],
      })
      console.log(`\n=== ${f} ===\n${(r.choices[0]?.message?.content ?? '').slice(0, 1600)}`)
    } catch (e) { console.log(f, 'ERROR', e.message) }
  }
}
main().catch(e => { console.error(e.message); process.exit(1) })
