'use client'

import { useEffect, useRef, useState } from 'react'
import { WEAPONS, BUY_ITEMS } from './weapons'
import type { WeaponId } from './weapons'
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
  world: 'C4',
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
        ROUND {s.round} · FIRST TO {s.winTarget}
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
            <div className="text-[10px] tracking-widest text-white/50">ARMOR {s.helmet ? '🪖' : ''}</div>
            <div className="text-3xl font-bold tabular-nums text-sky-300">{s.armor}</div>
          </div>
        </div>
      </div>

      {/* ---------------- bottom right: ammo / money ---------------- */}
      <div className="absolute bottom-4 right-4 z-20 text-right">
        <div className="text-[10px] tracking-widest text-white/50">MONEY</div>
        <div className="text-xl font-bold tabular-nums text-emerald-400">{fmtMoney(s.money)}</div>
        <div className="mt-2 text-[10px] tracking-widest text-white/50">{WEAPONS[s.weapon]?.name ?? ''}</div>
        {s.ammo.mag >= 0 ? (
          <div className="text-3xl font-bold tabular-nums">
            <span className={s.ammo.mag === 0 ? 'text-red-400' : ''}>{s.ammo.mag}</span>
            <span className="text-base text-white/50"> / {s.ammo.reserve}</span>
          </div>
        ) : (
          <div className="text-3xl font-bold">∞</div>
        )}
        {s.reloading && <div className="animate-pulse text-xs text-orange-300">RELOADING…</div>}
        {s.hasBomb && s.alive && <div className="mt-1 text-xs font-bold text-orange-400">C4 CARRIER — press 4</div>}
      </div>

      {/* weapon slots hint */}
      <div className="absolute bottom-4 left-1/2 z-20 flex -translate-x-1/2 gap-3 text-xs">
        {s.inventory.map((w, i) => (
          <span key={w} className={`px-1.5 ${i === s.wIdx ? 'border-b-2 border-orange-400 text-orange-300' : 'text-white/40'}`}>
            {i + 1} {WEAPONS[w]?.slot === 4 ? 'C4' : WEAPON_SHORT[w] ?? w}
          </span>
        ))}
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

      {/* ---------------- buy menu (B) ---------------- */}
      {open.buy && (
        <div className="pointer-events-auto absolute inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
          <div className="w-[560px] max-w-[95vw] rounded-xl bg-zinc-900/95 p-6 shadow-2xl">
            <div className="mb-1 flex items-baseline justify-between">
              <h2 className="text-xl font-bold tracking-widest text-orange-400">BUY EQUIPMENT</h2>
              <span className="font-bold tabular-nums text-emerald-400">{fmtMoney(s.money)}</span>
            </div>
            <p className="mb-4 text-xs text-white/50">{s.canBuy ? 'Buy time is open' : 'Buy time is OVER — you can browse only'}</p>
            <div className="grid grid-cols-2 gap-2">
              {BUY_ITEMS.filter(it => !it.team || it.team === s.team).map(it => {
                const w = WEAPONS[it.id as WeaponId]
                const afford = s.money >= it.price
                const owned = s.inventory.includes(it.id as WeaponId) || (it.id === 'kevlar' && s.armor > 0 && !s.helmet) || (it.id === 'kevlarhelm' && s.helmet)
                return (
                  <button key={it.id} disabled={!afford || !s.canBuy}
                    onClick={() => cb.onBuy(it.id)}
                    className={`flex items-center justify-between rounded-lg px-3 py-2.5 text-left transition ${afford && s.canBuy ? 'bg-zinc-800 hover:bg-zinc-700' : 'bg-zinc-800/40 opacity-40 cursor-not-allowed'}`}>
                    <div>
                      <div className="text-sm font-bold">{it.name}{owned && <span className="ml-2 text-[10px] text-emerald-400">OWNED</span>}</div>
                      {w && <div className="text-[10px] text-white/40">{w.damage} dmg · {w.fireDelay}ms · {w.mag === Infinity ? '∞' : w.mag} rds</div>}
                      {!w && <div className="text-[10px] text-white/40">armor 100{it.id === 'kevlarhelm' ? ' + helmet' : ''}</div>}
                    </div>
                    <span className={`tabular-nums text-sm ${afford ? 'text-emerald-400' : 'text-red-400'}`}>{it.price ? '$' + it.price : 'FREE'}</span>
                  </button>
                )
              })}
            </div>
            <button onClick={() => cb.onOpenBuy(false)} className="mt-4 w-full rounded-lg bg-orange-600 py-2 font-bold tracking-wider hover:bg-orange-500">
              CLOSE (B) — BACK TO GAME
            </button>
          </div>
        </div>
      )}

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
