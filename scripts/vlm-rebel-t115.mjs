// Task 115 — VLM verification: rebel model as the TERRORIST character,
// weapon in hands, correct scale, soldier (CT) unchanged.
import ZAI from 'z-ai-web-dev-sdk'
import fs from 'fs'

const shots = [
  ['t115b-t-closeup.png', 'rebel T bot close-up, front-quarter (pistol era)', `Live screenshot from a web FPS (aim map). Filling the frame: an enemy TERRORIST bot rendered with a NEW model — a "leather rebel" civilian fighter (leather jacket, no helmet/no military armor), holding a pistol. Answer concisely: 1) Does the character read as a LEATHER-WEARING REBEL/insurgent (civilian clothes, leather jacket) rather than a military soldier with helmet+vest? 2) Is it human-scale relative to the map (about 1.8 m tall, NOT a giant, NOT a dwarf)? 3) Are its HANDS holding the pistol (two-hand chest hold) — or is the gun floating away from the hands? 4) Any rendering bugs: spiky/stretched limbs, missing textures, black surfaces, geometry exploding, corpse clipping through the floor?`],
  ['t115b-t-side.png', 'rebel T bot side angle (ak47)', `Live screenshot from a web FPS (aim map). An enemy TERRORIST bot with the NEW "leather rebel" model (leather jacket civilian fighter), side/quarter angle, holding an AK-47 rifle. Answer concisely: 1) Right hand on the rifle's pistol grip / trigger area, left hand supporting the handguard — or are the hands empty / gun floating? 2) Human scale (~1.8 m) and correctly grounded on the floor? 3) Any deformation bugs: spikes, stretched arms, shoulder webbing, split seams at the elbows or armpits?`],
  ['t115b-t-side2.png', 'rebel T bot second side frame (ak47)', `Same scene one second later. Enemy TERRORIST "leather rebel" bot with an AK-47. Concisely: 1) hands still on the gun (right on grip, left on handguard)? 2) proportions still human and correct? 3) any spiky/exploded/stretched geometry or floating gun?`],
  ['t115b-ct-teammate.png', 'CT teammate — soldier model MUST be unchanged', `Live screenshot from a web FPS (aim map). A COUNTER-TERRORIST teammate rendered with the previous "soldier with helmet + tactical vest + backpack" model, slightly bluish team tint, holding a rifle. Answer concisely: 1) Does this character still read as the MILITARY SOLDIER (helmet, vest, backpack) — NOT a leather rebel? 2) Hands holding the rifle properly? 3) Human scale, no deformation/spikes? 4) Any regression vs a clean soldier render?`],
]

const main = async () => {
  const zai = await ZAI.create()
  const out = { task: 115, subject: 'rebel as T character — live VLM verification', shots: {} }
  for (const [f, desc, q] of shots) {
    try {
      const b64 = fs.readFileSync('/home/z/my-project/scripts/' + f).toString('base64')
      const r = await zai.chat.completions.createVision({
        model: 'glm-4.6v',
        messages: [
          { role: 'user', content: [
            { type: 'image_url', image_url: { url: `data:image/png;base64,${b64}` } },
            { type: 'text', text: q },
          ] },
        ],
      })
      const verdict = r.choices[0]?.message?.content ?? ''
      out.shots[f] = verdict.slice(0, 1400)
      console.log(`\n=== ${f} (${desc}) ===\n${verdict}`)
    } catch (e) {
      out.shots[f] = 'ERROR: ' + e.message
      console.log(f, 'ERROR', e.message)
    }
  }
  fs.writeFileSync('/home/z/my-project/scripts/vlm-rebel-t115.json', JSON.stringify(out, null, 2))
}
main().catch(e => { console.error(e.message); process.exit(1) })
