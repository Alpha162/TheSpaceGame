import { distanceBetween, getTuningVisual } from '../utils/Helpers';
import {
    SHIELD_CLUSTER_OVERLAP_MARGIN,
    SHIELD_TUNE_DEFAULT, SHIELD_TUNE_MIN, SHIELD_TUNE_MAX,
    SHIELD_TUNE_DRIFT_PER_HIT, SHIELD_TUNE_DRIFT_DECAY, SHIELD_TUNE_MANUAL_DRIFT_MULT,
    CLUSTER_ARC_SEGMENTS,
    CLUSTER_ARC_AMPLITUDE,
    CLUSTER_ARC_SPEED,
    CLUSTER_MEMBRANE_MARGIN,
    CLUSTER_MEMBRANE_SAMPLES
} from '../utils/Constants';
import { getClusterArcStyle, renderHexTessellationAt, type ShieldEffectState, type ImpactFlash } from '../rendering/ShieldEffects';

export interface IClusterShield {
    x: number;
    y: number;
    readonly isHub: boolean;
    getShieldRadius(): number;
    getHeat(): number;
    setHeat(value: number): void;
    isShieldActive(): boolean;
    collapseShield(): void;
    inCluster: boolean;
    clusterSyncPhase: number;
    /** Barycenter of the cluster this shield belongs to */
    clusterCenterX: number;
    clusterCenterY: number;
    /** Shield tuning (0.0 = kinetic, 0.5 = balanced, 1.0 = energy) */
    tuning: number;
    manualLock: boolean;
    lastTuningDriftTime: number;
    /** Visual effect state for cluster-level rendering */
    effectState: ShieldEffectState;
}

export interface ShieldCluster {
    members: IClusterShield[];
    edges: Array<[IClusterShield, IClusterShield]>;
    syncPhase: number;
    centerX: number;
    centerY: number;
    clusterTuning: number;
    clusterManualLock: boolean;
    lastTuningDriftTime: number;
    /** Unified hex rotation for cluster-level kinetic tessellation */
    hexRotation: number;
}

export class ShieldClusterManager {
    private clusters: ShieldCluster[] = [];
    private memberToCluster: Map<IClusterShield, ShieldCluster> = new Map();
    /** Preserved state keyed by a stable cluster fingerprint */
    private prevPhases: Map<string, number> = new Map();
    private prevTuning: Map<string, number> = new Map();
    private prevLock: Map<string, boolean> = new Map();
    private prevHexRotation: Map<string, number> = new Map();
    private clusterGraphics: Phaser.GameObjects.Graphics | null = null;

    init(scene: Phaser.Scene): void {
        this.clusterGraphics = scene.add.graphics();
        this.clusterGraphics.setDepth(-3);
    }

    destroy(): void {
        if (this.clusterGraphics) {
            this.clusterGraphics.destroy();
            this.clusterGraphics = null;
        }
    }

    private clusterKey(members: IClusterShield[]): string {
        return members.map(m => `${m.x},${m.y}`).sort().join('|');
    }

