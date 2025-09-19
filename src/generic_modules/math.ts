const Epsilon = 0.00000001;

export interface Point {
    x: number;
    y: number;
}

export function doLineSegmentsIntersect(p: Point, p2: Point, q: Point, q2: Point, omitEnds: boolean): { x: number; y: number; t: number } | false {
    const r = subtractPoints(p2, p);
    const s = subtractPoints(q2, q);

    const uNumerator = crossProduct(subtractPoints(q, p), r);
    const denominator = crossProduct(r, s);

    if (uNumerator === 0 && denominator === 0) {
        return false;
    }

    if (denominator === 0) {
        return false;
    }

    const u = uNumerator / denominator;
    const t = crossProduct(subtractPoints(q, p), s) / denominator;

    let doSegmentsIntersect: boolean;
    if (!omitEnds) {
        doSegmentsIntersect = (t >= 0) && (t <= 1) && (u >= 0) && (u <= 1);
    } else {
        doSegmentsIntersect = (t > 0.001) && (t < 1 - 0.001) && (u > 0.001) && (u < 1 - 0.001);
    }

    if (doSegmentsIntersect) {
        return { x: p.x + t * r.x, y: p.y + t * r.y, t: t };
    }

    return false;
}

export function equalV(v1: Point, v2: Point): boolean {
    const diff = subtractPoints(v1, v2);
    const l2 = lengthV2(diff);
    return l2 < Epsilon;
}

export function addPoints(point1: Point, point2: Point): Point {
    return {
        x: point1.x + point2.x,
        y: point1.y + point2.y
    };
}

export function subtractPoints(point1: Point, point2: Point): Point {
    return {
        x: point1.x - point2.x,
        y: point1.y - point2.y
    };
}

export function crossProduct(point1: Point, point2: Point): number {
    return point1.x * point2.y - point1.y * point2.x;
}

export function dotProduct(point1: Point, point2: Point): number {
    return point1.x * point2.x + point1.y * point2.y;
}

export function length(point1: Point, point2: Point): number {
    const v = subtractPoints(point2, point1);
    return lengthV(v);
}

export function length2(point1: Point, point2: Point): number {
    const v = subtractPoints(point2, point1);
    return lengthV2(v);
}

export function lengthV(v: Point): number {
    return Math.sqrt(lengthV2(v));
}

export function lengthV2(v: Point): number {
    return v.x * v.x + v.y * v.y;
}

export function angleBetween(v1: Point, v2: Point): number {
    const angleRad = Math.acos((v1.x * v2.x + v1.y * v2.y) / (lengthV(v1) * lengthV(v2)));
    return angleRad * 180 / Math.PI;
}

export function sign(x: number): number {
    if (x > 0) return 1;
    if (x < 0) return -1;
    return 0;
}

export function fractionBetween(v1: Point, v2: Point, fraction: number): Point {
    const v1ToV2 = subtractPoints(v2, v1);
    return { x: (v1.x + v1ToV2.x * fraction), y: (v1.y + v1ToV2.y * fraction) };
}

export function sinDegrees(deg: number): number {
    return Math.sin(deg * Math.PI / 180);
}

export function cosDegrees(deg: number): number {
    return Math.cos(deg * Math.PI / 180);
}

export function atanDegrees(val: number): number {
    return Math.atan(val) * 180 / Math.PI;
}

export function randomRange(min: number, max: number): number {
    return Math.random() * (max - min) + min;
}

export function multVScalar(v: Point, n: number): Point {
    return { x: v.x * n, y: v.y * n };
}

export function divVScalar(v: Point, n: number): Point {
    return { x: v.x / n, y: v.y / n };
}

export function distanceToLine(P: Point, A: Point, B: Point): { distance2: number, pointOnLine: Point, lineProj2: number, length2: number } {
    const AP = subtractPoints(P, A);
    const AB = subtractPoints(B, A);
    const result = project(AP, AB);
    const AD = result.projected;
    const D = addPoints(A, AD);

    return {
        distance2: length2(D, P),
        pointOnLine: D,
        lineProj2: sign(result.dotProduct) * lengthV2(AD),
        length2: lengthV2(AB)
    };
}

export function project(v: Point, onto: Point): { dotProduct: number, projected: Point } {
    const dot = dotProduct(v, onto);
    return {
        dotProduct: dot,
        projected: multVScalar(onto, dot / lengthV2(onto))
    };
}