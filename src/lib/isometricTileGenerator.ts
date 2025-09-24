/*
 * Procedural generation of isometric pavement tiles.
 * Adapted from standalone HTML prototype provided by design team.
 */

export interface TileGeneratorOptions {
    tileWidth: number;
    tileHeight: number;
    seedCount: number;
    damageProbability: number;
    lateralFocus: number;
    lateralBias: number;
    randomAmplitude: number;
    outlineColor: string;
    fillColor: string;
    crackColor: string;
    sideColor: string;
    thickness: number;
    seedPosition: number;
    seedDamage: number;
}

interface BuildTileArgs {
    W: number;
    H: number;
    count: number;
    damageProb: number;
    rngPos: () => number;
    rngDmg: () => number;
    latFocus: number;
    latBias: number;
    randAmp: number;
    outlineColor: string;
    fillColor: string;
    crackColor: string;
    thickness: number;
    sideColor: string;
}

const defaultOptions: TileGeneratorOptions = {
    tileWidth: 128,
    tileHeight: 64,
    seedCount: 400,
    damageProbability: 0.35,
    lateralFocus: 0.75,
    lateralBias: 1.2,
    randomAmplitude: 0.6,
    outlineColor: '#000000',
    fillColor: '#606060',
    crackColor: '#333333',
    sideColor: '#222222',
    thickness: 0,
    seedPosition: 12345,
    seedDamage: 54321,
};

const clampUnit = (value: number): number => {
    if (!Number.isFinite(value)) return 0;
    if (value < 0) return 0;
    if (value > 1) return 1;
    return value;
};

const createPRNG = (seed: number) => {
    let s = (seed >>> 0) || 0x12345678;
    return () => {
        s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
        return (s >>> 0) / 0x1_0000_0000;
    };
};

