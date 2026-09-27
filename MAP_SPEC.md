# Arena Map Specification

These files describe retained map geometry and collision. Current gameplay is freeze-tag, and Frostline is the only map selectable or playable by users; server room configuration rejects other map IDs. References below to FPS combat, shots, or hitscan are historical implementation notes, not current game requirements.

## Frostline

- X/Z bounds: -60 to +60 metres; Y up; -Z north, +X east. Ground Y=0. The concurrent user change expanded the plan's 80 m horizontal layout to 120 m; vertical dimensions remain unchanged.
- Perimeter walls at X/Z ±60, height 7. Player radius 0.4 m; body 1.8 m standing or 1.1 m crouched/sliding.
- Three lanes: lab walls at X ±19.5, middle depth 27, outer walls Z ±37.5/depth 15.
- Reactor: 7.5 × 7.5 m at (0,0), height 3.5 m.
- Catwalks: X ±43.5, width 9, depth 15, elevation 3. Wedge ramps at Z ±15, depth 15.
- Staggered cover is defined by `ARENA_BLOCKS`. Ice patches at Z ±31.5 are 18 × 13.5 m; shallow-water strips at X ±30 are 6 × 51 m and reduce speed to 70%.
- The former wooden-house site at (-30,-30) is open ground with no rendered model or collider.
- Sixteen authored spawn candidates. Selection scores enemy distance, line of sight and recent death location.

## Frost Island

Frost Island is a 160 × 160 metre combat archipelago. It preserves the optimized supplied Fort derivative as the recognizable central ruin and adds original procedural land, routes, facilities, and cover from `island-layout.ts`. The 136.6 MB source referenced by the original build report is absent from the current working tree; do not claim it is retained or attempt to extract additional source sectors until it is restored and inspected.

- Coordinate boundary: X/Z ±80 m; Y up; -Z north and +X east. Water surface Y=0.
- Central battlefield: overlapping snow platforms span roughly X ±29 and Z -27 to +20. The retained Fort is uniformly transformed by scale 0.52 and Y offset 0.25 in both rendering and collision. A five-metre Cryogenic Core at the origin, damaged facility blocks, containers, barriers, and machinery create close/medium lanes and interrupt cross-map sightlines.
- North island: X 0 / Z -68, observation platform and asymmetric ice ridges. Two metal bridges and a narrow ice path approach the center. Two stair routes counter the elevated position.
- West island: X -68 / Z 0, frozen warehouse, containers, pipeline, and loader. North bridge, south bridge, and central ice route support medium-range rotations.
- East island: X +68 / Z 0, two research blocks, connecting facility lane, and generator. North bridge, south bridge, and central ice route provide separate approaches.
- South island: X 0 / Z +68, trapped-vessel silhouette, cargo, crane base, and broken dock. Two dock bridges and one ice route connect to the center.
- Southwest/southeast islands: compact flanking land masses around (±47,+47). Each has an L-shaped center route and a second harbor rotation so players can bypass the central approach.
- Land masses remain visibly separate above cyan ocean. Bridges and ice paths are fast routes; water is a slower fallback. Sea movement uses deterministic buoyancy/drag: players float 0.55 m below the surface, hold jump to rise, move at 70% base speed, and receive no sprint or slide boost.
- All sixteen spawn candidates are on outer islands. Spawns have clear inward exits and are approximately five seconds from the central core at base movement speed. Dynamic server scoring still accounts for enemy distance, visibility, and recent death position.
- The Fort derivative remains 61,396 triangles, one material draw call, and 4,937,100 bytes. Procedural surfaces and cover are instanced by region/material for frustum culling; the Cryogenic Core uses distance-based LOD. No new runtime dependency or downloaded asset is introduced.
- Feet sample support across their radius. Floor queries remain bounded by current feet/step height; body clearance uses substepped cross-sections and ceiling rays. Shots intersect both exact transformed Fort triangles and authored analytic blocks.

## Build and invariants

Edit `island-layout.ts` for Frost Island land, routes, cover, bounds, and the single shared Fort transform. Do not separately transform the rendered Fort or generated collision. Fort triangle data is indexed by three-metre X/Z cells and combined with the analytic layout at query time. `npm run assets:island` rebuilds the retained Fort derivative only after the missing original source GLB has been restored; it must not overwrite the authored outer-island spawn plan.

