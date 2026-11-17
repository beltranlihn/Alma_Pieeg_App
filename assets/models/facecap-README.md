# facecap.glb

The face of Face › Mirror: Face Cap's head (by Bannaflak, https://www.bannaflak.com/face-cap/) with the 52 ARKit
blendshapes, from the three.js examples (examples/models/gltf/facecap.glb, the file PiEEG's Face Trainer v2 loads).

Changed for this app: the meshopt-compressed geometry decoded and the KTX2 texture removed (the app paints its own
grey skin), so the plain GLTFLoader reads it with no WebAssembly. Same geometry, same targets, same animations.

**Licence: not stated by its author.** Used internally (Alma Digital Studio and PiEEG) until confirmed. Before this
app is published, ask Bannaflak, or replace the face with one under a known licence (the 52 ARKit names stay).
