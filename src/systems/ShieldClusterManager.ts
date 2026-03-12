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
}

export class ShieldClusterManager {
    private clusters: ShieldCluster[] = [];
    private memberToCluster: Map<IClusterShield, ShieldCluster> = new Map();
    /** Preserved sync phases keyed by a stable cluster fingerprint */
    private prevPhases: Map<string, number> = new Map();
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
        this.memberToCluster.clear();

        // Dissolve: shields leaving clusters inherit cluster tuning
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

            // Preserve sync phase from previous frame
            const key = this.clusterKey(members);
            const prevPhase = this.prevPhases.get(key) ?? 0;

            // Average tuning across members for cluster tuning
            const avgTuning = members.reduce((sum, m) => sum + m.tuning, 0) / members.length;

            const cluster: ShieldCluster = {
                members, edges, syncPhase: prevPhase, centerX: cx, centerY: cy,
                clusterTuning: avgTuning,
                clusterManualLock: false,
                lastTuningDriftTime: 0
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
    }

    /** Idle decay for all cluster tunings — called each frame */
    updateClusterTuningDecay(): void {
        for (const cluster of this.clusters) {
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
            // Persist for next rebuild
            const key = this.clusterKey(cluster.members);
            this.prevPhases.set(key, cluster.syncPhase);
            for (const member of cluster.members) {
                member.clusterSyncPhase = cluster.syncPhase;
            }
        }
    }

    /** Render all cluster visuals (arcs + membrane). Called each frame. */
    renderClusters(): void {
        if (!this.clusterGraphics) return;
        this.clusterGraphics.clear();

        for (const cluster of this.clusters) {
            this.renderClusterArcs(cluster);
            this.renderClusterMembrane(cluster);
        }
    }

    // ── Harmonic arcs ──────────────────────────────────────────────

    private renderClusterArcs(cluster: ShieldCluster): void {
        const g = this.clusterGraphics!;
        const amplitude = CLUSTER_ARC_AMPLITUDE * Math.sin(cluster.syncPhase * CLUSTER_ARC_SPEED);
        const tuningVis = getTuningVisual(cluster.clusterTuning);
        const arcColour = tuningVis.colour;

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
            const innerWidth = isHubEdge ? 3 : 2;
            const innerAlpha = isHubEdge ? 0.22 : 0.15;
            const glowWidth = isHubEdge ? 8 : 5;
            const glowAlpha = isHubEdge ? 0.07 : 0.04;

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

        const tuningVis = getTuningVisual(cluster.clusterTuning);
        const membraneColour = tuningVis.colour;

        // Draw glow layer
        g.lineStyle(6, membraneColour, 0.03);
        g.beginPath();
        g.moveTo(smoothed[0].x, smoothed[0].y);
        for (let i = 1; i < smoothed.length; i++) {
            g.lineTo(smoothed[i].x, smoothed[i].y);
        }
        g.closePath();
        g.strokePath();

        // Draw inner membrane
        g.lineStyle(2, membraneColour, 0.08);
        g.beginPath();
        g.moveTo(smoothed[0].x, smoothed[0].y);
        for (let i = 1; i < smoothed.length; i++) {
            g.lineTo(smoothed[i].x, smoothed[i].y);
        }
        g.closePath();
        g.strokePath();
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
}
