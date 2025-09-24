import * as PIXI from 'pixi.js';

export interface IsoTileGenerationOptions {
    cols: number;
    rows: number;
    tileWidth: number;
    tileHeight: number;
    thickness: number;
    seedCount: number;
    damageProbability: number;
    lateralFocus: number;
    lateralBias: number;
    randomnessAmplitude: number;
    outlineColor: string;
    fillColor: string;
    crackColor: string;
    sideColor: string;
    seedPosition: number;
    seedDamage: number;
}

type RNG = () => number;

const DEFAULT_OPTIONS: IsoTileGenerationOptions = {
    cols: 2,
    rows: 2,
    tileWidth: 128,
    tileHeight: 64,
    thickness: 0,
    seedCount: 400,
    damageProbability: 0.35,
    lateralFocus: 0.75,
    lateralBias: 1.2,
    randomnessAmplitude: 0.6,
    outlineColor: '#000000',
    fillColor: '#606060',
    crackColor: '#333333',
    sideColor: '#222222',
    seedPosition: 12345,
    seedDamage: 54321,
};

const PRNG = (seed: number): RNG => {
    let s = (seed >>> 0) || 123456789;
    return () => {
        s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
        return (s >>> 0) / 0x1_0000_0000;
    };
};

const hexToRGB = (hex: string): [number, number, number] => {
    const clean = hex.trim();
    let value = clean;
    if (/^#?[0-9a-f]{3}$/i.test(clean)) {
        const h = clean.replace('#', '');
        value = `#${h[0]}${h[0]}${h[1]}${h[1]}${h[2]}${h[2]}`;
    }
    const match = value.match(/^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
    if (!match) return [0, 0, 0];
    return [
        parseInt(match[1], 16),
        parseInt(match[2], 16),
        parseInt(match[3], 16),
    ];
};

const insideDiamond = (x: number, y: number, W: number, H: number): boolean => {
    const cx = W * 0.5;
    const cy = H * 0.5;
    const u = Math.abs((x - cx) / (W * 0.5));
    const v = Math.abs((y - cy) / (H * 0.5));
    return u + v <= 1;
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

const maxSideDist = (W: number, H: number) => {
    const A = H / W;
    return (H * 0.5) / Math.hypot(A, 1);
};

interface BuildTileParams {
    W: number;
    H: number;
    count: number;
    damageProb: number;
    rngPos: RNG;
    rngDmg: RNG;
    latFocus: number;
    latBias: number;
    randAmp: number;
    outlineColor: string;
    fillColor: string;
    crackColor: string;
    thickness: number;
    sideColor: string;
}

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
}: BuildTileParams): HTMLCanvasElement | null => {
    if (typeof document === 'undefined') return null;
    const pts: number[] = [];
    pts.length = count * 2;
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
    if (n === 0) return null;
    const cpd = Math.max(6, Math.round(Math.sqrt(Math.max(n, 1))));
    const gx = cpd;
    const gy = cpd;
    const csx = W / gx;
    const csy = H / gy;
    const grid: number[][] = Array.from({ length: gx * gy }, () => []);
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
            out.length = 0;
            for (let j = cy - r; j <= cy + r; j++) {
                if (j < 0 || j >= gy) continue;
                for (let i = cx - r; i <= cx + r; i++) {
                    if (i < 0 || i >= gx) continue;
                    const arr = grid[j * gx + i];
                    if (arr && arr.length) {
                        out.push(...arr);
                    }
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
            if (!cand.length) continue;
            let bestDistSq = Infinity;
            let owner = -1;
            for (let k = 0; k < cand.length; k++) {
                const i = cand[k];
                const dx = x - pts[2 * i];
                const dy = y - pts[2 * i + 1];
                const distSq = dx * dx + dy * dy;
                if (distSq < bestDistSq) {
                    bestDistSq = distSq;
                    owner = i;
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
        const neighbors: Array<Set<number>> = Array.from({ length: n }, () => new Set<number>());
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
            const currentIdx = queue.shift();
            if (currentIdx === undefined) break;
            for (const neighborIdx of neighbors[currentIdx]) {
                if (!visited[neighborIdx] && !deleted[neighborIdx]) {
                    visited[neighborIdx] = 1;
                    mainComponent.add(neighborIdx);
                    queue.push(neighborIdx);
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
    if (!topCtx) return null;
    const topImg = topCtx.createImageData(W, H);
    const topDta = topImg.data;
    const outlineRGB = hexToRGB(outlineColor);
    const fillRGB = hexToRGB(fillColor);
    const crackRGB = hexToRGB(crackColor);
    for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
            const idx = (y * W + x) * 4;
            const ownerIdx = ownerMap[y * W + x];
            if (ownerIdx === -1) {
                topDta[idx + 3] = 0;
                continue;
            }
            if (deleted[ownerIdx]) {
                if (isOuterCrackCell[ownerIdx]) {
                    topDta[idx + 3] = 0;
                } else {
                    topDta[idx] = crackRGB[0];
                    topDta[idx + 1] = crackRGB[1];
                    topDta[idx + 2] = crackRGB[2];
                    topDta[idx + 3] = 255;
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
            topDta[idx] = rgb[0];
            topDta[idx + 1] = rgb[1];
            topDta[idx + 2] = rgb[2];
            topDta[idx + 3] = 255;
        }
    }
    topCtx.putImageData(topImg, 0, 0);
    topCtx.globalCompositeOperation = 'destination-in';
    const cx = W * 0.5;
    const cy = H * 0.5;
    topCtx.beginPath();
    topCtx.moveTo(cx, cy - H * 0.5);
    topCtx.lineTo(cx + W * 0.5, cy);
    topCtx.lineTo(cx, cy + H * 0.5);
    topCtx.lineTo(cx - W * 0.5, cy);
    topCtx.closePath();
    topCtx.fillStyle = '#ffffff';
    topCtx.fill();
    const finalCvs = document.createElement('canvas');
    finalCvs.width = W;
    finalCvs.height = H + thickness;
    const finalCtx = finalCvs.getContext('2d');
    if (!finalCtx) return null;
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

export const generateIsometricTileTexture = (
    options?: Partial<IsoTileGenerationOptions>,
): PIXI.Texture | null => {
    if (typeof document === 'undefined') return null;
    const opts: IsoTileGenerationOptions = { ...DEFAULT_OPTIONS, ...options };
    const sheetCanvas = document.createElement('canvas');
    sheetCanvas.width = opts.cols * opts.tileWidth;
    sheetCanvas.height = opts.rows * (opts.tileHeight + opts.thickness);
    const sctx = sheetCanvas.getContext('2d');
    if (!sctx) return null;
    sctx.clearRect(0, 0, sheetCanvas.width, sheetCanvas.height);
    const rngPosBase = PRNG(opts.seedPosition);
    const rngDmgBase = PRNG(opts.seedDamage);
    for (let r = 0; r < opts.rows; r++) {
        for (let c = 0; c < opts.cols; c++) {
            const tileSeedOffset = r * opts.cols + c + 1;
            const seedA = (Math.floor(rngPosBase() * 0xffffffff) ^ tileSeedOffset) >>> 0;
            const seedB = (Math.floor(rngDmgBase() * 0xffffffff) ^ (tileSeedOffset * 7919)) >>> 0;
            const rngPos = PRNG(seedA);
            const rngDmg = PRNG(seedB);
            const tileCanvas = buildTile({
                W: opts.tileWidth,
                H: opts.tileHeight,
                count: opts.seedCount,
                damageProb: opts.damageProbability,
                rngPos,
                rngDmg,
                latFocus: opts.lateralFocus,
                latBias: opts.lateralBias,
                randAmp: opts.randomnessAmplitude,
                outlineColor: opts.outlineColor,
                fillColor: opts.fillColor,
                crackColor: opts.crackColor,
                thickness: opts.thickness,
                sideColor: opts.sideColor,
            });
            if (tileCanvas) {
                sctx.drawImage(
                    tileCanvas,
                    c * opts.tileWidth,
                    r * (opts.tileHeight + opts.thickness),
                );
            }
        }
    }
    const baseTexture = PIXI.BaseTexture.from(sheetCanvas);
    try {
        baseTexture.wrapMode = PIXI.WRAP_MODES.REPEAT;
        baseTexture.mipmap = PIXI.MIPMAP_MODES.OFF;
    } catch (err) {
        // ignore wrap mode errors in environments that do not support it
    }
    return new PIXI.Texture(baseTexture);
};

export const defaultIsoTileOptions = DEFAULT_OPTIONS;
