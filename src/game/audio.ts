// CS:GO sample sound pack with WebAudio synth fallback.
// Accepted sounds: public/assets/sounds/*.ogg (committed). Pending sounds:
// public/staging/sounds/*.ogg (gitignored, still web-served). Loader tries
// the accepted copy first (steady state = one request), then the staged copy.
// Every public sound: real decoded sample if available -> procedural synth otherwise,
// so the game still sounds right if the pack fails to load (offline / old Safari).
export type Vec3 = [number, number, number]

// every sound file shipped in the pack (name == filename in /assets/sounds)
const FILES = [
  // per-weapon fire + distant variants
  'ak47_fire', 'ak47_distant', 'm4_fire', 'm4_distant', 'awp_fire', 'awp_distant',
  'deagle_fire', 'deagle_distant', 'mp5_fire', 'glock_fire', 'glock_distant',
  'usp_fire', 'usp_distant',
  // reload + draw, per weapon
  'ak47_clipout', 'ak47_clipin', 'ak47_bolt', 'ak47_draw',
  'm4_clipout', 'm4_clipin', 'm4_bolt', 'm4_draw',
  'awp_clipout', 'awp_clipin', 'awp_bolt', 'awp_boltforward', 'awp_draw',
  'deagle_clipout', 'deagle_clipin', 'deagle_slide', 'deagle_draw',
  'mp5_clipout', 'mp5_clipin', 'mp5_slide', 'mp5_draw',
  'glock_clipout', 'glock_clipin', 'glock_slide', 'glock_draw',
  'usp_clipout', 'usp_clipin', 'usp_slide', 'usp_draw',
  // knife
  'knife_draw', 'knife_slash1', 'knife_slash2', 'knife_hit1', 'knife_hit2', 'knife_wall', 'knife_stab',
  // C4
  'c4_beep1', 'c4_beep2', 'c4_click', 'c4_initiate', 'c4_plant', 'c4_explode',
  'c4_disarmstart', 'c4_disarmfinish', 'c4_draw', 'c4_key1', 'c4_key2',
  // empties
  'empty_pistol', 'empty_rifle',
  // player feedback
  'dink', 'headshot', 'hurt1', 'hurt2',
  // footsteps + impacts
  'foot_dirt1', 'foot_dirt2', 'foot_dirt3', 'foot_dirt4',
  'foot_conc1', 'foot_conc2', 'foot_conc3', 'foot_conc4',
  'impact1', 'impact2', 'impact3', 'impact4',
  // misc
  'buy', 'cant_buy', 'uiclick', 'zoom',
  // music stingers (default CS:GO music kit)
  'round_start', 'round_win', 'round_lose',
]

const DIR = '/assets/sounds/'
const STAGE_DIR = '/staging/sounds/'

// per-weapon sample tables
const FIRE: Record<string, string> = {
  ak47: 'ak47_fire', m4: 'm4_fire', awp: 'awp_fire', deagle: 'deagle_fire',
  mp5: 'mp5_fire', glock: 'glock_fire', usp: 'usp_fire',
}
const DISTANT: Record<string, string> = {
  ak47: 'ak47_distant', m4: 'm4_distant', awp: 'awp_distant', deagle: 'deagle_distant',
  glock: 'glock_distant', usp: 'usp_distant',
}
const RELOAD: Record<string, { out: string; in: string; rack: string }> = {
  ak47: { out: 'ak47_clipout', in: 'ak47_clipin', rack: 'ak47_bolt' },
  m4: { out: 'm4_clipout', in: 'm4_clipin', rack: 'm4_bolt' },
  awp: { out: 'awp_clipout', in: 'awp_clipin', rack: 'awp_bolt' },
  deagle: { out: 'deagle_clipout', in: 'deagle_clipin', rack: 'deagle_slide' },
  mp5: { out: 'mp5_clipout', in: 'mp5_clipin', rack: 'mp5_slide' },
  glock: { out: 'glock_clipout', in: 'glock_clipin', rack: 'glock_slide' },
  usp: { out: 'usp_clipout', in: 'usp_clipin', rack: 'usp_slide' },
}
const DRAW: Record<string, string> = {
  ak47: 'ak47_draw', m4: 'm4_draw', awp: 'awp_draw', deagle: 'deagle_draw',
  mp5: 'mp5_draw', glock: 'glock_draw', usp: 'usp_draw',
  knife: 'knife_draw', c4: 'c4_draw',
}
const PISTOLS = new Set(['deagle', 'glock', 'usp'])

