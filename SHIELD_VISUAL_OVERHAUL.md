# Shield Visual Overhaul — Rendering Spec Addendum

## Overview

This replaces the Phase 6 visual treatment from the original spec. The current implementation uses colour/opacity interpolation which works functionally but lacks visual identity at the extremes. Shields should look dramatically different at each end of the tuning spectrum — a kinetic shield should feel like a physical armour shell, an energy shield should feel like a living plasma field.

This is a rendering overhaul for shield bubbles. It does NOT change any gameplay mechanics, constants, or tuning logic. Only how shields look.

---

## Opacity Floor Fix (Immediate)

Before implementing the full overhaul, fix the opacity anchor points. Energy-tuned shields are currently invisible at 1.0.

Updated anchor points:

| Tuning | Opacity |
|--------|---------|
| 0.0 (kinetic) | 0.55 |
| 0.25 | 0.42 |
| 0.5 (balanced) | 0.30 |
| 0.75 | 0.25 |
| 1.0 (energy) | 0.22 |

The visual distinction between kinetic and energy comes from colour, texture, and effects — NOT from the shield disappearing.

---

## Kinetic-Tuned Shield (tuning 0.0–0.3) — "The Shell"

### Design Intent

A kinetic shield is a physical structure. Rigid, tessellated, mechanical. It looks like deployable armour plating wrapped around the node, not a force field. Dense, opaque, structural. No transparency shimmer. No glow.

### Hexagonal Tessellation

- The bubble surface is divided into a hexagonal grid pattern — interlocking armour cells
- Each hex cell has a thin bright edge (bronze/amber colour from the tuning palette) with a darker interior fill
- The pattern is drawn on the bubble surface, not as separate sprites — it's a texture on the shield circle/arc
- **Tuning blend:** At tuning 0.0, the hex pattern is fully defined with sharp, bright edges. At 0.3, the hex edges are soft and fading. At 0.5, the pattern is completely gone (clean bubble). The hex pattern fades in linearly between tuning 0.5 and 0.0
- The hex cells should be sized relative to the shield radius — roughly 8-10 cells visible across the diameter of a standard shield. Scale proportionally for hub shields (larger) and enemy shields (smaller)

### Shell Rotation

- The hex pattern rotates very slowly around the shield centre — approximately 1 full rotation per 30 seconds
- This creates a subtle sense of mass and physical presence, like a solid structure with inertia
- Rotation speed is constant regardless of tuning or heat

### Kinetic Impact Effect

When a kinetic-tuned shield (tuning < 0.3) takes a hit:

1. **Cell flash:** The hex cell closest to the impact point flashes bright white/bronze for ~100ms
2. **Shockwave ripple:** Adjacent hex cells flash in sequence, rippling outward from the impact point. Each ring of cells flashes ~50ms after the previous ring. 2-3 rings maximum
3. **Crack pattern:** Brief bright fracture lines appear within the hit cell, branching from the impact point to the cell edges. Fades over ~200ms
4. **No glow or energy dispersal** — the effect is entirely mechanical. Metal being struck, not energy being absorbed

### Rendering Notes

- The hex pattern can be drawn using line graphics on the shield's graphics layer
- Calculate hex cell positions once when the shield deploys or joins a cluster, then rotate the pattern each frame
- For clustered shields with a merged membrane, the hex pattern should tile across the entire merged shape, not per-individual-shield. One continuous tessellation across the cluster

---

## Energy-Tuned Shield (tuning 0.7–1.0) — "The Plasma Field"

### Design Intent

An energy shield is alive. It flows, breathes, and shimmers. It looks like contained plasma or a localised aurora — constantly moving, prismatic, luminous. The shield feels like it's actively working to maintain itself.

### Surface Plasma Tendrils

- Wispy particle trails that crawl along the inner surface of the bubble
- Each tendril is a short curved line (arc segment) that moves along the bubble circumference
- Tendrils fork and recombine — occasionally a tendril splits into two shorter ones, and occasionally two nearby tendrils merge
- Movement speed: moderate, clearly visible but not frantic. Each tendril traverses roughly 1/4 of the bubble circumference over ~3 seconds
- Colour: shifted slightly from the base shield colour — brighter, more saturated. At tuning 1.0, tendrils shimmer through blue → violet → magenta → cyan in a slow cycle (~5 seconds per full colour rotation)
- Tendril opacity: 0.4–0.7, varying per tendril. They should feel like wisps, not solid lines
- Line width: 1-2px, tapering at the ends

