// ============================================================
// Data-driven weapon audio map — Phase 2 (WEAPONS_PLAN 2.1)
// ============================================================
// Sound NAME == filename (without .ogg) in /assets/sounds (accepted,
// committed) or /staging/sounds (pending, gitignored, web-served — the
// loader tries accepted first, then staged). audio.ts derives its preload
// FILES list from this map; no hand-maintained name lists anywhere.
//
// Coverage: entries for the FULL target roster (current 9 + the 33 future
// weapons of phases 3-8) so later phases add weapons with ZERO audio work —
// their samples are already staged and mapped. Only entries whose weapon id
// exists in WEAPONS (live) get preloaded (bandwidth); the rest load when
// the weapon lands.
//
// Raw sources: assets/packs/csgo/weapons/*.wav (gitignored pack, converted
// by scripts/stage-weapon-sounds.sh — same ffmpeg settings as the accepted
// set: leading-silence strip, Vorbis q3 44.1kHz).

import { WEAPONS } from './weapons'

/** Per-weapon sample set. Fields optional; engine falls back to synth. */
export interface WeaponAudio {
  fire?: string
  distant?: string      // far-shooter variant
  out?: string          // reload stage 1: mag release / box out / shell insert
  in?: string           // reload stage 2: mag seat / box in / shell insert
  rack?: string         // reload stage 3: charging handle / slide release / pump
  draw?: string         // weapon raise on switch
  bolt?: string         // post-shot rechamber (awp-style)
  suppressed?: string   // suppressed fire variant (inherently-suppressed guns point fire here)
}