    /** Rebuild clusters from scratch using union-find on bubble overlap. */
    rebuild(shields: IClusterShield[]): void {
        // Dissolve: shields leaving clusters inherit cluster tuning
        // (must happen BEFORE clearing memberToCluster)
        for (const s of shields) {
            if (s.inCluster) {
                const oldCluster = this.memberToCluster.get(s);
                if (oldCluster) {
                    s.tuning = oldCluster.clusterTuning;
                    s.manualLock = oldCluster.clusterManualLock;
                }
            }
            s.inCluster = false;
        }
        this.memberToCluster.clear();

        if (shields.length < 2) {
            this.clusters = [];
            this.prevPhases.clear();
            return;
        }

        // Union-find
        const parent = shields.map((_, i) => i);
        const find = (i: number): number => {
            while (parent[i] !== i) {
                parent[i] = parent[parent[i]];
                i = parent[i];
            }
            return i;
        };
        const union = (a: number, b: number): void => {
            parent[find(a)] = find(b);
        };

        // Pairwise overlap check — also collect edges
        const edgePairs: Array<[number, number]> = [];
        for (let i = 0; i < shields.length; i++) {
            for (let j = i + 1; j < shields.length; j++) {
                const a = shields[i];
                const b = shields[j];
                const dist = distanceBetween(a.x, a.y, b.x, b.y);
                if (dist < a.getShieldRadius() + b.getShieldRadius() + SHIELD_CLUSTER_OVERLAP_MARGIN) {
                    union(i, j);
                    edgePairs.push([i, j]);
                }
            }
        }

        // Group by root
        const groups = new Map<number, number[]>();
        for (let i = 0; i < shields.length; i++) {
            const root = find(i);
            let group = groups.get(root);
            if (!group) {
                group = [];
                groups.set(root, group);
            }
            group.push(i);
        }

        // Build clusters from groups with more than 1 member
        const newPhases = new Map<string, number>();
        this.clusters = [];
        for (const indices of groups.values()) {
            if (indices.length < 2) continue;

            const members = indices.map(i => shields[i]);
            const memberSet = new Set(indices);

            // Collect edges belonging to this cluster
            const edges: Array<[IClusterShield, IClusterShield]> = [];
            for (const [i, j] of edgePairs) {
                if (memberSet.has(i)) {
                    edges.push([shields[i], shields[j]]);
                }
            }

            // Compute barycenter
            let cx = 0, cy = 0;
            for (const m of members) { cx += m.x; cy += m.y; }
            cx /= members.length;
            cy /= members.length;

            // Preserve state from previous frame
            const key = this.clusterKey(members);
            const prevPhase = this.prevPhases.get(key) ?? 0;
            const prevTuning = this.prevTuning.get(key);
            const prevLock = this.prevLock.get(key);
            const prevHexRot = this.prevHexRotation.get(key) ?? 0;

            // If this exact cluster existed before, keep its tuning/lock.
            // Otherwise average member tunings (which already inherited from
            // their old cluster via the dissolve step above).
            const clusterTuning = prevTuning !== undefined
                ? prevTuning
                : members.reduce((sum, m) => sum + m.tuning, 0) / members.length;
            const clusterManualLock = prevLock ?? false;

            const cluster: ShieldCluster = {
                members, edges, syncPhase: prevPhase, centerX: cx, centerY: cy,
                clusterTuning,
                clusterManualLock,
                lastTuningDriftTime: 0,
                hexRotation: prevHexRot,
            };
            this.clusters.push(cluster);
            newPhases.set(key, prevPhase);
            for (const m of members) {
                m.inCluster = true;
                m.clusterCenterX = cx;
                m.clusterCenterY = cy;
                this.memberToCluster.set(m, cluster);
            }
        }
        this.prevPhases = newPhases;
        // Also snapshot tuning/lock for the new cluster set
        this.prevTuning.clear();
        this.prevLock.clear();
        for (const cluster of this.clusters) {
            const key = this.clusterKey(cluster.members);
            this.prevTuning.set(key, cluster.clusterTuning);
            this.prevLock.set(key, cluster.clusterManualLock);
        }
    }

    /** Distribute heat from a damage event across the cluster. */
    distributeHeat(target: IClusterShield, heatIncrease: number): void {
        const cluster = this.memberToCluster.get(target);

        if (!cluster) {
            // Solo shield — apply directly
            target.setHeat(target.getHeat() + heatIncrease);
            if (target.getHeat() >= 1) {
                target.collapseShield();
            }
            return;
        }

        const activeMembers = cluster.members.filter(m => m.isShieldActive());
        if (activeMembers.length === 0) return;

        const heatPerMember = heatIncrease / activeMembers.length;
        for (const member of activeMembers) {
            member.setHeat(member.getHeat() + heatPerMember);
        }

        // If any member overloaded, collapse all
        if (activeMembers.some(m => m.getHeat() >= 1)) {
            for (const member of activeMembers) {
                member.collapseShield();
            }
        }
    }

