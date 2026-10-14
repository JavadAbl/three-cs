// WebAudio synthesized game sounds — no audio files needed
export class GameAudio {
  private ctx: AudioContext | null = null
  private master: GainNode | null = null
  private noiseBuf: AudioBuffer | null = null
  volume = 0.8

  init() {
    if (this.ctx) return
    try {
      this.ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)()
      this.master = this.ctx.createGain()
      this.master.gain.value = this.volume
      this.master.connect(this.ctx.destination)
      // shared noise buffer
      const len = this.ctx.sampleRate * 1.2
      this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate)
      const d = this.noiseBuf.getChannelData(0)
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1
    } catch { /* audio unavailable */ }
  }

  setVolume(v: number) {
    this.volume = v
    if (this.master) this.master.gain.value = v
  }

  resume() { this.ctx?.resume() }

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

  // distance-attenuated positional helper
  private att(pos?: [number, number, number], self?: [number, number, number]): number {
    if (!pos || !self) return 1
    const d = Math.hypot(pos[0] - self[0], pos[1] - self[1], pos[2] - self[2])
    return Math.max(0.05, Math.min(1, 1 - d / 55))
  }

  gunshot(weapon: string, pos?: [number, number, number], self?: [number, number, number]) {
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

  knifeSwing() { this.noise(0.12, 3000, 0.25, 'bandpass', 2) }
  knifeHit() { this.noise(0.1, 700, 0.5); this.tone(200, 0.08, 0.3, 'triangle', 90) }

  hitmarker() { this.tone(1150, 0.05, 0.35, 'square') }
  headshotDing() { this.tone(1800, 0.09, 0.45, 'sine', 1200); this.tone(2400, 0.07, 0.3, 'sine') }
  damageTaken() { this.tone(160, 0.18, 0.5, 'sawtooth', 70); this.noise(0.15, 500, 0.3) }
  death() { this.tone(90, 0.9, 0.6, 'sawtooth', 30) }

  reloadClick() {
    this.tone(700, 0.04, 0.25, 'square')
    setTimeout(() => this.tone(500, 0.05, 0.25, 'square'), 120)
    setTimeout(() => this.noise(0.06, 1500, 0.3), 240)
  }

  reloadMagIn() { // heavier double click: magazine seats
    this.tone(420, 0.05, 0.3, 'square', 200)
    setTimeout(() => this.tone(310, 0.06, 0.3, 'square', 140), 70)
    this.noise(0.05, 900, 0.25)
  }

  reloadSlide() { // slide/bolt rack at the end of the reload
    this.noise(0.08, 2000, 0.35)
    setTimeout(() => this.noise(0.07, 1400, 0.4), 90)
    setTimeout(() => this.tone(520, 0.05, 0.3, 'square', 240), 170)
  }

  dryFire() { this.tone(900, 0.04, 0.2, 'square') }

  bombBeep(urgent: boolean) {
    this.tone(urgent ? 2200 : 1750, 0.07, 0.4, 'sine')
  }
  bombPlanted() { this.tone(880, 0.3, 0.4, 'sine', 440); setTimeout(() => this.tone(880, 0.3, 0.4, 'sine', 440), 350) }
  bombExplode() {
    this.noise(1.2, 400, 1.0)
    this.tone(60, 1.0, 0.9, 'sine', 20)
    this.noise(0.8, 150, 0.8)
  }
  bombDefused() { this.tone(600, 0.15, 0.4, 'sine'); setTimeout(() => this.tone(800, 0.2, 0.4, 'sine'), 160); setTimeout(() => this.tone(1000, 0.3, 0.4, 'sine'), 380) }

  plantTick() { this.tone(1400, 0.05, 0.3, 'square') }

  roundStart() { this.tone(520, 0.12, 0.35, 'sine'); setTimeout(() => this.tone(720, 0.15, 0.35, 'sine'), 140) }
  roundWin() { [660, 880, 1100].forEach((f, i) => setTimeout(() => this.tone(f, 0.25, 0.4, 'sine'), i * 180)) }
  roundLose() { [440, 330, 220].forEach((f, i) => setTimeout(() => this.tone(f, 0.3, 0.4, 'sine'), i * 200)) }

  footstep(self: boolean) {
    this.noise(0.07, self ? 600 : 350, self ? 0.12 : 0.2)
  }

  buy() { this.tone(880, 0.08, 0.3, 'square'); setTimeout(() => this.tone(1320, 0.1, 0.3, 'square'), 90) }
  switchWeapon() { this.noise(0.08, 2000, 0.25, 'bandpass', 3) }
}

export const audio = new GameAudio()
