// ============================================================
// Server weapon-module shim (Phase 1: single source of truth)
// ============================================================
// The canonical weapon table lives in shared/weapons.ts — this file only
// re-exports it so existing relative imports ('./weapons') keep working.
// NEVER define stats here; edit shared/weapons.ts. scripts/test-buymenu.ts
// asserts both shims resolve to the same module (object identity).
export * from '../../shared/weapons'
