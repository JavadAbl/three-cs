'use client'

import { useEffect, useRef, useState } from 'react'
import { WEAPONS, BUY_MENU, buyEntriesFor, GEAR } from './weapons'
import type { WeaponId, BuyMenuKey, BuyEntry } from './weapons'
import type { HudState } from './engine'

const ctColor = '#7ab0e8'
const tColor = '#eec37a'

function fmtTime(s: number): string {
  const m = Math.floor(s / 60)
  const r = Math.floor(s % 60)
  return `${m}:${r.toString().padStart(2, '0')}`
}

function fmtMoney(n: number): string {
  return '$' + n.toLocaleString()
}

const WEAPON_SHORT: Record<string, string> = {
  ak47: 'AK-47', m4: 'M4A4', awp: 'AWP', deagle: 'Deagle', glock: 'Glock', usp: 'USP-S',
  mp5: 'MP5', knife: 'Knife', c4: 'C4', kevlar: 'Kevlar', kevlarhelm: 'Kevlar+Helm',
  world: 'C4', fall: 'Gravity',
  // Phase 3 pistols
  p250: 'P250', fiveseven: 'Five-Seven', tec9: 'Tec-9', cz75: 'CZ75', elites: 'Dualies',
  hkp2000: 'P2000', revolver: 'R8', taser: 'Zeus',
  // Phase 4 SMGs
  mp9: 'MP9', mac10: 'MAC-10', mp7: 'MP7', ump45: 'UMP', p90: 'P90', bizon: 'Bizon',
  // Phase 5 rifles + snipers
  m4a1s: 'M4A1-S', galil: 'Galil', famas: 'FAMAS', sg553: 'SG 553', aug: 'AUG',
  ssg08: 'SSG 08', scar20: 'SCAR-20', g3sg1: 'G3SG1',
  // Phase 6 shotguns
  nova: 'Nova', xm1014: 'XM1014', mag7: 'MAG-7', sawedoff: 'Sawed-Off',
  // Phase 8 grenades + equipment
  flash: 'Flash', he: 'HE', smoke: 'Smoke', molotov: 'Molly', inc: 'Inc',
  decoy: 'Decoy', defusekit: 'Kit',
}

/** 1.6-style silhouette icon per buy row (Phase 9 plan 9.1c). Source PNGs
 *  are generated procedurally from the weapon viewmodels
 *  (scripts/gen-buy-icons.ts). Asset-acceptance policy v3: accepted copy
 *  (/assets/icons) first, staged copy (/staging/icons) as fallback, hidden
 *  if neither exists — so the menu works identically before/after acceptance. */
function BuyIcon({ id }: { id: string }) {
  const [stage, setStage] = useState(0)
  const src = stage === 0 ? `/assets/icons/${id}.png` : stage === 1 ? `/staging/icons/${id}.png` : null
  if (!src) return null
  return (
    <img src={src} alt="" draggable={false} loading="eager"
      className="h-7 w-[76px] shrink-0 object-contain opacity-90"
      onError={() => setStage(stage + 1)} />
  )
}

// ============================================================
// CS 1.6-style category buy menu — two-level keyboard navigation.
// B opens (page.tsx toggles), digits 1-6 pick a category, digits
// 1-9 buy inside a category, 0/Backspace goes one level up (0 at
// root = exit, exactly like 1.6), B/ESC closes. Mouse works too.
// Money/team/window validation lives in engine.buy() + the server;
// rows stay clickable so rejected buys surface as toast feedback.
// NOTE: categories over 9 entries page CS 1.6-style — 8 rows per page,
// 0 = NEXT (cycles), last page's 0 = BACK. Phase 5 (rifles: 11 entries)
// is the first category to need it.
const PAGE = 8

