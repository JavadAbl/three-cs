// ============================================================
// CS2-clone shared weapon definitions (kept in sync with client)
// ============================================================

export type TeamId = 'CT' | 'T'
export type HitPart = 'head' | 'body' | 'legs'
export type WeaponId =
  | 'knife' | 'glock' | 'usp' | 'deagle' | 'mp5'
  | 'ak47' | 'm4' | 'awp' | 'c4'

export interface WeaponDef {
  id: WeaponId
  name: string
  slot: 1 | 2 | 3 | 4 | 5   // 1 primary, 2 pistol, 3 knife, 4 c4
  price: number
  team?: TeamId              // restricted
  damage: number             // base body damage
  hsMult: number             // headshot multiplier
  legMult: number
  fireDelay: number          // ms between shots
  mag: number
  reserve: number
  reloadMs: number
  moveSpeed: number          // meters/sec while holding
  armorPen: number           // 0..1 damage multiplier vs armor
  falloff10m: number         // damage multiplier per 10m distance
  auto: boolean
  scope?: boolean
  killReward: number
  accurate: number           // base spread degrees standing still
}

export const WEAPONS: Record<WeaponId, WeaponDef> = {
  knife: {
    id: 'knife', name: 'Knife', slot: 3, price: 0, damage: 40, hsMult: 1, legMult: 1,
    fireDelay: 400, mag: Infinity, reserve: Infinity, reloadMs: 0, moveSpeed: 5.0,
    armorPen: 0.85, falloff10m: 1, auto: true, killReward: 1500, accurate: 0,
  },
  glock: {
    id: 'glock', name: 'Glock-18', slot: 2, price: 0, team: 'T', damage: 30, hsMult: 4, legMult: 0.75,
    fireDelay: 150, mag: 20, reserve: 120, reloadMs: 2200, moveSpeed: 4.9,
    armorPen: 0.47, falloff10m: 0.89, auto: false, killReward: 300, accurate: 0.45,
  },
  usp: {
    id: 'usp', name: 'USP-S', slot: 2, price: 0, team: 'CT', damage: 35, hsMult: 4, legMult: 0.75,
    fireDelay: 170, mag: 12, reserve: 24, reloadMs: 2200, moveSpeed: 4.9,
    armorPen: 0.505, falloff10m: 0.91, auto: false, killReward: 300, accurate: 0.38,
  },
  deagle: {
    id: 'deagle', name: 'Desert Eagle', slot: 2, price: 700, damage: 53, hsMult: 4, legMult: 0.75,
    fireDelay: 350, mag: 7, reserve: 35, reloadMs: 2200, moveSpeed: 4.8,
    armorPen: 0.925, falloff10m: 0.81, auto: false, killReward: 300, accurate: 0.55,
  },
  mp5: {
    id: 'mp5', name: 'MP5-SD', slot: 1, price: 1500, damage: 27, hsMult: 4, legMult: 0.75,
    fireDelay: 90, mag: 30, reserve: 120, reloadMs: 2600, moveSpeed: 4.7,
    armorPen: 0.55, falloff10m: 0.84, auto: true, killReward: 600, accurate: 0.55,
  },
  ak47: {
    id: 'ak47', name: 'AK-47', slot: 1, price: 2700, team: 'T', damage: 36, hsMult: 4, legMult: 0.75,
    fireDelay: 100, mag: 30, reserve: 90, reloadMs: 2400, moveSpeed: 4.35,
    armorPen: 0.775, falloff10m: 0.98, auto: true, killReward: 300, accurate: 0.35,
  },
  m4: {
    id: 'm4', name: 'M4A4', slot: 1, price: 3100, team: 'CT', damage: 33, hsMult: 4, legMult: 0.75,
    fireDelay: 90, mag: 30, reserve: 90, reloadMs: 3000, moveSpeed: 4.45,
    armorPen: 0.70, falloff10m: 0.97, auto: true, killReward: 300, accurate: 0.32,
  },
  awp: {
    id: 'awp', name: 'AWP', slot: 1, price: 4750, damage: 115, hsMult: 4, legMult: 0.75,
    fireDelay: 1450, mag: 10, reserve: 30, reloadMs: 3600, moveSpeed: 4.0,
    armorPen: 0.975, falloff10m: 1.0, auto: false, scope: true, killReward: 100, accurate: 0.05,
  },
  c4: {
    id: 'c4', name: 'C4 Explosive', slot: 4, price: 0, team: 'T', damage: 0, hsMult: 1, legMult: 1,
    fireDelay: 1000, mag: Infinity, reserve: Infinity, reloadMs: 0, moveSpeed: 5.0,
    armorPen: 1, falloff10m: 1, auto: false, killReward: 300, accurate: 0,
  },
}

export const BUY_ITEMS: Array<{ id: string; name: string; price: number; team?: TeamId }> = [
  { id: 'deagle', name: 'Desert Eagle', price: 700 },
  { id: 'mp5', name: 'MP5-SD', price: 1500 },
  { id: 'ak47', name: 'AK-47', price: 2700, team: 'T' },
  { id: 'm4', name: 'M4A4', price: 3100, team: 'CT' },
  { id: 'awp', name: 'AWP', price: 4750 },
  { id: 'kevlar', name: 'Kevlar Vest', price: 650 },
  { id: 'kevlarhelm', name: 'Kevlar + Helmet', price: 1000 },
]

export const PART_MULT: Record<HitPart, number> = { head: 4, body: 1, legs: 0.75 }

export const ECONOMY = {
  startMoney: 800,
  maxMoney: 16000,
  winReward: 3250,
  lossBase: 1400,
  lossStep: 500,
  lossMax: 3400,
  plantBonus: 300,
  plantLossBonus: 800,
}

export const ROUND = {
  freezeMs: 8000,
  liveMs: 115000,
  bombMs: 40000,
  postMs: 6000,
  plantMs: 3200,
  defuseMs: 10000,
  buyWindowMs: 20000,
}

export function computeDamage(
  w: WeaponDef, part: HitPart, dist: number, victimArmor: number, victimHelmet: boolean
): { dmg: number; armorDmg: number } {
  let dmg = w.damage * (part === 'head' ? w.hsMult : part === 'legs' ? w.legMult : 1)
  // helmet helps only vs head
  const hasArmor = part === 'head' ? victimArmor > 0 && victimHelmet : victimArmor > 0
  if (hasArmor) dmg *= w.armorPen
  // range falloff
  const steps = dist / 10
  dmg *= Math.pow(w.falloff10m, Math.floor(steps))
  if (part === 'head' && !hasArmor) dmg = Math.max(dmg, 100) // unarmored headshot with any gun is deadly-ish
  const armorDmg = hasArmor ? Math.min(victimArmor, dmg * 0.5) : 0
  return { dmg: Math.round(dmg), armorDmg: Math.round(armorDmg) }
}
