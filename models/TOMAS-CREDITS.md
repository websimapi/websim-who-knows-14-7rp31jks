# Tomas Voss — blue character

Character direction: `npc/blue/soul.md`. Clothing, accessories, tapered strand groom and guide rig were created in Blender for this character. Body motion reuses the existing game's X Bot Mixamo rig and idle, walk, run, agree and headShake clips. The additional sad_pose and sneak_pose clips are retained.

Head scan and its color/normal textures: **Lee Perry-Smith**, **Infinite Realities**, **CC BY 3.0**, from the project's Hair Salon reference and the [Three.js normal map example](https://threejs.org/examples/webgl_materials_normalmap.html). License: [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/). Original [asset license notice](https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/models/gltf/LeePerrySmith/LeePerrySmith_License.txt). Source asset attribution: [Lee Perry-Smith head](https://casual-effects.com/data/). The scan was trimmed, scaled, bound to the game rig and fitted with eyes and a custom groom.

Hair motion adapts the pinned-root Verlet, bending, length constraint and scalp collision approach in `@api/hair-salon-3`; it uses 24 two-segment guide chains to move 2,100 tapered strand meshes. The GLB contains geometry and skin weights; real-time gravity/inertia is provided by `js/clue/hair-motion.js`, not baked into the GLB. Importing the GLB alone into another engine gives a rigged groom without that runtime simulation.

This is a detailed playable character prototype for review, not a claim of finished AAA production quality. It has no facial speech rig or morph targets, and guide motion approximates a short groom rather than simulating every strand individually. Inspect the face, hair, sitting and carried-object poses before accepting it as the final design.
