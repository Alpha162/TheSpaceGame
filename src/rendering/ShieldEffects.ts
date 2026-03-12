/**
 * Centralised shield visual effects system.
 *
 * Manages hex tessellation (kinetic), plasma tendrils & floating particles (energy),
 * breathing, prismatic colour shift, inner glow, impact effects, and collapse effects.
 *
 * Individual shields register on deploy and deregister on destroy.  Each frame the
 * owning entity calls `ShieldEffects.render(graphics, id, ...)` instead of drawing
 * particles itself.
 */

import { getTuningVisual } from '../utils/Helpers';

// ── Global budget caps ────────────────────────────────────────────────
const MAX_GLOBAL_TENDRILS = 80;
const MAX_GLOBAL_PARTICLES = 150;
const MAX_GLOBAL_COLLAPSE_FRAGMENTS = 60;

// ── Tendril ───────────────────────────────────────────────────────────
interface Tendril {
    angle: number;       // position on circumference (radians)
    speed: number;       // radians per ms
    length: number;      // arc length in radians
    opacity: number;
    width: number;
    colourPhase: number; // offset into colour cycle
    active: boolean;
}

// ── Floating particle ─────────────────────────────────────────────────
interface FloatingParticle {
    angle: number;
    speed: number;       // radians per ms
    glowRadius: number;
    sparkTimer: number;  // ms until next spark
    sparking: boolean;
    sparkLife: number;   // ms remaining on current spark
    active: boolean;
    // Impact scatter state
    scatterSpeed: number;
    scatterTimer: number;
}

// ── Collapse fragment ─────────────────────────────────────────────────
interface CollapseFragment {
    x: number;
    y: number;
    vx: number;
    vy: number;
    rotation: number;
    rotSpeed: number;
    size: number;
    timer: number;
    colour: number;
    active: boolean;
    /** 'kinetic' = angular shard, 'energy' = bright dot, 'balanced' = ring particle */
    style: 'kinetic' | 'energy' | 'balanced';
}

// ── Impact flash ──────────────────────────────────────────────────────
export interface ImpactFlash {
    angle: number;       // where on the circumference
    timer: number;       // ms remaining
    colour: number;
    style: 'kinetic' | 'energy' | 'balanced';
    // Kinetic: ring of hex cells to flash
    rippleRing: number;
    // Energy: web-lightning branches
    branches: Array<{ angles: number[]; opacity: number }>;
}

// ── Per-shield state ──────────────────────────────────────────────────
export interface ShieldEffectState {
    // Hex tessellation
    hexRotation: number;         // current rotation of hex pattern (radians)

    // Energy tendrils
    tendrils: Tendril[];
    maxTendrils: number;

    // Floating particles
    particles: FloatingParticle[];
    maxParticles: number;

    // Breathing
    breathPhase: number;         // 0..2π

    // Prismatic colour shift
    prismaticPhase: number;      // 0..1 through the colour cycle

    // Collapse fragments
    fragments: CollapseFragment[];

    // Impact flashes
    impacts: ImpactFlash[];

    // Energy impact: tendril acceleration
    tendrilAccelTimer: number;   // ms remaining for acceleration effect
    tendrilAccelAngle: number;   // angle of impact for proximity check

    // Whether this is an enemy shield (reduced budgets)
    isEnemy: boolean;

    // Whether collapse is brighter (enemy shields)
    brightCollapse: boolean;

    // Whether this shield is in a cluster (hex rendered at cluster level)
    inCluster: boolean;
}

// ── Prismatic colour palette ──────────────────────────────────────────
const PRISMATIC_COLOURS = [
    { r: 180, g: 120, b: 255 },
    { r: 120, g: 140, b: 255 },
    { r: 100, g: 200, b: 255 },
    { r: 160, g: 100, b: 255 },
];

function lerpColour(a: { r: number; g: number; b: number }, b: { r: number; g: number; b: number }, f: number): number {
    const r = Math.round(a.r + (b.r - a.r) * f);
    const g = Math.round(a.g + (b.g - a.g) * f);
    const bl = Math.round(a.b + (b.b - a.b) * f);
    return (r << 16) | (g << 8) | bl;
}

function blendColourHex(a: number, b: number, f: number): number {
    const ar = (a >> 16) & 0xff, ag = (a >> 8) & 0xff, ab = a & 0xff;
    const br = (b >> 16) & 0xff, bg = (b >> 8) & 0xff, bb = b & 0xff;
    const r = Math.round(ar + (br - ar) * f);
    const g = Math.round(ag + (bg - ag) * f);
    const bl = Math.round(ab + (bb - ab) * f);
    return (r << 16) | (g << 8) | bl;
}