const hexToRGB = (hex: string): [number, number, number] => {
    const trimmed = hex.trim();
    if (/^#?[0-9a-f]{3}$/i.test(trimmed)) {
        const h = trimmed.replace('#', '');
        return [
            parseInt(h[0] + h[0], 16),
            parseInt(h[1] + h[1], 16),
            parseInt(h[2] + h[2], 16),
        ];
    }
    const match = trimmed.match(/^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
    if (!match) return [0, 0, 0];
    return [parseInt(match[1], 16), parseInt(match[2], 16), parseInt(match[3], 16)];
};

const insideDiamond = (x: number, y: number, W: number, H: number): boolean => {
    const cx = W * 0.5;
    const cy = H * 0.5;
    const u = Math.abs((x - cx) / (W * 0.5));
    const v = Math.abs((y - cy) / (H * 0.5));
    return (u + v) <= 1;
};

interface SegmentInfo {
    dist: number;
    t: number;
}

const distToSegmentInfo = (
    px: number,
    py: number,
    x1: number,
    y1: number,
    x2: number,
    y2: number,
): SegmentInfo => {
    const vx = x2 - x1;
    const vy = y2 - y1;
    const wx = px - x1;
    const wy = py - y1;
    const c2 = vx * vx + vy * vy;
    if (c2 === 0) {
        return { dist: Math.hypot(px - x1, py - y1), t: 0 };
    }
    const t = (vx * wx + vy * wy) / c2;
    let qx: number;
    let qy: number;
    if (t <= 0) {
        qx = x1;
        qy = y1;
    } else if (t >= 1) {
        qx = x2;
        qy = y2;
    } else {
        qx = x1 + t * vx;
        qy = y1 + t * vy;
    }
    return { dist: Math.hypot(px - qx, py - qy), t };
};

const diamondSideProx = (x: number, y: number, W: number, H: number) => {
    const cx = W * 0.5;
    const cy = H * 0.5;
    const T: [number, number] = [cx, cy - H * 0.5];
    const R: [number, number] = [cx + W * 0.5, cy];
    const B: [number, number] = [cx, cy + H * 0.5];
    const L: [number, number] = [cx - W * 0.5, cy];
    return {
        T: distToSegmentInfo(x, y, T[0], T[1], R[0], R[1]),
        R: distToSegmentInfo(x, y, R[0], R[1], B[0], B[1]),
        B: distToSegmentInfo(x, y, B[0], B[1], L[0], L[1]),
        L: distToSegmentInfo(x, y, L[0], L[1], T[0], T[1]),
    };
};

const maxSideDist = (W: number, H: number): number => {
    const aspect = H / W;
    return (H * 0.5) / Math.hypot(aspect, 1);
};

const buildTile = ({
    W,
    H,
    count,
    damageProb,
    rngPos,
    rngDmg,
    latFocus,
    latBias,
    randAmp,
    outlineColor,
    fillColor,
    crackColor,
    thickness,
    sideColor,
}: BuildTileArgs): HTMLCanvasElement => {
    const pts: number[] = new Array(count * 2);
    let p = 0;
    let tries = 0;
    while (p < count * 2 && tries < 20) {
        for (let k = 0; k < count && p < count * 2; k++) {
            const x = Math.floor(rngPos() * W);
            const y = Math.floor(rngPos() * H);
            if (insideDiamond(x, y, W, H)) {
                pts[p++] = x;
                pts[p++] = y;
            }
        }
        tries++;
    }
    const n = Math.floor(p / 2);
    const cpd = Math.max(6, Math.round(Math.sqrt(Math.max(n, 1))));
    const gx = cpd;
    const gy = cpd;
    const csx = W / gx;
    const csy = H / gy;
    const grid: number[][] = new Array(gx * gy).fill(null).map(() => []);
    for (let i = 0; i < n; i++) {
        const x = pts[2 * i];
        const y = pts[2 * i + 1];
        const cx = Math.min(gx - 1, Math.max(0, Math.floor(x / csx)));
        const cy = Math.min(gy - 1, Math.max(0, Math.floor(y / csy)));
        grid[cy * gx + cx].push(i);
    }
    const candidates = (x: number, y: number) => {
        const cx = Math.min(gx - 1, Math.max(0, Math.floor(x / csx)));
        const cy = Math.min(gy - 1, Math.max(0, Math.floor(y / csy)));
        let out: number[] = [];
        for (let r = 1; r <= 2; r++) {
            out = [];
            for (let j = cy - r; j <= cy + r; j++) {
                if (j < 0 || j >= gy) continue;
                for (let i = cx - r; i <= cx + r; i++) {
                    if (i < 0 || i >= gx) continue;
                    const arr = grid[j * gx + i];
                    if (arr && arr.length) out.push(...arr);
                }
            }
            if (out.length || r === 2) return out;
        }
        return out;
    };

    const deleted = new Uint8Array(n);
    deleted.fill(0);
    const maxDist = maxSideDist(W, H) || 1;
    for (let i = 0; i < n; i++) {
        const x = pts[2 * i];
        const y = pts[2 * i + 1];
        if (!insideDiamond(x, y, W, H)) {
            deleted[i] = 1;
            continue;
        }
        const prox = diamondSideProx(x, y, W, H);
        const minDist = Math.min(prox.L.dist, prox.R.dist, prox.T.dist, prox.B.dist);
        const edgeProximity = minDist / maxDist;
        const focusExponent = 1 + latFocus * 4;
        const edgeness = Math.pow(1 - edgeProximity, focusExponent);
        const biasMultiplier = 1 + latBias;
        let probability = damageProb * edgeness * biasMultiplier;
        probability *= 1 + (rngDmg() - 0.5) * randAmp;
        if (rngDmg() < probability) {
            deleted[i] = 1;
        } else {
            deleted[i] = 0;
        }
    }

    const ownerMap = new Int32Array(W * H);
    ownerMap.fill(-1);
    for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
            if (!insideDiamond(x, y, W, H)) continue;
            const cand = candidates(x, y);
            if (cand.length === 0) continue;
            let bestDistSq = Infinity;
            let owner = -1;
            for (let k = 0; k < cand.length; k++) {
                const idx = cand[k];
                const dx = x - pts[2 * idx];
                const dy = y - pts[2 * idx + 1];
                const distSq = dx * dx + dy * dy;
                if (distSq < bestDistSq) {
                    bestDistSq = distSq;
                    owner = idx;
                }
            }
            if (owner !== -1) ownerMap[y * W + x] = owner;
        }
    }

    const mainComponent = new Set<number>();
    let startNode = -1;
    let minCenterDistSq = Infinity;
    const centerX = W / 2;
    const centerY = H / 2;
    for (let i = 0; i < n; i++) {
        if (!deleted[i]) {
            const dx = pts[2 * i] - centerX;
            const dy = pts[2 * i + 1] - centerY;
            const distSq = dx * dx + dy * dy;
            if (distSq < minCenterDistSq) {
                minCenterDistSq = distSq;
                startNode = i;
            }
        }
    }

    if (startNode !== -1) {
        const neighbors = Array.from({ length: n }, () => new Set<number>());
        for (let y = 0; y < H - 1; y++) {
            for (let x = 0; x < W - 1; x++) {
                const i1 = ownerMap[y * W + x];
                if (i1 === -1) continue;
                const i2r = ownerMap[y * W + x + 1];
                const i2d = ownerMap[(y + 1) * W + x];
                if (i2r !== -1 && i1 !== i2r) {
                    neighbors[i1].add(i2r);
                    neighbors[i2r].add(i1);
                }
                if (i2d !== -1 && i1 !== i2d) {
                    neighbors[i1].add(i2d);
                    neighbors[i2d].add(i1);
                }
            }
        }
        const queue: number[] = [startNode];
        const visited = new Uint8Array(n);
        visited[startNode] = 1;
        mainComponent.add(startNode);
        while (queue.length > 0) {
            const current = queue.shift();
            if (current === undefined) break;
            for (const neighbor of neighbors[current]) {
                if (!visited[neighbor] && !deleted[neighbor]) {
                    visited[neighbor] = 1;
                    mainComponent.add(neighbor);
                    queue.push(neighbor);
                }
            }
        }
    }

    for (let i = 0; i < n; i++) {
        if (!mainComponent.has(i)) {
            deleted[i] = 1;
        }
    }

    const isOuterCrackCell = new Uint8Array(n);
    for (let y = 1; y < H - 1; y++) {
        for (let x = 1; x < W - 1; x++) {
            const ownerIdx = ownerMap[y * W + x];
            if (ownerIdx !== -1 && deleted[ownerIdx] && !isOuterCrackCell[ownerIdx]) {
                if (
                    ownerMap[y * W + x - 1] === -1 ||
                    ownerMap[y * W + x + 1] === -1 ||
                    ownerMap[(y - 1) * W + x] === -1 ||
                    ownerMap[(y + 1) * W + x] === -1
                ) {
                    isOuterCrackCell[ownerIdx] = 1;
                }
            }
        }
    }

    const topCvs = document.createElement('canvas');
    topCvs.width = W;
    topCvs.height = H;
    const topCtx = topCvs.getContext('2d');
    if (!topCtx) return topCvs;
    const topImg = topCtx.createImageData(W, H);
    const topData = topImg.data;
    const outlineRGB = hexToRGB(outlineColor);
    const fillRGB = hexToRGB(fillColor);
    const crackRGB = hexToRGB(crackColor);
    for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
            const idx = (y * W + x) * 4;
            const ownerIdx = ownerMap[y * W + x];
            if (ownerIdx === -1) {
                topData[idx + 3] = 0;
                continue;
            }
            if (deleted[ownerIdx]) {
                if (isOuterCrackCell[ownerIdx]) {
                    topData[idx + 3] = 0;
                } else {
                    topData[idx] = crackRGB[0];
                    topData[idx + 1] = crackRGB[1];
                    topData[idx + 2] = crackRGB[2];
                    topData[idx + 3] = 255;
                }
                continue;
            }
            let isBorder = false;
            const neighborCoords = [
                [x, y - 1],
                [x, y + 1],
                [x - 1, y],
                [x + 1, y],
            ];
            for (const [nx, ny] of neighborCoords) {
                if (nx >= 0 && nx < W && ny >= 0 && ny < H) {
                    const neighborOwnerIdx = ownerMap[ny * W + nx];
                    if (neighborOwnerIdx === -1 || deleted[neighborOwnerIdx]) {
                        isBorder = true;
                        break;
                    }
                } else {
                    isBorder = true;
                    break;
                }
            }
            const rgb = isBorder ? outlineRGB : fillRGB;
            topData[idx] = rgb[0];
            topData[idx + 1] = rgb[1];
            topData[idx + 2] = rgb[2];
            topData[idx + 3] = 255;
        }
    }
    topCtx.putImageData(topImg, 0, 0);
    topCtx.globalCompositeOperation = 'destination-in';
    topCtx.beginPath();
    const cx = W * 0.5;
    const cy = H * 0.5;
    topCtx.moveTo(cx, cy - H * 0.5);
    topCtx.lineTo(cx + W * 0.5, cy);
    topCtx.lineTo(cx, cy + H * 0.5);
    topCtx.lineTo(cx - W * 0.5, cy);
    topCtx.closePath();
    topCtx.fillStyle = '#fff';
    topCtx.fill();

    const finalCvs = document.createElement('canvas');
    finalCvs.width = W;
    finalCvs.height = H + Math.max(0, thickness | 0);
    const finalCtx = finalCvs.getContext('2d');
    if (!finalCtx) return topCvs;

    if (thickness > 0) {
        finalCtx.drawImage(topCvs, 0, thickness);
        finalCtx.globalCompositeOperation = 'source-in';
        finalCtx.fillStyle = sideColor;
        finalCtx.fillRect(0, 0, W, H + thickness);
    }

    finalCtx.globalCompositeOperation = 'source-over';
    finalCtx.drawImage(topCvs, 0, 0);
    return finalCvs;
};

