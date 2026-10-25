// Task 113 — does the auto-rig's bind setup (bind(skeleton, IDENTITY) on a
// root-less proto, then skeletonClone + parent under a TRANSFORMED p.root)
// double-apply the root transform to skinned vertices? Replicates the exact
// structure of usermodel.buildProto + players.ts parenting and computes the
// real three.js shader math (no renderer needed):
//   world_v = mesh.matrixWorld · B⁻¹ · (bone.matrixWorld · boneInverse) · B · v
// against the CORRECT rigid result:
//   world_v = root.matrixWorld · (posed bone world-in-model) · (bind bone world-in-model)⁻¹ · v
import * as THREE from 'three'
import { clone as skeletonClone } from 'three/examples/jsm/utils/SkeletonUtils.js'

const tmp = new THREE.Matrix4()

// NOTE: three.js SkinnedMesh.updateMatrixWorld RE-DERIVES bindMatrixInverse from the
// mesh's CURRENT matrixWorld every frame (attached bind mode, the default) — that is
// what cancels the mesh's own transform out of the skinning chain. A naive
// "bindMatrixInverse stays identity" assumption (my first version) produces a phantom
// double-transform. This test reads the LIVE bindMatrix/bindMatrixInverse, exactly
// like the shader uniforms the renderer sets.
function shaderWorld(mesh, bone, boneInv, v) {
  // boneMat = bone.matrixWorld · boneInverse   (Skeleton.update)
  const bm = tmp.multiplyMatrices(bone.matrixWorld, boneInv)
  // transformed = B⁻¹ · bm · B · v   (live B/B⁻¹ — attached mode keeps them consistent)
  const t = new THREE.Vector3(...v).applyMatrix4(mesh.bindMatrix).applyMatrix4(bm).applyMatrix4(mesh.bindMatrixInverse)
  // world = mesh.matrixWorld · transformed
  return t.applyMatrix4(mesh.matrixWorld)
}

function correctWorld(root, bone, v) {
  // rigid follow: rootWorld · bonePoseWorldInModel · boneBindWorldInModel⁻¹ · v
  const poseInModel = bone.matrixWorld.clone().premultiply(root.matrixWorld.clone().invert())
  const bindInModel = bone.matrixWorld.clone() // bones never posed in this test => bind == current-in-model
  // NOTE: to make bind≠pose we pose the bone AFTER capturing inverses; recompute bind pose manually:
  return null
}

// ---- build the proto (mirrors usermodel.buildProto) ----
function buildProto() {
  const model = new THREE.Group()
  const hips = new THREE.Bone(); hips.name = 'hips'; hips.position.set(0, 1.0, 0)
  const torso = new THREE.Bone(); torso.name = 'torso'; torso.position.set(0, 0.5, 0)
  hips.add(torso); model.add(hips)

  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute([0, 1.4, 0, 0.1, 1.55, 0, -0.1, 1.55, 0.05], 3))
  const n = 3
  const si = new Uint16Array(n * 4), sw = new Float32Array(n * 4)
  for (let i = 0; i < n; i++) { si[i * 4] = 1; sw[i * 4] = 1 }   // all verts -> torso (bone index 1)
  geo.setAttribute('skinIndex', new THREE.BufferAttribute(si, 4))
  geo.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4))

  const mesh = new THREE.SkinnedMesh(geo, new THREE.MeshBasicMaterial())
  mesh.name = 'skin'
  mesh.frustumCulled = false
  model.add(mesh)

  model.updateMatrixWorld(true)
  const skeleton = new THREE.Skeleton([hips, torso])      // inverses captured HERE (model root-less)
  mesh.bind(skeleton, new THREE.Matrix4())                // bindMatrix = identity, exactly like buildProto
  return model
}

// bind-pose world positions of the torso (in model space) for the rigid reference
function torsoBindWorldInModel() {
  const proto = buildProto()
  const t = proto.getObjectByName('torso')
  return t.matrixWorld.clone()
}

const BIND_TORSO = torsoBindWorldInModel()

function runCase(label, rootTf, poseTorso) {
  const inst = skeletonClone(buildProto())                 // createUserModel
  const root = new THREE.Group()                           // p.root
  rootTf(root)
  root.add(inst)                                           // players.ts: p.root.add(glb.model)
  poseTorso?.(inst.getObjectByName('torso'))               // driveUser bone pose
  const scene = new THREE.Scene(); scene.add(root); scene.updateMatrixWorld(true)

  const mesh = inst.children.find(c => c.isSkinnedMesh); mesh.updateMatrixWorld(true)
  const torso = inst.getObjectByName('torso')
  const boneInv = mesh.skeleton.boneInverses[1]            // torso inverse (captured root-less)

  const pos = geo => geo.attributes.position
  const g = pos(mesh.geometry)
  console.log(`\n=== ${label}`)
  for (let i = 0; i < g.count; i++) {
    const v = [g.getX(i), g.getY(i), g.getZ(i)]
    const shader = shaderWorld(mesh, torso, boneInv, v)
    // correct rigid follow: world_v = rootWorld · (bonePoseInModel · boneBindInModel⁻¹) · v
    // (v is in model/mesh space; at bind pose this reduces to rootWorld·v — the shader's bind-pose result)
    const bonePoseInModel = torso.matrixWorld.clone().premultiply(root.matrixWorld.clone().invert())
    const correct = new THREE.Vector3(...v)
      .applyMatrix4(BIND_TORSO.clone().invert())
      .applyMatrix4(bonePoseInModel)
      .applyMatrix4(root.matrixWorld)
    const d = shader.distanceTo(correct)
    console.log(`  v${i} shader=[${shader.x.toFixed(3)}, ${shader.y.toFixed(3)}, ${shader.z.toFixed(3)}]  rigid=[${correct.x.toFixed(3)}, ${correct.y.toFixed(3)}, ${correct.z.toFixed(3)}]  Δ=${d.toFixed(3)}${d > 0.05 ? '  <-- MISMATCH' : ''}`)
  }
}

// alive: position + yaw only, torso posed (driveUser)
runCase('ALIVE  root=(10,0,5) yaw=60°, torso pitched 0.7', r => { r.position.set(10, 0, 5); r.rotation.y = Math.PI / 3 }, t => { t.rotation.x = 0.7 })
// dead: same + the death-fall rotation on the root (players.ts death branch)
runCase('DEAD   root=(10,0,5) yaw=60° + root.rotation.x=1.52 (fall)', r => { r.position.set(10, 0, 5); r.rotation.y = Math.PI / 3; r.rotation.x = 1.52 }, t => { t.rotation.x = 0.7 })
// dead, fall on Z axis
runCase('DEAD-Z root=(10,0,5) yaw=60° + root.rotation.z=-1.52', r => { r.position.set(10, 0, 5); r.rotation.y = Math.PI / 3; r.rotation.z = -1.52 }, t => { t.rotation.x = 0.7 })
