export function distanceBetween(
    x1: number, y1: number,
    x2: number, y2: number
): number {
    const dx = x2 - x1;
    const dy = y2 - y1;
    return Math.sqrt(dx * dx + dy * dy);
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