Frostline is the only player-selectable map. Rooms default to Frostline, room configuration rejects every other map ID, and countdown completion reasserts Frostline before play. Alternate map implementations, shared geometry, and assets remain internal and are not exposed as player choices. Tests independently raycast the transformed GLB plus procedural blocks, verify the archipelago topology, and verify every spawn can walk forward. Frostline uses shared analytic blocks and solid ramp wedges. Maximum step-up is 0.32 m; movement substeps prevent tunneling.

Trim, core rings, and distant LOD detail are cosmetic and stay inside visible colliders. Do not introduce misleading cover without collision. Underground interiors, jump pads, ziplines, pickups, deep-water behavior, narrow edges, population density, spawn camping, visibility balance, mobile performance, and sustained capacity require later implementation or playtesting.

## Original World

Restored from GitHub commit [87a8893](https://github.com/ChadBojelador/orbiting_game/commit/87a8893f6b84acc39f9b2df709153abe26079cdd), the first arena world foundation, before the Version 2 expansion. Identifier: original. It remains retained geometry and is not selectable; Frostline is the only playable map.

- Original X/Z authored envelope is 125 m; ocean Y=1.5. Original colorful palette, irregular terrain and elevations are retained beneath a permanent deep-navy night sky, distance fog, and cool moonlight.
- Nine land regions: village, forest, Crystal Valley, Ice Peaks, meadow, beach, and three coastal islands. Retains the village crystal, ancient tree, crystal spire, ice summit, meadow windmill, beach arch, original river network, two waterfalls and four bridges. The village crystal, Crystal Valley spire, and island moonstone are emissive nighttime landmarks with broad shadowless regional lights (85/110/75 m). A 9-metre village light and the windmill's integrated 90-metre shadowless amber beacon provide warm navigation; bridge lamps are emissive only.
- Original village cover is rendered as solid blocks with wood and stone finishes. Mesh terrain, bridge decks/rails, landmarks, vegetation, and cover share baked triangle collision. River ribbons follow their centerline terrain profile and are closed volumes: only the top is transparent water, while opaque terrain-backed banks and bottoms extend into the surrounding ground. A shallow closed riverbed sits beneath the transparent surface, including steep transitions. Its top overlaps the full terrain cells removed for the channel and enters collision, closing bank and endpoint gaps without making its support walls blocking. The ocean is a closed six-metre-deep water column with a matching analytic seabed; hold crouch to dive, hold jump to rise, or release both to return to the normal surface float depth.
- The 3.125 m terrain grid is an indexed, welded, closed volume: top faces point upward, exposed coast/river/world-envelope walls point outward, and a shared underside closes each land section at `WATER_BOTTOM`. Coast walls continue to that seabed so underwater cameras cannot see through the landmass. Terrain, paths, rivers, and ocean use normal front-face culling. The ocean has an explicit downward-facing interior surface; only presentation sheets such as waterfalls and the boundary remain intentionally double-sided.
- Sixteen distinct village/inner-approach spawns have clear inward exits; server scoring accounts for enemies, visibility, and last death. The restored layout is not yet validated for 150-player combat.
- Edit original-topology.ts / OriginalWorldMap and run npm run assets:original together for collision changes. The generated original-data.ts is collision only. Independent renderer raycasts, closed-manifold/winding checks, and spawn movement tests verify the bake. A byte-for-byte mesh/bake regression also protects all solid landmark poses. Boundary and paint remain cosmetic; the windmill's elevated rotating fan is presentation-only and excluded from collision. This retained map is unavailable to current freeze-tag rooms.
- The 2026-09-20 visual polish changes no gameplay coordinates, spawns, routes or solid geometry. Terrain vertex colors blend over biome boundaries; lightweight material shaders supply grain, wetness, frost and faint crystal veins. The original closed skirts/beds remain intact. Water has procedural moving highlights, a 128-square depth-color lookup, and distance haze; waterfall presentation sheets align exactly to their existing endpoints. Small instanced ground accents stay below 0.3 m, outside authored routes, river supports, bridges and the central hub. Presentation descendants carry `originalPresentation` metadata and are excluded from collision baking. No new houses, tall vegetation or decorative cover is introduced.
