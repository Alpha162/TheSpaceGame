# TheSpaceGame — Shield Tuning & Damage System Overhaul

## Complete Implementation Spec

This document covers a multi-phase overhaul that introduces damage typing, shield tuning, a new enemy class, and enemy shields. Phases must be built in order — each depends on the previous.

---

## Table of Contents

1. [Phase 1: Damage Pipeline Abstraction](#phase-1-damage-pipeline-abstraction)
2. [Phase 2: Weapon & Projectile Tagging](#phase-2-weapon--projectile-tagging)
3. [Phase 3: Lancer Enemy Class](#phase-3-lancer-enemy-class)
4. [Phase 4: Enemy Shields](#phase-4-enemy-shields)
5. [Phase 5: Player Shield Tuning System](#phase-5-player-shield-tuning-system)
6. [Phase 6: Visual Language](#phase-6-visual-language)
7. [Balance Tuning Guide](#balance-tuning-guide)
8. [Edge Cases & Gotchas](#edge-cases--gotchas)
9. [File Change Summary](#file-change-summary)
10. [Testing Checklist](#testing-checklist)

---

## Phase 1: Damage Pipeline Abstraction

### Problem

Currently, damage is applied in multiple places via different mechanisms:

- Projectile turrets (Blaster, Missile): create projectile entities that are checked in `CombatSystem.ts` for collision
- Laser turret: calls `enemy.takeDamage(dmg)` directly every frame — bypasses shields entirely
- All enemy types: fire melee-range projectiles on cooldown timers

There is no unified damage path. Shields can only intercept projectile entities, not beam damage. This must be fixed before any tuning system is added.

### Solution

Create a unified damage application method in `CombatSystem.ts` that ALL damage flows through:

```typescript
applyDamage(
    source: Entity,
    target: Entity,
    damage: number,
    damageType: number,      // 0.0 = kinetic, 1.0 = energy
    isBeam: boolean = false,  // true for continuous beam weapons (laser/lancer)
    isAoE: boolean = false    // true for splash damage (missile)
): void {
    // 1. Check if any shield is between source and target
    //    - For projectiles: existing collision detection (hub shield → player shields → direct hit)
    //    - For beams: ray-cast from source to target, check shield bubble intersections
    //
    // 2. If shield intercepts:
    //    a. Calculate bleedthrough based on shield tuning vs damageType (Phase 5)
    //       (Until Phase 5 is implemented, use bleedthrough = 1.0 — full damage to heat)
    //    b. Apply tuning drift to shield (Phase 5)
    //    c. Convert damage to heat on the intercepting shield
    //    d. Projectile is destroyed / beam is blocked
    //
    // 3. If no shield intercepts:
    //    a. Apply damage directly to target via target.takeDamage(damage)
}
```

### Beam-Shield Ray-Cast

For beam weapons (player laser turret hitting enemies, future Lancer hitting player nodes), the system needs to check whether a shield bubble sits between the beam source and target:

```typescript
checkBeamShieldIntersection(
    beamOrigin: { x: number, y: number },
    beamTarget: { x: number, y: number },
    shields: Shield[]  // all active shields (player or enemy depending on direction)
): Shield | null {
    // For each active shield:
    //   Calculate closest point on the line segment (beamOrigin → beamTarget) to shield centre
    //   If distance < shield bubble radius, beam intersects this shield
    //   Return the first (closest to beamOrigin) intersecting shield, or null
}
```

This works for both directions:
- Player laser → enemy shield: check against enemy shields
- Enemy Lancer beam → player node: check against player shields (hub shield first, then player-built shields)

### Laser Turret Refactor

In `src/entities/turrets/Laser.ts`, replace the direct `takeDamage` call:

```typescript
// BEFORE:
const dmg = LASER_DPS * (delta / 1000);
this.currentTarget.takeDamage(dmg);

// AFTER:
const dmg = LASER_DPS * (delta / 1000);
combatSystem.applyDamage(
    this,                    // source: the laser turret
    this.currentTarget,      // target: the enemy
    dmg,                     // damage amount
    1.0,                     // damageType: pure energy
    true,                    // isBeam: true
    false                    // isAoE: false
);
```

The laser turret no longer needs to know about shields, damage types, or anything else. It just fires damage into the pipeline.

### Enemy Attack Refactor

All four enemy types fire projectiles. These already go through CombatSystem collision checks, so they just need `damageType` tagging (Phase 2). No structural change needed for enemy projectile attacks.

---

## Phase 2: Weapon & Projectile Tagging

### Projectile damageType Property

Add to the projectile/bullet entity interface:

```typescript
damageType: number;  // 0.0 = pure kinetic, 1.0 = pure energy
```

### Player Weapon Tags

| Turret | damageType | Rationale |
|--------|-----------|-----------|
| Blaster | `0.0` | Pure kinetic — discrete projectile rounds |
| Missile | `0.1` | Mostly kinetic, slight energy from explosive thermal component |
| Laser | `1.0` | Pure energy — continuous beam (handled via `applyDamage`, not projectile entity) |

### Enemy Weapon Tags

All four current enemy types fire kinetic projectiles:

| Enemy | damageType | Notes |
|-------|-----------|-------|
| Drone | `0.0` | Standard kinetic |
| Scout | `0.0` | Standard kinetic |
| Tank | `0.0` | Standard kinetic, heavy hits |
| Swarm | `0.0` | Standard kinetic |

### Missile AoE Inheritance

When a missile detonates and deals splash damage, the AoE damage inherits the missile's `damageType` (0.1). Pass `isAoE: true` to `applyDamage` for the splash portion. This flag is used in Phase 5 to prevent multiple tuning drift applications per cluster (see Edge Cases).

---

## Phase 3: Lancer Enemy Class

### Overview

A new fifth enemy type: a fragile, ranged energy beam attacker. The Lancer exists to force the player to deal with energy damage, making the shield tuning system meaningful. Without it, shields only face kinetic damage and tuning is decorative.

### Stats

Add to `Constants.ts`:

```typescript
// Lancer Enemy
LANCER_HP: 20,
LANCER_SPEED: 0.05,
LANCER_BEAM_DPS: 8,
LANCER_BEAM_RANGE: 170,          // Inside missile (180) and laser (200) range, outside blaster (150)
LANCER_LOCK_TIME_MS: 400,
LANCER_REWARD: 15,
LANCER_POWER_DRAW: 0,            // Enemies don't use power grid
```

### Range Rationale

170px was specifically chosen:
- **Inside** player laser range (200px) — lasers can always hit Lancers
- **Inside** player missile range (180px) — missiles can hit Lancers
- **Outside** player blaster range (150px) — blasters CANNOT hit Lancers

This punishes blaster-only defences and rewards turret diversity. If the player built nothing but cheap blasters, Lancers sit safely at range and burn shields. The player must invest in missiles or lasers to counter.

### Behaviour

The Lancer does NOT orbit like other enemies. Distinct behaviour pattern:

```typescript
// Lancer AI state machine:
// 1. APPROACH: Move toward nearest attackable target (node/turret/hub)
//    - Stop when within LANCER_BEAM_RANGE of target
//
// 2. POSITION: Hold at maximum beam range from target
//    - Maintain distance — don't drift closer
//    - If something blocks line-of-sight (shield blocking beam), strafe laterally to find clear angle
//    - If no clear angle available, advance and accept entering shorter turret ranges
//
// 3. LOCK: Aim at target for LANCER_LOCK_TIME_MS
//    - If target dies during lock, reset to APPROACH for new target
//    - If Lancer takes heavy damage during lock (>50% HP lost), flee briefly then re-approach
//
// 4. FIRE: Continuous beam, dealing LANCER_BEAM_DPS per second
//    - Damage routed through combatSystem.applyDamage(this, target, dmg, 1.0, true, false)
//    - Beam is checked against player shields via ray-cast (Phase 1 pipeline)
//    - If shield intercepts, damage applies to shield as heat (shield takes punishment, node is protected)
//    - If target dies, reset to APPROACH
//    - If target moves out of range, reset to APPROACH
```

### Visual Appearance

- Distinct silhouette from other enemies — elongated, angular, "sniper" profile
- Visible charge-up glow during lock-on phase (player warning: "this thing is about to fire")
- Beam visual: thin, bright energy line from Lancer to target (same style as player laser but different colour — suggest amber/orange to distinguish from player's cyan/blue laser)
- When beam hits a shield, visible impact point on the shield surface with energy dispersal effect

### Spawn Behaviour

Lancers should spawn in small numbers (1-2 per wave slot, not groups of 4 like Swarm). They're specialists, not fodder. They hang back behind Drones and Tanks. The player should see them setting up and have a window to react.

---

## Phase 4: Enemy Shields

### Overview

Tank and Scout enemies gain shields. These use the same shield mechanics as player shields (heat, collapse, cooldown, auto-tuning) but with different parameters. This teaches the player the tuning system from the offensive side — "their shield is kinetic-tuned, I should switch to laser."

### Tank Shield

Add to `Constants.ts`:

```typescript
// Tank Enemy Shield
TANK_SHIELD_RADIUS: 40,
TANK_SHIELD_HEAT_DECAY: 0.002,          // Slower decay than player shields (0.003) — tougher
TANK_SHIELD_HEAT_PER_DAMAGE: 0.08,      // Slightly less heat per hit than player (0.1) — tankier
TANK_SHIELD_COOLDOWN_MS: 6000,          // 6 seconds to redeploy after collapse (longer than player 5s)
TANK_SHIELD_TUNE_DEFAULT: 0.5,          // Starts balanced
TANK_SHIELD_RESERVE_ENABLED: false,     // No reserve — when shield collapses, it's down until cooldown ends
```

**Behaviour:**
- Shield is always present on spawn (no deploy animation — it's already up)
- Auto-tunes toward incoming player fire using same drift constants as player shields
- Collapses when heat reaches 1.0 — visible pop/burst effect (player feedback: "now's my window!")
- 6 second cooldown before shield comes back — long enough for focused fire to kill the Tank
- No reserve power — once it collapses, it stays down for the full cooldown. Simpler than player shields, more predictable for the player to learn from

### Scout Shield

Add to `Constants.ts`:

```typescript
// Scout Enemy Shield
SCOUT_SHIELD_RADIUS: 20,
SCOUT_SHIELD_HEAT_DECAY: 0.0,           // No decay — heat only goes up. Shield is a one-shot buffer.
SCOUT_SHIELD_HEAT_PER_DAMAGE: 0.4,      // Very high — 2-3 hits collapses it
SCOUT_SHIELD_COOLDOWN_MS: 0,            // No cooldown — once it's gone, it's gone for good
SCOUT_SHIELD_TUNE_DEFAULT: 0.5,         // Starts balanced
SCOUT_SHIELD_RESERVE_ENABLED: false,
SCOUT_SHIELD_ONE_SHOT: true,            // Flag: shield does not regenerate after collapse
```

**Behaviour:**
- Shield is present on spawn
- Auto-tunes, but barely matters — it pops so fast the tuning rarely shifts significantly
- Collapses after 2-3 hits regardless of damage type
- Does NOT come back. One-time buffer. Absorbs the first burst, buys the Scout one dodge window
- Purpose: makes Scouts slightly more annoying, forces the player to spend an extra shot or two
- The player shouldn't feel they need to "solve" Scout shields — they just need to account for them

### Enemy Shield Rendering

Enemy shields use the **same visual tuning language** as player shields (see Phase 6). This is critical — the player needs to read enemy shield state at a glance:

- Bronze/opaque = kinetic-tuned → switch to laser
- Cyan = balanced → either weapon works equally
- Prismatic/translucent = energy-tuned → switch to blaster/missile

This teaches the tuning system bidirectionally. The player learns the visual language by attacking enemy shields, then recognises the same signals on their own shields when defending.

### Collapse Effect

When any enemy shield collapses:
- Visible burst/pop — bright flash expanding outward from the shield boundary
- Brief particle scatter in the shield's tuning colour (bronze sparks for kinetic-tuned, prismatic shards for energy-tuned)
- Audio cue if SoundManager supports it (even a simple "pop" or "crack")
- Purpose: clear player feedback that the window is open. Especially important for Tanks where the 6-second window is the key to killing them.

---

## Phase 5: Player Shield Tuning System

### New Constants

Add to `src/utils/Constants.ts` alongside the existing shield block (lines 53–68):

```typescript
// Shield Tuning
SHIELD_TUNE_DEFAULT: 0.5,              // balanced on deploy
SHIELD_TUNE_MIN: 0.0,                  // full kinetic specialisation
SHIELD_TUNE_MAX: 1.0,                  // full energy specialisation
SHIELD_TUNE_DRIFT_PER_HIT: 0.03,       // auto-drift toward incoming damage type per hit
SHIELD_TUNE_DRIFT_DECAY: 0.001,        // per frame, relaxes toward 0.5 when idle
SHIELD_TUNE_MANUAL_DRIFT_MULT: 0.5,    // drift rate multiplier when manually locked
SHIELD_TUNE_BLEEDTHROUGH_MIN: 0.15,    // best case damage passthrough (perfect tune match)
SHIELD_TUNE_BLEEDTHROUGH_MAX: 0.85,    // worst case damage passthrough (full mismatch)
```

These same drift/decay constants are shared by enemy shields unless overridden per-type.

### Shield.ts Changes

#### New Properties

```typescript
tuning: number = Constants.SHIELD_TUNE_DEFAULT;
manualLock: boolean = false;
```

#### Tuning Reset on Deploy

When a shield enters `deploying` state:

```typescript
this.tuning = Constants.SHIELD_TUNE_DEFAULT;
this.manualLock = false;
```

#### Auto-Drift on Hit

Called by CombatSystem when this shield takes a hit. Drift tuning toward the incoming damage type:

```typescript
applyTuningDrift(incomingDamageType: number): void {
    const driftRate = this.manualLock
        ? Constants.SHIELD_TUNE_DRIFT_PER_HIT * Constants.SHIELD_TUNE_MANUAL_DRIFT_MULT
        : Constants.SHIELD_TUNE_DRIFT_PER_HIT;

    if (incomingDamageType < this.tuning) {
        this.tuning = Math.max(Constants.SHIELD_TUNE_MIN, this.tuning - driftRate);
    } else if (incomingDamageType > this.tuning) {
        this.tuning = Math.min(Constants.SHIELD_TUNE_MAX, this.tuning + driftRate);
    }
}
```

**If this shield is part of a cluster, do NOT call this on the individual shield.** The cluster manager handles drift at cluster level (see Cluster section below).

#### Idle Decay

Each frame in `maintaining` state with no hits:

```typescript
updateTuningDecay(): void {
    if (this.tuning > 0.5) {
        this.tuning = Math.max(0.5, this.tuning - Constants.SHIELD_TUNE_DRIFT_DECAY);
    } else if (this.tuning < 0.5) {
        this.tuning = Math.min(0.5, this.tuning + Constants.SHIELD_TUNE_DRIFT_DECAY);
    }
}
```

If clustered, the cluster manager handles this.

#### Bleedthrough Calculation

The core damage formula:

```typescript
calculateBleedthrough(incomingDamageType: number): number {
    const mismatch = Math.abs(this.tuning - incomingDamageType);
    return Constants.SHIELD_TUNE_BLEEDTHROUGH_MIN
        + (Constants.SHIELD_TUNE_BLEEDTHROUGH_MAX - Constants.SHIELD_TUNE_BLEEDTHROUGH_MIN)
        * mismatch;
}
```

Returns 0.15 at perfect match (85% blocked), 0.85 at full mismatch (15% blocked).

#### Manual Override

```typescript
setManualTuning(value: number): void {
    this.tuning = Math.max(Constants.SHIELD_TUNE_MIN, Math.min(Constants.SHIELD_TUNE_MAX, value));
    this.manualLock = true;
}

clearManualLock(): void {
    this.manualLock = false;
}
```

### CombatSystem.ts — Bleedthrough Integration

In the unified `applyDamage` method (Phase 1), when a shield intercepts damage:

```typescript
// Get the effective tuning (cluster tuning if clustered, individual otherwise)
const tuning = shield.isInCluster()
    ? shield.getCluster().clusterTuning
    : shield.tuning;

// Calculate bleedthrough
const mismatch = Math.abs(tuning - damageType);
const bleedthrough = Constants.SHIELD_TUNE_BLEEDTHROUGH_MIN
    + (Constants.SHIELD_TUNE_BLEEDTHROUGH_MAX - Constants.SHIELD_TUNE_BLEEDTHROUGH_MIN)
    * mismatch;

// Apply tuning drift BEFORE heat (so bleedthrough uses pre-drift value)
if (shield.isInCluster()) {
    shield.getCluster().applyClusterTuningDrift(damageType);
} else {
    shield.applyTuningDrift(damageType);
}

// Apply heat (scaled by bleedthrough — well-tuned = less heat, mistuned = more heat)
const heatGenerated = rawDamage * bleedthrough * Constants.SHIELD_HEAT_PER_DAMAGE;
shield.addHeat(heatGenerated);
```

The projectile/beam is still fully blocked by the shield regardless of tuning. Tuning affects how much the shield *suffers*, not whether it intercepts. The shield always protects what's behind it — it just might not survive long if mistuned.

### ShieldClusterManager.ts — Cluster Tuning

#### Cluster-Level Properties

```typescript
// Add to cluster data structure:
clusterTuning: number;
clusterManualLock: boolean;
```

#### On Cluster Formation / Shield Join

```typescript
// When shields merge into a cluster or a shield joins an existing cluster:
// Average all member tunings to get the initial cluster tuning
clusterTuning = members.reduce((sum, s) => sum + s.tuning, 0) / members.length;
clusterManualLock = false;  // Reset lock — player must re-lock the new cluster
```

#### On Cluster Dissolution

```typescript
// When cluster breaks apart (e.g. a shield is destroyed):
for (const shield of formerMembers) {
    shield.tuning = clusterTuning;         // Inherit cluster's tuning value
    shield.manualLock = clusterManualLock;  // Inherit lock state
}
```

#### Cluster Drift and Decay

```typescript
applyClusterTuningDrift(incomingDamageType: number): void {
    const driftRate = this.clusterManualLock
        ? Constants.SHIELD_TUNE_DRIFT_PER_HIT * Constants.SHIELD_TUNE_MANUAL_DRIFT_MULT
        : Constants.SHIELD_TUNE_DRIFT_PER_HIT;

    if (incomingDamageType < this.clusterTuning) {
        this.clusterTuning = Math.max(Constants.SHIELD_TUNE_MIN, this.clusterTuning - driftRate);
    } else if (incomingDamageType > this.clusterTuning) {
        this.clusterTuning = Math.min(Constants.SHIELD_TUNE_MAX, this.clusterTuning + driftRate);
    }
}

updateClusterTuningDecay(): void {
    if (this.clusterTuning > 0.5) {
        this.clusterTuning = Math.max(0.5, this.clusterTuning - Constants.SHIELD_TUNE_DRIFT_DECAY);
    } else if (this.clusterTuning < 0.5) {
        this.clusterTuning = Math.min(0.5, this.clusterTuning + Constants.SHIELD_TUNE_DRIFT_DECAY);
    }
}
```

#### Manual Override on Clusters

Player clicks anywhere on the merged cluster bubble → tuning slider appears → sets `clusterTuning` and `clusterManualLock = true`. A lock icon renders on the cluster bubble.

### Hub Shield (CommandHub.ts)

The hub shield gets tuning using the same properties and methods as regular shields. It's a permanent single-shield entity (cluster of one). Same auto-drift, same decay, same manual override via slider.

Hub shield uses its existing slightly faster heat decay (0.004 vs 0.003) but the same tuning constants. No special treatment.

### Upgrade Interaction

The existing shield upgrade (60→72 px radius, 1.5× heat decay) does NOT affect tuning. Tuning constants are the same for basic and upgraded shields. Durability and tuning are orthogonal upgrade paths. A future "Adaptive Shield" upgrade could affect tuning (faster drift, narrower bleedthrough range), but that's a separate design decision.

---

## Phase 6: Visual Language

### Shield Tuning Colour/Opacity

All shields (player, enemy, hub, clustered) use the same visual language. Five anchor points with linear interpolation between them:

| Tuning | Colour (RGB) | Opacity | Visual Style |
|--------|-------------|---------|-------------|
| 0.0 (kinetic) | `rgb(180, 150, 100)` | 0.6 | Dense, metallic bronze/steel, nearly opaque |
| 0.25 | `rgb(200, 170, 80)` | 0.45 | Semi-opaque, warm amber tint |
| 0.5 (balanced) | `rgb(0, 220, 255)` | 0.3 | Current default cyan — familiar baseline |
| 0.75 | `rgb(120, 140, 255)` | 0.2 | Translucent, cool blue-violet, shimmering |
| 1.0 (energy) | `rgb(180, 120, 255)` | 0.12 | Near-transparent prismatic film, refractive |

Apply to:
- Individual shield bubble fill and stroke
- Cluster merged membrane
- Harmonic arcs between clustered shields
- Enemy shields (Tank and Scout) — same colours, same meaning

The transition must be smooth and continuous. As tuning drifts, the player watches the shield physically transform in real-time.

### Hit Effects Based on Tuning

**Kinetic-tuned shields (tuning < 0.3):**
- Impact creates heavy concentric ripple rings expanding outward from hit point
- Ripples are opaque, bronze/amber palette, short duration
- Feels like hitting armour plate — heavy, solid, satisfying

**Balanced shields (tuning 0.3–0.7):**
- Current hit effect or a moderate flash/ripple at the impact point
- Neutral visual — neither heavy nor electrical

**Energy-tuned shields (tuning > 0.7):**
- Impact creates web-lightning / branching energy dispersal across the bubble surface
- Thin bright lines that fork and fade, prismatic colours
- Longer duration, lighter visual weight — energy being absorbed and redistributed

Interpolate between these effects in the transition zones. A shield at 0.4 shows mostly standard ripple with a hint of kinetic weight.

### Lancer Beam Visual

- Thin, bright beam line from Lancer to target
- Colour: amber/orange — visually distinct from player laser (cyan/blue)
- Charge-up glow on the Lancer during lock-on phase (400ms warning)
- When beam hits a player shield: visible energy impact point on the shield surface with dispersal arcs radiating from the contact point (since it's energy damage, always use the energy-style dispersal effect at the impact point regardless of shield tuning)

### Shield Collapse Effect (All Shields)

When any shield collapses (player or enemy):
- Bright flash expanding outward from shield boundary
- Brief particle scatter in the shield's current tuning colour
  - Bronze sparks for kinetic-tuned
  - Cyan sparks for balanced
  - Prismatic shards for energy-tuned
- Shield radius shrinks rapidly to zero over ~200ms (not instant pop — a fast collapse)
- Audio cue via SoundManager if possible

This is especially important for enemy shields — the player needs clear feedback that the window is open.

### Manual Lock Indicator

When `manualLock` (or `clusterManualLock`) is true:
- Small lock icon rendered near the shield node or at the edge of the cluster bubble
- Semi-transparent, doesn't obscure gameplay
- Same tuning colour as the shield for visual cohesion

---

## Balance Tuning Guide

If testing reveals problems, here's what to adjust and why:

| Problem | Adjust | Direction |
|---------|--------|-----------|
| Shields adapt too fast — player never gets punished for wrong tuning | `SHIELD_TUNE_DRIFT_PER_HIT` | Decrease (e.g. 0.03 → 0.015) |
| Shields adapt too slowly — tuning feels unresponsive | `SHIELD_TUNE_DRIFT_PER_HIT` | Increase (e.g. 0.03 → 0.05) |
| Well-tuned shields are invincible | `SHIELD_TUNE_BLEEDTHROUGH_MIN` | Increase (e.g. 0.15 → 0.25) |
| Mistuned shields die too fast — feels unfair | `SHIELD_TUNE_BLEEDTHROUGH_MAX` | Decrease (e.g. 0.85 → 0.65) |
| Tank enemy shields make them immortal | `TANK_SHIELD_HEAT_PER_DAMAGE` | Increase (e.g. 0.08 → 0.12) |
| Tank shields collapse too easily | `TANK_SHIELD_HEAT_DECAY` | Increase (e.g. 0.002 → 0.003) |
| Scout shields are pointless (pop too fast) | `SCOUT_SHIELD_HEAT_PER_DAMAGE` | Decrease (e.g. 0.4 → 0.3) |
| Scout shields are too annoying (absorb too much) | `SCOUT_SHIELD_HEAT_PER_DAMAGE` | Increase (e.g. 0.4 → 0.5) |
| Lancers are unkillable | `LANCER_HP` | Decrease (e.g. 20 → 15) |
| Lancers die before they can fire | `LANCER_HP` | Increase (e.g. 20 → 30) |
| Lancers melt shields too fast | `LANCER_BEAM_DPS` | Decrease (e.g. 8 → 5) |
| Lancers feel harmless | `LANCER_BEAM_DPS` | Increase (e.g. 8 → 10) |
| Idle shields snap back to 0.5 too fast | `SHIELD_TUNE_DRIFT_DECAY` | Decrease (e.g. 0.001 → 0.0005) |
| Idle shields never return to balanced | `SHIELD_TUNE_DRIFT_DECAY` | Increase (e.g. 0.001 → 0.002) |
| Manual lock feels too weak (still drifts a lot) | `SHIELD_TUNE_MANUAL_DRIFT_MULT` | Decrease (e.g. 0.5 → 0.25) |
| Manual lock is too absolute (no counter-play) | `SHIELD_TUNE_MANUAL_DRIFT_MULT` | Increase (e.g. 0.5 → 0.75) |

---

## Edge Cases & Gotchas

### AoE and Shield Clusters

When a missile detonates near a shield cluster:
- The AoE splash should apply tuning drift to the cluster **once**, not once per shield in the cluster
- Without this guard, a single missile near a 4-shield cluster would drift tuning 4× faster than intended
- Implementation: in the AoE damage handler, track which clusters have already received drift this frame and skip duplicates

```typescript
// In AoE damage application:
const driftedClusters = new Set<string>();  // cluster IDs already drifted this AoE

for (const shield of shieldsInAoERadius) {
    const clusterId = shield.isInCluster() ? shield.getCluster().id : shield.id;
    
    if (!driftedClusters.has(clusterId)) {
        // Apply drift once per cluster
        if (shield.isInCluster()) {
            shield.getCluster().applyClusterTuningDrift(damageType);
        } else {
            shield.applyTuningDrift(damageType);
        }
        driftedClusters.add(clusterId);
    }
    
    // Heat distribution still applies per-shield as normal (existing cluster heat sharing)
}
```

### Beam Tick Rate and Drift Speed

The player laser and Lancer beam deal damage every frame. Each frame's damage counts as a "hit" for tuning drift purposes. At 60fps, a beam would apply 60 drift nudges per second — far faster than projectile weapons.

**Solution:** For beam weapons (`isBeam: true`), apply tuning drift at a capped rate, not every frame:

```typescript
// In Shield or ClusterManager:
lastTuningDriftTime: number = 0;
TUNING_DRIFT_MIN_INTERVAL_MS: 200;  // Max 5 drift applications per second for beams

// When processing beam hit:
if (isBeam) {
    const now = performance.now();
    if (now - shield.lastTuningDriftTime >= TUNING_DRIFT_MIN_INTERVAL_MS) {
        shield.applyTuningDrift(damageType);
        shield.lastTuningDriftTime = now;
    }
} else {
    shield.applyTuningDrift(damageType);  // Projectiles: drift every hit as normal
}
```

This ensures beams drift shields at roughly the same rate as sustained projectile fire, not 60× faster.

### Lancer Beam vs Player Shield: Both Directions

The damage pipeline must handle both directions:
- **Player weapons → enemy shields:** Blaster/missile projectiles and laser beam check against Tank/Scout shields
- **Enemy weapons → player shields:** Drone/Scout/Tank/Swarm projectiles and Lancer beam check against player shields (hub first, then player-built)

Ensure `applyDamage` determines which shield set to check based on the source entity's faction, not a hardcoded list.

### Enemy Shield and Existing Combat Priority

Current player combat system checks: hub shield → player shields → direct node hit.

For player weapons hitting enemies, add: enemy shield → enemy direct hit.

The enemy shield is checked first. If it's active and the projectile/beam intersects it, damage goes to the shield. If the shield is collapsed/cooldown, damage goes directly to the enemy.

### Shield Tuning on Collapse and Redeploy

When a player shield collapses and later redeploys after cooldown:
- Tuning resets to 0.5 (balanced) — specified in Phase 5
- This is intentional: the shield "forgets" its tuning on collapse
- Forces the player to re-establish tuning, either manually or by letting it auto-drift again
- Prevents a degenerate pattern where shields collapse and instantly redeploy with perfect tuning

When an enemy Tank shield collapses and redeploys after 6s cooldown:
- Also resets to 0.5
- Same reasoning — the player can't assume the Tank shield comes back with the same tuning

Scout shields do not redeploy (one-shot), so this doesn't apply to them.

### Turret Auto-Targeting — Future-Proofing Note

Current turret targeting is presumably "nearest enemy." With Lancers sitting at max range (170px, outside blaster range), players may want targeting priority options. This is NOT required for this implementation, but:

**Do not structure the targeting code in a way that makes priority systems difficult to add later.** Specifically, ensure the target selection logic is in a single method that can be overridden or extended, not scattered across multiple places.

A future targeting system might include: nearest, lowest HP, highest threat (Lancers), or shield-down-first.

---

## File Change Summary

| File | Phase | Changes |
|------|-------|---------|
| `src/utils/Constants.ts` | 2-5 | Add shield tuning constants, Lancer constants, enemy shield constants, missile damageType |
| `src/systems/CombatSystem.ts` | 1, 2, 5 | Add unified `applyDamage()` method, beam-shield ray-cast, bleedthrough calculation, tuning drift calls, AoE cluster drift guard, beam drift rate cap |
| `src/entities/turrets/Laser.ts` | 1 | Replace direct `takeDamage()` with `combatSystem.applyDamage()` call |
| `src/entities/defence/Shield.ts` | 5, 6 | Add `tuning`, `manualLock`, `lastTuningDriftTime`. Add `applyTuningDrift()`, `updateTuningDecay()`, `calculateBleedthrough()`, `setManualTuning()`, `clearManualLock()`. Update rendering for tuning visuals, hit effects, collapse effect. |
| `src/systems/ShieldClusterManager.ts` | 5, 6 | Add `clusterTuning`, `clusterManualLock` to cluster data. Cluster-level drift, decay, manual override. Average on join, inherit on dissolve. Update cluster rendering for tuning visuals. |
| `src/entities/CommandHub.ts` | 5 | Add tuning properties and methods to hub shield |
| Projectile/bullet entities | 2 | Add `damageType: number` property |
| `src/entities/turrets/Blaster.ts` | 2 | Tag projectiles with `damageType: 0.0` |
| `src/entities/turrets/Missile.ts` | 2 | Tag projectiles with `damageType: 0.1`, pass `isAoE: true` for splash |
| Enemy base class or individual enemy files | 2 | Tag enemy projectiles with `damageType: 0.0` |
| **NEW** `src/entities/enemies/Lancer.ts` | 3 | New enemy class — beam weapon, positioning AI, visual appearance |
| Enemy entity files (Tank) | 4 | Add shield with Tank shield constants, render enemy shield, check in combat |
| Enemy entity files (Scout) | 4 | Add one-shot shield with Scout shield constants, render, check in combat |
| UI system | 5 | Add tuning slider panel on shield/cluster selection — slider, lock/unlock button, real-time position |
| `src/systems/SoundManager.ts` | 6 | Add shield collapse sound, Lancer beam sound, lock/unlock click (if applicable) |

---

## Testing Checklist

### Phase 1 — Damage Pipeline
- [ ] Player laser beam damage routes through `applyDamage()`
- [ ] Player laser beam is intercepted by enemy shields (when Phase 4 is complete)
- [ ] Enemy Lancer beam is intercepted by player shields (when Phase 3 is complete)
- [ ] All projectile damage still routes through existing collision → `applyDamage()`
- [ ] Beam-shield ray-cast correctly identifies shield intersection
- [ ] Beam-shield ray-cast returns null when no shield is in the path

### Phase 2 — Weapon Tagging
- [ ] Blaster projectiles have `damageType: 0.0`
- [ ] Missile projectiles have `damageType: 0.1`
- [ ] Missile AoE splash passes `damageType: 0.1` and `isAoE: true`
- [ ] Laser passes `damageType: 1.0` and `isBeam: true`
- [ ] All enemy projectiles have `damageType: 0.0`

### Phase 3 — Lancer
- [ ] Lancer spawns with correct stats
- [ ] Lancer approaches and holds at ~170px range
- [ ] Lancer locks on for 400ms with visible charge-up
- [ ] Lancer fires continuous beam dealing ~8 DPS
- [ ] Lancer beam is blocked by player shields (damage converts to shield heat)
- [ ] Lancer beam visual renders correctly (amber/orange)
- [ ] Lancer repositions if line-of-sight is blocked
- [ ] Lancer is within missile turret range (180px) — missiles can hit it
- [ ] Lancer is within laser turret range (200px) — lasers can hit it
- [ ] Lancer is outside blaster turret range (150px) — blasters cannot hit it
- [ ] Lancer dies in reasonable number of hits given 20 HP

### Phase 4 — Enemy Shields
- [ ] Tank spawns with shield active, radius 40px
- [ ] Tank shield auto-tunes toward incoming player fire
- [ ] Tank shield collapses at heat 1.0 with visible collapse effect
- [ ] Tank shield redeploys after 6s cooldown, tuning reset to 0.5
- [ ] Tank shield visual matches tuning (bronze/cyan/prismatic)
- [ ] Scout spawns with shield active, radius 20px
- [ ] Scout shield collapses after 2-3 hits
- [ ] Scout shield does NOT redeploy (one-shot)
- [ ] Player can read enemy shield tuning visually and adapt weapon choice

### Phase 5 — Player Shield Tuning
- [ ] Single unclustered shield auto-drifts toward kinetic fire
- [ ] Single unclustered shield auto-drifts toward energy fire (Lancer beam)
- [ ] Shield relaxes back to 0.5 when idle
- [ ] Manual lock holds tuning position (with halved drift)
- [ ] Unlock resumes normal auto-drift
- [ ] Well-tuned shield generates less heat (survives longer)
- [ ] Mistuned shield generates more heat (collapses faster)
- [ ] Cluster averages tuning when shields merge
- [ ] Cluster members inherit tuning when cluster dissolves
- [ ] Cluster drift operates on cluster tuning, not individual shields
- [ ] Manual lock on cluster locks the whole formation
- [ ] Hub shield supports tuning with same mechanics
- [ ] Slider UI appears on shield/cluster selection
- [ ] Slider marker moves in real-time during auto-drift
- [ ] Lock icon appears when manually locked
- [ ] Beam weapons cap tuning drift rate (not every frame)
- [ ] AoE applies tuning drift once per cluster, not per shield
- [ ] Tuning resets to 0.5 on shield collapse and redeploy
- [ ] Mixed damage types (kinetic + energy simultaneous) create tuning tug-of-war near 0.5

### Phase 6 — Visuals
- [ ] Shield colour/opacity interpolates smoothly across full 0.0–1.0 range
- [ ] Kinetic-tuned shields show bronze/metallic appearance
- [ ] Energy-tuned shields show prismatic/translucent appearance
- [ ] Balanced shields show current cyan appearance
- [ ] Kinetic hit effects: heavy concentric ripples
- [ ] Energy hit effects: web-lightning dispersal
- [ ] Balanced hit effects: moderate flash
- [ ] Cluster membrane and harmonic arcs shift colour with tuning
- [ ] Enemy shields use identical visual language
- [ ] Shield collapse shows burst + coloured particle scatter + rapid shrink
- [ ] Lancer charge-up glow visible during lock-on
- [ ] Lancer beam renders as amber/orange line
- [ ] Manual lock icon renders on locked shields/clusters
