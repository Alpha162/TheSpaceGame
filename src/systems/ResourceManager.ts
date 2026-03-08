import { STARTING_MINERALS } from '../utils/Constants';

export class ResourceManager {
    private minerals: number;
    private incomeRate = 0;

    constructor() {
        this.minerals = STARTING_MINERALS;
    }

    getMinerals(): number {
        return Math.floor(this.minerals);
    }

    getIncomeRate(): number {
        return this.incomeRate;
    }

    setIncomeRate(rate: number): void {
        this.incomeRate = rate;
    }

    canAfford(cost: number): boolean {
        return this.minerals >= cost;
    }

    spend(amount: number): boolean {
        if (this.minerals < amount) return false;
        this.minerals -= amount;
        return true;
    }

    earn(amount: number): void {
        this.minerals += amount;
    }
}