function getPrismaticColour(phase: number): number {
    const len = PRISMATIC_COLOURS.length;
    const scaled = ((phase % 1) + 1) % 1 * len;
    const i = Math.floor(scaled);
    const f = scaled - i;
    const a = PRISMATIC_COLOURS[i % len];
    const b = PRISMATIC_COLOURS[(i + 1) % len];
    return lerpColour(a, b, f);
}

// ── Hex grid helpers ──────────────────────────────────────────────────
/**
 * Compute hex cell centres that tile across a circle of given radius.
 * Returns array of {cx, cy} in local coords (shield centre = 0,0).
 * `cellSize` is the flat-to-flat distance of each hex.
 */
function computeHexGrid(radius: number, cellSize: number): Array<{ cx: number; cy: number }> {
    const cells: Array<{ cx: number; cy: number }> = [];
    const rowH = cellSize * Math.sqrt(3) / 2;
    const rows = Math.ceil(radius / rowH) + 1;
    for (let row = -rows; row <= rows; row++) {
        const y = row * rowH;
        const offset = (row % 2 !== 0) ? cellSize * 0.5 : 0;
        const cols = Math.ceil(radius / cellSize) + 1;
        for (let col = -cols; col <= cols; col++) {
            const x = col * cellSize + offset;
            if (x * x + y * y <= (radius + cellSize) * (radius + cellSize)) {
                cells.push({ cx: x, cy: y });
            }
        }
    }
    return cells;
}

/**
 * Draw a single hexagon outline (pointy-top) at (cx, cy) with given flat-to-flat size.
 * rotation is applied to the entire hex grid (not individual hexes).
 */
function drawHexCell(
    g: Phaser.GameObjects.Graphics,
    cx: number, cy: number,
    halfSize: number,
    colour: number, edgeAlpha: number, fillAlpha: number,
    lineWidth: number
): void {
    const pts: Array<{ x: number; y: number }> = [];
    for (let i = 0; i < 6; i++) {
        const a = (Math.PI / 3) * i - Math.PI / 6;
        pts.push({ x: cx + halfSize * Math.cos(a), y: cy + halfSize * Math.sin(a) });
    }

    // Dark fill
    if (fillAlpha > 0.005) {
        g.fillStyle(0x000000, fillAlpha);
        g.beginPath();
        g.moveTo(pts[0].x, pts[0].y);
        for (let i = 1; i < 6; i++) g.lineTo(pts[i].x, pts[i].y);
        g.closePath();
        g.fillPath();
    }

    // Bright edges
    if (edgeAlpha > 0.005) {
        g.lineStyle(lineWidth, colour, edgeAlpha);
        g.beginPath();
        g.moveTo(pts[0].x, pts[0].y);
        for (let i = 1; i < 6; i++) g.lineTo(pts[i].x, pts[i].y);
        g.closePath();
        g.strokePath();
    }
}

/**
 * Find the hex cell index closest to a given angle on the circumference.
 */
function closestHexCell(
    cells: Array<{ cx: number; cy: number }>,
    angle: number, radius: number
): number {
    const px = Math.cos(angle) * radius;
    const py = Math.sin(angle) * radius;
    let best = 0;
    let bestDist = Infinity;
    for (let i = 0; i < cells.length; i++) {
        const dx = cells[i].cx - px;
        const dy = cells[i].cy - py;
        const d = dx * dx + dy * dy;
        if (d < bestDist) {
            bestDist = d;
            best = i;
        }
    }
    return best;
}

// ── Global state ──────────────────────────────────────────────────────
let globalTendrilCount = 0;
let globalParticleCount = 0;
let globalFragmentCount = 0;

// ── Public API ────────────────────────────────────────────────────────

export function createShieldEffectState(isEnemy: boolean): ShieldEffectState {
    const maxTendrils = isEnemy ? 6 : 12;
    const maxParticles = isEnemy ? 8 : 20;
    return {
        hexRotation: 0,
        tendrils: [],
        maxTendrils,
        particles: [],
        maxParticles,
        breathPhase: Math.random() * Math.PI * 2,
        prismaticPhase: Math.random(),
        fragments: [],
        impacts: [],
        tendrilAccelTimer: 0,
        tendrilAccelAngle: 0,
        isEnemy,
        brightCollapse: isEnemy,
        inCluster: false,
    };
}

/**
 * Called when a shield is destroyed. Releases global budget.
 */
export function releaseShieldEffectState(state: ShieldEffectState): void {
    globalTendrilCount -= state.tendrils.filter(t => t.active).length;
    globalParticleCount -= state.particles.filter(p => p.active).length;
    globalFragmentCount -= state.fragments.filter(f => f.active).length;
    state.tendrils.length = 0;
    state.particles.length = 0;
    state.fragments.length = 0;
}

/**
 * Adjust particle budgets for clustered shields.
 * A cluster of N shields gets roughly 1.5× solo budget, not N× solo.
 */
