# three-cs — project worklog (compacted)

> **Compacted in Task 133** (user: "compact worklog and scripts and unused
> files"; previously compacted in Task 122). This file keeps only: the live
> state snapshot, the standing rules/protocols, and a one-line ledger of
> every task. Full narratives are recoverable from git:
> Task-122-era history `git show 67e81f6:worklog.md`;
> Task 123–132 narratives `git show 2fca833:worklog.md`.

## Current state snapshot (as of Task 133)

- **Game**: CS-style web FPS. 6 maps (dust, dust2, aim_headshot + cs_office CS 1.6
  BSP imports, aimdepot night, island tropical day). cs_office accepted as v1 in
  Task 130 (user: many issues to improve later — see Task-127 known-limitations
  list). island accepted as v1 in Task 132 (user: "island accepted" — PBR+HDRI
  look; polish backlog queued: floating dock piece near B, palm frond polys,
  grass macro variation, ocean shader pass Task 134). Full 42-entry weapon roster (CS 1.6 category buy menu,
  team-filtered), 6 grenades, C4 defusal, 5v5 bot fill (easy/normal/hard),
  economy + kill rewards, CS-style recoil, quick-switch/reload-cancel, directional
  damage indicators, outline crosshair.
- **Player models**: CT = `human.glb` (soldier, accepted Task 117, sha `cdd14b1d…`),
  T = `rebel.glb` (accepted Task 116, sha `8f06fbf5…`); weapons held in hands
  (gripGap 0.022 m), human-scale. User models for 6 weapons (ak47/ak74/aug/
  famas/galil/m4) + night sky GLBs accepted. All committed in `public/assets/`.
- **Sounds**: 256-file authentic CS:GO pack (`public/assets/sounds/`, 44.1 kHz
  Vorbis q3) incl. the 4 announcer lines now using the REAL CS radio announcer
  from sourcesounds/csgo (Task 120). User's own fire recordings kept for
  ak74_fire + m4_fire. Raw sourcesounds clone (10,223 CS:GO sounds, gitignored)
  at `assets/packs/sourcesounds-csgo/` for future grabs.
- **Island regen chain (wipe-resilient, Task 132 proof)**: `scripts/bsp/island-regen.sh`
  = `bun scripts/island/gen.ts` (deterministic, geom sha256 cbea66a6) ->
  `hf-tar-index.py` 0..7 -> `extract-island-hf.py` -> `extract-island-sky.py` ->
  `bake-island-textures.py`. Proven end-to-end after the 5th container wipe
  (39 min, byte-identical geom). Committed assets = the durable line.
- **PAT status**: rotation concerns WAIVED by the user ("forgot about token
  concerns") — reminders dropped permanently.
- **Servers**: web `bun run dev` :3000, game server `mini-services/game-server`
  (bun --hot) :3003, platform proxy :81 (**live multiplayer/verification must
  enter via http://localhost:81/ — the socket uses the XTransformPort=3003
  convention; :3000 direct never connects the game socket**).
- **Regression suites** (`bun scripts/test-*.ts`, all green): audio-map 336,
  buymenu 235, rebel-t115 37, gunhold-t114 24, bots 26, cache-t111 28, phases
  3–9 + bots/e2e suites, dust/dust2/aimdepot/aimhead, money, game-server,
  serverlist, feel-t109, reload, tint, user-glb/rig, office 11/11 (Task 130),
  island live harness (Task 132). `npx tsc --noEmit`:
  src+shared clean (31 pre-existing lines in examples//scripts/bsp are
  unchanged noise).

## Standing rules & protocols

1. **Asset-acceptance policy v3** (user rule, Tasks 22–26): `public/assets/`
   holds ONLY accepted, committed running assets. New binaries land in
   `public/staging/` (gitignored but web-served; loaders try /assets/ first,
   /staging/ fallback). Acceptance = explicit user approval, then
   `mv public/staging/<x> public/assets/<x> && git add`. Never drop new
   binaries directly into /assets/. Re-shipping an accepted body needs an
   `ASSET_CACHE_VERSION` bump (BUMP RULE, Task 104) so browsers refetch.
2. **Push protocol**: PATs are used inline in the push URL ONLY — never stored
   in git config, env files or logs; echoed output scrubbed. Every PAT is
   chat-exposed → user revokes after use; next push gets a fresh token.
   Repo: github.com/JavadAbl/three-cs (main). The remote is the only durable
   line — commit before the container can roll back.
   (Task 132: user waived PAT-rotation concerns — no further reminders.)
3. **Session health probe** (Task 119 lesson, run on every session start):
   `git log --oneline -1` (HEAD at latest pushed task?) ·
   `ls public/assets/models/` (player models present?) ·
   `grep ASSET_CACHE_VERSION src/game/preloader.ts` (version current? —
   now **v12**). A rolled-back container is silent — it "works" while serving
   month-old state. Container restarts may flip +x bits on tracked files
   (mode-only noise; verify with `git diff --summary`, reset with chmod,
   never content-restore).
4. **Live verification**: enter via :81 (see above). Debug surface `__eng.*`
   (state/teleport/players/glbTeams/sfx/skinBBox/vmProbe…) in src/game/engine.ts.
   Audio debug: `__eng.sfx()` → { loaded, errors, announceLog }.
5. **Announcer sounds**: the 4 `announce_*.ogg` are the genuine CS radio
   announcer (Task 120). Do NOT run `make-announcer-sounds-t98.sh` unless
   deliberately rolling back to TTS. TTS originals recoverable from commit 7ef919b.
6. **User-kept recordings**: ak74_fire.ogg + m4_fire.ogg are the user's own —
   never overwrite with pack samples.
7. **Scripts hygiene** (Tasks 122 + 133): scripts/ = tools, pipelines, and
   regression suites ONLY. One-off diagnostics (screenshots, VLM dumps,
   probe JSONs, per-task browser scripts, shot dirs) are deleted on sight —
   recoverable from git (`git show 2fca833` era) if ever needed. Before
   deleting anything, cross-check with rg against src/, shared/,
   mini-services/, package.json and kept scripts.
8. **All GLB traffic rides extensionless POST /api/assets routes**
   (Task 135, from the Task 22/23 lessons): NO client code may ever fetch a
   URL ending in `.glb` — the user's IDM extension pattern-matches the
   extension, captures the download, and (pre-Task-135) let the fetch resolve
   WITHOUT its body, wedging the preload forever (room stuck in server
   'warmup'). A new GLB family = new API route (staging-wins, ETag+mtime
   cache) + ROUTE_RE family in preloader.ts. The 45s netGuard now bounds
   BOTH the header and body phases of every cached fetch, so no hijacked or
   dead asset fetch can wedge the loading bar again.

## Task ledger (one line each; full detail in git history)

ID | Task
--- | ---
1 | Build a full-stack CS2 clone web game (Dust2 map, headshot aim, multiplayer with friends, self-deployable)
2 | v2 overhaul — fix map layout + physics problems reported by the player after first playtest
3 | v5c — eliminate geometry overlap / ghost / phantom meshes reported after the visual-fidelity pass
4 | fix "reloading don't work" reported after v5c
5 | rename current map to Dust, build real Dust II, add map selection + CS 1.6-style server browser
10 | weapon texture pass — attach REAL image textures to the weapons (user request "can we attach textures to weapons too?" → "yes"); rebuild of the detailed weapon models
11 | re-integrate the weapon sound pack (user request) — replaces the Task-8 pack lost in the sandbox re-provision
12 | push the project to the user's GitHub repo (JavadAbl/three-cs) as a progress backup, minus unused screenshots
13 | fix 3 gameplay bugs reported by user (weapons persist after death / scoreboard not updating after kills / no money added after rounds)
14 | import CS 1.6 BSP map (aim_headshot) into the game — full BSP v30 → three.js/mapdef converter pipeline
15 | fix "character falls out of the terrain" on aim_headshot (BSP-converted map)
16 | fix "climbing the ramp makes you fall into the ramp" on aim_headshot
17 | fix aim_headshot ramp issues — (1) left side of ramp has no texture (see terrain through it, invisible collision), (2) ramp start blocked ("something blocking to going 
16 | Push latest updates (ramp bug fixes) to GitHub backup repo
18 | replace cube players with real soldier models + textures (user request)
19 | replace procedural soldier players with real GLB models + animations (user request "add player model and texture")
20 | push pending commits to GitHub with fresh PAT — user policy: "dont push downloaded/uploaded contents. just actual running assets"
21 | replace Mixamo Vanguard with the user's uploaded model (glb.rar) — auto-rig it for full animation
22 | bug — "after i start a game, it download human.glb to browser" + user policy: never commit/push new model/assets until explicitly accepted
23 | user report — IDM extension auto-downloads human.glb on the menu at preview-chat-<chatid>.space-z.ai/assets/models/human.glb
24 | environment rollback recovery + permanent asset-acceptance policy (user asked to persist the rule)
25 | user provided GitHub PAT → execute pending remote history purge (Task 24 follow-up)
26 | user requested staging-based asset policy — "ignore staging folder instead, after submitted move them to assets" (public/assets = committed running assets)
27 | user asked "did u add this to your rules docs?" → gap found (no AGENTS.md/CLAUDE.md existed), created AGENTS.md
28 | user ordered "long multi-phase plan for creating all weapons + CS 1.6 category-based buy menu"
29 | WEAPONS_PLAN.md Phase 0 — CS 1.6-style category buy menu (user: "Start with Phase 0")
30 | Push Phase 0 commit to remote main (user: "push phase 0 commit")
31 | Store PAT for future pushes (user: "use this token for future pushes")
32 | Align repo with user's push-content rule: "no screenshots, no downloaded/uploaded/staged contents, only production assets"
33 | WEAPONS_PLAN.md Phase 1 — single source of truth for weapon stats + schema extensions
34 | Repair environment wipe that struck between Phase 1 commit and push
35 | WEAPONS_PLAN.md Phase 2 — data-driven audio map + stage all new-weapon samples
36 | WEAPONS_PLAN.md Phase 3 — pistols ×8 (p250, five-seven, tec-9, cz75, dual berettas, p2000, R8 revolver, zeus)
37 | WEAPONS_PLAN.md Phase 4 — SMGs ×6 (mp9, mac-10, mp7, ump-45, p90, bizon)
38 | WEAPONS_PLAN.md Phase 5 — rifles ×8 (galil, famas, sg553, aug, ssg08, scar-20, g3sg1, m4a1-s) + three new mechanics: burst fire, multi-level scopes, suppression
39 | WEAPONS_PLAN.md Phase 6 — shotguns ×4 (nova, xm1014, mag-7, sawed-off) + multi-pellet ballistics, the first server hit-reg change
40 | WEAPONS_PLAN.md Phase 7 — machine guns ×2 (m249, negev) + the negev accuracy ramp (spool)
41 | Phase 8 — grenades & equipment (WEAPONS_PLAN.md 8.1-8.4), finishing the interrupted in-progress implementation and landing the acceptance stack
42 | WEAPONS_PLAN.md Phase 9 — balance, polish, acceptance sweep (plan 9.1–9.2; 9.3 list prepared for user)
43 | Re-provision push credentials (platform wipe deleted ~/.git-credentials) and push the unpushed Phase 9 commit
44 | 9.3 asset acceptance (user: "ok they are good") + the icon-orientation fix (user: "buy icons should rotate 180 degree. the weapons magazine are in top.")
45 | Record the user's environment-recovery rule (sandbox restart → pull from remote first)
46 | Decide the weapon model format (user question: "which kind of models do u use for weapons? glb?")
47 | Draco compression for GLBs (user question: "can u compress glb files with draco for fit in web games?")
48 | GLB inventory — list files in use vs missing (user question)
49 | Restore git push auth with the user-provided PAT, pull & push (user: "use this to pull & push")
50 | Remove human.glb — user formally REJECTS the previous player model ("remove human.glb. i dont want it. i find better one later")
51 | Evaluate the user's Drive weapon pack ("Ultimate Gun Pack - July 2019") for suitability
52 | Evaluate the user-uploaded "Ultimate Guns Pack-glb.zip" (poly.pizza GLB bundle) for the weapon GLB pipeline
53 | Wire the weapon-GLB loader branch + stage the Quaternius pack as remote guns and knife viewmodel (user approved with "ok")
54 | First-person gun viewmodels still showed the OLD procedural models — user: "but in first person camera i see old models in hand"
55 | Wipe ALL weapon models — user: "wipe all weapon models . they are not good, il find new models"
56 | Restore git push auth with the user-provided PAT, push the Task 55 commits (user: "<PAT>")
57 | Stage the user-uploaded Sketchfab "ak-47.glb" for live evaluation (user: "i upload ak-47.glb")
58 | First-person AK sits too close — "in first person camera, it should go back a little. Gun stock is completely in screen"
59 | AK viewmodel still shows a stock wedge after the 0.13 pull-back (user: "it is better but it need to go back yet") — pull it back further
60 | User asked "status" — routine check surfaced that public/staging was WIPED by a gitignored-paths cleanup at 2026-10-20 04:12 UTC: the staged ak47.glb, scripts/.tmp (bak
61 | Position approved (user: "its position is good now") — reduce the first-person AK size a little (user: "can reduce its size a little now?")
62 | User supplied the Sketchfab source URL and asked "ok do magazine works" — license check + acceptance decision + wire the real bm_magazine* nodes into the reload animati
63 | User waived the license concern ("forgot about licence at all. i dont want publish this game. i want it for dev porpuses only") — do the pending ak47 ACCEPTANCE (dev-on
64 | User asked for "wiring the AK's dust cover/barrel nodes for a slide-back animation on fire" (the Task 62 follow-up)
65 | User: "push updates" — pushed the 12 locally-stranded commits to GitHub (user supplied a fine-grained PAT in chat)
66 | User: "add ak74 for terror. i upload both glb and mp3 sound" — full AK-74M weapon integration (user's own model + fire recording)
67 | User: "accept ak74" — accept the Task-66 staged AK-74M binaries (model + fire sound + buy icon) into committed assets, dev-only like ak47
68 | User supplied a fresh fine-grained PAT in chat (implicit "push the stranded commits" per Task 65 protocol) — push the 3 local-only commits (Tasks 66-67) to GitHub
70 | Recover from platform environment reset + re-integrate the Galil AR with CORRECT orientation (user: "status", following "the weapon is reverse!! the gun stock in front")
71 | User: "Galil accepted. but i cant but another weps, seems they are lock" — accept the Galil binaries + diagnose the locked-weapons report
72 | User supplied a PAT in chat (implicit "push the stranded commits" per Task 65 protocol) — push the 5 local-only commits to GitHub
73 | User: "https://ambientcg.com/ get your required textures and stuffs for details of maps and terrains" — real photo textures for the map surfaces
74 | User: "use good texture for walls" — the staged wall texture looked flat/wrong; upgrade it
75 | User: "accept textures" (+ fresh PAT paste) — accept the staged PolyHaven CC0 map texture set (Task 73/74, wall = worn_cracked_plaster 2K) and push everything to GitHub
76 | User: "ok first one" — the offered follow-up "per-wall UV variation to kill tiling on long walls" (from Task 74's residual nit: mild tiling on the largest flat expanses
77 | User: "the dust series have shared layout. but aim head shod and future maps should have their own texture and layout structure. the real cs aimheadshot map is green layo
78 | User: "Accept Aimhead" — accept the staged aimhead de_aztec texture set (Task 77) per the AGENTS.md asset-acceptance policy
79 | User: "we should go to improve ai. now ai is oneshotted us, even in easy mode. and some times kill when we behind a cover. the counter side is always Standing and they ha
80 | User: "i dont hear other players weapon sounds" — remote gunfire is inaudible
81 | User: "game freeze when it want to load contents. its should preload and game should have loading bar like other games, and it should cache assets, for dont downloading t
82 | User: "bug, while downloading data the game has started and i hear the bot guns sound. did u use service worker to do this?" — match started (bot gunfire audible) behin
83 | User: "reduse amount of gase exit from weapon when firing" — the per-shot muzzle gas/smoke was oversized
84 | User: "map aimheadshot has no bomb at all" — investigation + fix of the bomb experience on aim_headshot
85 | User: "you misunderstand. aim head shot should not have bomb." — the Task-84 reading ('aimheadshot has no bomb' = missing-bomb bug) was wrong; the real spec: aim maps a
86 | User provided a GitHub fine-grained PAT — publish the local Task-85 commit to github.com/JavadAbl/three-cs
87 | User: "add another map like aimheadshot" — a second aim-style map: AIM DEPOT (id 'aimdepot'), a classic crate-yard rifle-duel arena
88 | User: "https://ambientcg.com/" — integrate the ambientCG CC0 texture library into the game; target: the AIM DEPOT identity (the one map still on the generic shared dese
89 | User provided a NEW GitHub fine-grained PAT (Task-86 token revoked after chat exposure) — publish the two pending Task-88 commits to github.com/JavadAbl/three-cs
90 | User picked next steps "1 and 2": (1) experience the AIM DEPOT ambientCG materials live, (2) roll the real-normal PBR upgrade out to dust2 + aim_headshot. Executed across
91 | User: "ok push updates" — verify the GitHub publish state for the Task-90 work (the handoff summary was stale: it predated the Task-90 execution and claimed Task 90 uns
92 | User: "aim depot ground should not be sand. change it." (+ ambientCG popular-list link) and "also there is 2 hanging arcs. remove them"
93 | User provided a fresh GitHub fine-grained PAT — publish the two pending commits (Task 91 worklog record 6aba856 + Task 92 aimdepot re-skin 030c9ac) to github.com/JavadA
94 | User: "do 4. what is 1?" — housekeeping (option 4); option 1 (roll real-normal PBR to plain 'dust') explained, not executed
95 | User provided a fresh PAT — publish the pending Task-94 worklog commit (6fe56a7)
96 | User: "ok do 1" — roll the real-normal PBR upgrade to plain 'dust', the last bare-key map (mirroring Task 90's dust2 scoped pattern)
97 | User re-sent the PAT with instructions to keep it locally for future pushes (not committed) — publish the pending Task-96 commit (2307635)
98 | User: "we need sounds for terrorist wins, counter terrorist wins, bomb planted, bomb defused"
99 | User: "there are two Rectangle shapes on the air in aim depot map. can remove them?"
100 | User: "make aim depot night. with moon and stars"
101 | User: "can use models for moon and stars?" + two uploaded GLBs (moon.glb, star_cluster_-_15k_stars_model.glb) — upgrade the Task-100 canvas-painted AIM DEPOT night sky 
101 | User: "fewer stars, fewer lighting. moon be in middle of map sky"
103 | "the weapon aiming pointer is broken. check it" — diagnose & fix the crosshair
103b | user approved the follow-up — add an outline around the green crosshair ticks for bright-backdrop visibility
103c | user: "1px thinner" — slim the crosshair outline
104 | User: "replace m4a4 with this new one" — full M4A4 replacement from upload/m4.glb + upload/m4.mp3 (model + fire sound)
105 | User: "change famas model to this. also change the fire rate to auto, instead of burst" — FAMAS model replacement (upload/famas_-_csgo__plasmas.glb) + burst→full-auto
106 | User: "AUG" (with upload/steyr_aug_a3.glb) — AUG model replacement, same instruction pattern as the five previous user-model drops
107 | AUG first-person viewmodel size trim — user: "can make aug model a bit smaller in first person view?"
108 | Team-filtered buy menu — user: "each side should only see their own weapons from the buy list"
109 | Feel-polish trio — user: "do 2,5,6" from the polish menu (2: CS-style recoil patterns, 5: quick-switch + reload cancel, 6: directional damage indicators)
111 | user: "did this game cache data? seems every time i open app it downloads data. how can cache data? is it possible?" — make the Task-81 asset cache actually stick acros
112 | user uploaded soldier_character.glb — "is it good for counter terrorist character?" Evaluation + staging through the game's real character pipeline.
113 | user: "the ct characters are a big monster!!!!" — diagnose and fix.
114 | user: "they are ok now, but they are not holding the weapon in hands" — remote GLB characters' weapons float away from the hands (follow-up to the Task-113 monster fix)
115 | user: "i uplaod rebel model. use it for terrorists charachter" — the uploaded leather_rebel.glb becomes the T-side character model (CT keeps the Task-112 soldier).
116 | user: "accept" — execute the documented acceptance procedure for the Task-115 rebel model (the T-side character).
117 | user: "accept" (second) — accept the CT soldier model (human.glb), the acceptance I offered at the end of Task 116 ("say the word and I'll accept human.glb the same way
118 | user: "push updates" then supplied a fresh GitHub fine-grained PAT — publish the 9 pending commits (Tasks 113–117) to github.com/JavadAbl/three-cs.
119 | user: "status" — the status probe exposed a CONTAINER ROLLBACK; this task is the full recovery from it.
120 | user pointed at github.com/sourcesounds/csgo — "grab your missing or generated sound from this rep. sound like win notify, bomb defuse and others"
121 | user supplied a fresh PAT — push Task 120 upstream
123 | user: "when characters moves seems they run like Taking toddling steps" — ground-matched gait: speed-scaled stride (0.85 rad cap, blend-band safe), speed-scaled cadence law, knee drive + run bob; VLM + numeric verified
124 | user: "can make procedural models and textures better?" — procedural-weapons quality pass: 3 PBR material families + 43 regenerated buy icons staged in public/staging
125 | user: "accept" — accept the Task-124 procedural-weapons quality pass into /assets per policy (ASSET_CACHE_VERSION bump sweep)
126 | user supplied a fresh PAT — push the two unpushed local commits (b031dbc Task-124 pass, 501b8b6 Task-125 acceptance)
127 | user uploaded cs_office.bsp ("add office map... no hostages... ambientcg textures, high quality procedural") — import CS 1.6 cs_office as 5th map: BSP->geom conversion, ambientCG PBR bake (7 winner assets, VLM A/B), live on :81 pending acceptance
128 | push the Task-127 office commit with the session PAT (remote synced)
129 | "status" exposed the 3rd container rollback — full recovery: reset to origin/main, regenerate the office staging payload (geom.json 2.4MB + 21 jpgs), re-index all 8 HF tars, commit map-tar.py (pipeline gap), office 11/11 regression + live re-verified
130 | user ACCEPTED cs_office as v1 ("later we should improve it well") — staging->assets promotion, ASSET_CACHE_VERSION v10->v11, regressions green, pushed
131 | user "go" on the island plan ("add a map on an Island in day...") — 6th map "island" (tropical day, bomb defusal): 6-phase plan, HF catalog grep + winner picks (Sand007/Bark012/Leaves003/Grass001/Rock + DaySkyHDRI017B), generator + engine wiring, LIVE on :81 pending textures/acceptance
132 | island ship + 3 hotfixes + ACCEPTANCE: hotfixes = bot sinking (nav mesh), player fall-through (collider count fix), invisible walls (fine-0.5 staircase + per-box STAIR_CLIMB 0.95, losBoxes bit-for-bit); user "island accepted (forgot about token concerns)" — v12 cutover: staging->assets, ASSET_CACHE_VERSION v11->v12, island-regen.sh wipe-resilience proof (5th-wipe regen chain, geom sha cbea66a6 byte-identical), collider-probe/graph/office 11/11 gates ALL green, VLM live accept, pushed; PAT rotation waived by user
133 | user: "compact worklog and scripts and unused files" — worklog 502->219 lines / 76K->23K (123-132 folded to ledger), scripts 22M->1.1M (deleted t123/t124/t125/t126 one-off pngs+VLM dumps, island/shots/), purged tool-results/ + scripts/.tmp/; cross-checked every candidate with rg before deletion
134 | user: "use these models" + 4 uploaded Sketchfab palm GLBs (realistic HD windmill / low-poly / burned / plant-series) — real palm models replace the procedural palm soup. Pack pipeline (pack-palm-models-t134.ts): world-space bake, per-material merge, height-1 normalize, gltf-transform webp+quantize -> /staging/models/island/ (14.6MB->2.4MB, triangle-exact verified). CRITICAL ENV FINDING: the Draco ENCODER is broken in this sandbox (crashes on one mesh, silently corrupts others to ~30% of their triangles) — BANNED, all models ship KHR_mesh_quantization instead. gen.ts emits model props with EXACT rnd-draw parity (boxes 19001/losBoxes 5008, only the 34 palm trunks recentered), geom 4.4->2.1MB; engine mapview renders GLB props (shared prototype + clones, /assets->/staging chain); preloader warms geom+sky+palms. Gates ALL green (collider-probe triple, graph-check/cfg, island live harness, office 11/11, tsc). VERIFICATION LESSONS: the sim is SERVER-AUTHORITATIVE — __eng.teleport reverts in 1-2 frames in live matches (scenic shots need socket disconnect first); killing the platform-spawned game server (bun --hot) leaves a zombie AND poisons the host Caddy XTransformPort upstream (:81 multiplayer -> 502 until sandbox restart). STAGING PREVIEW: geomUrl points at /staging — palms live for evaluation; on ACCEPT: promote geom+models, flip geomUrl to /assets, bump ASSET_CACHE_VERSION v12->v13
135 | user: "when it want to enter the map idm extension capture all glb downloads and the game wont start and stuck on warmup state" — Task 134's palms were the only direct .glb URLs left in the client; the IDM extension captured them, the fetches resolved WITHOUT bodies, and the unguarded r.blob() in the cache wrapper hung forever -> preload pool wedged -> join gate never released -> room parked in server 'warmup' (no rounds, no bot ticks). FIX: (1) new extensionless POST route /api/assets/island/[model] (staging-wins, ETag+mtime cache, hyphen ids) — mapview palms now fetch->parse through it and the preloader warm list points there; ROUTE_RE gains the island family. (2) BODY GUARD: r.blob() wrapped in the same 45s netGuard as the header phase — any hijacked/dead fetch now falls through to the next candidate, the network-gate slot releases, the bar ALWAYS lifts. (3) No ASSET_CACHE_VERSION bump — pure-addition change, no existing cache key can turn stale, v13 stays reserved for the island acceptance. Gates: cache-t111 28/28, island live ALL PASS, office 11/11, tsc src/shared clean; route verified live via :81 (4/4 sha1 MATCH vs staging, 404 guards, ETag 304). ENV: the sandbox reaps agent-spawned background procs at tool-invocation end — the game server can't be kept alive across invocations (platform owns :3003), so E2E gates ran server+suite in ONE invocation; leaving :3003 down after gates is normal, NOT a poison (the :81 upstream only 502-poisons on an explicit kill of the platform's instance — natural death falls back to the Next page)
