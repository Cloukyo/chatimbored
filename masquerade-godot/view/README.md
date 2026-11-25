# The 3D view

Everything here is placeholder art built from primitives, laid out like the web version (`client-web/src/crowd/scene3d.ts`)
so the game is playable now and each piece can be replaced by modelled art later without touching the rules.

Units and axes: 1 unit = 1 metre, Y up, the arena's x runs along +X and its y along +Z (toward the camera).
32 arena pixels = 1 metre, so the 1280 x 720 arena is a 40 x 22.5 m floor centred on the origin.

| Piece | Where | Replace with |
|---|---|---|
| Figure bodies | `Figure._body_mesh` | one rigged .glb shared by players and guests (gown and tailcoat variants), origin at the feet, facing +Z, about 1.75 m tall |
| Walk, run, stunned, fallen | `Figure.animate` | animations on that rig: idle, walk, run, stunned, sick, dead |
| Masks | `MaskArt` painted on a card | one .glb per animal (fox, owl, hare, raven, cat, wolf, stag, bear), tinted per colour; keep it facing the camera |
| Rooms | `Room` | one scene per room style (hall, library, garden, tower, vault, gallery, music, post, terrace, ballroom); keep the floor at y = 0 and nothing inside the arena |
| Lanterns, bells, vaults | `PropModel` | .glb props with a light part (lantern glass, bell, alarm lamp) the code can tint |

Keep poly counts low: a room can have 100+ figures on screen.
