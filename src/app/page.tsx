'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { io, type Socket } from 'socket.io-client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Hud } from '@/game/hud'
import type { HudState, Engine } from '@/game/engine'
import type { MapId } from '@/game/mapdata'
import { MAP_LIST } from '@/game/mapdata'
import { installAssetCache, preloadGameAssets, stageLabel } from '@/game/preloader'
import type { LoadProgress } from '@/game/preloader'

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

interface ServerEntry {
  id: string
  name: string
  map: string
  mapName: string
  players: number
  humans: number
  max: number
  phase: string
  round: number
}

const phaseLabel: Record<string, string> = {
  warmup: 'WARMUP', freeze: 'FREEZE', live: 'LIVE', post: 'ROUND END', over: 'MATCH OVER',
}

// Task 81 loading bar state — the overlay between PLAY and the match. The
// three asset stages come from preloadGameAssets; the warm stages
// (textures/sounds/shaders) from engine.warmup()
interface LoadPhase {
  stage: string
  done: number
  total: number
  pct: number    // 0..1 across BOTH halves (preload 0-70, warmup 70-100)
  cached: boolean
}

const WARM_PCT: Record<string, number> = { textures: 0.78, sounds: 0.88, shaders: 0.96 }

// Task 81 — CS2-style loading screen: map name, real progress bar, stage
// text driven by the preloader + engine warmup. Shows "served from cache"
// when the whole preload was IDB hits (every game after the first).
function LoadingOverlay({ phase, mapName }: { phase: LoadPhase; mapName: string }) {
  const WARM_LABEL: Record<string, string> = {
    textures: 'PREPARING TEXTURES', sounds: 'DECODING SOUNDS', shaders: 'COMPILING SHADERS',
  }
  const label = phase.stage.startsWith('warmup:')
    ? WARM_LABEL[phase.stage.slice(7)] ?? 'FINISHING'
    : phase.stage === 'done'
      ? (phase.cached ? 'READY — SERVED FROM CACHE' : 'READY')
      : `${stageLabel(phase.stage)} · ${phase.done}/${phase.total}`
  const pct = Math.round(phase.pct * 100)
  return (
    <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-black">
      <div className="w-[560px] max-w-[85vw]">
        <div className="mb-1 font-mono text-xs font-bold tracking-[0.4em] text-orange-500">LOADING</div>
        <div className="mb-6 font-mono text-4xl font-black tracking-widest text-zinc-100">{mapName}</div>
        <div className="h-3 w-full overflow-hidden rounded-full bg-zinc-800 ring-1 ring-zinc-700">
          <div className="h-full rounded-full bg-orange-500 transition-all duration-200" style={{ width: `${pct}%` }} />
        </div>
        <div className="mt-3 flex items-baseline justify-between font-mono text-xs tracking-widest text-zinc-400">
          <span>{label}</span>
          <span className="text-zinc-200">{pct}%</span>
        </div>
      </div>
    </div>
  )
}