const pick = <T,>(arr: T[]): T => arr[(Math.random() * arr.length) | 0]

export class GameAudio {
  private ctx: AudioContext | null = null
  private master: GainNode | null = null
  private noiseBuf: AudioBuffer | null = null
  private buffers = new Map<string, AudioBuffer>()
  private packErrors: string[] = []
  private packStarted = false
  private playCount = 0
  private lastAwkBolt = 0
  // camera forward (horizontal), updated by the engine each frame — drives stereo panning
  private fwd: Vec3 = [0, 0, -1]
  volume = 0.8

  init() {
    if (this.ctx) return
    try {
      this.ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)()
      this.master = this.ctx.createGain()
      this.master.gain.value = this.volume
      this.master.connect(this.ctx.destination)
      // shared noise buffer for the synth fallbacks
      const len = this.ctx.sampleRate * 1.2
      this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate)
      const d = this.noiseBuf.getChannelData(0)
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1
    } catch { /* audio unavailable */ }
  }

  /** fetch + decode the whole pack; sounds fall back to synth until (and if) loaded */
  loadPack() {
    if (!this.ctx || this.packStarted) return
    this.packStarted = true
    for (const name of FILES) {
      this.loadSound(name)
    }
  }

  /** accepted copy first, pending staging copy as fallback (asset-acceptance policy v3) */
  private async loadSound(name: string) {
    for (const dir of [DIR, STAGE_DIR]) {
      try {
        const r = await fetch(dir + name + '.ogg')
        if (!r.ok) continue
        const ab = await r.arrayBuffer()
        const buf = await this.ctx!.decodeAudioData(ab)
        this.buffers.set(name, buf)
        return
      } catch { /* try the next directory */ }
    }
    this.packErrors.push(name)
  }

  setVolume(v: number) {
    this.volume = v
    if (this.master) this.master.gain.value = v
  }

  resume() { this.ctx?.resume() }

  /** engine calls this every frame with the camera world forward, for stereo panning */
  setListener(forward: Vec3) { this.fwd = forward }

  info() {
    return {
      total: FILES.length,
      loaded: this.buffers.size,
      errors: this.packErrors,
      plays: this.playCount,
      ctxState: this.ctx?.state ?? 'no-ctx',
    }
  }

  // ---------------------------------------------------------------- sample player
  private play(name: string, opts: { gain?: number; pan?: number; rate?: number; variance?: number } = {}): boolean {
    if (!this.ctx || !this.master) return false
    const buf = this.buffers.get(name)
    if (!buf) return false
    try {
      const src = this.ctx.createBufferSource()
      src.buffer = buf
      const v = opts.variance ?? 0
      src.playbackRate.value = (opts.rate ?? 1) * (1 + (Math.random() * 2 - 1) * v)
      const g = this.ctx.createGain()
      g.gain.value = opts.gain ?? 1
      src.connect(g)
      let tail: AudioNode = g
      if (opts.pan !== undefined && typeof this.ctx.createStereoPanner === 'function') {
        const p = this.ctx.createStereoPanner()
        p.pan.value = Math.max(-0.85, Math.min(0.85, opts.pan))
        g.connect(p)
        tail = p
      }
      tail.connect(this.master)
      src.start()
      this.playCount++
      return true
    } catch { return false }
  }

  // distance attenuation + stereo pan from the listener's facing
  private spatial(pos?: Vec3, self?: Vec3): { gain: number; pan: number; far: boolean } {
    if (!pos || !self) return { gain: 1, pan: 0, far: false }
    const dx = pos[0] - self[0], dy = pos[1] - self[1], dz = pos[2] - self[2]
    const d = Math.hypot(dx, dy, dz)
    const gain = Math.max(0.05, Math.min(1, 1 - d / 55))
    const hl = Math.hypot(dx, dz) || 1
    const fl = Math.hypot(this.fwd[0], this.fwd[2]) || 1
    // camera right = (-fz, fx) of the horizontal forward
    const pan = ((dx / hl) * (-this.fwd[2] / fl) + (dz / hl) * (this.fwd[0] / fl)) * 0.8
    return { gain, pan, far: d > 30 }
  }

  // ---------------------------------------------------------------- synth fallbacks
  private noise(dur: number, filterFreq: number, gain: number, type: BiquadFilterType = 'lowpass', q = 1): void {
    if (!this.ctx || !this.master || !this.noiseBuf) return
    const src = this.ctx.createBufferSource()
    src.buffer = this.noiseBuf
    const f = this.ctx.createBiquadFilter()
    f.type = type; f.frequency.value = filterFreq; f.Q.value = q
    const g = this.ctx.createGain()
    const t = this.ctx.currentTime
    g.gain.setValueAtTime(gain, t)
    g.gain.exponentialRampToValueAtTime(0.001, t + dur)
    src.connect(f); f.connect(g); g.connect(this.master)
    src.start(t, Math.random() * 0.5, dur)
    src.stop(t + dur)
  }

  private tone(freq: number, dur: number, gain: number, type: OscillatorType = 'sine', freqEnd?: number): void {
    if (!this.ctx || !this.master) return
    const o = this.ctx.createOscillator()
    o.type = type
    const t = this.ctx.currentTime
    o.frequency.setValueAtTime(freq, t)
    if (freqEnd) o.frequency.exponentialRampToValueAtTime(Math.max(1, freqEnd), t + dur)
    const g = this.ctx.createGain()
    g.gain.setValueAtTime(gain, t)
    g.gain.exponentialRampToValueAtTime(0.001, t + dur)
    o.connect(g); g.connect(this.master)
    o.start(t); o.stop(t + dur)
  }

  private att(pos?: Vec3, self?: Vec3): number {
    if (!pos || !self) return 1
    const d = Math.hypot(pos[0] - self[0], pos[1] - self[1], pos[2] - self[2])
    return Math.max(0.05, Math.min(1, 1 - d / 55))
  }

  // ---------------------------------------------------------------- weapons
  gunshot(weapon: string, pos?: Vec3, self?: Vec3) {
    const s = this.spatial(pos, self)
    const wid = FIRE[weapon] ? weapon : weapon === 'mp5' ? 'mp5' : weapon
    const fire = FIRE[wid] ?? FIRE[weapon]
    if (fire) {
      let name = fire
      if (s.far && DISTANT[wid]) name = DISTANT[wid]
      const gain = pos ? 0.48 * s.gain : 0.5
      if (this.play(name, { gain, pan: s.pan, variance: 0.04 })) {
        // AWP rechambers audibly after every nearby shot
        if (weapon === 'awp' && !s.far) {
          const now = performance.now()
          if (now - this.lastAwkBolt > 700) {
            this.lastAwkBolt = now
            setTimeout(() => this.play('awp_bolt', { gain: 0.38, variance: 0.03 }), 300)
          }
        }
        return
      }
    }
    // synth fallback
    const a = this.att(pos, self)
    switch (weapon) {
      case 'awp':
        this.noise(0.35, 900, 0.9 * a)
        this.noise(0.5, 180, 0.7 * a)
        this.tone(140, 0.3, 0.5 * a, 'square', 40)
        break
      case 'ak47':
        this.noise(0.16, 1600, 0.7 * a)
        this.tone(180, 0.12, 0.4 * a, 'square', 60)
        this.noise(0.25, 300, 0.45 * a)
        break
      case 'm4':
        this.noise(0.13, 2100, 0.6 * a)
        this.tone(220, 0.1, 0.3 * a, 'square', 80)
        break
      case 'mp5':
        this.noise(0.09, 2600, 0.5 * a)
        this.tone(260, 0.07, 0.25 * a, 'square', 120)
        break
      case 'deagle':
        this.noise(0.22, 1200, 0.8 * a)
        this.tone(120, 0.2, 0.5 * a, 'square', 35)
        break
      case 'glock': case 'usp':
        this.noise(0.12, 2400, 0.55 * a)
        this.tone(300, 0.08, 0.2 * a, 'square', 150)
        break
      default:
        this.noise(0.14, 1800, 0.6 * a)
    }
  }

  /** staged reload sfx: 'out' mag release, 'in' mag seat, 'rack' charging handle/slide */
  reloadStage(weapon: string, stage: 'out' | 'in' | 'rack') {
    const r = RELOAD[weapon]
    if (r) {
      if (this.play(r[stage], { gain: 0.5, variance: 0.02 })) return
    }
    if (stage === 'out') this.reloadClick()
    else if (stage === 'in') this.reloadMagIn()
    else this.reloadSlide()
  }

  /** weapon raise sound on switch */
  draw(weapon: string) {
    const d = DRAW[weapon]
    if (d && this.play(d, { gain: 0.45, variance: 0.02 })) return
    this.switchWeapon()
  }

  dryFire(weapon?: string) {
    if (weapon && PISTOLS.has(weapon) && this.play('empty_pistol', { gain: 0.4 })) return
    if (weapon && this.play('empty_rifle', { gain: 0.4 })) return
    this.tone(900, 0.04, 0.2, 'square')
  }

  zoom() {
    if (this.play('zoom', { gain: 0.35 })) return
    this.tone(1200, 0.06, 0.2, 'sine', 800)
  }

  /** bullet impact on the map near a hit point */
  impact() {
    if (this.play(pick(['impact1', 'impact2', 'impact3', 'impact4']), { gain: 0.28, variance: 0.05 })) return
    this.noise(0.05, 1800, 0.15)
  }

  // ---------------------------------------------------------------- knife
  knifeSwing() {
    if (this.play(pick(['knife_slash1', 'knife_slash2']), { gain: 0.3, variance: 0.06 })) return
    this.noise(0.12, 3000, 0.25, 'bandpass', 2)
  }
  knifeHit() {
    if (this.play(pick(['knife_hit1', 'knife_hit2']), { gain: 0.45, variance: 0.04 })) return
    this.noise(0.1, 700, 0.5); this.tone(200, 0.08, 0.3, 'triangle', 90)
  }
  knifeStab() { if (this.play('knife_stab', { gain: 0.5 })) return this.knifeHit() }

  // ---------------------------------------------------------------- feedback
  hitmarker() { this.tone(1150, 0.05, 0.35, 'square') }
  headshotDing() {
    // the classic CS:GO helmet dink
    if (this.play('dink', { gain: 0.55 })) return
    this.tone(1800, 0.09, 0.45, 'sine', 1200); this.tone(2400, 0.07, 0.3, 'sine')
  }
  damageTaken() {
    if (this.play(pick(['hurt1', 'hurt2']), { gain: 0.4 })) return
    this.tone(160, 0.18, 0.5, 'sawtooth', 70); this.noise(0.15, 500, 0.3)
  }
  death() { this.tone(90, 0.9, 0.6, 'sawtooth', 30) }

  // ---------------------------------------------------------------- reload synth fallbacks
  reloadClick() {
    this.tone(700, 0.04, 0.25, 'square')
    setTimeout(() => this.tone(500, 0.05, 0.25, 'square'), 120)
    setTimeout(() => this.noise(0.06, 1500, 0.3), 240)
  }

  reloadMagIn() {
    this.tone(420, 0.05, 0.3, 'square', 200)
    setTimeout(() => this.tone(310, 0.06, 0.3, 'square', 140), 70)
    this.noise(0.05, 900, 0.25)
  }

  reloadSlide() {
    this.noise(0.08, 2000, 0.35)
    setTimeout(() => this.noise(0.07, 1400, 0.4), 90)
    setTimeout(() => this.tone(520, 0.05, 0.3, 'square', 240), 170)
  }

  // ---------------------------------------------------------------- C4
  bombBeep(urgent: boolean) {
    if (this.play(urgent ? 'c4_beep2' : 'c4_beep1', { gain: 0.5 })) return
    this.tone(urgent ? 2200 : 1750, 0.07, 0.4, 'sine')
  }
  c4Initiate() {
    if (this.play('c4_initiate', { gain: 0.45 })) return
    this.tone(880, 0.15, 0.3, 'sine', 660)
  }
  c4DisarmStart() {
    if (this.play('c4_disarmstart', { gain: 0.45 })) return
    this.tone(300, 0.15, 0.3, 'sawtooth', 200)
  }
  bombPlanted() {
    if (this.play('c4_plant', { gain: 0.5 })) return
    this.tone(880, 0.3, 0.4, 'sine', 440); setTimeout(() => this.tone(880, 0.3, 0.4, 'sine', 440), 350)
  }
  bombExplode() {
    if (this.play('c4_explode', { gain: 0.95 })) return
    this.noise(1.2, 400, 1.0)
    this.tone(60, 1.0, 0.9, 'sine', 20)
    this.noise(0.8, 150, 0.8)
  }
  bombDefused() {
    if (this.play('c4_disarmfinish', { gain: 0.5 })) return
    this.tone(600, 0.15, 0.4, 'sine'); setTimeout(() => this.tone(800, 0.2, 0.4, 'sine'), 160); setTimeout(() => this.tone(1000, 0.3, 0.4, 'sine'), 380)
  }

  plantTick() {
    if (this.play(pick(['c4_key1', 'c4_key2']), { gain: 0.35 })) return
    this.tone(1400, 0.05, 0.3, 'square')
  }

  // ---------------------------------------------------------------- round jingles
  roundStart() {
    if (this.play('round_start', { gain: 0.38 })) return
    this.tone(520, 0.12, 0.35, 'sine'); setTimeout(() => this.tone(720, 0.15, 0.35, 'sine'), 140)
  }
  roundWin() {
    if (this.play('round_win', { gain: 0.38 })) return
    ;[660, 880, 1100].forEach((f, i) => setTimeout(() => this.tone(f, 0.25, 0.4, 'sine'), i * 180))
  }
  roundLose() {
    if (this.play('round_lose', { gain: 0.38 })) return
    ;[440, 330, 220].forEach((f, i) => setTimeout(() => this.tone(f, 0.3, 0.4, 'sine'), i * 200))
  }

  // ---------------------------------------------------------------- movement
  footstep(self: boolean) {
    // Dust maps: mostly sandy dirt, some concrete
    const pool = Math.random() < 0.7
      ? ['foot_dirt1', 'foot_dirt2', 'foot_dirt3', 'foot_dirt4']
      : ['foot_conc1', 'foot_conc2', 'foot_conc3', 'foot_conc4']
    if (this.play(pick(pool), { gain: self ? 0.16 : 0.28, variance: 0.05 })) return
    this.noise(0.07, self ? 600 : 350, self ? 0.12 : 0.2)
  }

  // ---------------------------------------------------------------- ui / items
  buy() {
    if (this.play('buy', { gain: 0.5 })) return
    this.tone(880, 0.08, 0.3, 'square'); setTimeout(() => this.tone(1320, 0.1, 0.3, 'square'), 90)
  }
  cantBuy() {
    if (this.play('cant_buy', { gain: 0.45 })) return
    this.tone(220, 0.12, 0.3, 'square', 180)
  }
  uiClick() {
    if (this.play('uiclick', { gain: 0.3 })) return
    this.tone(700, 0.03, 0.15, 'square')
  }
  switchWeapon() { this.noise(0.08, 2000, 0.25, 'bandpass', 3) }
}

export const audio = new GameAudio()