export function setClusterBudget(state: ShieldEffectState, clusterSize: number): void {
    state.inCluster = clusterSize > 1;
    if (clusterSize <= 1) {
        state.maxTendrils = state.isEnemy ? 6 : 12;
        state.maxParticles = state.isEnemy ? 8 : 20;
    } else {
        // Shared budget: ~1.5× solo / clusterSize per member
        const tendrilBudget = state.isEnemy ? 6 : Math.round(16 / clusterSize);
        const particleBudget = state.isEnemy ? 8 : Math.round(25 / clusterSize);
        state.maxTendrils = Math.max(2, tendrilBudget);
        state.maxParticles = Math.max(3, particleBudget);
    }
}

/**
 * Update effect state each frame. Call before render.
 */
export function updateShieldEffects(
    state: ShieldEffectState,
    delta: number,
    tuning: number,
    _radius: number
): void {
    // Intensity calculations
    const kineticIntensity = tuning < 0.5
        ? Math.min(1.0, (0.5 - tuning) / 0.2)
        : 0.0;
    const energyIntensity = tuning > 0.5
        ? Math.min(1.0, (tuning - 0.5) / 0.2)
        : 0.0;

    // ── Hex rotation (kinetic) ──
    if (kineticIntensity > 0) {
        state.hexRotation += (delta / 1000) * (Math.PI * 2 / 30); // 1 rotation per 30s
    }

    // ── Breathing (energy) ──
    if (energyIntensity > 0) {
        state.breathPhase += (delta / 1000) * (Math.PI * 2 / 2); // 2s per cycle
    }

    // ── Prismatic shift ──
    if (energyIntensity > 0) {
        state.prismaticPhase += (delta / 1000) / 8; // 8s full cycle
    }

    // ── Tendrils ──
    const targetTendrils = Math.floor(energyIntensity * state.maxTendrils);
    // Spawn tendrils up to target (respecting global cap)
    while (state.tendrils.filter(t => t.active).length < targetTendrils && globalTendrilCount < MAX_GLOBAL_TENDRILS) {
        const tendril: Tendril = {
            angle: Math.random() * Math.PI * 2,
            speed: (0.0003 + Math.random() * 0.0003) * (Math.random() < 0.5 ? 1 : -1),
            length: 0.3 + Math.random() * 0.5,
            opacity: 0.4 + Math.random() * 0.3,
            width: 1 + Math.random(),
            colourPhase: Math.random(),
            active: true,
        };
        state.tendrils.push(tendril);
        globalTendrilCount++;
    }
    // Deactivate excess tendrils
    let activeTendrils = state.tendrils.filter(t => t.active).length;
    for (let i = state.tendrils.length - 1; i >= 0 && activeTendrils > targetTendrils; i--) {
        if (state.tendrils[i].active) {
            state.tendrils[i].active = false;
            globalTendrilCount--;
            activeTendrils--;
        }
    }
    // Update tendril positions
    for (const t of state.tendrils) {
        if (!t.active) continue;
        let speed = t.speed;
        // Accelerate tendrils near impact point
        if (state.tendrilAccelTimer > 0) {
            let angleDiff = t.angle - state.tendrilAccelAngle;
            while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
            while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;
            if (Math.abs(angleDiff) < Math.PI * 0.6) { // ~30% of circumference
                speed *= 2;
            }
        }
        t.angle += speed * delta;
        t.colourPhase += delta * 0.0002;
    }

    // ── Floating particles ──
    const targetParticles = Math.floor(energyIntensity * state.maxParticles);
    while (state.particles.filter(p => p.active).length < targetParticles && globalParticleCount < MAX_GLOBAL_PARTICLES) {
        const particle: FloatingParticle = {
            angle: Math.random() * Math.PI * 2,
            speed: (0.0001 + Math.random() * 0.0002) * (Math.random() < 0.5 ? 1 : -1),
            glowRadius: 4 + Math.random() * 2,
            sparkTimer: 2000 + Math.random() * 4000,
            sparking: false,
            sparkLife: 0,
            active: true,
            scatterSpeed: 0,
            scatterTimer: 0,
        };
        state.particles.push(particle);
        globalParticleCount++;
    }
    let activeParticles = state.particles.filter(p => p.active).length;
    for (let i = state.particles.length - 1; i >= 0 && activeParticles > targetParticles; i--) {
        if (state.particles[i].active) {
            state.particles[i].active = false;
            globalParticleCount--;
            activeParticles--;
        }
    }
    for (const p of state.particles) {
        if (!p.active) continue;
        let speed = p.speed;
        if (p.scatterTimer > 0) {
            speed = p.scatterSpeed;
            p.scatterTimer -= delta;
            p.scatterSpeed *= 0.98; // decelerate
        }
        p.angle += speed * delta;
        // Spark timing
        if (p.sparking) {
            p.sparkLife -= delta;
            if (p.sparkLife <= 0) p.sparking = false;
        } else {
            p.sparkTimer -= delta;
            if (p.sparkTimer <= 0) {
                p.sparking = true;
                p.sparkLife = 80;
                p.sparkTimer = 2000 + Math.random() * 4000;
            }
        }
    }

    // ── Impact flashes ──
    for (let i = state.impacts.length - 1; i >= 0; i--) {
        state.impacts[i].timer -= delta;
        // Kinetic ripple progression
        if (state.impacts[i].style === 'kinetic') {
            const elapsed = 300 - state.impacts[i].timer;
            state.impacts[i].rippleRing = Math.floor(elapsed / 50);
        }
        // Energy web-lightning fade
        if (state.impacts[i].style === 'energy') {
            const t = 1 - state.impacts[i].timer / 300;
            for (const branch of state.impacts[i].branches) {
                branch.opacity = Math.max(0, 1 - t);
            }
        }
        if (state.impacts[i].timer <= 0) {
            state.impacts.splice(i, 1);
        }
    }

    // ── Tendril acceleration timer ──
    if (state.tendrilAccelTimer > 0) {
        state.tendrilAccelTimer -= delta;
    }

    // ── Collapse fragments ──
    for (let i = state.fragments.length - 1; i >= 0; i--) {
        const f = state.fragments[i];
        if (!f.active) continue;
        f.timer -= delta;
        if (f.timer <= 0) {
            f.active = false;
            globalFragmentCount--;
            continue;
        }
        f.x += f.vx * delta;
        f.y += f.vy * delta;
        f.rotation += f.rotSpeed * delta;
    }
    // Clean up dead fragments
    state.fragments = state.fragments.filter(f => f.active);
}

