// scripts/island/types.ts — tiny shared types for the island generator
export type Rng = () => number
export interface Group {
  tex: string
  pos: number[]
  norm: number[]
  uv: number[]
  color: number[]
  idx: number[]
}
export type Groups = Map<string, Group>
/** server-side box: y = CENTER (matches MapDef Box) */
export interface PropBox { x: number; y: number; z: number; w: number; h: number; d: number }
export interface PropOut { boxes: PropBox[] }
/** the light function baked per-vertex: (position, normal) -> [0..~1.1] */
export type LightFn = (p: number[], n: number[]) => number
