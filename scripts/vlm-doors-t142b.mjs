// Task 142 — VLM re-verification of retaken shots
import ZAI from 'z-ai-web-dev-sdk'
import fs from 'fs'

const shots = [
  ['B-south (standing south of the open doorway, looking north through it)', 't142-final-b-south.png',
   'First-person FPS screenshot in a CS-style office map. The player stands a few meters SOUTH of a doorway looking north. QUESTION: Ahead, do you see an open doorway/passage (no door panel blocking), and can you see the room beyond it? Answer: OPEN-PASSAGE or BLOCKED + one sentence.'],
  ['A-closed (decor door on office-wing wall — should be a CLOSED door)', 't142-final-a-closed.png',
   'First-person FPS screenshot in a CS-style office map, carpeted office area, looking south at a wall. QUESTION: Is there a closed door (wooden door panel in a frame) visible ahead in the wall? Answer: CLOSED-DOOR-VISIBLE or NO-DOOR + one sentence.'],
  ['D-closed (decor door at cement wall — should be a CLOSED door)', 't142-final-d-closed.png',
   'First-person FPS screenshot in a CS-style office map, concrete/floor area, looking south at a cement wall. QUESTION: Is there a closed door (door panel in a frame, slightly darker wood tone) visible ahead in the wall? Answer: CLOSED-DOOR-VISIBLE or NO-DOOR + one sentence.'],
]

const main = async () => {
  const zai = await ZAI.create()
  for (const [tag, f, q] of shots) {
    const b64 = fs.readFileSync('/home/z/my-project/scripts/' + f).toString('base64')
    const r = await zai.chat.completions.createVision({
      model: 'glm-4.6v',
      messages: [{ role: 'user', content: [
        { type: 'image_url', image_url: { url: `data:image/png;base64,${b64}` } },
        { type: 'text', text: q },
      ] }],
    })
    console.log(`\n===== ${tag} =====\n${(r.choices[0]?.message?.content ?? '').slice(0, 400)}`)
  }
}
main().catch(e => { console.error(e.message); process.exit(1) })