/**
 * Render all shield visual effects onto the given graphics context.
 * Graphics should already be positioned at the shield centre (x=0, y=0 is shield centre).
 */
export function renderShieldEffects(
    g: Phaser.GameObjects.Graphics,
    state: ShieldEffectState,
    tuning: number,
    radius: number,
    baseColour: number,
    baseAlpha: number,
    _heatLevel: number
): void {
    const kineticIntensity = tuning < 0.5
        ? Math.min(1.0, (0.5 - tuning) / 0.2)
        : 0.0;
    const energyIntensity = tuning > 0.5
        ? Math.min(1.0, (tuning - 0.5) / 0.2)
        : 0.0;

    // ── Inner glow (energy) ──
    if (energyIntensity > 0) {
        const glowAlpha = (0.04 + energyIntensity * 0.04) * baseAlpha;
        const prismaticCol = getPrismaticColour(state.prismaticPhase);
        const glowColour = energyIntensity > 0.5
            ? blendColourHex(baseColour, prismaticCol, (energyIntensity - 0.5) * 2)
            : baseColour;
        const glowR = radius * 0.7;
        g.fillStyle(glowColour, glowAlpha);
        g.fillCircle(0, 0, glowR);
    }

    // ── Hex tessellation (kinetic) ──
    if (kineticIntensity > 0.01 && radius > 5) {
        renderHexTessellation(g, state, kineticIntensity, radius, baseColour, baseAlpha);
    }

    // ── Plasma tendrils (energy) ──
    if (energyIntensity > 0.01) {
        renderTendrils(g, state, energyIntensity, tuning, radius, baseColour, baseAlpha);
    }

    // ── Floating particles (energy) ──
    if (energyIntensity > 0.01) {
        renderFloatingParticles(g, state, energyIntensity, tuning, radius, baseAlpha);
    }

    // ── Impact effects ──
    for (const impact of state.impacts) {
        renderImpact(g, impact, radius, baseColour);
    }

    // ── Collapse fragments ──
    renderCollapseFragments(g, state);
}

/**
 * Get the effective visual radius (includes breathing offset for energy shields).
 * Use this for visual-only purposes; collision still uses the base radius.
 */
export function getBreathingOffset(state: ShieldEffectState, tuning: number): number {
    const energyIntensity = tuning > 0.5
        ? Math.min(1.0, (tuning - 0.5) / 0.2)
        : 0.0;
    if (energyIntensity <= 0) return 0;
    return Math.sin(state.breathPhase) * 1.5 * energyIntensity;
}

/**
 * Get the prismatic colour for the current phase (for energy shields).
 * Blends between base colour and prismatic based on tuning.
 */
export function getEffectiveColour(
    state: ShieldEffectState,
    tuning: number,
    baseColour: number
): number {
    const energyIntensity = tuning > 0.5
        ? Math.min(1.0, (tuning - 0.5) / 0.2)
        : 0.0;
    if (energyIntensity <= 0) return baseColour;
    // Prismatic shift intensity scales from 0.7 to 1.0
    const shiftIntensity = tuning > 0.7
        ? Math.min(1.0, (tuning - 0.7) / 0.3)
        : 0.0;
    if (shiftIntensity <= 0) return baseColour;
    const prismaticCol = getPrismaticColour(state.prismaticPhase);
    return blendColourHex(baseColour, prismaticCol, shiftIntensity * 0.6);
}

