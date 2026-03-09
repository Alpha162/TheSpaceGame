import { distanceBetween } from '../utils/Helpers';
import { SHIELD_CLUSTER_OVERLAP_MARGIN } from '../utils/Constants';

export interface IClusterShield {
    x: number;
    y: number;
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
    syncPhase: number;
    centerX: number;
    centerY: number;
}

export class ShieldClusterManager {
    private clusters: ShieldCluster[] = [];
    private memberToCluster: Map<IClusterShield, ShieldCluster> = new Map();
    /** Preserved sync phases keyed by a stable cluster fingerprint */
    private prevPhases: Map<string, number> = new Map();

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

        // Pairwise overlap check
        for (let i = 0; i < shields.length; i++) {
            for (let j = i + 1; j < shields.length; j++) {
                const a = shields[i];
                const b = shields[j];
                const dist = distanceBetween(a.x, a.y, b.x, b.y);
                if (dist < a.getShieldRadius() + b.getShieldRadius() + SHIELD_CLUSTER_OVERLAP_MARGIN) {
                    union(i, j);
                }
            }
        }

        // Group by root
        const groups = new Map<number, IClusterShield[]>();
        for (let i = 0; i < shields.length; i++) {
            const root = find(i);
            let group = groups.get(root);
            if (!group) {
                group = [];
                groups.set(root, group);
            }
            group.push(shields[i]);
        }

        // Build clusters from groups with more than 1 member
        const newPhases = new Map<string, number>();
        this.clusters = [];
        for (const members of groups.values()) {
            if (members.length < 2) continue;

            // Compute barycenter
            let cx = 0, cy = 0;
            for (const m of members) { cx += m.x; cy += m.y; }
            cx /= members.length;
            cy /= members.length;

            // Preserve sync phase from previous frame
            const key = this.clusterKey(members);
            const prevPhase = this.prevPhases.get(key) ?? 0;

            const cluster: ShieldCluster = { members, syncPhase: prevPhase, centerX: cx, centerY: cy };
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

    getClusters(): ShieldCluster[] {
        return this.clusters;
    }
}
