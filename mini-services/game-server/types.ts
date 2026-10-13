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
}

export type Phase = 'warmup' | 'freeze' | 'live' | 'post' | 'over'

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
  players: Map<string, PlayerState>
  phase: Phase
  phaseEndsAt: number
  round: number
  scores: { CT: number; T: number }
  lossStreak: { CT: number; T: number }
  bomb: BombState
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
