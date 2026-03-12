export function distanceBetween(
    x1: number, y1: number,
    x2: number, y2: number
): number {
    const dx = x2 - x1;
    const dy = y2 - y1;
    return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Shield tuning visual interpolation.
 * 5 anchor points from kinetic (0.0) to energy (1.0), linearly interpolated.
 * Returns { colour: 0xRRGGBB, opacity: number }.
 */
const TUNING_ANCHORS: Array<{ t: number; r: number; g: number; b: number; a: number }> = [
    { t: 0.0,  r: 180, g: 150, b: 100, a: 0.60 },
    { t: 0.25, r: 200, g: 170, b: 80,  a: 0.45 },
    { t: 0.5,  r: 0,   g: 220, b: 255, a: 0.30 },
    { t: 0.75, r: 120, g: 140, b: 255, a: 0.20 },
    { t: 1.0,  r: 180, g: 120, b: 255, a: 0.12 },
];

export function getTuningVisual(tuning: number): { colour: number; opacity: number } {
    const clamped = Math.max(0, Math.min(1, tuning));

    // Find surrounding anchors
    let lo = TUNING_ANCHORS[0];
    let hi = TUNING_ANCHORS[TUNING_ANCHORS.length - 1];
    for (let i = 0; i < TUNING_ANCHORS.length - 1; i++) {
        if (clamped >= TUNING_ANCHORS[i].t && clamped <= TUNING_ANCHORS[i + 1].t) {
            lo = TUNING_ANCHORS[i];
            hi = TUNING_ANCHORS[i + 1];
            break;
        }
    }

    const range = hi.t - lo.t;
    const f = range > 0 ? (clamped - lo.t) / range : 0;

    const r = Math.round(lo.r + (hi.r - lo.r) * f);
    const g = Math.round(lo.g + (hi.g - lo.g) * f);
    const b = Math.round(lo.b + (hi.b - lo.b) * f);
    const opacity = lo.a + (hi.a - lo.a) * f;

    return { colour: (r << 16) | (g << 8) | b, opacity };
}

export function hexagonPoints(cx: number, cy: number, radius: number): number[] {
    const points: number[] = [];
    for (let i = 0; i < 6; i++) {
        const angle = (Math.PI / 3) * i - Math.PI / 6;
        points.push(cx + radius * Math.cos(angle));
        points.push(cy + radius * Math.sin(angle));
    }
    return points;
}