    /** Apply tuning drift at cluster level (one drift per hit for the whole cluster) */
    applyClusterTuningDrift(cluster: ShieldCluster, incomingDamageType: number): void {
        const driftRate = cluster.clusterManualLock
            ? SHIELD_TUNE_DRIFT_PER_HIT * SHIELD_TUNE_MANUAL_DRIFT_MULT
            : SHIELD_TUNE_DRIFT_PER_HIT;

        if (incomingDamageType < cluster.clusterTuning) {
            cluster.clusterTuning = Math.max(SHIELD_TUNE_MIN, cluster.clusterTuning - driftRate);
        } else if (incomingDamageType > cluster.clusterTuning) {
            cluster.clusterTuning = Math.min(SHIELD_TUNE_MAX, cluster.clusterTuning + driftRate);
        }

        // Persist so rebuild() sees the change
        const key = this.clusterKey(cluster.members);
        this.prevTuning.set(key, cluster.clusterTuning);
    }

    /** Idle decay for all cluster tunings — called each frame */
    updateClusterTuningDecay(): void {
        for (const cluster of this.clusters) {
            if (cluster.clusterManualLock) continue;
            if (cluster.clusterTuning > 0.5) {
                cluster.clusterTuning = Math.max(0.5, cluster.clusterTuning - SHIELD_TUNE_DRIFT_DECAY);
            } else if (cluster.clusterTuning < 0.5) {
                cluster.clusterTuning = Math.min(0.5, cluster.clusterTuning + SHIELD_TUNE_DRIFT_DECAY);
            }
        }
    }

    /** Advance synced ripple phase for each cluster. */
    updateSyncPhase(delta: number): void {
        for (const cluster of this.clusters) {
            cluster.syncPhase += delta * 0.0008;
            // Advance cluster hex rotation (1 rotation per 30s)
            const kineticIntensity = cluster.clusterTuning < 0.5
                ? Math.min(1.0, (0.5 - cluster.clusterTuning) / 0.2)
                : 0.0;
            if (kineticIntensity > 0) {
                cluster.hexRotation += (delta / 1000) * (Math.PI * 2 / 30);
            }
            // Persist for next rebuild
            const key = this.clusterKey(cluster.members);
            this.prevPhases.set(key, cluster.syncPhase);
            this.prevTuning.set(key, cluster.clusterTuning);
            this.prevLock.set(key, cluster.clusterManualLock);
            this.prevHexRotation.set(key, cluster.hexRotation);
            for (const member of cluster.members) {
                member.clusterSyncPhase = cluster.syncPhase;
            }
        }
    }

    /** Render all cluster visuals (arcs + membrane + unified hex). Called each frame. */
    renderClusters(): void {
        if (!this.clusterGraphics) return;
        this.clusterGraphics.clear();

        for (const cluster of this.clusters) {
            this.renderClusterArcs(cluster);
            this.renderClusterMembrane(cluster);
            this.renderClusterHex(cluster);
        }
    }

    // ── Harmonic arcs ──────────────────────────────────────────────