/**
 * Register an impact event at the given angle on the shield circumference.
 */
export function triggerImpact(
    state: ShieldEffectState,
    angle: number,
    tuning: number,
    colour: number,
    _radius: number
): void {
    const kineticIntensity = tuning < 0.5
        ? Math.min(1.0, (0.5 - tuning) / 0.2)
        : 0.0;
    const energyIntensity = tuning > 0.5
        ? Math.min(1.0, (tuning - 0.5) / 0.2)
        : 0.0;

    if (kineticIntensity > 0.3) {
        // Kinetic impact — cell flash + shockwave ripple
        state.impacts.push({
            angle,
            timer: 300,
            colour,
            style: 'kinetic',
            rippleRing: 0,
            branches: [],
        });
    } else if (energyIntensity > 0.3) {
        // Energy impact — web-lightning + tendril acceleration
        const branches: Array<{ angles: number[]; opacity: number }> = [];
        const numBranches = 3 + Math.floor(Math.random() * 3);
        for (let i = 0; i < numBranches; i++) {
            const branchAngle = angle + (Math.random() - 0.5) * Math.PI;
            const splitAngle = branchAngle + (Math.random() - 0.5) * 0.6;
            branches.push({
                angles: [angle, branchAngle, splitAngle],
                opacity: 1,
            });
        }
        state.impacts.push({
            angle,
            timer: 300,
            colour,
            style: 'energy',
            rippleRing: 0,
            branches,
        });
        // Tendril acceleration
        state.tendrilAccelTimer = 500;
        state.tendrilAccelAngle = angle;
        // Particle scatter
        scatterParticles(state, angle);
    } else {
        // Balanced impact — simple flash ring
        state.impacts.push({
            angle,
            timer: 200,
            colour,
            style: 'balanced',
            rippleRing: 0,
            branches: [],
        });
    }
}

/**
 * Trigger collapse visual effect. Call when shield heat reaches 1.
 */
export function triggerCollapse(
    state: ShieldEffectState,
    tuning: number,
    radius: number,
    colour: number
): void {
    const kineticIntensity = tuning < 0.5
        ? Math.min(1.0, (0.5 - tuning) / 0.2)
        : 0.0;
    const energyIntensity = tuning > 0.5
        ? Math.min(1.0, (tuning - 0.5) / 0.2)
        : 0.0;

    const brightMult = state.brightCollapse ? 1.3 : 1.0;

    if (kineticIntensity > 0.5) {
        // Kinetic collapse — hex cells shatter outward
        const cellSize = radius / 4;
        const cells = computeHexGrid(radius, cellSize);
        let count = 0;
        for (const cell of cells) {
            if (globalFragmentCount >= MAX_GLOBAL_COLLAPSE_FRAGMENTS) break;
            if (count >= 20) break; // cap per collapse
            const dist = Math.sqrt(cell.cx * cell.cx + cell.cy * cell.cy);
            if (dist > radius * 1.1) continue;
            const ang = Math.atan2(cell.cy, cell.cx);
            const speed = (0.05 + Math.random() * 0.1) * brightMult;
            state.fragments.push({
                x: cell.cx,
                y: cell.cy,
                vx: Math.cos(ang) * speed,
                vy: Math.sin(ang) * speed,
                rotation: Math.random() * Math.PI * 2,
                rotSpeed: (Math.random() - 0.5) * 0.01,
                size: cellSize * 0.4,
                timer: 400,
                colour: colour,
                active: true,
                style: 'kinetic',
            });
            globalFragmentCount++;
            count++;
        }
    } else if (energyIntensity > 0.5) {
        // Energy collapse — tendrils flare, particles burst, web-lightning flash
        // Burst particles outward
        let count = 0;
        for (let i = 0; i < 12; i++) {
            if (globalFragmentCount >= MAX_GLOBAL_COLLAPSE_FRAGMENTS) break;
            if (count >= 15) break;
            const ang = (i / 12) * Math.PI * 2 + Math.random() * 0.3;
            const speed = (0.08 + Math.random() * 0.12) * brightMult;
            state.fragments.push({
                x: Math.cos(ang) * radius * 0.8,
                y: Math.sin(ang) * radius * 0.8,
                vx: Math.cos(ang) * speed,
                vy: Math.sin(ang) * speed,
                rotation: 0,
                rotSpeed: 0,
                size: 2 + Math.random() * 2,
                timer: 400,
                colour: colour,
                active: true,
                style: 'energy',
            });
            globalFragmentCount++;
            count++;
        }
        // Web-lightning flash as an impact
        const branches: Array<{ angles: number[]; opacity: number }> = [];
        for (let i = 0; i < 8; i++) {
            const a = (i / 8) * Math.PI * 2;
            branches.push({
                angles: [a, a + 0.5 + Math.random() * 0.5],
                opacity: 1,
            });
        }
        state.impacts.push({
            angle: 0,
            timer: 100,
            colour: 0xffffff,
            style: 'energy',
            rippleRing: 0,
            branches,
        });
    } else {
        // Balanced collapse — expanding ring + particle scatter
        let count = 0;
        for (let i = 0; i < 8; i++) {
            if (globalFragmentCount >= MAX_GLOBAL_COLLAPSE_FRAGMENTS) break;
            if (count >= 10) break;
            const ang = (i / 8) * Math.PI * 2 + Math.random() * 0.3;
            const speed = 0.05 + Math.random() * 0.08;
            state.fragments.push({
                x: Math.cos(ang) * radius * 0.5,
                y: Math.sin(ang) * radius * 0.5,
                vx: Math.cos(ang) * speed,
                vy: Math.sin(ang) * speed,
                rotation: 0,
                rotSpeed: 0,
                size: 2,
                timer: 400,
                colour: colour,
                active: true,
                style: 'balanced',
            });
            globalFragmentCount++;
            count++;
        }
    }
}

