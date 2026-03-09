import { distanceBetween } from '../utils/Helpers';
import {
    SHIELD_CLUSTER_OVERLAP_MARGIN,
    COLOUR_CLUSTER_VIOLET,
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
}

export interface ShieldCluster {
    members: IClusterShield[];
    edges: Array<[IClusterShield, IClusterShield]>;
    syncPhase: number;
    centerX: number;
    centerY: number;
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

        // Reset all shields
        for (const s of shields) {
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

            const cluster: ShieldCluster = { members, edges, syncPhase: prevPhase, centerX: cx, centerY: cy };
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
                g.lineStyle(glowWidth, COLOUR_CLUSTER_VIOLET, glowAlpha);
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
                g.lineStyle(innerWidth, COLOUR_CLUSTER_VIOLET, innerAlpha);
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

        // 1. Sample offset points around each member
        const points: Array<{ x: number; y: number }> = [];
        for (const m of cluster.members) {
            const r = m.getShieldRadius() + CLUSTER_MEMBRANE_MARGIN;
            for (let i = 0; i < CLUSTER_MEMBRANE_SAMPLES; i++) {
                const angle = (i / CLUSTER_MEMBRANE_SAMPLES) * Math.PI * 2;
                const wobble = 1 + Math.sin(angle * 3 + cluster.syncPhase * 1.5) * 0.03;
                points.push({
                    x: m.x + r * wobble * Math.cos(angle),
                    y: m.y + r * wobble * Math.sin(angle)
                });
            }
        }

        // 2. Convex hull
        const hull = this.grahamScan(points);
        if (hull.length < 3) return;

        // 3. Chaikin smoothing (2 passes)
        let smoothed = hull;
        smoothed = this.chaikinSmooth(smoothed);
        smoothed = this.chaikinSmooth(smoothed);

        // 4. Draw glow layer
        g.lineStyle(6, COLOUR_CLUSTER_VIOLET, 0.03);
        g.beginPath();
        g.moveTo(smoothed[0].x, smoothed[0].y);
        for (let i = 1; i < smoothed.length; i++) {
            g.lineTo(smoothed[i].x, smoothed[i].y);
        }
        g.closePath();
        g.strokePath();

        // 5. Draw inner membrane
        g.lineStyle(2, COLOUR_CLUSTER_VIOLET, 0.08);
        g.beginPath();
        g.moveTo(smoothed[0].x, smoothed[0].y);
        for (let i = 1; i < smoothed.length; i++) {
            g.lineTo(smoothed[i].x, smoothed[i].y);
        }
        g.closePath();
        g.strokePath();
    }

    // ── Geometry helpers ───────────────────────────────────────────

    private grahamScan(points: Array<{ x: number; y: number }>): Array<{ x: number; y: number }> {
        if (points.length < 3) return points.slice();

        // Find bottom-most point (then left-most)
        let pivot = points[0];
        for (let i = 1; i < points.length; i++) {
            if (points[i].y < pivot.y || (points[i].y === pivot.y && points[i].x < pivot.x)) {
                pivot = points[i];
            }
        }

        // Sort by polar angle from pivot
        const sorted = points
            .filter(p => p !== pivot)
            .sort((a, b) => {
                const angleA = Math.atan2(a.y - pivot.y, a.x - pivot.x);
                const angleB = Math.atan2(b.y - pivot.y, b.x - pivot.x);
                if (angleA !== angleB) return angleA - angleB;
                // Same angle — keep the farther point
                const distA = (a.x - pivot.x) ** 2 + (a.y - pivot.y) ** 2;
                const distB = (b.x - pivot.x) ** 2 + (b.y - pivot.y) ** 2;
                return distA - distB;
            });

        const stack: Array<{ x: number; y: number }> = [pivot];
        for (const p of sorted) {
            while (stack.length > 1) {
                const top = stack[stack.length - 1];
                const below = stack[stack.length - 2];
                const cross = (top.x - below.x) * (p.y - below.y) - (top.y - below.y) * (p.x - below.x);
                if (cross <= 0) {
                    stack.pop();
                } else {
                    break;
                }
            }
            stack.push(p);
        }

        return stack;
    }

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
