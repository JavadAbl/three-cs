import type { WeaponId, TeamId, HitPart } from './weapons'

export interface Ammo { mag: number; reserve: number }

export interface PlayerState {
  id: string
  name: string
  team: TeamId
  bot: boolean
  socketId: string | null
  // transform
  x: number; y: number; z: number
  yaw: number; pitch: number
  crouch: boolean
  moving: boolean
  walking: boolean
  // combat
  hp: number
  armor: number
  helmet: boolean
  money: number
  kills: number
  deaths: number
  assists?: number
  alive: boolean
  // weapons
  inventory: WeaponId[]          // ordered slots: primary, pistol, knife, c4?
  wIdx: number
  ammo: Partial<Record<WeaponId, Ammo>>
  lastShotAt: number
  reloadEndsAt: number
  burstShots: number    // Phase 5: shots fired in the current burst window (DORMANT burst anti-cheat — no current gun is burst since Task 105)
  // Phase 6: the shotgun shell currently in flight — seed + aim dir (for
  // pellet-cone validation) and the per-shot pellet-claim budget (anti
  // split-resend). Undefined for single-ray weapons / between shots.
  shot?: { seed: number; dir: [number, number, number]; at: number; claims: number }
  lastSelfDmgAt?: number
  // Phase 8 grenades + equipment
  hasKit?: boolean                 // defuse kit (CT) — halves defuse time, lost on death
  blindUntil?: number              // flashbang: no vision past this ms timestamp
  lastThrowAt?: number             // grenade throw rate gate
  // objective
  hasBomb: boolean
  plantingSince: number
  defusingSince: number
  lastStateAt: number
  // ai fields
  ai?: BotBrain
}

export interface BotBrain {
  path: string[]                 // remaining waypoint ids
  goal: string                   // final node id
  role: 'rush' | 'hold' | 'escort'
  site: 'A' | 'B' | 'MID'
  holdYaw: number
  engageTarget: string | null
  lastSeenAt: number
  nextShotAt: number
  burstLeft: number
  reactAt: number
  strafeDir: number
  strafeUntil: number
  stuckAt: number
  lastX: number; lastZ: number
  // Phase 8 grenade AI (light, statistical — plan 8.4)
  nadeNextAt: number             // earliest next grenade throw
  nadesThrown: number            // throws this round (cap 2)
  flashThrown: boolean           // one site-push flash per round
  lastEnemyX: number; lastEnemyZ: number  // smoke-retreat aim memory
  // Task 79: fair-fight + aliveness fields
  seenX: number; seenZ: number   // last CONFIRMED-LOS enemy position (aim memory, never fired at blind)
  burstLen: number               // shots in the current burst (spray-decay index)
  huntUntil: number              // hunt-the-cover push expiry (goal 'hunt:<node>')
  repositionAt: number           // next idle stance/spot shift (holders stay alive)
  rotateAt: number               // round-pressure site-rotate cooldown (no tick-flip jitter)
  hurtAt: number                 // last damage taken (turn-toward-shooter reaction)
  hurtFromX: number; hurtFromZ: number
}

export type Phase = 'warmup' | 'freeze' | 'live' | 'post' | 'over'

// ---- Phase 8 grenade entities (projectile shape lives in
// shared/grenades.ts for the shared physics; these carry server effect state) ----
import type { NadeEnt } from '../../shared/grenades'

export interface SmokeEnt {
  id: number
  x: number; y: number; z: number
  startedAt: number
  endsAt: number
}

export interface FireEnt {
  id: number
  x: number; y: number; z: number
  endsAt: number
  lastTickAt: number
  owner: string
  weapon: string               // 'molotov' | 'inc' (kill credit + sound)
}

export interface DecoyEnt {
  id: number
  x: number; y: number; z: number
  endsAt: number
  nextShotAt: number
  owner: string
  weapon: string               // the gun sound it mimics
}

export interface BombState {
  planted: boolean
  x: number; y: number; z: number
  plantedAt: number
  explodeAt: number
  defuseProgress: number   // 0..1
  defusingBy: string | null
  exploded: boolean
  defused: boolean
}

export interface Match {
  roomId: string
  mapId: string                     // MapId ('dust' | 'dust2')
  serverName: string | null         // non-null + listed = shows in server browser
  listed: boolean
  ownerId: string | null            // creator's socket id
  createdAt: number
  players: Map<string, PlayerState>
  phase: Phase
  phaseEndsAt: number
  round: number
  scores: { CT: number; T: number }
  lossStreak: { CT: number; T: number }
  bomb: BombState
  // Phase 8 grenade entities (server-authoritative, 20 Hz tick)
  nades: NadeEnt[]                  // flying/resting projectiles
  smokes: SmokeEnt[]                // popped smoke volumes (LOS blockers)
  fires: FireEnt[]                  // molotov/incendiary burn zones
  decoys: DecoyEnt[]                // resting decoy sound sources
  nadeSeq: number                   // grenade id counter
  winTarget: number
  botFill: boolean
  botDifficulty: 'easy' | 'normal' | 'hard'
  roundWinner: TeamId | null
  winReason: string
  mvp: string | null
  started: boolean
  lastHumanAt: number
  roundKills: Map<string, number>   // player id -> kills this round (for MVP)
}

export interface KillEvent {
  killer: string
  victim: string
  weapon: WeaponId
  headshot: boolean
  killerName: string
  victimName: string
  killerTeam: TeamId
  victimTeam: TeamId
  throughSmoke?: false
}