// ── Private render helpers ────────────────────────────────────────────

function renderHexTessellation(
    g: Phaser.GameObjects.Graphics,
    state: ShieldEffectState,
    kineticIntensity: number,
    radius: number,
    baseColour: number,
    baseAlpha: number
): void {
    // Skip if this shield is in a cluster — cluster renders unified hex instead
    if (state.inCluster) return;

    renderHexTessellationAt(g, state.hexRotation, state.impacts, kineticIntensity, radius,
        0, 0, radius, baseColour, baseAlpha);
}

/**
 * Core hex tessellation renderer. Can be called for individual shields (centreX/Y=0)
 * or for cluster-level rendering (centreX/Y = cluster barycenter offset).
 * `clipRadius` defines the outer boundary; hex cells only render in the outer 35% ring.
 * `gridRadius` controls the extent of the hex grid generation.
 */
export function renderHexTessellationAt(
    g: Phaser.GameObjects.Graphics,
    hexRotation: number,
    impacts: ImpactFlash[],
    kineticIntensity: number,
    gridRadius: number,
    centreX: number,
    centreY: number,
    clipRadius: number,
    baseColour: number,
    baseAlpha: number
): void {
    // Cell size: roughly 8-10 cells across diameter
    const cellSize = (gridRadius * 2) / 9;
    const halfCell = cellSize * 0.55;
    const cells = computeHexGrid(gridRadius, cellSize);

    const cos = Math.cos(hexRotation);
    const sin = Math.sin(hexRotation);

    const edgeAlpha = kineticIntensity * 0.6 * baseAlpha;
    const fillAlpha = kineticIntensity * 0.05 * baseAlpha;

    const tuningVis = getTuningVisual(0.0);
    const hexColour = blendColourHex(baseColour, tuningVis.colour, kineticIntensity * 0.5);

    // Only draw cells in the outer 35% ring (inner radius = 65% of clip radius)
    const innerRadiusSq = (clipRadius * 0.65) * (clipRadius * 0.65);
    const outerRadiusSq = clipRadius * clipRadius;

    for (const cell of cells) {
        const rx = cell.cx * cos - cell.cy * sin + centreX;
        const ry = cell.cx * sin + cell.cy * cos + centreY;

        // Only draw cells in the outer ring band
        const distSq = rx * rx + ry * ry;
        if (distSq > outerRadiusSq || distSq < innerRadiusSq) continue;

        drawHexCell(g, rx, ry, halfCell, hexColour, edgeAlpha, fillAlpha, 0.8);
    }

    // Find active impact flash cells
    for (const impact of impacts) {
        if (impact.style !== 'kinetic') continue;
        const impactIdx = closestHexCell(cells, impact.angle, gridRadius * 0.9);
        if (impactIdx < 0) continue;

        for (let i = 0; i < cells.length; i++) {
            const cell = cells[i];
            const rx = cell.cx * cos - cell.cy * sin + centreX;
            const ry = cell.cx * sin + cell.cy * cos + centreY;
            const distSq = rx * rx + ry * ry;
            if (distSq > outerRadiusSq) continue;

            const hitCell = cells[impactIdx];
            const dx = cell.cx - hitCell.cx;
            const dy = cell.cy - hitCell.cy;
            const distCells = Math.sqrt(dx * dx + dy * dy) / cellSize;
            const ring = Math.round(distCells);

            if (ring <= impact.rippleRing && ring <= 3) {
                const flashFade = 1 - (impact.rippleRing > 0 ? (ring / impact.rippleRing) * 0.5 : 0);
                const flashAlpha = flashFade * (impact.timer / 300) * baseAlpha;
                if (ring === 0) {
                    // Hit cell — bright white/bronze flash
                    drawHexCell(g, rx, ry, halfCell, 0xffffff, flashAlpha * 0.8, flashAlpha * 0.3, 1.2);
                    // Crack pattern inside hit cell
                    if (impact.timer > 100) {
                        const crackAlpha = ((impact.timer - 100) / 200) * baseAlpha;
                        g.lineStyle(0.5, 0xffffff, crackAlpha);
                        g.beginPath();
                        g.moveTo(rx, ry);
                        for (let c = 0; c < 3; c++) {
                            const ca = impact.angle + (c - 1) * 1.0;
                            g.lineTo(rx + Math.cos(ca) * halfCell * 0.8, ry + Math.sin(ca) * halfCell * 0.8);
                            g.moveTo(rx, ry);
                        }
                        g.strokePath();
                    }
                } else {
                    // Ripple ring cells
                    drawHexCell(g, rx, ry, halfCell, hexColour, flashAlpha * 0.4, 0, 1);
                }
            }
        }
    }
}

