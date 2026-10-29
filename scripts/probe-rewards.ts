// quick probe: killReward field vs KILL_REWARD_BY_CLASS consistency
import { WEAPONS, KILL_REWARD_BY_CLASS, WeaponDef } from '../shared/weapons'

let bad = 0
for (const w of Object.values(WEAPONS) as WeaponDef[]) {
  const cls = w.killRewardClass
  if (!cls) { console.log(`NO CLASS: ${w.id} (killReward=${w.killReward})`); bad++; continue }
  const expected = KILL_REWARD_BY_CLASS[cls]
  if (w.killReward !== expected) {
    console.log(`MISMATCH: ${w.id} class=${cls} killReward=${w.killReward} expected=${expected}`)
    bad++
  }
}
console.log(bad === 0 ? `ALL ${Object.keys(WEAPONS).length} WEAPONS CONSISTENT` : `${bad} problems`)
