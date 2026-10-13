'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Hud } from '@/game/hud'
import type { HudState, Engine } from '@/game/engine'

const LS_KEY = 'cs2web-settings-v1'

interface Settings { sens: number; vol: number; fov: number }

function loadSettings(): Settings {
  if (typeof window === 'undefined') return { sens: 1, vol: 0.8, fov: 75 }
  try {
    const raw = localStorage.getItem(LS_KEY)
    if (raw) return { ...{ sens: 1, vol: 0.8, fov: 75 }, ...JSON.parse(raw) }
  } catch { /* ignore */ }
  return { sens: 1, vol: 0.8, fov: 75 }
}

export default function Home() {
  const [screen, setScreen] = useState<'lobby' | 'game'>('lobby')
  const [hud, setHud] = useState<HudState | null>(null)
  const [open, setOpen] = useState({ buy: false, chat: false })
  const [settings, setSettings] = useState<Settings>({ sens: 1, vol: 0.8, fov: 75 })

  // lobby form
  const [name, setName] = useState('Player')
  const [team, setTeam] = useState<'auto' | 'CT' | 'T'>('auto')
  const [room, setRoom] = useState('dust2')
  const [botFill, setBotFill] = useState(true)
  const [botDifficulty, setBotDifficulty] = useState<'easy' | 'normal' | 'hard'>('normal')
  const [winTarget, setWinTarget] = useState(8)

  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const engineRef = useRef<Engine | null>(null)
  const openRef = useRef(open)

  useEffect(() => { setSettings(loadSettings()) }, [])
  useEffect(() => { openRef.current = open }, [open])

  // persist settings
  const applySettings = useCallback((s: Settings) => {
    setSettings(s)
    try { localStorage.setItem(LS_KEY, JSON.stringify(s)) } catch { /* ignore */ }
    engineRef.current?.setSensitivity(s.sens)
    engineRef.current?.setVolume(s.vol)
    engineRef.current?.setFov(s.fov)
  }, [])

  // mount engine when entering game
  useEffect(() => {
    if (screen !== 'game' || !canvasRef.current || engineRef.current) return
    let cancelled = false
    ;(async () => {
      const mod = await import('@/game/engine')
      if (cancelled || !canvasRef.current) return
      const engine = new mod.Engine(canvasRef.current, {
        name: name.slice(0, 16) || 'Player',
        team,
        room: room.trim().slice(0, 24) || 'dust2',
        botFill,
        botDifficulty,
        winTarget,
        sensitivity: settings.sens,
        volume: settings.vol,
        fov: settings.fov,
      }, (s) => setHud(s))
      engineRef.current = engine
      engine.start()
    })()
    return () => {
      cancelled = true
      engineRef.current?.dispose()
      engineRef.current = null
      setHud(null)
    }
  }, [screen]) // eslint-disable-line react-hooks/exhaustive-deps

  // global keys for buy / chat
  useEffect(() => {
    if (screen !== 'game') return
    const onKey = (e: KeyboardEvent) => {
      const eng = engineRef.current
      if (!eng) return
      if (e.code === 'KeyB' && !openRef.current.chat) {
        e.preventDefault()
        const next = !openRef.current.buy
        setOpen(o => ({ ...o, buy: next }))
        eng.buyOpen = next
        if (next) eng.releaseLock()
        else eng.requestLock()
      } else if (e.code === 'Enter' && !openRef.current.buy && !openRef.current.chat) {
        e.preventDefault()
        setOpen(o => ({ ...o, chat: true }))
        eng.chatOpen = true
        eng.releaseLock()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [screen])

  const quit = useCallback(() => {
    engineRef.current?.dispose()
    engineRef.current = null
    setOpen({ buy: false, chat: false })
    setHud(null)
    setScreen('lobby')
  }, [])

  // ---------------------------------------------------------------- lobby
  if (screen === 'lobby') {
    return (
      <main className="min-h-screen bg-zinc-950 text-zinc-100">
        <div className="pointer-events-none fixed inset-0 opacity-[0.06]" style={{
          backgroundImage: 'radial-gradient(circle at 25% 25%, #eec37a 0, transparent 40%), radial-gradient(circle at 75% 75%, #7ab0e8 0, transparent 40%)',
        }} />
        <div className="relative mx-auto flex min-h-screen max-w-5xl flex-col items-center justify-center gap-8 px-4 py-10">
          <div className="text-center">
            <div className="mb-2 flex items-center justify-center gap-3">
              <span className="h-1 w-10 bg-orange-500/70" />
              <h1 className="text-4xl font-black tracking-[0.3em] text-orange-400 sm:text-5xl">DUST2</h1>
              <span className="h-1 w-10 bg-orange-500/70" />
            </div>
            <p className="font-mono text-sm tracking-widest text-zinc-400">
              CS2-STYLE WEB FPS · BOMB DEFUSAL · MULTIPLAYER
            </p>
            <p className="mt-1 font-mono text-xs text-zinc-500">
              headshots hit hard · bots fill the server · bring friends with a room code
            </p>
          </div>

          <div className="grid w-full max-w-3xl gap-4 md:grid-cols-2">
            {/* left: player setup */}
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/80 p-5">
              <h2 className="mb-4 text-xs font-bold tracking-widest text-zinc-400">PLAYER</h2>
              <label className="mb-3 block">
                <span className="mb-1 block text-xs text-zinc-400">Nickname</span>
                <Input value={name} onChange={e => setName(e.target.value.slice(0, 16))} maxLength={16}
                  className="border-zinc-700 bg-zinc-950 font-mono" placeholder="your name" />
              </label>
              <div className="mb-3">
                <span className="mb-1.5 block text-xs text-zinc-400">Team</span>
                <div className="grid grid-cols-3 gap-1.5">
                  {(['auto', 'CT', 'T'] as const).map(t => (
                    <button key={t} onClick={() => setTeam(t)}
                      className={`rounded-md py-2 font-mono text-xs font-bold tracking-wider transition ${team === t
                        ? t === 'CT' ? 'bg-sky-800 text-sky-200 ring-1 ring-sky-500'
                          : t === 'T' ? 'bg-orange-800 text-orange-200 ring-1 ring-orange-500'
                            : 'bg-zinc-100 text-zinc-900'
                        : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'}`}>
                      {t === 'auto' ? 'AUTO' : t === 'CT' ? 'COUNTER-T' : 'TERRORIST'}
                    </button>
                  ))}
                </div>
              </div>
              <label className="mb-1 block">
                <span className="mb-1 block text-xs text-zinc-400">Room code <span className="text-zinc-600">(share with friends — everyone with the same code plays together)</span></span>
                <Input value={room} onChange={e => setRoom(e.target.value.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 24))}
                  className="border-zinc-700 bg-zinc-950 font-mono uppercase" placeholder="dust2" />
              </label>
            </div>

            {/* right: match setup */}
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/80 p-5">
              <h2 className="mb-4 text-xs font-bold tracking-widest text-zinc-400">MATCH</h2>
              <div className="mb-3">
                <span className="mb-1.5 block text-xs text-zinc-400">Bots</span>
                <div className="flex gap-1.5">
                  <button onClick={() => setBotFill(!botFill)}
                    className={`flex-1 rounded-md py-2 font-mono text-xs font-bold tracking-wider transition ${botFill ? 'bg-zinc-100 text-zinc-900' : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'}`}>
                    {botFill ? 'FILL 5v5' : 'HUMANS ONLY'}
                  </button>
                  <select value={botDifficulty} onChange={e => setBotDifficulty(e.target.value as 'easy' | 'normal' | 'hard')}
                    disabled={!botFill}
                    className="flex-1 rounded-md border-0 bg-zinc-800 px-2 py-2 font-mono text-xs text-zinc-300 outline-none disabled:opacity-40">
                    <option value="easy">EASY</option>
                    <option value="normal">NORMAL</option>
                    <option value="hard">HARD</option>
                  </select>
                </div>
              </div>
              <div className="mb-3">
                <span className="mb-1.5 block text-xs text-zinc-400">Match format (rounds to win)</span>
                <div className="grid grid-cols-4 gap-1.5">
                  {[4, 8, 13, 16].map(n => (
                    <button key={n} onClick={() => setWinTarget(n)}
                      className={`rounded-md py-2 font-mono text-xs font-bold transition ${winTarget === n ? 'bg-orange-600 text-white' : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'}`}>
                      {n === 16 ? '16 (MR30)' : n === 13 ? '13 (MR24)' : `first ${n}`}
                    </button>
                  ))}
                </div>
              </div>
              <div className="rounded-lg bg-zinc-950/60 p-3">
                <span className="mb-2 block text-xs text-zinc-400">Quick settings</span>
                <label className="mb-2 block text-xs">
                  <span className="text-zinc-500">Sensitivity: {settings.sens.toFixed(2)}</span>
                  <input type="range" min="0.2" max="3" step="0.05" value={settings.sens}
                    onChange={e => applySettings({ ...settings, sens: +e.target.value })}
                    className="mt-1 w-full accent-orange-500" />
                </label>
                <label className="mb-2 block text-xs">
                  <span className="text-zinc-500">Volume: {Math.round(settings.vol * 100)}%</span>
                  <input type="range" min="0" max="1" step="0.05" value={settings.vol}
                    onChange={e => applySettings({ ...settings, vol: +e.target.value })}
                    className="mt-1 w-full accent-orange-500" />
                </label>
                <label className="block text-xs">
                  <span className="text-zinc-500">FOV: {settings.fov}°</span>
                  <input type="range" min="60" max="100" step="1" value={settings.fov}
                    onChange={e => applySettings({ ...settings, fov: +e.target.value })}
                    className="mt-1 w-full accent-orange-500" />
                </label>
              </div>
            </div>
          </div>

          <Button onClick={() => setScreen('game')} size="lg"
            className="h-14 w-full max-w-md rounded-xl bg-orange-600 font-mono text-lg font-black tracking-[0.3em] text-white shadow-lg shadow-orange-900/50 transition hover:bg-orange-500">
            ▶ PLAY
          </Button>

          <div className="max-w-3xl rounded-xl border border-zinc-800 bg-zinc-900/60 p-4 font-mono text-xs leading-relaxed text-zinc-400">
            <b className="text-zinc-200">HOW TO PLAY</b> — click the game to lock your mouse. <b>WASD</b> move ·
            <b> SHIFT</b> walk · <b>CTRL</b> crouch · <b>SPACE</b> jump · <b>LMB</b> fire · <b>RMB</b> scope (AWP) ·
            <b> R</b> reload · <b>1-4</b> weapons · <b>E</b> hold to plant/defuse · <b>B</b> buy menu ·
            <b> TAB</b> scoreboard · <b>ENTER</b> chat · <b>ESC</b> pause.
            Headshots deal 4× damage. Ts win by bombing A or B; CTs win by defusing, eliminating Ts, or running down the clock.
          </div>
        </div>
      </main>
    )
  }

  // ---------------------------------------------------------------- game
  return (
    <div className="fixed inset-0 bg-black">
      <canvas ref={canvasRef} className="block h-full w-full" />
      {hud ? (
        <Hud s={hud} open={open} settings={settings} cb={{
          onBuy: (item) => engineRef.current?.buy(item),
          onChat: (text) => engineRef.current?.sendChat(text),
          onResume: () => {
            setOpen({ buy: false, chat: false })
            const eng = engineRef.current
            if (eng) { eng.buyOpen = false; eng.chatOpen = false; eng.requestLock() }
          },
          onOpenBuy: (o) => {
            setOpen(s => ({ ...s, buy: o }))
            const eng = engineRef.current
            if (eng) {
              eng.buyOpen = o
              if (o) eng.releaseLock(); else eng.requestLock()
            }
          },
          onCloseChat: () => {
            setOpen(s => ({ ...s, chat: false }))
            const eng = engineRef.current
            if (eng) { eng.chatOpen = false; eng.requestLock() }
          },
          onSettings: (s) => applySettings(s),
          onQuit: quit,
        }} />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center bg-black">
          <div className="text-center">
            <div className="mx-auto mb-4 h-10 w-10 animate-spin rounded-full border-4 border-zinc-700 border-t-orange-500" />
            <p className="font-mono text-sm tracking-widest text-zinc-400">LOADING DUST2…</p>
          </div>
        </div>
      )}
    </div>
  )
}