function renderTendrils(
    g: Phaser.GameObjects.Graphics,
    state: ShieldEffectState,
    energyIntensity: number,
    tuning: number,
    radius: number,
    baseColour: number,
    baseAlpha: number
): void {
    // Colour cycle: at tuning 1.0, cycle blue → violet → magenta → cyan
    const colourShiftIntensity = tuning > 0.7
        ? Math.min(1.0, (tuning - 0.7) / 0.3)
        : 0.0;

    for (const t of state.tendrils) {
        if (!t.active) continue;

        // Determine tendril colour
        let tColour = baseColour;
        if (colourShiftIntensity > 0) {
            const prismatic = getPrismaticColour(t.colourPhase);
            tColour = blendColourHex(baseColour, prismatic, colourShiftIntensity * 0.7);
            // Make slightly brighter/more saturated
            tColour = blendColourHex(tColour, 0xffffff, 0.15);
        }

        const opacity = t.opacity * energyIntensity * baseAlpha;
        const accel = state.tendrilAccelTimer > 0 ? 1.3 : 1.0;
        const brighten = accel > 1 ? 0.2 : 0;

        g.lineStyle(t.width, tColour, Math.min(1, opacity + brighten));
        g.beginPath();

        // Draw arc along circumference
        const arcLen = t.length * energyIntensity;
        const segments = 12;
        for (let i = 0; i <= segments; i++) {
            const frac = i / segments;
            const angle = t.angle + frac * arcLen;
            // Slight inward wobble for organic feel
            const wobble = radius - 1 + Math.sin(frac * Math.PI * 3 + t.colourPhase * 10) * 1.5;
            const px = Math.cos(angle) * wobble;
            const py = Math.sin(angle) * wobble;
            // Taper at ends
            if (i === 0) {
                g.moveTo(px, py);
            } else {
                g.lineTo(px, py);
            }
        }
        g.strokePath();
    }
}

function renderFloatingParticles(
    g: Phaser.GameObjects.Graphics,
    state: ShieldEffectState,
    energyIntensity: number,
    tuning: number,
    radius: number,
    baseAlpha: number
): void {
    const colourShiftIntensity = tuning > 0.7
        ? Math.min(1.0, (tuning - 0.7) / 0.3)
        : 0.0;

    for (const p of state.particles) {
        if (!p.active) continue;

        const px = Math.cos(p.angle) * (radius - 3);
        const py = Math.sin(p.angle) * (radius - 3);

        const pAlpha = energyIntensity * baseAlpha * 0.7;

        // Glow halo
        let glowCol = 0xffffff;
        if (colourShiftIntensity > 0) {
            const prismatic = getPrismaticColour(state.prismaticPhase + p.angle * 0.1);
            glowCol = blendColourHex(0xffffff, prismatic, colourShiftIntensity * 0.3);
        }

        g.fillStyle(glowCol, pAlpha * 0.15);
        g.fillCircle(px, py, p.glowRadius);

        // Core dot
        const coreAlpha = p.sparking ? pAlpha * 1.5 : pAlpha;
        g.fillStyle(0xffffff, Math.min(1, coreAlpha));
        g.fillCircle(px, py, p.sparking ? 3 : 2);
    }
}