    private renderClusterArcs(cluster: ShieldCluster): void {
        const g = this.clusterGraphics!;
        const amplitude = CLUSTER_ARC_AMPLITUDE * Math.sin(cluster.syncPhase * CLUSTER_ARC_SPEED);

        // Get tuning-aware arc styling
        const arcStyle = getClusterArcStyle(cluster.clusterTuning, cluster.syncPhase);
        const arcColour = arcStyle.colour;

        for (const [a, b] of cluster.edges) {
            const dx = b.x - a.x;
            const dy = b.y - a.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist < 1) continue;

            // Perpendicular unit vector
            const perpX = -dy / dist;
            const perpY = dx / dist;

            // Hub connections get emphasized styling
            const isHubEdge = a.isHub || b.isHub;
            const baseInnerWidth = isHubEdge ? 3 : 2;
            const baseInnerAlpha = isHubEdge ? 0.22 : 0.15;
            const baseGlowWidth = isHubEdge ? 8 : 5;
            const baseGlowAlpha = isHubEdge ? 0.07 : 0.04;

            // Apply tuning-based modifiers
            const innerWidth = baseInnerWidth * arcStyle.lineWidthMult;
            const innerAlpha = baseInnerAlpha * arcStyle.alphaMult * arcStyle.pulse;
            const glowWidth = baseGlowWidth * arcStyle.lineWidthMult;
            const glowAlpha = baseGlowAlpha * arcStyle.alphaMult * arcStyle.pulse;

            // Draw two arcs bowing in opposite directions
            for (const sign of [1, -1]) {
                // Glow layer
                g.lineStyle(glowWidth, arcColour, glowAlpha);
                g.beginPath();
                for (let i = 0; i <= CLUSTER_ARC_SEGMENTS; i++) {
                    const t = i / CLUSTER_ARC_SEGMENTS;
                    const wave = Math.sin(t * Math.PI) * amplitude * sign;
                    const px = a.x + dx * t + perpX * wave;
                    const py = a.y + dy * t + perpY * wave;
                    if (i === 0) g.moveTo(px, py); else g.lineTo(px, py);
                }
                g.strokePath();

                // Inner layer
                g.lineStyle(innerWidth, arcColour, innerAlpha);
                g.beginPath();
                for (let i = 0; i <= CLUSTER_ARC_SEGMENTS; i++) {
                    const t = i / CLUSTER_ARC_SEGMENTS;
                    const wave = Math.sin(t * Math.PI) * amplitude * sign;
                    const px = a.x + dx * t + perpX * wave;
                    const py = a.y + dy * t + perpY * wave;
                    if (i === 0) g.moveTo(px, py); else g.lineTo(px, py);
                }
                g.strokePath();
            }
        }
    }

    // ── Cluster membrane ───────────────────────────────────────────

    private renderClusterMembrane(cluster: ShieldCluster): void {
        const g = this.clusterGraphics!;

        // Build one unified contour from the union of all shield circles.
        // We ray-cast from cluster center so hub size naturally influences silhouette.
        const contour: Array<{ x: number; y: number }> = [];
        for (let i = 0; i < CLUSTER_MEMBRANE_SAMPLES; i++) {
            const angle = (i / CLUSTER_MEMBRANE_SAMPLES) * Math.PI * 2;
            const ux = Math.cos(angle);
            const uy = Math.sin(angle);

            let bestT = -Infinity;
            for (const m of cluster.members) {
                const r = m.getShieldRadius() + CLUSTER_MEMBRANE_MARGIN;
                const ox = cluster.centerX - m.x;
                const oy = cluster.centerY - m.y;

                // Intersect ray C + t*u with circle |P - M|^2 = r^2
                const proj = -(ox * ux + oy * uy);
                const perpSq = ox * ox + oy * oy - proj * proj;
                if (perpSq > r * r) continue;

                const reach = Math.sqrt(r * r - perpSq);
                const t = proj + reach;
                if (t > bestT) bestT = t;
            }

            if (!Number.isFinite(bestT)) continue;

            const wobble = 1 + Math.sin(angle * 3 + cluster.syncPhase * 1.4) * 0.015;
            contour.push({
                x: cluster.centerX + ux * bestT * wobble,
                y: cluster.centerY + uy * bestT * wobble
            });
        }

        if (contour.length < 3) return;

        // Smooth silhouette while keeping the same topology.
        let smoothed = contour;
        smoothed = this.chaikinSmooth(smoothed);
        smoothed = this.chaikinSmooth(smoothed);

        const arcStyle = getClusterArcStyle(cluster.clusterTuning, cluster.syncPhase);
        const membraneColour = arcStyle.colour;

        // Draw glow layer
        g.lineStyle(6, membraneColour, 0.03 * arcStyle.pulse);
        g.beginPath();
        g.moveTo(smoothed[0].x, smoothed[0].y);
        for (let i = 1; i < smoothed.length; i++) {
            g.lineTo(smoothed[i].x, smoothed[i].y);
        }
        g.closePath();
        g.strokePath();

        // Draw inner membrane
        g.lineStyle(2, membraneColour, 0.08 * arcStyle.pulse);
        g.beginPath();
        g.moveTo(smoothed[0].x, smoothed[0].y);
        for (let i = 1; i < smoothed.length; i++) {
            g.lineTo(smoothed[i].x, smoothed[i].y);
        }
        g.closePath();
        g.strokePath();
    }

    // ── Unified cluster hex tessellation ─────────────────────────────

    private renderClusterHex(cluster: ShieldCluster): void {
        const g = this.clusterGraphics!;
        const tuning = cluster.clusterTuning;
        const kineticIntensity = tuning < 0.5
            ? Math.min(1.0, (0.5 - tuning) / 0.2)
            : 0.0;
        if (kineticIntensity < 0.01) return;

        // Compute a grid radius that covers the full cluster extent
        let maxExtent = 0;
        for (const m of cluster.members) {
            const dx = m.x - cluster.centerX;
            const dy = m.y - cluster.centerY;
            const dist = Math.sqrt(dx * dx + dy * dy) + m.getShieldRadius();
            if (dist > maxExtent) maxExtent = dist;
        }

        // Collect all impact flashes from member shields
        const allImpacts: ImpactFlash[] = [];
        for (const m of cluster.members) {
            for (const impact of m.effectState.impacts) {
                allImpacts.push(impact);
            }
        }

        // Get base colour from tuning visual
        const tuningVis = getTuningVisual(tuning);
        const baseColour = tuningVis.colour;
        const baseAlpha = tuningVis.alpha;

        // Use a custom rendering approach: generate hex grid at cluster centre,
        // but only draw cells that fall inside at least one member shield circle.
        // This creates the unified armour shell look.
        const cellSize = (maxExtent * 2) / 9;
        const halfCell = cellSize * 0.55;

        // Generate hex grid centred at origin
        const cells = this.computeClusterHexGrid(maxExtent, cellSize);

        const cos = Math.cos(cluster.hexRotation);
        const sin = Math.sin(cluster.hexRotation);

        const edgeAlpha = kineticIntensity * 0.6 * baseAlpha;
        const fillAlpha = kineticIntensity * 0.05 * baseAlpha;

        for (const cell of cells) {
            // Rotate around cluster centre
            const rx = cell.cx * cos - cell.cy * sin + cluster.centerX;
            const ry = cell.cx * sin + cell.cy * cos + cluster.centerY;

            // Check if this cell falls inside any member shield's outer ring
            let insideAny = false;
            for (const m of cluster.members) {
                const dx = rx - m.x;
                const dy = ry - m.y;
                const distSq = dx * dx + dy * dy;
                const r = m.getShieldRadius();
                const outerSq = r * r;
                const innerSq = (r * 0.65) * (r * 0.65);
                if (distSq <= outerSq && distSq >= innerSq) {
                    insideAny = true;
                    break;
                }
            }
            if (!insideAny) continue;

            this.drawClusterHexCell(g, rx, ry, halfCell, baseColour, edgeAlpha, fillAlpha, 0.8);
        }

        // Impact flash rendering for cluster hex
        for (const impact of allImpacts) {
            if (impact.style !== 'kinetic') continue;
            const impactPx = Math.cos(impact.angle) * maxExtent * 0.9;
            const impactPy = Math.sin(impact.angle) * maxExtent * 0.9;

            // Find closest cell to impact
            let bestIdx = 0;
            let bestDist = Infinity;
            for (let i = 0; i < cells.length; i++) {
                const dx = cells[i].cx - impactPx;
                const dy = cells[i].cy - impactPy;
                const d = dx * dx + dy * dy;
                if (d < bestDist) { bestDist = d; bestIdx = i; }
            }

            const hitCell = cells[bestIdx];
            for (const cell of cells) {
                const rx = cell.cx * cos - cell.cy * sin + cluster.centerX;
                const ry = cell.cx * sin + cell.cy * cos + cluster.centerY;

                // Must be inside a member shield
                let inside = false;
                for (const m of cluster.members) {
                    const dx = rx - m.x;
                    const dy = ry - m.y;
                    if (dx * dx + dy * dy <= m.getShieldRadius() * m.getShieldRadius()) {
                        inside = true;
                        break;
                    }
                }
                if (!inside) continue;

                const dx = cell.cx - hitCell.cx;
                const dy = cell.cy - hitCell.cy;
                const distCells = Math.sqrt(dx * dx + dy * dy) / cellSize;
                const ring = Math.round(distCells);

                if (ring <= impact.rippleRing && ring <= 3) {
                    const flashFade = 1 - (impact.rippleRing > 0 ? (ring / impact.rippleRing) * 0.5 : 0);
                    const flashAlpha = flashFade * (impact.timer / 300) * baseAlpha;
                    if (ring === 0) {
                        this.drawClusterHexCell(g, rx, ry, halfCell, 0xffffff, flashAlpha * 0.8, flashAlpha * 0.3, 1.2);
                    } else {
                        this.drawClusterHexCell(g, rx, ry, halfCell, baseColour, flashAlpha * 0.4, 0, 1);
                    }
                }
            }
        }
    }

    private computeClusterHexGrid(radius: number, cellSize: number): Array<{ cx: number; cy: number }> {
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

    private drawClusterHexCell(
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
        if (fillAlpha > 0.005) {
            g.fillStyle(0x000000, fillAlpha);
            g.beginPath();
            g.moveTo(pts[0].x, pts[0].y);
            for (let i = 1; i < 6; i++) g.lineTo(pts[i].x, pts[i].y);
            g.closePath();
            g.fillPath();
        }
        if (edgeAlpha > 0.005) {
            g.lineStyle(lineWidth, colour, edgeAlpha);
            g.beginPath();
            g.moveTo(pts[0].x, pts[0].y);
            for (let i = 1; i < 6; i++) g.lineTo(pts[i].x, pts[i].y);
            g.closePath();
            g.strokePath();
        }
    }

    // ── Geometry helpers ───────────────────────────────────────────

    private chaikinSmooth(points: Array<{ x: number; y: number }>): Array<{ x: number; y: number }> {
        const result: Array<{ x: number; y: number }> = [];
        const n = points.length;
        for (let i = 0; i < n; i++) {
            const curr = points[i];
            const next = points[(i + 1) % n];
            result.push({
                x: curr.x * 0.75 + next.x * 0.25,
                y: curr.y * 0.75 + next.y * 0.25
            });
            result.push({
                x: curr.x * 0.25 + next.x * 0.75,
                y: curr.y * 0.25 + next.y * 0.75
            });
        }
        return result;
    }

    getClusters(): ShieldCluster[] {
        return this.clusters;
    }

    /** Return the cluster a shield belongs to, or undefined if solo. */
    getClusterFor(shield: IClusterShield): ShieldCluster | undefined {
        return this.memberToCluster.get(shield);
    }

    /** Set manual tuning for an entire cluster. */
    setClusterManualTuning(cluster: ShieldCluster, value: number): void {
        cluster.clusterTuning = Math.max(SHIELD_TUNE_MIN, Math.min(SHIELD_TUNE_MAX, value));
        cluster.clusterManualLock = true;
        // Persist immediately so rebuild() on the next frame sees the change
        const key = this.clusterKey(cluster.members);
        this.prevTuning.set(key, cluster.clusterTuning);
        this.prevLock.set(key, true);
    }

    /** Clear the manual lock on a cluster, allowing auto-drift to resume. */
    clearClusterManualLock(cluster: ShieldCluster): void {
        cluster.clusterManualLock = false;
        const key = this.clusterKey(cluster.members);
        this.prevLock.set(key, false);
    }
}
