# Player model assets (not in git)

Model binaries (`*.glb` / `*.gltf` / `*.fbx`, …) are intentionally **not committed** —
large binaries bloat git history permanently, and models get swapped often.
They only enter the repo when explicitly accepted.

The game loads the model through the extensionless route **`/api/assets/human`**
(`src/app/api/assets/human/route.ts`, fetched via POST), not the static path —
browser download-manager extensions (IDM etc.) must never see a `.glb` URL:

- **If the file is missing**, the route returns 404 and the game still works:
  players fall back to the built-in procedural soldier rig (players.ts) — nothing breaks.
- To use the real character model, copy it here as `human.glb` and reload the page.
  The model is preloaded while the lobby menu is open, so starting a match
  never triggers a fresh download.