function renderImpact(
    g: Phaser.GameObjects.Graphics,
    impact: ImpactFlash,
    radius: number,
    _baseColour: number
): void {
    const px = Math.cos(impact.angle) * radius;
    const py = Math.sin(impact.angle) * radius;

    if (impact.style === 'balanced') {
        // Simple flash at impact point + expanding ring
        const t = 1 - impact.timer / 200;
        const flashAlpha = (1 - t) * 0.7;
        g.fillStyle(0xffffff, flashAlpha);
        g.fillCircle(px, py, 4 * (1 - t * 0.5));
        // Expanding ring
        g.lineStyle(1, impact.colour, flashAlpha * 0.5);
        g.strokeCircle(px, py, 8 + t * 15);
    } else if (impact.style === 'energy') {
        // Contact flash
        const t = 1 - impact.timer / 300;
        if (t < 0.27) {
            const flashAlpha = (1 - t / 0.27) * 0.9;
            g.fillStyle(0xffffff, flashAlpha);
            g.fillCircle(px, py, 5);
            g.fillStyle(impact.colour, flashAlpha * 0.5);
            g.fillCircle(px, py, 8);
        }
        // Web-lightning branches
        for (const branch of impact.branches) {
            if (branch.opacity <= 0.01) continue;
            g.lineStyle(1, blendColourHex(impact.colour, 0xffffff, 0.5), branch.opacity * 0.8);
            g.beginPath();
            let started = false;
            for (const a of branch.angles) {
                const bx = Math.cos(a) * radius;
                const by = Math.sin(a) * radius;
                if (!started) {
                    g.moveTo(bx, by);
                    started = true;
                } else {
                    g.lineTo(bx, by);
                }
            }
            g.strokePath();
        }
    }
    // Kinetic impacts are rendered inline with hex tessellation (above)
}

function renderCollapseFragments(
    g: Phaser.GameObjects.Graphics,
    state: ShieldEffectState
): void {
    for (const f of state.fragments) {
        if (!f.active) continue;
        const fadeAlpha = f.timer / 400;

        if (f.style === 'kinetic') {
            // Angular shard
            const cos = Math.cos(f.rotation);
            const sin = Math.sin(f.rotation);
            const s = f.size;
            g.fillStyle(f.colour, fadeAlpha * 0.7);
            g.beginPath();
            g.moveTo(f.x + cos * s, f.y + sin * s);
            g.lineTo(f.x - sin * s * 0.6, f.y + cos * s * 0.6);
            g.lineTo(f.x - cos * s * 0.5, f.y - sin * s * 0.5);
            g.closePath();
            g.fillPath();
            g.lineStyle(0.5, blendColourHex(f.colour, 0xffffff, 0.3), fadeAlpha * 0.9);
            g.strokePath();
        } else if (f.style === 'energy') {
            // Bright dot with glow
            g.fillStyle(f.colour, fadeAlpha * 0.3);
            g.fillCircle(f.x, f.y, f.size * 2);
            g.fillStyle(0xffffff, fadeAlpha * 0.8);
            g.fillCircle(f.x, f.y, f.size * 0.7);
        } else {
            // Balanced — simple dot
            g.fillStyle(f.colour, fadeAlpha * 0.6);
            g.fillCircle(f.x, f.y, f.size);
        }
    }
}

function scatterParticles(state: ShieldEffectState, impactAngle: number): void {
    let scattered = 0;
    for (const p of state.particles) {
        if (!p.active || scattered >= 8) break;
        // Scatter particles near the impact
        let diff = p.angle - impactAngle;
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        if (Math.abs(diff) < Math.PI * 0.5) {
            // Burst away from impact
            p.scatterSpeed = (diff > 0 ? 1 : -1) * 0.003;
            p.scatterTimer = 400;
            scattered++;
        }
    }
}

// ── Cluster-specific helpers ──────────────────────────────────────────

/**
 * Get arc styling properties based on cluster tuning.
 */
export function getClusterArcStyle(tuning: number, syncPhase: number): {
    colour: number;
    lineWidthMult: number;
    alphaMult: number;
    pulse: number;
} {
    const kineticIntensity = tuning < 0.5
        ? Math.min(1.0, (0.5 - tuning) / 0.2)
        : 0.0;
    const energyIntensity = tuning > 0.5
        ? Math.min(1.0, (tuning - 0.5) / 0.2)
        : 0.0;

    const tuningVis = getTuningVisual(tuning);
    let colour = tuningVis.colour;

    if (energyIntensity > 0.3) {
        // Prismatic arcs
        const phase = (syncPhase * 0.1) % 1;
        const prismatic = getPrismaticColour(phase);
        colour = blendColourHex(colour, prismatic, energyIntensity * 0.5);
    }

    return {
        colour,
        lineWidthMult: kineticIntensity > 0.3 ? 1.3 : (energyIntensity > 0.3 ? 0.8 : 1.0),
        alphaMult: 1.0,
        // Energy arcs pulse in sync with breathing (2s cycle)
        pulse: energyIntensity > 0.3
            ? 0.8 + 0.2 * Math.sin(syncPhase * Math.PI)
            : 1.0,
    };
}