// Current roster — names are all in the accepted, committed pack.
// Future roster — names are staged in public/staging/sounds/ per policy v3
// (nothing commits until the user accepts; acceptance = mv + git add).
export const WEAPON_AUDIO: Record<string, WeaponAudio> = {
  // ---- live (accepted samples) ----
  ak47: { fire: 'ak47_fire', distant: 'ak47_distant', out: 'ak47_clipout', in: 'ak47_clipin', rack: 'ak47_bolt', draw: 'ak47_draw' },
  // Task 66/67: AK-74M — the user's own ak74_fire recording (ACCEPTED
  // 2026-10-20, committed under /assets/sounds); distant + reload + draw
  // reuse the AK-47 family samples (same platform — accepted, committed)
  ak74: { fire: 'ak74_fire', distant: 'ak47_distant', out: 'ak47_clipout', in: 'ak47_clipin', rack: 'ak47_bolt', draw: 'ak47_draw' },
  // Task 104: M4A4 — fire is the USER'S OWN m4.mp3 recording (replaced the
  // CS:GO pack sample 2026-10-24, committed under /assets/sounds; old sample
  // recoverable in git history); distant + reload + draw keep the pack's
  // M4 family samples
  m4: { fire: 'm4_fire', distant: 'm4_distant', out: 'm4_clipout', in: 'm4_clipin', rack: 'm4_bolt', draw: 'm4_draw' },
  awp: { fire: 'awp_fire', distant: 'awp_distant', out: 'awp_clipout', in: 'awp_clipin', rack: 'awp_bolt', draw: 'awp_draw', bolt: 'awp_bolt' },
  deagle: { fire: 'deagle_fire', distant: 'deagle_distant', out: 'deagle_clipout', in: 'deagle_clipin', rack: 'deagle_slide', draw: 'deagle_draw' },
  mp5: { fire: 'mp5_fire', out: 'mp5_clipout', in: 'mp5_clipin', rack: 'mp5_slide', draw: 'mp5_draw' },
  glock: { fire: 'glock_fire', distant: 'glock_distant', out: 'glock_clipout', in: 'glock_clipin', rack: 'glock_slide', draw: 'glock_draw' },
  usp: { fire: 'usp_fire', distant: 'usp_distant', out: 'usp_clipout', in: 'usp_clipin', rack: 'usp_slide', draw: 'usp_draw' },
  knife: { draw: 'knife_draw' },
  c4: { draw: 'c4_draw' },

  // ---- Phase 3: pistols (staged) ----
  p250: { fire: 'p250_fire', distant: 'p250_distant', out: 'p250_clipout', in: 'p250_clipin', rack: 'p250_slide' },
  fiveseven: { fire: 'fiveseven_fire', distant: 'fiveseven_distant', out: 'fiveseven_clipout', in: 'fiveseven_clipin', rack: 'fiveseven_slide' },
  tec9: { fire: 'tec9_fire', distant: 'tec9_distant', out: 'tec9_clipout', in: 'tec9_clipin', rack: 'tec9_bolt' },
  cz75: { fire: 'cz75_fire', distant: 'cz75_distant' }, // pack has no cz75 reload sounds — synth fallback until found
  elites: { fire: 'elites_fire', distant: 'elites_distant', out: 'elites_clipout', in: 'elites_clipin', rack: 'elites_slide' },
  hkp2000: { fire: 'hkp2000_fire', distant: 'hkp2000_distant', out: 'hkp2000_clipout', in: 'hkp2000_clipin', rack: 'hkp2000_slide' },
  revolver: { fire: 'revolver_fire', distant: 'revolver_distant', out: 'revolver_clipout', in: 'revolver_clipin', rack: 'revolver_slide' },
  taser: { fire: 'taser_fire', draw: 'taser_draw' }, // zeus: one shot, no reload

  // ---- Phase 4: SMGs (staged) ----
  mp9: { fire: 'mp9_fire', distant: 'mp9_distant', out: 'mp9_clipout', in: 'mp9_clipin', rack: 'mp9_bolt', draw: 'mp9_draw' },
  mac10: { fire: 'mac10_fire', distant: 'mac10_distant', out: 'mac10_clipout', in: 'mac10_clipin', rack: 'mac10_bolt', draw: 'mac10_draw' },
  mp7: { fire: 'mp7_fire', distant: 'mp7_distant', out: 'mp7_clipout', in: 'mp7_clipin', rack: 'mp7_slide', draw: 'mp7_draw' },
  ump45: { fire: 'ump45_fire', distant: 'ump45_distant', out: 'ump45_clipout', in: 'ump45_clipin', rack: 'ump45_bolt', draw: 'ump45_draw' },
  p90: { fire: 'p90_fire', distant: 'p90_distant', out: 'p90_clipout', in: 'p90_clipin', rack: 'p90_bolt', draw: 'p90_draw' },
  bizon: { fire: 'bizon_fire', distant: 'bizon_distant', out: 'bizon_clipout', in: 'bizon_clipin', rack: 'bizon_bolt', draw: 'bizon_draw' },

  // ---- Phase 5: rifles + snipers (staged) ----
  galil: { fire: 'galil_fire', distant: 'galil_distant', out: 'galil_clipout', in: 'galil_clipin', rack: 'galil_bolt', draw: 'galil_draw' },
  famas: { fire: 'famas_fire', distant: 'famas_distant', out: 'famas_clipout', in: 'famas_clipin', rack: 'famas_bolt', draw: 'famas_draw' },
  sg553: { fire: 'sg553_fire', distant: 'sg553_distant', out: 'sg553_clipout', in: 'sg553_clipin', rack: 'sg553_bolt', draw: 'sg553_draw' },
  aug: { fire: 'aug_fire', distant: 'aug_distant', out: 'aug_clipout', in: 'aug_clipin', rack: 'aug_bolt' },
  ssg08: { fire: 'ssg08_fire', distant: 'ssg08_distant', out: 'ssg08_clipout', in: 'ssg08_clipin', rack: 'ssg08_bolt', draw: 'ssg08_draw' },
  scar20: { fire: 'scar20_fire', distant: 'scar20_distant', out: 'scar20_clipout', in: 'scar20_clipin', rack: 'scar20_bolt', draw: 'scar20_draw' },
  g3sg1: { fire: 'g3sg1_fire', distant: 'g3sg1_distant', out: 'g3sg1_clipout', in: 'g3sg1_clipin', rack: 'g3sg1_slide', draw: 'g3sg1_draw' },
  m4a1s: { fire: 'm4a1s_fire', distant: 'm4a1s_distant', out: 'm4a1s_clipout', in: 'm4a1s_clipin', rack: 'm4a1s_bolt', draw: 'm4a1s_draw', suppressed: 'm4a1s_fire' },

  // ---- Phase 6: shotguns (staged; reload = shell insert + pump) ----
  nova: { fire: 'nova_fire', distant: 'nova_distant', out: 'nova_shell', in: 'nova_shell', rack: 'nova_pump', draw: 'nova_draw', bolt: 'nova_pump' },
  xm1014: { fire: 'xm1014_fire', distant: 'xm1014_distant', out: 'xm1014_shell', in: 'xm1014_shell', rack: 'xm1014_pump' },
  mag7: { fire: 'mag7_fire', distant: 'mag7_distant', out: 'mag7_shell', in: 'mag7_shell', rack: 'mag7_pump', draw: 'mag7_draw', bolt: 'mag7_pump' },
  sawedoff: { fire: 'sawedoff_fire', distant: 'sawedoff_distant', out: 'sawedoff_shell', in: 'sawedoff_shell', rack: 'sawedoff_pump', draw: 'sawedoff_draw', bolt: 'sawedoff_pump' },

  // ---- Phase 7: machine guns (staged; reload = ammo box) ----
  m249: { fire: 'm249_fire', distant: 'm249_distant', out: 'm249_boxout', in: 'm249_boxin', rack: 'm249_coverup', draw: 'm249_draw' },
  negev: { fire: 'negev_fire', distant: 'negev_distant', out: 'negev_boxout', in: 'negev_boxin', rack: 'negev_coverup' },

  // ---- Phase 8: grenades (staged; draw = the pin-pull/raise on switch;
  //      the full per-kind effect sounds live in GRENADE_AUDIO below) ----
  flash: { draw: 'flash_draw' },
  he: { draw: 'grenade_deploy' },
  smoke: { draw: 'smoke_draw' },
  molotov: { draw: 'grenade_deploy' },
  inc: { draw: 'grenade_deploy' },
  decoy: { draw: 'grenade_deploy' },
}