**Particle budget per shield:**
- Solo shield: 8-12 tendrils active at any time
- Clustered shields: shared budget across merged membrane. A 4-shield cluster gets ~14-16 tendrils total (1.5× solo, NOT 4× solo)
- Enemy shields: 4-6 tendrils (half budget — smaller shields, less visual fidelity needed on targets)

### Bubble Breathing

- The shield radius oscillates sinusoidally by ±1.5px around its base radius
- Cycle time: ~2 seconds per full breath
- This is purely visual — collision detection still uses the fixed base radius
- Creates a sense of the field being a contained energy, not a rigid boundary

### Prismatic Colour Shifting

- At tuning 1.0, the base shield colour is not static. It shifts slowly through the palette: `rgb(180,120,255)` → `rgb(120,140,255)` → `rgb(100,200,255)` → `rgb(160,100,255)` → back
- Full cycle: ~8 seconds
- This is a slow, gentle wash across the entire bubble surface — not a strobe or flash
- At tuning 0.7, the shift is barely perceptible (mostly stays near the blue-violet anchor). Shift intensity scales linearly from tuning 0.7 to 1.0

### Inner Glow

- A soft radial gradient from the shield centre outward — brighter at centre, fading to the bubble edge
- Gives the shield visual depth rather than looking like a flat coloured circle
- Glow colour matches the current prismatic cycle colour but at ~0.08 opacity
- Glow radius: ~70% of bubble radius (doesn't reach the edge)

### Floating Charged Particles

- Tiny bright dots (2-3px) that drift along the inner surface of the bubble
- Movement: slow, slightly erratic — like charged particles trapped in a magnetic bottle
- Each particle has a faint 4-6px glow halo
- Particles occasionally "spark" — brief bright flash at their position, then resume drifting
- Colour: white or very pale version of the current prismatic cycle colour

**Particle budget:**
- Solo shield: 15-20 floating particles
- Clustered shields: 20-25 across the merged membrane
- Enemy shields: 6-8 particles

### Energy Impact Effect

When an energy-tuned shield (tuning > 0.7) takes a hit:

1. **Contact flash:** Bright point flash at the impact location, white core fading to shield colour, ~80ms
2. **Web-lightning:** Branching energy lines spread from the impact point across the bubble surface. 3-5 main branches, each splitting once. Lines are thin (1px), bright, and fade over ~300ms. Colour: brighter/whiter version of current shield colour
3. **Tendril acceleration:** All plasma tendrils within ~30% of the bubble circumference from the impact point briefly accelerate (2× speed for ~500ms) and intensify in brightness. The field is visibly redistributing the absorbed energy
4. **Particle scatter:** 5-8 floating particles burst outward from the impact point along the bubble surface, moving fast then decelerating. They rejoin normal drift after ~400ms
5. **No mechanical ripple, no crack patterns** — the effect is entirely energetic. Energy being absorbed and dispersed, not armour being struck

---

## Balanced Shield (tuning 0.3–0.7) — "The Standard Field"

### Design Intent

The familiar baseline. Clean, calm, functional. As tuning moves away from 0.5, elements of the kinetic or energy visual style begin to bleed in.

### Appearance at 0.5

- Clean cyan bubble, current baseline appearance
- No hex pattern, no plasma tendrils, no floating particles
- Subtle inner glow at low opacity (~0.04)
- Standard hit effect: moderate flash at impact point, simple expanding ring, fades quickly

### Transition Blending (0.3–0.5 range — kinetic bleed-in)

- At 0.4: Faint hex pattern visible — edges are soft, low opacity (~0.15), slightly glowing rather than sharp bronze. Gives a hint of structure without committing to the full shell look
- At 0.35: Hex pattern becoming more defined. Edges brighter (~0.3 opacity). Occasional hex cell edge catches light
- At 0.3: Hex pattern clearly visible but edges still softer than full kinetic. Impact effects start showing the cell flash alongside the standard ring

### Transition Blending (0.5–0.7 range — energy bleed-in)

- At 0.6: No hex pattern. Surface has a faint flowing texture — like very subtle plasma movement just beneath the surface. 2-3 barely-visible proto-tendrils, short and wispy
- At 0.65: Proto-tendrils becoming more defined. 4-5 visible. Faint colour shifting beginning. A few floating particles appear (3-4)
- At 0.7: Full energy visual system active but at reduced intensity. All effects present but tendrils are shorter, particles fewer, colour shift slower than at 1.0

### Blending Implementation

Rather than hard transitions, use the tuning value to interpolate effect intensities:

```typescript
// Kinetic effects intensity (hex pattern, mechanical impacts)
const kineticIntensity = tuning < 0.5
    ? Math.min(1.0, (0.5 - tuning) / 0.2)   // Ramps from 0 at 0.5 to 1.0 at 0.3
    : 0.0;

// Energy effects intensity (tendrils, particles, glow, prismatic shift)
const energyIntensity = tuning > 0.5
    ? Math.min(1.0, (tuning - 0.5) / 0.2)   // Ramps from 0 at 0.5 to 1.0 at 0.7
    : 0.0;

// Use these to scale:
// - Hex edge opacity: kineticIntensity * maxHexOpacity
// - Number of active tendrils: Math.floor(energyIntensity * maxTendrils)
// - Floating particle count: Math.floor(energyIntensity * maxParticles)
// - Prismatic shift range: energyIntensity * maxShiftRange
// - Inner glow opacity: baseGlow + (energyIntensity * maxGlowBoost)
// - Impact effect: blend between mechanical and energy based on intensities
```

This means at 0.5 both intensities are 0 — clean bubble. Moving in either direction smoothly ramps up the corresponding visual system. There's a dead zone between 0.3–0.7 where both systems overlap very slightly at their minimums, which creates a natural visual transition.

---

## Shield Collapse Effect (Updated)

The collapse effect should reflect the shield's tuning at the moment of collapse.

### Kinetic Collapse (tuning < 0.3)

- Hex cells shatter outward — each cell becomes a separate fragment that flies away from the centre
- Fragments are small angular shapes (triangle/quad) in bronze/amber
- Fragments rotate as they fly outward, fade over ~400ms
- Brief bright flash at the shield boundary
- Feels like armour plating breaking apart

### Energy Collapse (tuning > 0.7)

- Plasma tendrils flare bright and scatter outward in all directions
- Floating particles burst away from centre at high speed
- Web-lightning covers the entire bubble surface for a brief moment (~100ms) then the whole field dissipates
- Inner glow flares bright then fades rapidly
- Feels like a containment failure — energy escaping

### Balanced Collapse (tuning 0.3–0.7)

- Expanding flash ring (current behaviour)
- Coloured particle scatter in the tuning colour
- Rapid radius shrink to zero over ~200ms
- Clean and simple

### All Collapses

- Total collapse animation duration: ~400ms maximum
- Shield visuals are fully gone by the end — no lingering particles
- Audio cue via SoundManager (if available)

---

## Cluster-Specific Rendering

### Junction Points

Where individual shields overlap within a cluster, the junction/merge zone should have heightened visual effects:

- **Kinetic clusters:** Hex pattern at junction points has brighter edges and slightly denser tessellation. The seam where two shells meet should glow — reinforced armour at the join
- **Energy clusters:** Plasma tendril density is higher at junction points. Tendrils from adjacent shield regions are drawn toward the overlap zone. Floating particles congregate near junctions. The merge point looks like a plasma confluence — where two fields are actively merging

### Harmonic Arcs

The existing harmonic arcs between clustered shields should adopt tuning colour:
- Kinetic: bronze arcs, slightly thicker, steady brightness
- Energy: prismatic arcs, thinner, pulsing brightness in sync with the bubble breathing
- Balanced: current appearance

---

## Enemy Shield Rendering

Enemy shields use the **exact same visual language** as player shields. Same hex pattern for kinetic, same plasma tendrils for energy. This is critical — the player must be able to read enemy shield tuning at a glance and know which weapon to use.

### Reduced Particle Budget

Enemy shields are smaller and the player needs less visual detail on targets:

| Effect | Player (solo) | Player (cluster) | Enemy |
|--------|--------------|-------------------|-------|
| Plasma tendrils | 8-12 | 14-16 total | 4-6 |
| Floating particles | 15-20 | 20-25 total | 6-8 |
| Hex cell density | Full | Full (continuous) | Same ratio (fewer cells due to smaller radius) |

### Collapse Readability

Enemy shield collapse must be clearly visible to the player — it's the signal that the enemy is now vulnerable. Consider making enemy collapse effects slightly brighter/larger than player ones to ensure they read clearly at distance. The "window is open" moment must be unmissable.

---

## Performance Considerations

### Particle Object Pooling

Do NOT create and destroy particle objects every frame. Use object pools:

```typescript
// Pre-allocate pools at scene start:
const tendrilPool = new ObjectPool<Tendril>(maxTendrils);
const particlePool = new ObjectPool<FloatingParticle>(maxParticles);
const fragmentPool = new ObjectPool<CollapseFragment>(maxFragments);

// On shield deploy: acquire from pool
// On shield collapse: release back to pool (after collapse animation)
// On shield destroy: release immediately
```

### Frame Budget

Set a global particle cap to prevent performance issues with many shields on screen:

```typescript
const MAX_GLOBAL_TENDRILS = 80;
const MAX_GLOBAL_PARTICLES = 150;
const MAX_GLOBAL_COLLAPSE_FRAGMENTS = 60;
```

If the global cap is reached, new shields deploy with reduced particle counts rather than exceeding the budget. Prioritise player shields over enemy shields when budget is tight.

### LOD (Level of Detail) — Optional

If performance is a concern with many shields, implement distance-based LOD:

- Shields near the camera/viewport centre: full effects
- Shields at viewport edges: reduced tendril count, no floating particles, simplified impacts
- Shields off-screen: no particle updates at all (pause and resume when back on screen)

This is optional and only needed if the full particle system causes frame drops. Implement the full system first, optimise only if needed.

---

## Implementation Order

1. **Opacity floor fix** — update anchor points immediately (quick win)
2. **Kinetic hex tessellation** — draw hex pattern on shield surface, fade based on tuning
3. **Kinetic impact effects** — cell flash, shockwave ripple, crack pattern
4. **Energy plasma tendrils** — implement tendril system with pooling
5. **Energy floating particles** — implement particle system with pooling
6. **Energy visual effects** — breathing, prismatic shift, inner glow
7. **Energy impact effects** — web-lightning, tendril acceleration, particle scatter
8. **Transition blending** — wire up intensity interpolation between 0.3–0.7
9. **Collapse effects** — kinetic shatter, energy dispersal, balanced ring
10. **Cluster rendering** — junction enhancements, harmonic arc tuning colours
11. **Enemy shield rendering** — same language, reduced budgets, bright collapse
12. **Performance pass** — verify frame rate, implement global caps, add pooling if not already done

---

## File Change Summary

| File | Changes |
|------|---------|
| `src/entities/defence/Shield.ts` | Major rendering overhaul — hex tessellation, plasma tendrils, floating particles, breathing, prismatic shift, inner glow, updated impact effects, updated collapse effects |
| `src/systems/ShieldClusterManager.ts` | Junction rendering enhancements, harmonic arc tuning colours, cluster particle budget management |
| `src/entities/CommandHub.ts` | Same rendering overhaul applied to hub shield |
| `src/entities/Enemy.ts` | Same rendering language on Tank/Scout shields with reduced particle budgets, brighter collapse |
| `src/utils/Helpers.ts` | Update `getTuningVisual()` opacity anchors. Possibly add particle pool utilities |
| **NEW** `src/rendering/ShieldEffects.ts` | (Suggested) Centralised shield effect system — tendril management, particle pooling, global budget tracking, LOD. Keeps rendering logic out of entity classes |

### Suggested Architecture Note

Consider creating a dedicated `ShieldEffects` class that owns all particle pools and manages the global budget. Individual shields register with it on deploy and deregister on destroy. This prevents every shield instance from independently managing particles and makes the global cap trivial to enforce. Shield entities call `shieldEffects.renderShield(this)` each frame instead of drawing their own particles.

This is a suggestion, not a requirement. If it's simpler to keep rendering in the shield classes, that's fine — but the global particle cap must still be enforced somewhere.