function BuyMenu({ s, cb }: { s: HudState; cb: HudCallbacks }) {
  const [cat, setCat] = useState<BuyMenuKey | null>(null)
  const [page, setPage] = useState(0)
  // live ref so the window-level key handler never sees stale state
  const live = useRef({ cat, page, s, cb })
  live.current = { cat, page, s, cb }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const { cat, page, cb } = live.current
      if (e.code === 'Escape') { e.preventDefault(); cb.onOpenBuy(false); return }
      if (e.code === 'Backspace') { e.preventDefault(); setCat(null); setPage(0); return }
      // KeyB is handled by page.tsx (toggle) — never double-handle here
      const m = /^(?:Digit|Numpad)([0-9])$/.exec(e.code)
      if (!m) return
      e.preventDefault()
      const n = +m[1]
      if (n === 0) {
        if (cat === null) { cb.onOpenBuy(false); return }   // 0. EXIT at root, 1.6-style
        const pages = Math.ceil(buyEntriesFor(cat).length / PAGE)
        if (pages > 1 && page < pages - 1) setPage(page + 1) // 0. NEXT page
        else { setCat(null); setPage(0) }                    // last page: 0. BACK up
        return
      }
      if (cat === null) {
        const c = BUY_MENU[n - 1]
        if (c && buyEntriesFor(c.key).length > 0) { setCat(c.key); setPage(0) }
        return
      }
      const entry = buyEntriesFor(cat)[page * PAGE + n - 1]
      if (entry) cb.onBuy(entry.id)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const catDef = cat ? BUY_MENU.find(c => c.key === cat)! : null
  const entries = cat ? buyEntriesFor(cat) : []
  const pages = Math.ceil(entries.length / PAGE)
  const shown = entries.slice(page * PAGE, page * PAGE + PAGE)

  // per-entry display state
  const rowState = (it: BuyEntry) => {
    const w = WEAPONS[it.id as WeaponId]
    const wrongTeam = !!it.team && it.team !== s.team
    const afford = s.money >= it.price
    const owned = w
      ? s.inventory.includes(w.id)
      : it.id === 'kevlar' ? s.armor > 0 && !s.helmet : it.id === 'kevlarhelm' ? s.helmet : false
    const curPrimary = s.inventory.find(x => WEAPONS[x]?.slot === 1)
    const swap = w?.slot === 1 && curPrimary && curPrimary !== w.id ? curPrimary : null
    return { w, wrongTeam, afford, owned, swap }
  }

  return (
    <div className="pointer-events-auto absolute inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="w-[560px] max-w-[95vw] rounded-xl bg-zinc-900/95 p-6 shadow-2xl">
        <div className="mb-1 flex items-baseline justify-between">
          <h2 className="text-xl font-bold tracking-widest text-orange-400">{catDef ? catDef.label : 'BUY'}</h2>
          <span className="font-bold tabular-nums text-emerald-400">{fmtMoney(s.money)}</span>
        </div>
        <p className="mb-4 text-xs text-white/50">
          {s.canBuy ? 'Buy time is open' : 'Buy time is OVER — you can browse only'}
        </p>

        {/* level 1: category list (fixed 1.6 numbering 1-6) */}
        {!cat && (
          <div className="grid grid-cols-2 gap-x-6 gap-y-1.5">
            {BUY_MENU.map((c, i) => {
              const n = buyEntriesFor(c.key).length
              const empty = n === 0
              return (
                <button key={c.key} onClick={() => { if (!empty) setCat(c.key) }}
                  className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-left transition ${empty ? 'cursor-not-allowed bg-zinc-800/30 text-white/25' : 'bg-zinc-800 text-white hover:bg-zinc-700'}`}>
                  <span className="w-4 font-bold text-orange-400">{i + 1}.</span>
                  <span className="flex-1 text-sm font-bold tracking-wider">{c.label}</span>
                  <span className="text-[10px] text-white/40">{empty ? '—' : n}</span>
                </button>
              )
            })}
          </div>
        )}

        {/* level 2: weapons in category (8 rows per page, 0 = NEXT) */}
        {cat && (
          <div className="flex flex-col gap-1.5">
            {shown.map((it, i) => {
              const st = rowState(it)
              // grenades: kind-flavored stat lines instead of gun numbers
              const NADE_DESC: Record<string, string> = {
                flash: 'blinds up to 5s · max 2',
                he: '98 dmg · 9m radius',
                smoke: '18s vision blocker',
                molotov: 'fire zone · 7s burn',
                inc: 'fire zone · 7s burn',
                decoy: 'fake gunfire · 30s',
              }
              const stats = st.w?.throwable
                ? (NADE_DESC[it.id] ?? '')
                : st.w
                ? `${st.w.damage}${(st.w.pellets ?? 0) > 1 ? `×${st.w.pellets}` : ''} dmg · ${st.w.fireDelay}ms · ${st.w.mag === Infinity ? '∞' : st.w.mag} rds`
                : (GEAR.find(g => g.id === it.id)?.desc ?? '')
              return (
                <button key={it.id} onClick={() => cb.onBuy(it.id)}
                  className={`flex items-center gap-3 rounded-lg px-3 py-2 text-left transition ${st.wrongTeam ? 'bg-zinc-800/40 opacity-40' : 'bg-zinc-800 hover:bg-zinc-700'}`}>
                  <span className="w-4 font-bold text-orange-400">{i + 1}.</span>
                  <BuyIcon id={it.id} />
                  <div className="flex-1">
                    <div className="flex items-center gap-2 text-sm font-bold">
                      {it.name}
                      {it.team && (
                        <span className={`rounded px-1 text-[9px] font-bold ${it.team === 'CT' ? 'bg-sky-900/70 text-sky-300' : 'bg-orange-900/60 text-orange-300'}`}>
                          {it.team}
                        </span>
                      )}
                      {st.owned && (
                        <span className="text-[9px] font-bold text-emerald-400">
                          ✓ {st.w?.throwable ? `${s.inventory.filter(x => x === it.id).length}/${st.w.maxCarry ?? 1}` : 'OWNED'}
                        </span>
                      )}
                      {st.swap && <span className="text-[9px] text-amber-400/80">⇄ replaces {WEAPONS[st.swap]?.name}</span>}
                    </div>
                    <div className="text-[10px] text-white/40">{stats}</div>
                  </div>
                  <span className={`text-sm tabular-nums ${st.afford ? 'text-emerald-400' : 'text-red-400'}`}>${it.price}</span>
                </button>
              )
            })}
          </div>
        )}

        <div className="mt-4 flex items-center justify-between text-[10px] tracking-widest text-white/40">
          <span>
            {cat
              ? pages > 1
                ? `PAGE ${page + 1}/${pages} · DIGITS BUY · ${page < pages - 1 ? '0 NEXT' : '0 BACK'}`
                : 'DIGITS BUY · 0 BACK'
              : '1-6 CATEGORIES · 0 EXIT'}
          </span>
          <span>B / ESC CLOSE</span>
        </div>
        <button onClick={() => { if (cat) { setCat(null); setPage(0) } else cb.onOpenBuy(false) }}
          className="mt-2 w-full rounded-lg bg-orange-600 py-2 font-bold tracking-wider text-white transition hover:bg-orange-500">
          {cat ? (pages > 1 && page < pages - 1 ? 'NEXT PAGE (0)' : 'BACK (0)') : 'CLOSE (B) — BACK TO GAME'}
        </button>
      </div>
    </div>
  )
}

export interface HudCallbacks {
  onBuy: (item: string) => void
  onChat: (text: string) => void
  onResume: () => void
  onOpenBuy: (open: boolean) => void
  onCloseChat: () => void
  onSettings: (s: { sens: number; vol: number; fov: number }) => void
  onQuit: () => void
}

export function Hud({ s, cb, settings, open }: {
  s: HudState
  cb: HudCallbacks
  settings: { sens: number; vol: number; fov: number }
  open: { buy: boolean; chat: boolean }
}) {
  const chatRef = useRef<HTMLInputElement>(null)
  const [chatText, setChatText] = useState('')
  const [showSettings, setShowSettings] = useState(false)
  const [localSettings, setLocalSettings] = useState(settings)

  useEffect(() => { setLocalSettings(settings) }, [settings])

  // crosshair spread px
  const spreadPx = Math.min(60, s.spread * 9)

  return (
    <div className="pointer-events-none fixed inset-0 select-none font-mono text-white" style={{ textShadow: '0 1px 3px rgba(0,0,0,0.9)' }}>
      {/* ---------------- scope overlay ---------------- */}
      {s.scoped && (
        <div className="absolute inset-0 z-40">
          <div className="absolute inset-0 bg-black" style={{ clipPath: 'polygon(0 0, 100% 0, 100% 100%, 0 100%)', maskImage: 'radial-gradient(circle at center, transparent 0, transparent 30vh, black 30.2vh)', WebkitMaskImage: 'radial-gradient(circle at center, transparent 0, transparent 30vh, black 30.2vh)' }} />
          <div className="absolute left-1/2 top-0 h-full w-px bg-black/90" />
          <div className="absolute top-1/2 left-0 w-full h-px bg-black/90" />
        </div>
      )}

      {/* ---------------- crosshair ---------------- */}
      {s.alive && !s.scoped && (
        <div className="absolute left-1/2 top-1/2 z-30 -translate-x-1/2 -translate-y-1/2">
          <div className="relative h-0 w-0">
            {(['top', 'bottom', 'left', 'right'] as const).map(pos => (
              <div key={pos} className="absolute bg-[#3cff5e]" style={{
                width: pos === 'left' || pos === 'right' ? 7 : 2,
                height: pos === 'left' || pos === 'right' ? 2 : 7,
                [pos === 'left' ? 'right' : pos === 'right' ? 'left' : pos === 'top' ? 'bottom' : 'top']: `${4 + spreadPx}px`,
                transform: pos === 'left' || pos === 'right' ? 'translateY(-50%)' : 'translateX(-50%)',
                left: pos === 'left' || pos === 'right' ? 'auto' : 0,
              } as React.CSSProperties} />
            ))}
            <div className="absolute h-[2px] w-[2px] bg-[#3cff5e] -translate-x-1/2 -translate-y-1/2" />
          </div>
        </div>
      )}

      {/* hitmarker */}
      {s.hitmarkerAge < 180 && (
        <div className="absolute left-1/2 top-1/2 z-30 -translate-x-1/2 -translate-y-1/2" style={{ opacity: 1 - s.hitmarkerAge / 180 }}>
          <svg width="26" height="26" viewBox="0 0 26 26">
            <line x1="3" y1="3" x2="9" y2="9" stroke={s.headshotAge < 400 ? '#ff4d4d' : '#ffffff'} strokeWidth="2.4" />
            <line x1="23" y1="3" x2="17" y2="9" stroke={s.headshotAge < 400 ? '#ff4d4d' : '#ffffff'} strokeWidth="2.4" />
            <line x1="3" y1="23" x2="9" y2="17" stroke={s.headshotAge < 400 ? '#ff4d4d' : '#ffffff'} strokeWidth="2.4" />
            <line x1="23" y1="23" x2="17" y2="17" stroke={s.headshotAge < 400 ? '#ff4d4d' : '#ffffff'} strokeWidth="2.4" />
          </svg>
        </div>
      )}

      {/* ---------------- Phase 8: flashbang whiteout ---------------- */}
      {s.flash > 0.01 && (
        <div className="pointer-events-none absolute inset-0 z-[70] bg-white" style={{ opacity: s.flash }} />
      )}

      {/* ---------------- damage vignette ---------------- */}
      {s.damageAge < 700 && !s.alive && (
        <div className="absolute inset-0 z-20" style={{ boxShadow: `inset 0 0 140px rgba(160,0,0,${0.75 * (1 - s.damageAge / 700)})` }} />
      )}
      {!s.alive && (
        <div className="absolute inset-0 z-10" style={{ boxShadow: 'inset 0 0 200px rgba(80,0,0,0.55)' }} />
      )}

      {/* ---------------- top bar: scores + timer ---------------- */}
      <div className="absolute top-3 left-1/2 z-20 flex -translate-x-1/2 items-center gap-3">
        <div className="flex items-center gap-2 rounded-l-md bg-black/60 px-3 py-1.5 backdrop-blur-sm" style={{ borderBottom: `2px solid ${ctColor}` }}>
          <span className="text-xs tracking-widest" style={{ color: ctColor }}>CT</span>
          <span className="text-xl font-bold" style={{ color: ctColor }}>{s.scores.CT}</span>
        </div>
        <div className={`rounded-md bg-black/70 px-4 py-1.5 font-bold tabular-nums backdrop-blur-sm ${s.bombPlanted && s.phase === 'live' ? 'text-red-400' : 'text-white'}`}>
          {s.phase === 'over' ? 'GG' : s.phase === 'warmup' ? 'WARMUP' : fmtTime(s.timer)}
        </div>
        <div className="flex items-center gap-2 rounded-r-md bg-black/60 px-3 py-1.5 backdrop-blur-sm" style={{ borderBottom: `2px solid ${tColor}` }}>
          <span className="text-xl font-bold" style={{ color: tColor }}>{s.scores.T}</span>
          <span className="text-xs tracking-widest" style={{ color: tColor }}>T</span>
        </div>
      </div>
      <div className="absolute top-12 left-1/2 z-20 -translate-x-1/2 text-[10px] tracking-widest text-white/50">
        {s.mapName} · ROUND {s.round} · FIRST TO {s.winTarget}
      </div>

      {/* bomb planted indicator */}
      {s.bombPlanted && s.phase === 'live' && (
        <div className="absolute top-12 left-1/2 z-20 -translate-x-1/2 animate-pulse text-xs font-bold tracking-widest text-red-400">
          ⏱ BOMB PLANTED
        </div>
      )}

      {/* ---------------- toasts ---------------- */}
      <div className="absolute top-20 left-1/2 z-20 flex -translate-x-1/2 flex-col items-center gap-1">
        {s.toasts.map((t, i) => (
          <div key={i} className="rounded bg-black/60 px-3 py-1 text-xs backdrop-blur-sm">{t.msg}</div>
        ))}
      </div>

      {/* ---------------- killfeed ---------------- */}
      <div className="absolute right-3 top-3 z-20 flex flex-col items-end gap-1">
        {s.killfeed.map((k, i) => (
          <div key={i} className="flex items-center gap-2 rounded bg-black/55 px-2 py-1 text-xs backdrop-blur-sm">
            <span style={{ color: k.killerTeam === 'CT' ? ctColor : tColor }}>{k.killer || '☠'}</span>
            <span className="text-white/70">{WEAPON_SHORT[k.weapon] ?? k.weapon}</span>
            {k.hs && <span className="text-red-400">HS</span>}
            <span className="text-white/40">→</span>
            <span style={{ color: k.victimTeam === 'CT' ? ctColor : tColor }}>{k.victim}</span>
          </div>
        ))}
      </div>

      {/* ---------------- round banner ---------------- */}
      {s.banner && (s.phase === 'freeze' || s.phase === 'post') && (
        <div className="absolute left-1/2 top-1/4 z-30 -translate-x-1/2 text-center">
          <div className="text-3xl font-bold tracking-wide" style={{ color: s.banner.winner === 'CT' ? ctColor : s.banner.winner === 'T' ? tColor : '#fff' }}>
            {s.banner.title}
          </div>
          <div className="mt-1 text-sm text-white/70">{s.banner.sub}</div>
        </div>
      )}

      {/* ---------------- gameover banner ---------------- */}
      {s.gameover && (
        <div className="absolute left-1/2 top-1/3 z-40 -translate-x-1/2 rounded-lg bg-black/75 p-8 text-center backdrop-blur-sm">
          <div className="text-4xl font-bold" style={{ color: s.gameover.winner === 'CT' ? ctColor : tColor }}>
            {s.gameover.winner === 'CT' ? 'COUNTER-TERRORISTS WIN' : 'TERRORISTS WIN'}
          </div>
          <div className="mt-2 text-xl tabular-nums">Final score {s.gameover.scores.CT} : {s.gameover.scores.T}</div>
          <div className="mt-3 text-xs text-white/60">Starting a new match in a moment…</div>
        </div>
      )}

      {/* ---------------- death overlay ---------------- */}
      {!s.alive && s.deathBy && (
        <div className="absolute left-1/2 top-2/5 z-30 -translate-x-1/2 text-center">
          <div className="text-2xl font-bold text-red-500">YOU WERE KILLED</div>
          <div className="text-sm text-white/70">by {s.deathBy} · respawning next round</div>
          <div className="mt-2 text-xs text-white/40">click to spectate teammates</div>
        </div>
      )}

      {/* ---------------- plant / defuse progress ---------------- */}
      {s.plantBar !== null && s.plantBar > 0 && (
        <div className="absolute bottom-1/3 left-1/2 z-30 w-64 -translate-x-1/2 text-center">
          <div className="mb-1 text-xs tracking-widest">PLANTING THE BOMB</div>
          <div className="h-3 w-full overflow-hidden rounded-sm bg-black/60">
            <div className="h-full bg-orange-500 transition-none" style={{ width: `${s.plantBar * 100}%` }} />
          </div>
        </div>
      )}
      {s.defuseBar !== null && s.defuseBar > 0 && (
        <div className="absolute bottom-1/3 left-1/2 z-30 w-64 -translate-x-1/2 text-center">
          <div className="mb-1 text-xs tracking-widest">DEFUSING THE BOMB</div>
          <div className="h-3 w-full overflow-hidden rounded-sm bg-black/60">
            <div className="h-full bg-sky-400" style={{ width: `${s.defuseBar * 100}%` }} />
          </div>
        </div>
      )}

      {/* plant/defuse hint */}
      {s.canPlant && s.plantBar === null && (
        <div className="absolute bottom-1/3 left-1/2 z-30 -translate-x-1/2 rounded bg-black/60 px-3 py-1.5 text-xs tracking-wider">
          <span className="rounded border border-white/60 px-1.5 py-0.5">E</span> HOLD TO PLANT THE BOMB
        </div>
      )}
      {s.canDefuse && s.defuseBar === null && (
        <div className="absolute bottom-1/3 left-1/2 z-30 -translate-x-1/2 rounded bg-black/60 px-3 py-1.5 text-xs tracking-wider">
          <span className="rounded border border-white/60 px-1.5 py-0.5">E</span> HOLD TO DEFUSE (10s)
        </div>
      )}

      {/* ---------------- bottom left: hp / armor ---------------- */}
      <div className="absolute bottom-4 left-4 z-20 flex flex-col gap-1.5">
        {s.chat.length > 0 && (
          <div className="mb-2 flex max-h-40 w-80 flex-col-reverse gap-0.5 overflow-hidden text-xs">
            {s.chat.slice(-6).map((c, i) => (
              <div key={i} className="truncate bg-black/40 px-2 py-0.5">
                <span style={{ color: c.team === 'CT' ? ctColor : tColor }}>{c.name}</span>
                <span className="text-white/80">: {c.text}</span>
              </div>
            ))}
          </div>
        )}
        <div className="flex items-end gap-4">
          <div>
            <div className="text-[10px] tracking-widest text-white/50">HEALTH</div>
            <div className={`text-3xl font-bold tabular-nums ${s.hp < 30 ? 'text-red-400' : 'text-white'}`}>{s.hp}</div>
          </div>
          <div>
            <div className="text-[10px] tracking-widest text-white/50">ARMOR {s.helmet ? '🪖' : ''}{s.hasKit ? ' · KIT' : ''}</div>
            <div className="text-3xl font-bold tabular-nums text-sky-300">{s.armor}</div>
          </div>
        </div>
      </div>

      {/* ---------------- bottom right: ammo / money ---------------- */}
      <div className="absolute bottom-4 right-4 z-20 text-right">
        <div className="text-[10px] tracking-widest text-white/50">MONEY</div>
        <div className="text-xl font-bold tabular-nums text-emerald-400">{fmtMoney(s.money)}</div>
        <div className="mt-2 text-[10px] tracking-widest text-white/50">{WEAPONS[s.weapon]?.name ?? ''}</div>
        {s.grenadeCount > 0 ? (
          <div className="text-3xl font-bold tabular-nums text-orange-300">×{s.grenadeCount}</div>
        ) : s.ammo.mag >= 0 ? (
          <div className="text-3xl font-bold tabular-nums">
            <span className={s.ammo.mag === 0 ? 'text-red-400' : ''}>{s.ammo.mag}</span>
            <span className="text-base text-white/50"> / {s.ammo.reserve}</span>
          </div>
        ) : (
          <div className="text-3xl font-bold">∞</div>
        )}
        {WEAPONS[s.weapon]?.throwable && s.alive && (
          <div className="text-[10px] tracking-widest text-white/50">LMB THROW · RMB LOB</div>
        )}
        {s.reloading && <div className="animate-pulse text-xs text-orange-300">RELOADING…</div>}
        {s.hasBomb && s.alive && <div className="mt-1 text-xs font-bold text-orange-400">C4 CARRIER — press 4</div>}
      </div>

      {/* weapon slots hint (grenades collapse to counted kinds — 5 FLASH×2 SMOKE) */}
      <div className="absolute bottom-4 left-1/2 z-20 flex -translate-x-1/2 gap-3 text-xs">
        {(() => {
          const shown: Array<{ key: string; label: string; active: boolean }> = []
          const nadeShown = new Set<string>()
          for (let i = 0; i < s.inventory.length; i++) {
            const w = s.inventory[i]
            const def = WEAPONS[w]
            if (def?.slot === 5) {
              if (nadeShown.has(w)) continue
              nadeShown.add(w)
              const count = s.inventory.filter(x => x === w).length
              shown.push({
                key: `n-${w}`,
                label: `5 ${WEAPON_SHORT[w] ?? w}${count > 1 ? `×${count}` : ''}`,
                active: WEAPONS[s.inventory[s.wIdx] ?? '']?.id === w,
              })
              continue
            }
            shown.push({
              key: `s-${i}`,
              label: `${i + 1} ${def?.slot === 4 ? 'C4' : WEAPON_SHORT[w] ?? w}`,
              active: i === s.wIdx,
            })
          }
          return shown.map(e => (
            <span key={e.key} className={`px-1.5 ${e.active ? 'border-b-2 border-orange-400 text-orange-300' : 'text-white/40'}`}>
              {e.label}
            </span>
          ))
        })()}
      </div>

      {/* ---------------- buy hint during freeze ---------------- */}
      {s.canBuy && s.alive && !open.buy && (
        <div className="absolute bottom-16 left-1/2 z-20 -translate-x-1/2 animate-pulse text-xs tracking-widest text-white/70">
          PRESS <span className="rounded border border-white/60 px-1">B</span> TO BUY
        </div>
      )}

      {/* buy error toast */}
      {s.buyError && (
        <div className="absolute bottom-24 left-1/2 z-30 -translate-x-1/2 rounded bg-red-900/80 px-3 py-1 text-xs">
          {s.buyError}
        </div>
      )}

      {/* ---------------- spectate hint ---------------- */}
      {s.specTarget && !s.alive && (
        <div className="absolute bottom-24 left-1/2 z-20 -translate-x-1/2 text-xs text-white/50">
          SPECTATING — click to cycle teammates
        </div>
      )}

      {/* ---------------- fps ---------------- */}
      <div className="absolute right-3 bottom-24 z-10 text-[10px] text-white/30">{s.fps} FPS</div>

      {/* ---------------- scoreboard (Tab) ---------------- */}
      {s.scoreboardOpen && (
        <div className="absolute inset-x-0 top-24 z-40 mx-auto w-[720px] max-w-[95vw] rounded-lg bg-black/85 p-4 backdrop-blur-sm">
          <div className="mb-3 flex justify-between px-2 text-xs tracking-widest text-white/50">
            <span>DUST2 · BOMB DEFUSAL</span>
            <span>ROUND {s.round} · {s.scores.CT} : {s.scores.T}</span>
          </div>
          {(['CT', 'T'] as const).map(team => (
            <div key={team} className="mb-3">
              <div className="mb-1 flex items-center justify-between px-2 py-1 text-sm font-bold" style={{ color: team === 'CT' ? ctColor : tColor }}>
                <span>{team === 'CT' ? 'COUNTER-TERRORISTS' : 'TERRORISTS'}</span>
                <span className="text-xs text-white/40">K / D / $</span>
              </div>
              {s.scoreboard.filter(p => p.team === team).map(p => (
                <div key={p.id} className={`flex items-center justify-between px-2 py-1 text-sm ${p.self ? 'bg-white/10' : ''} ${p.alive ? '' : 'opacity-40'}`}>
                  <span className="flex items-center gap-2">
                    {p.bot && <span className="text-[9px] rounded bg-white/15 px-1 text-white/60">BOT</span>}
                    {p.name}{p.self && <span className="text-[10px] text-white/40">(you)</span>}
                    {!p.alive && <span className="text-[10px] text-red-400">✝</span>}
                  </span>
                  <span className="tabular-nums text-white/80">{p.kills} / {p.deaths} / ${p.money}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}

      {/* ---------------- pause menu (pointer unlocked) ---------------- */}
      {!s.pointerLocked && !open.buy && !open.chat && s.joined && !s.gameover && (
        <div className="pointer-events-auto absolute inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
          <div className="w-80 rounded-xl bg-zinc-900/95 p-6 shadow-2xl">
            <h2 className="mb-1 text-center text-2xl font-bold tracking-widest text-orange-400">DUST2</h2>
            <p className="mb-5 text-center text-xs text-white/50">CS2-style web FPS · {s.connected ? 'connected' : 'connecting…'}</p>
            {s.phase === 'freeze' && (
              <button onClick={cb.onResume} className="mb-2 w-full rounded-lg bg-orange-600 py-2.5 font-bold tracking-wider text-white transition hover:bg-orange-500">
                ▶ PLAY ({fmtTime(s.timer)})
              </button>
            )}
            <button onClick={cb.onResume} className="mb-2 w-full rounded-lg bg-zinc-700 py-2.5 font-bold tracking-wider text-white transition hover:bg-zinc-600">
              RESUME
            </button>
            <button onClick={() => setShowSettings(!showSettings)} className="mb-2 w-full rounded-lg bg-zinc-800 py-2 text-sm tracking-wider text-white/90 transition hover:bg-zinc-700">
              ⚙ SETTINGS
            </button>
            {showSettings && (
              <div className="mb-3 rounded-lg bg-zinc-800/60 p-3 text-xs">
                <label className="mb-2 block">
                  <span className="text-white/60">Mouse sensitivity: {localSettings.sens.toFixed(2)}</span>
                  <input type="range" min="0.2" max="3" step="0.05" value={localSettings.sens}
                    onChange={e => setLocalSettings({ ...localSettings, sens: +e.target.value })}
                    onMouseUp={() => cb.onSettings(localSettings)}
                    onTouchEnd={() => cb.onSettings(localSettings)}
                    className="mt-1 w-full accent-orange-500" />
                </label>
                <label className="mb-2 block">
                  <span className="text-white/60">Volume: {Math.round(localSettings.vol * 100)}%</span>
                  <input type="range" min="0" max="1" step="0.05" value={localSettings.vol}
                    onChange={e => setLocalSettings({ ...localSettings, vol: +e.target.value })}
                    onMouseUp={() => cb.onSettings(localSettings)}
                    onTouchEnd={() => cb.onSettings(localSettings)}
                    className="mt-1 w-full accent-orange-500" />
                </label>
                <label className="block">
                  <span className="text-white/60">FOV: {localSettings.fov}°</span>
                  <input type="range" min="60" max="100" step="1" value={localSettings.fov}
                    onChange={e => setLocalSettings({ ...localSettings, fov: +e.target.value })}
                    onMouseUp={() => cb.onSettings(localSettings)}
                    onTouchEnd={() => cb.onSettings(localSettings)}
                    className="mt-1 w-full accent-orange-500" />
                </label>
              </div>
            )}
            <div className="mb-4 rounded-lg bg-zinc-800/40 p-3 text-[11px] leading-relaxed text-white/50">
              WASD move · SHIFT walk · CTRL crouch · SPACE jump<br />
              LMB fire · RMB zoom (AWP) · R reload · 1-4 weapons<br />
              E plant/defuse · B buy menu · TAB scoreboard · ENTER chat
            </div>
            <button onClick={cb.onQuit} className="w-full rounded-lg bg-red-900/70 py-2 text-sm tracking-wider text-white/90 transition hover:bg-red-800">
              QUIT TO LOBBY
            </button>
          </div>
        </div>
      )}

      {/* ---------------- buy menu (B) — CS 1.6 categories ---------------- */}
      {open.buy && <BuyMenu s={s} cb={cb} />}

      {/* ---------------- chat input (Enter) ---------------- */}
      {open.chat && (
        <div className="pointer-events-auto absolute bottom-8 left-1/2 z-50 w-[440px] max-w-[90vw] -translate-x-1/2">
          <form onSubmit={e => {
            e.preventDefault()
            if (chatText.trim()) cb.onChat(chatText.trim())
            setChatText('')
            cb.onCloseChat()
          }}>
            <input ref={chatRef} autoFocus value={chatText} onChange={e => setChatText(e.target.value)}
              onKeyDown={e => { if (e.key === 'Escape') { setChatText(''); cb.onCloseChat() } }}
              maxLength={100}
              placeholder="Say something… (Esc to cancel)"
              className="w-full rounded-md bg-black/80 px-3 py-2 text-sm text-white outline-none ring-1 ring-white/20 focus:ring-orange-500" />
          </form>
        </div>
      )}
    </div>
  )
}
