import * as PIXI from 'pixi.js';

type RNG = () => number;

function PRNG(seed: number): RNG {
    let s = (seed >>> 0) || 123456789;
    return () => {
        s = (s * 1664525 + 1013904223) >>> 0;
        return s / 4294967296;
    };
}

function hexToRGB(hex: string): [number, number, number] {
    let value = hex.trim();
    if (/^#?[0-9a-f]{3}$/i.test(value)) {
        const h = value.replace('#', '');
        value = `#${h[0]}${h[0]}${h[1]}${h[1]}${h[2]}${h[2]}`;
    }
    const match = value.match(/^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
    if (!match) return [0, 0, 0];
    return [parseInt(match[1], 16), parseInt(match[2], 16), parseInt(match[3], 16)];
}

function insideDiamond(x: number, y: number, W: number, H: number): boolean {
    const cx = W * 0.5;
    const cy = H * 0.5;
    const u = Math.abs((x - cx) / (W * 0.5));
    const v = Math.abs((y - cy) / (H * 0.5));
    return (u + v) <= 1;
}

function distToSegmentInfo(px: number, py: number, x1: number, y1: number, x2: number, y2: number) {
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
        qx = x1; qy = y1;
    } else if (t >= 1) {
        qx = x2; qy = y2;
    } else {
        qx = x1 + t * vx;
        qy = y1 + t * vy;
    }
    return { dist: Math.hypot(px - qx, py - qy), t };
}

function diamondSideProx(x: number, y: number, W: number, H: number) {
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
        L: distToSegmentInfo(x, y, L[0], L[1], T[0], T[1])
    };
}

function maxSideDist(W: number, H: number): number {
    const A = H / W;
    return (H * 0.5) / Math.hypot(A, 1);
}

interface BuildTileOptions {
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

function buildTile({ W, H, count, damageProb, rngPos, rngDmg, latFocus, latBias, randAmp, outlineColor, fillColor, crackColor, thickness, sideColor }: BuildTileOptions): HTMLCanvasElement {
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
    const cpd = Math.max(6, Math.round(Math.sqrt(Math.max(n, 1))));
    const gx = cpd;
    const gy = cpd;
    const csx = W / gx;
    const csy = H / gy;
    const grid: number[][] = Array(gx * gy);
    for (let i = 0; i < grid.length; i++) grid[i] = [];
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
                    if (arr && arr.length) out.push(...arr);
                }
            }
            if (out.length || r === 2) return out;
        }
        return out;
    };
    const deleted = new Uint8Array(n);
    deleted.fill(0);
    const maxDist = maxSideDist(W, H);
    for (let i = 0; i < n; i++) {
        const x = pts[2 * i];
        const y = pts[2 * i + 1];
        if (!insideDiamond(x, y, W, H)) {
            deleted[i] = 1;
            continue;
        }
        const prox = diamondSideProx(x, y, W, H);
        const minDist = Math.min(prox.L.dist, prox.R.dist, prox.T.dist, prox.B.dist);
        const edgeProximity = minDist / (maxDist || 1);
        const focusExponent = 1 + latFocus * 4;
        const edgeness = Math.pow(1 - edgeProximity, focusExponent);
        const biasMultiplier = 1 + latBias;
        let probability = damageProb * edgeness * biasMultiplier;
        probability *= (1 + (rngDmg() - 0.5) * randAmp);
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
        const neighbors: Set<number>[] = Array.from({ length: n }, () => new Set<number>());
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
            const currentIdx = queue.shift()!;
            neighbors[currentIdx].forEach((neighborIdx) => {
                if (!visited[neighborIdx] && !deleted[neighborIdx]) {
                    visited[neighborIdx] = 1;
                    mainComponent.add(neighborIdx);
                    queue.push(neighborIdx);
                }
            });
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
                if (ownerMap[y * W + x - 1] === -1 || ownerMap[y * W + x + 1] === -1 || ownerMap[(y - 1) * W + x] === -1 || ownerMap[(y + 1) * W + x] === -1) {
                    isOuterCrackCell[ownerIdx] = 1;
                }
            }
        }
    }

    const topCanvas = document.createElement('canvas');
    topCanvas.width = W;
    topCanvas.height = H;
    const topCtx = topCanvas.getContext('2d');
    if (!topCtx) {
        throw new Error('Failed to acquire 2D context for tile generation');
    }
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
            const neighbors = [[x, y - 1], [x, y + 1], [x - 1, y], [x + 1, y]] as const;
            for (const [nx, ny] of neighbors) {
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

    if (thickness <= 0) {
        return topCanvas;
    }

    const finalCanvas = document.createElement('canvas');
    finalCanvas.width = W;
    finalCanvas.height = H + thickness;
    const finalCtx = finalCanvas.getContext('2d');
    if (!finalCtx) {
        throw new Error('Failed to acquire 2D context for tile finalization');
    }
    finalCtx.drawImage(topCanvas, 0, thickness);
    finalCtx.globalCompositeOperation = 'source-in';
    finalCtx.fillStyle = sideColor;
    finalCtx.fillRect(0, 0, W, H + thickness);
    finalCtx.globalCompositeOperation = 'source-over';
    finalCtx.drawImage(topCanvas, 0, 0);
    return finalCanvas;
}