/** Grenade/equipment audio (Phase 8 consumes; staged now). */
export interface GrenadeAudio {
  draw?: string
  deploy?: string      // throw/landing loop (decoy)
  emit?: string        // smoke cloud hiss
  explode?: string
  explodeDistant?: string
}
export const GRENADE_AUDIO: Record<string, GrenadeAudio> = {
  flash: { draw: 'flash_draw', explode: 'flash_explode', explodeDistant: 'flash_explode_distant' },
  he: { explode: 'he_explode', explodeDistant: 'he_explode_distant' },
  smoke: { draw: 'smoke_draw', emit: 'smoke_emit' },
  molotov: { explode: 'molotov_explode', explodeDistant: 'molotov_explode_distant' },
  inc: { explode: 'inc_explode', explodeDistant: 'inc_explode_distant' },
  decoy: { deploy: 'decoy_loop' },
}
/** Shared throw-sequence sounds for every grenade (staged). */
export const GRENADE_COMMON = {
  pinpull: 'grenade_pinpull',
  throw: 'grenade_throw',
  bounce: 'grenade_bounce',
  deploy: 'grenade_deploy',
}

/** Non-weapon sounds: melee events, C4, player feedback, world, UI, music. */
export const NON_WEAPON_FILES: string[] = [
  // knife melee events
  'knife_slash1', 'knife_slash2', 'knife_hit1', 'knife_hit2', 'knife_wall', 'knife_stab',
  // C4 events
  'c4_beep1', 'c4_beep2', 'c4_click', 'c4_initiate', 'c4_plant', 'c4_explode',
  'c4_disarmstart', 'c4_disarmfinish', 'c4_key1', 'c4_key2',
  // empties + player feedback
  'empty_pistol', 'empty_rifle',
  'dink', 'headshot', 'hurt1', 'hurt2',
  // footsteps + impacts
  'foot_dirt1', 'foot_dirt2', 'foot_dirt3', 'foot_dirt4',
  'foot_conc1', 'foot_conc2', 'foot_conc3', 'foot_conc4',
  'impact1', 'impact2', 'impact3', 'impact4',
  // misc + music stingers
  'buy', 'cant_buy', 'uiclick', 'zoom',
  'round_start', 'round_win', 'round_lose',
  // Task 98 — announcer VOICE lines (TTS-generated, license-clean — see
  // public/assets/sounds/README.md): team-neutral round outcomes + bomb state
  'announce_t_win', 'announce_ct_win', 'announce_planted', 'announce_defused',
]

/** All names a WEAPON_AUDIO entry references (deduped). */
export function weaponAudioNames(a: WeaponAudio): string[] {
  return [...new Set([a.fire, a.distant, a.out, a.in, a.rack, a.draw, a.bolt, a.suppressed].filter(Boolean) as string[])]
}

/**
 * Preload list for LIVE weapons only (ids present in WEAPONS) — future-roster
 * entries stay staged and load the moment their weapon lands in WEAPONS.
 */
export function liveWeaponSoundFiles(): string[] {
  const out: string[] = []
  for (const id of Object.keys(WEAPONS)) {
    const a = WEAPON_AUDIO[id]
    if (a) out.push(...weaponAudioNames(a))
  }
  return [...new Set(out)]
}

/**
 * Phase 8: grenade effect samples for LIVE grenade kinds + the shared
 * throw-sequence sounds (pin pull / throw / bounce / deploy) — anyone
 * holding a grenade needs those regardless of kind. The weapon ids in
 * WEAPONS double as GRENADE_AUDIO keys (id == kind).
 */
export function liveGrenadeSoundFiles(): string[] {
  const out: string[] = []
  for (const id of Object.keys(WEAPONS)) {
    const w = WEAPONS[id as keyof typeof WEAPONS]
    if (!w.throwable) continue
    const g = GRENADE_AUDIO[w.throwable.kind]
    if (g) out.push(g.draw ?? 'grenade_deploy', g.deploy ?? 'grenade_deploy', g.emit ?? 'smoke_emit', g.explode ?? 'he_explode', g.explodeDistant ?? 'he_explode_distant')
  }
  out.push(...Object.values(GRENADE_COMMON))
  return [...new Set(out.filter((n): n is string => !!n))]
}