export default function Home() {
  const [screen, setScreen] = useState<'lobby' | 'game'>('lobby')
  const [hud, setHud] = useState<HudState | null>(null)
  const [open, setOpen] = useState({ buy: false, chat: false })
  const [loadPhase, setLoadPhase] = useState<LoadPhase | null>(null)
  const [settings, setSettings] = useState<Settings>({ sens: 1, vol: 0.8, fov: 75 })

  // lobby form
  const [tab, setTab] = useState<'quick' | 'servers'>('quick')
  const [name, setName] = useState('Player')
  const [team, setTeam] = useState<'auto' | 'CT' | 'T'>('auto')
  const [map, setMap] = useState<MapId>('dust2')
  const [room, setRoom] = useState('')
  const [botFill, setBotFill] = useState(true)
  const [botDifficulty, setBotDifficulty] = useState<'easy' | 'normal' | 'hard'>('normal')
  const [winTarget, setWinTarget] = useState(8)

  // server browser
  const [servers, setServers] = useState<ServerEntry[]>([])
  const [srvName, setSrvName] = useState('')
  const [srvMap, setSrvMap] = useState<MapId>('dust2')
  const [joining, setJoining] = useState(false)

  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const engineRef = useRef<Engine | null>(null)
  const openRef = useRef(open)
  const watchSockRef = useRef<Socket | null>(null)
  const engineOptsRef = useRef<{ room: string; map: MapId } | null>(null)
  const loadGenRef = useRef(0)

  useEffect(() => { setSettings(loadSettings()) }, [])
  useEffect(() => { openRef.current = open }, [open])

  // Task 81: install the persistent asset cache FIRST, so even the lobby
  // warm-ups below (human model, weapon GLBs) populate it instead of pulling
  // the same bytes again at PLAY.
  useEffect(() => { installAssetCache() }, [])

  // Warm the character model (human.glb, ~7.6 MB) while the player is still
  // browsing the menu: the download then happens during lobby time, so hitting
  // PLAY never triggers a fresh model download — players spawn rigged at once.
  // players.ts calls preloadUserModel() again as a safety net; the promise is
  // cached at module level, so this never double-fetches.
  useEffect(() => {
    void import('@/game/usermodel')
      .then((m) => m.preloadUserModel())
      .catch(() => { /* procedural rig stays the fallback */ })
  }, [])

  // Same warm-up for the staged weapon GLBs (remote guns + knife viewmodel,
  // ~320 KB Draco total): parse during lobby time so the first match already
  // renders them. weapongltf memoizes, so engine/players re-calls are no-ops.
  useEffect(() => {
    void import('@/game/weapongltf')
      .then((m) => m.preloadWeaponModels())
      .catch(() => { /* procedural weapons stay the fallback */ })
  }, [])


  // server browser live list (lobby only)
  useEffect(() => {
    if (screen !== 'lobby') return
    const s = io('/?XTransformPort=3003', { path: '/' })
    watchSockRef.current = s
    s.on('connect', () => s.emit('watchServers'))
    s.on('serverList', (d: { servers: ServerEntry[] }) => setServers(d.servers ?? []))
    return () => { s.disconnect(); watchSockRef.current = null }
  }, [screen])

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
      if (cancelled || !canvasRef.current || !engineOptsRef.current) return
      const engine = new mod.Engine(canvasRef.current, {
        name: name.slice(0, 16) || 'Player',
        team,
        room: engineOptsRef.current.room,
        map: engineOptsRef.current.map,
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
  }, [screen])

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
    loadGenRef.current++           // cancel any in-flight load pipeline
    engineRef.current?.dispose()
    engineRef.current = null
    setOpen({ buy: false, chat: false })
    setHud(null)
    setLoadPhase(null)
    setScreen('lobby')
  }, [])

  const enterGame = useCallback((roomId: string, mapId: MapId) => {
    engineOptsRef.current = { room: roomId, map: mapId }
    setJoining(false)
    const gen = ++loadGenRef.current
    setLoadPhase({ stage: 'textures', done: 0, total: 1, pct: 0, cached: false })
    setScreen('game')   // engine mounts in parallel; its fetches dedupe into the preload
    ;(async () => {
      const t0 = performance.now()
      try {
        await preloadGameAssets(mapId, (p) => {
          if (loadGenRef.current !== gen) return
          setLoadPhase(l => l ? { ...l, stage: p.stage, done: p.done, total: p.total, pct: p.pct * 0.7 } : l)
        })
        if (loadGenRef.current !== gen) return
        const cached = performance.now() - t0 < 3000   // near-instant = IDB hits, not downloads
        // engine mounts on screen==='game' while the preload runs — wait for it
        let eng: Engine | null = null
        for (let i = 0; i < 100 && loadGenRef.current === gen; i++) {
          eng = engineRef.current
          if (eng) break
          await new Promise<void>(r => setTimeout(r, 100))
        }
        if (loadGenRef.current !== gen) return
        if (eng) {
          await eng.warmup((stage) => {
            if (loadGenRef.current !== gen) return
            setLoadPhase(l => l ? { ...l, stage: `warmup:${stage}`, pct: WARM_PCT[stage] ?? 0.9 } : l)
          })
        }
        if (loadGenRef.current !== gen) return
        setLoadPhase(l => l ? { ...l, stage: 'done', pct: 1, cached } : l)
        console.log(`[preload] match ready in ${((performance.now() - t0) / 1000).toFixed(1)}s${cached ? ' (cached)' : ''}`)
        setTimeout(() => { if (loadGenRef.current === gen) setLoadPhase(null) }, 300)
      } catch {
        if (loadGenRef.current === gen) setLoadPhase(null)   // never trap the player on the bar
      }
    })()
  }, [])

  const createServer = useCallback(() => {
    const s = watchSockRef.current
    if (!s || !s.connected) return
    setJoining(true)
    s.emit('createServer', {
      name: srvName.trim().slice(0, 32) || `${name.trim() || 'Player'}'s server`,
      map: srvMap,
      botFill,
      botDifficulty,
      winTarget,
      team,
    }, (r: { ok?: boolean; roomId?: string; mapId?: MapId }) => {
      if (r?.ok && r.roomId) {
        s.disconnect()
        watchSockRef.current = null
        enterGame(r.roomId, (r.mapId ?? srvMap) as MapId)
      } else {
        setJoining(false)
      }
    })
  }, [srvName, srvMap, botFill, botDifficulty, winTarget, team, name, enterGame])

  const joinServer = useCallback((srv: ServerEntry) => {
    const s = watchSockRef.current
    if (s) { s.disconnect(); watchSockRef.current = null }
    enterGame(srv.id, srv.map as MapId)
  }, [enterGame])

  // ---------------------------------------------------------------- lobby
  if (screen === 'lobby') {
    const mapButtons = (selected: MapId, onSelect: (m: MapId) => void, compact = false) => (
      <div className={`grid gap-1.5 ${compact ? 'grid-cols-2' : 'grid-cols-2'}`}>
        {MAP_LIST.map(m => (
          <button key={m.id} onClick={() => onSelect(m.id)}
            className={`rounded-md py-2.5 text-left transition ${selected === m.id
              ? 'bg-orange-600 text-white ring-1 ring-orange-400'
              : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700'}`}>
            <span className="block font-mono text-xs font-bold tracking-wider">{m.name.toUpperCase()}</span>
            {!compact && <span className="mt-0.5 block text-[10px] leading-tight text-zinc-400">{m.desc}</span>}
          </button>
        ))}
      </div>
    )

    const matchSettings = (
      <>
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
                {n === 16 ? '16' : n === 13 ? '13' : `first ${n}`}
              </button>
            ))}
          </div>
        </div>
      </>
    )

    return (
      <main className="min-h-screen bg-zinc-950 text-zinc-100">
        <div className="pointer-events-none fixed inset-0 opacity-[0.06]" style={{
          backgroundImage: 'radial-gradient(circle at 25% 25%, #eec37a 0, transparent 40%), radial-gradient(circle at 75% 75%, #7ab0e8 0, transparent 40%)',
        }} />
        <div className="relative mx-auto flex min-h-screen max-w-5xl flex-col items-center justify-center gap-6 px-4 py-10">
          <div className="text-center">
            <div className="mb-2 flex items-center justify-center gap-3">
              <span className="h-1 w-10 bg-orange-500/70" />
              <h1 className="text-4xl font-black tracking-[0.3em] text-orange-400 sm:text-5xl">DUST</h1>
              <span className="text-4xl font-black tracking-[0.1em] text-zinc-600 sm:text-5xl">/</span>
              <h1 className="text-4xl font-black tracking-[0.3em] text-zinc-100 sm:text-5xl">DUST&nbsp;2</h1>
              <span className="h-1 w-10 bg-orange-500/70" />
            </div>
            <p className="font-mono text-sm tracking-widest text-zinc-400">
              CS-STYLE WEB FPS · BOMB DEFUSAL · SERVER BROWSER · MULTIPLAYER
            </p>
          </div>

          {/* tabs */}
          <div className="flex w-full max-w-3xl gap-1.5">
            {(['quick', 'servers'] as const).map(t => (
              <button key={t} onClick={() => setTab(t)}
                className={`flex-1 rounded-lg py-2.5 font-mono text-xs font-bold tracking-widest transition ${tab === t
                  ? 'bg-zinc-100 text-zinc-900'
                  : 'bg-zinc-900 text-zinc-400 hover:bg-zinc-800'}`}>
                {t === 'quick' ? '▶ QUICK PLAY' : '🌐 FIND SERVERS'}
              </button>
            ))}
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

            {/* right: quick play or server browser */}
            {tab === 'quick' ? (
              <div className="rounded-xl border border-zinc-800 bg-zinc-900/80 p-5">
                <h2 className="mb-4 text-xs font-bold tracking-widest text-zinc-400">MATCH</h2>
                <div className="mb-3">
                  <span className="mb-1.5 block text-xs text-zinc-400">Map</span>
                  {mapButtons(map, setMap)}
                </div>
                {matchSettings}
                <label className="mb-4 block">
                  <span className="mb-1 block text-xs text-zinc-400">Room code <span className="text-zinc-600">(optional — friends with the same code play together)</span></span>
                  <Input value={room} onChange={e => setRoom(e.target.value.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 24))}
                    className="border-zinc-700 bg-zinc-950 font-mono uppercase" placeholder="random" />
                </label>
                <Button onClick={() => enterGame(room.trim() || `play-${Math.random().toString(36).slice(2, 8)}`, map)} size="lg"
                  className="h-12 w-full rounded-xl bg-orange-600 font-mono text-base font-black tracking-[0.2em] text-white shadow-lg shadow-orange-900/50 transition hover:bg-orange-500">
                  ▶ PLAY
                </Button>
              </div>
            ) : (
              <div className="flex flex-col rounded-xl border border-zinc-800 bg-zinc-900/80 p-5">
                <h2 className="mb-4 text-xs font-bold tracking-widest text-zinc-400">SERVER BROWSER</h2>
                {/* server list */}
                <div className="mb-4 min-h-[130px] max-h-72 overflow-y-auto rounded-lg border border-zinc-800 bg-zinc-950/70">
                  {servers.length === 0 ? (
                    <div className="flex h-[130px] items-center justify-center px-4 text-center font-mono text-xs text-zinc-500">
                      No servers yet — start one below and share it with friends
                    </div>
                  ) : servers.map(srv => (
                    <div key={srv.id} className="flex items-center gap-3 border-b border-zinc-800/60 px-3 py-2.5 last:border-0 hover:bg-zinc-900/60">
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-mono text-sm font-bold text-zinc-100">{srv.name}</div>
                        <div className="mt-0.5 flex items-center gap-2 font-mono text-[10px] text-zinc-500">
                          <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-zinc-300">{srv.mapName}</span>
                          <span>{srv.players}/{srv.max} players</span>
                          <span className={srv.phase === 'live' ? 'text-orange-400' : 'text-zinc-500'}>
                            {phaseLabel[srv.phase] ?? srv.phase}{srv.round > 0 ? ` · R${srv.round}` : ''}
                          </span>
                        </div>
                      </div>
                      <Button onClick={() => joinServer(srv)}
                        className="h-8 rounded-md bg-orange-600 px-4 font-mono text-xs font-bold tracking-wider text-white hover:bg-orange-500">
                        JOIN
                      </Button>
                    </div>
                  ))}
                </div>
                {/* create server */}
                <div className="mb-3">
                  <span className="mb-1.5 block text-xs text-zinc-400">Start your own server</span>
                  <Input value={srvName} onChange={e => setSrvName(e.target.value.slice(0, 32))}
                    className="mb-2 border-zinc-700 bg-zinc-950 font-mono" placeholder={`${name.trim() || 'Player'}'s server`} />
                  {mapButtons(srvMap, setSrvMap, true)}
                </div>
                {matchSettings}
                <Button onClick={createServer} disabled={joining} size="lg"
                  className="h-12 w-full rounded-xl bg-zinc-100 font-mono text-base font-black tracking-[0.2em] text-zinc-900 shadow-lg transition hover:bg-white disabled:opacity-50">
                  {joining ? 'STARTING…' : '⬆ START SERVER'}
                </Button>
              </div>
            )}
          </div>

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
  const mapMeta = MAP_LIST.find(m => m.id === engineOptsRef.current?.map)
  return (
    <div className="fixed inset-0 bg-black">
      <canvas ref={canvasRef} className="block h-full w-full" />
      {loadPhase ? (
        <LoadingOverlay phase={loadPhase} mapName={mapMeta?.name.toUpperCase() ?? 'MATCH'} />
      ) : hud ? (
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
            <p className="font-mono text-sm tracking-widest text-zinc-400">CONNECTING…</p>
          </div>
        </div>
      )}
    </div>
  )
}