export interface PavementTilesOptions {
    tileWidth: number;
    tileHeight: number;
    thickness: number;
    pointCount: number;
    damagePercent: number;
    latFocus: number;
    latBias: number;
    randomness: number;
    outlineColor: string;
    fillColor: string;
    crackColor: string;
    sideColor: string;
    cols: number;
    rows: number;
    seedPosition: number;
    seedDamage: number;
}

const DEFAULT_OPTIONS: PavementTilesOptions = {
    tileWidth: 128,
    tileHeight: 64,
    thickness: 0,
    pointCount: 400,
    damagePercent: 35,
    latFocus: 0.75,
    latBias: 1.2,
    randomness: 0.60,
    outlineColor: '#000000',
    fillColor: '#606060',
    crackColor: '#333333',
    sideColor: '#222222',
    cols: 4,
    rows: 4,
    seedPosition: 12345,
    seedDamage: 54321,
};

export function createPavementTilesTexture(options: Partial<PavementTilesOptions> = {}): PIXI.Texture {
    if (typeof document === 'undefined') {
        return PIXI.Texture.WHITE;
    }
    const opts = { ...DEFAULT_OPTIONS, ...options };
    const W = Math.max(16, Math.floor(opts.tileWidth));
    const H = Math.max(16, Math.floor(opts.tileHeight));
    const thickness = Math.max(0, Math.floor(opts.thickness));
    const cols = Math.max(1, Math.floor(opts.cols));
    const rows = Math.max(1, Math.floor(opts.rows));
    const sheet = document.createElement('canvas');
    sheet.width = cols * W;
    sheet.height = rows * H;
    const sctx = sheet.getContext('2d');
    if (!sctx) {
        throw new Error('Failed to acquire 2D context for pavement sheet');
    }
    sctx.clearRect(0, 0, sheet.width, sheet.height);
    const rngPosBase = PRNG(opts.seedPosition | 0);
    const rngDmgBase = PRNG(opts.seedDamage | 0);
    const damageProb = Math.max(0, Math.min(1, opts.damagePercent / 100));
    const latFocus = Math.max(0, opts.latFocus);
    const latBias = Math.max(0, opts.latBias);
    const randAmp = Math.max(0, opts.randomness);
    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
            const tileSeedOffset = r * cols + c + 1;
            const rngPosSeed = (Math.floor(rngPosBase() * 0xffffffff) ^ tileSeedOffset) >>> 0;
            const rngDmgSeed = (Math.floor(rngDmgBase() * 0xffffffff) ^ (tileSeedOffset * 7919)) >>> 0;
            const rngPos = PRNG(rngPosSeed);
            const rngDmg = PRNG(rngDmgSeed);
            const tileCanvas = buildTile({
                W,
                H,
                count: Math.max(10, Math.floor(opts.pointCount)),
                damageProb,
                rngPos,
                rngDmg,
                latFocus,
                latBias,
                randAmp,
                outlineColor: opts.outlineColor,
                fillColor: opts.fillColor,
                crackColor: opts.crackColor,
                thickness,
                sideColor: opts.sideColor,
            });
            sctx.drawImage(tileCanvas, 0, 0, W, H, c * W, r * H, W, H);
        }
    }
    const texture = PIXI.Texture.from(sheet);
    if (texture.baseTexture) {
        try { texture.baseTexture.wrapMode = PIXI.WRAP_MODES.REPEAT; } catch (err) {}
    }
    return texture;
}