const drawTileIntoPattern = (
    ctx: CanvasRenderingContext2D,
    tile: HTMLCanvasElement,
    x: number,
    y: number,
) => {
    ctx.drawImage(tile, x, y);
};

const buildTilePlacementOffsets = (W: number, H: number) => {
    const radius = 2; // how many rings of neighbours contribute to the repeating pattern
    const offsets: Array<{ dx: number; dy: number; seedOffset: number }> = [];
    let seedOffset = 1;
    const halfW = W * 0.5;
    const halfH = H * 0.5;
    for (let q = -radius; q <= radius; q++) {
        for (let r = -radius; r <= radius; r++) {
            const s = -q - r;
            if (Math.abs(s) > radius) continue;
            const dx = (q - r) * halfW;
            const dy = (q + r) * halfH;
            offsets.push({ dx, dy, seedOffset: seedOffset++ });
        }
    }
    return offsets;
};

export const generateIsometricTilePattern = (
    partialOptions: Partial<TileGeneratorOptions> = {},
): HTMLCanvasElement | null => {
    if (typeof document === 'undefined') return null;
    const options = { ...defaultOptions, ...partialOptions };
    const W = Math.max(16, Math.floor(options.tileWidth));
    const H = Math.max(16, Math.floor(options.tileHeight));
    const seedCount = Math.max(30, Math.floor(options.seedCount));
    const thickness = Math.max(0, Math.floor(options.thickness));
    const rngPosBase = createPRNG(options.seedPosition >>> 0);
    const rngDmgBase = createPRNG(options.seedDamage >>> 0);

    const patternCanvas = document.createElement('canvas');
    patternCanvas.width = W;
    patternCanvas.height = H;
    const patternCtx = patternCanvas.getContext('2d');
    if (!patternCtx) return null;

    patternCtx.clearRect(0, 0, patternCanvas.width, patternCanvas.height);
    patternCtx.fillStyle = options.fillColor || '#555555';
    patternCtx.fillRect(0, 0, patternCanvas.width, patternCanvas.height);

    const offsets = buildTilePlacementOffsets(W, H);

    offsets.forEach(({ dx, dy, seedOffset }) => {
        const rngPosSeed = Math.floor(rngPosBase() * 0xffffffff) ^ seedOffset;
        const rngDmgSeed = Math.floor(rngDmgBase() * 0xffffffff) ^ (seedOffset * 7919);
        const tile = buildTile({
            W,
            H,
            count: seedCount,
            damageProb: clampUnit(options.damageProbability),
            rngPos: createPRNG(rngPosSeed >>> 0),
            rngDmg: createPRNG(rngDmgSeed >>> 0),
            latFocus: clampUnit(options.lateralFocus),
            latBias: clampUnit(options.lateralBias),
            randAmp: clampUnit(options.randomAmplitude),
            outlineColor: options.outlineColor,
            fillColor: options.fillColor,
            crackColor: options.crackColor,
            thickness,
            sideColor: options.sideColor,
        });
        drawTileIntoPattern(patternCtx, tile, dx, dy);
    });

    return patternCanvas;
};

export const getDefaultTileOptions = (): TileGeneratorOptions => ({
    ...defaultOptions,
});
