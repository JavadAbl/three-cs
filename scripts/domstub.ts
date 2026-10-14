// DOM stub for running three.js canvas-texture code under bun (no browser).
// Must be imported FIRST in any script that imports src/game/textures.ts transitively.
function fakeCtx(): Record<string, unknown> {
  const ctx: Record<string, unknown> = {
    canvas: {},
    createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }),
    createLinearGradient: () => ({ addColorStop: () => undefined }),
    createRadialGradient: () => ({ addColorStop: () => undefined }),
    measureText: () => ({ width: 10 }),
    getImageData: () => ({ data: new Uint8ClampedArray(4) }),
  }
  return new Proxy(ctx, {
    get(t, k) {
      if (k in t) return t[k]
      return () => undefined // any unknown method call no-ops
    },
    set() { return true },
  }) as Record<string, unknown>
}
function fakeCanvas(): Record<string, unknown> {
  return { width: 0, height: 0, style: {}, getContext: () => fakeCtx() }
}
;(globalThis as Record<string, unknown>).document = { createElement: () => fakeCanvas() }
;(globalThis as Record<string, unknown>).window = { devicePixelRatio: 1 }
