import { Noise } from 'noisejs';
import { sampleWarpedNoise } from '../lib/noiseField';

export interface CrackGeneratorOptions {
    divisions: number;
    thickness: number;
    dilateRadius: number;
    seed: number;
    scale?: number;
    color?: [number, number, number];
}

function makeRng(seed: number) {
    let state = seed >>> 0;
    return () => {
        state = (state * 1664525 + 1013904223) >>> 0;
        return state / 0x100000000;
    };
}

const bilerp = (v00: number, v10: number, v01: number, v11: number, tx: number, ty: number) => {
    const top = v00 + (v10 - v00) * tx;
    const bottom = v01 + (v11 - v01) * tx;
    return top + (bottom - top) * ty;
};

const pickMaskSampleStep = (width: number, height: number, bandWidth: number) => {
    const safeW = Math.max(1, width);
    const safeH = Math.max(1, height);
    const diag = Math.sqrt(safeW * safeH);
    const base = Math.max(1, Math.min(5, Math.round(diag / 280)));
    if (!(bandWidth > 0)) return base;
    const widthScale = Math.max(0.6, Math.min(1.4, bandWidth / 0.012));
    const step = Math.round(base * widthScale);
    return Math.max(1, Math.min(6, step || 1));
};

export function generateVoronoiCrackImage(width: number, height: number, options: CrackGeneratorOptions): Uint8ClampedArray {
    const sw = Math.max(1, Math.round(width));
    const sh = Math.max(1, Math.round(height));
    const scale = options.scale ?? 1;
    const color: [number, number, number] = options.color ?? [58, 58, 58];
    const baseDivisions = Math.max(8, Math.min(5000, Math.round(options.divisions)));
    const longestDim = Math.max(sw, sh);
    const sizeScale = Math.max(0.5, Math.min(1.6, longestDim / 512));
    const divisions = Math.max(8, Math.min(5000, Math.round(baseDivisions * sizeScale)));
    const narrowDim = Math.max(1, Math.min(sw, sh));
    const maxThickness = Math.max(1, narrowDim * 0.45);
    const effectiveThickness = Math.max(0.75, Math.min(options.thickness, maxThickness));
    const rng = makeRng(Math.floor(options.seed) || 1);
    const pts = new Float32Array(divisions * 2);
    for (let i = 0; i < divisions; i++) {
        pts[2 * i] = rng() * sw;
        pts[2 * i + 1] = rng() * sh;
    }

    const cellsPerDim = Math.max(8, Math.round(Math.sqrt(divisions)));
    const cellSizeX = sw / cellsPerDim;
    const cellSizeY = sh / cellsPerDim;
    const grid: number[][] = new Array(cellsPerDim * cellsPerDim);
    for (let i = 0; i < grid.length; i++) grid[i] = [];
    for (let i = 0; i < divisions; i++) {
        const x = pts[2 * i];
        const y = pts[2 * i + 1];
        const cx = Math.min(cellsPerDim - 1, Math.max(0, Math.floor(x / cellSizeX)));
        const cy = Math.min(cellsPerDim - 1, Math.max(0, Math.floor(y / cellSizeY)));
        grid[cy * cellsPerDim + cx].push(i);
    }

    const candidatesLocal = (x: number, y: number) => {
        const cx = Math.min(cellsPerDim - 1, Math.max(0, Math.floor(x / cellSizeX)));
        const cy = Math.min(cellsPerDim - 1, Math.max(0, Math.floor(y / cellSizeY)));
        const out: number[] = [];
        for (let r = 1; r <= 2; r++) {
            out.length = 0;
            for (let yy = cy - r; yy <= cy + r; yy++) {
                if (yy < 0 || yy >= cellsPerDim) continue;
                for (let xx = cx - r; xx <= cx + r; xx++) {
                    if (xx < 0 || xx >= cellsPerDim) continue;
                    const bucket = grid[yy * cellsPerDim + xx];
                    if (bucket && bucket.length) out.push(...bucket);
                }
            }
            if (out.length || r === 2) return out;
        }
        return out;
    };

    const data = new Uint8ClampedArray(sw * sh * 4);
    const eps = (effectiveThickness / 10) * scale;

    for (let y = 0; y < sh; y++) {
        for (let x = 0; x < sw; x++) {
            const candidates = candidatesLocal(x, y);
            let b1 = Infinity;
            let b2 = Infinity;
            if (candidates.length) {
                for (let k = 0; k < candidates.length; k++) {
                    const idx = candidates[k];
                    const dx = x - pts[2 * idx];
                    const dy = y - pts[2 * idx + 1];
                    const dist2 = dx * dx + dy * dy;
                    if (dist2 < b1) {
                        b2 = b1;
                        b1 = dist2;
                    } else if (dist2 < b2) {
                        b2 = dist2;
                    }
                }
            } else {
                for (let i = 0; i < divisions; i++) {
                    const dx = x - pts[2 * i];
                    const dy = y - pts[2 * i + 1];
                    const dist2 = dx * dx + dy * dy;
                    if (dist2 < b1) {
                        b2 = b1;
                        b1 = dist2;
                    } else if (dist2 < b2) {
                        b2 = dist2;
                    }
                }
            }
            const delta = Math.sqrt(b2) - Math.sqrt(b1);
            const p = (y * sw + x) * 4;
            if (delta < eps) {
                data[p] = color[0];
                data[p + 1] = color[1];
                data[p + 2] = color[2];
                data[p + 3] = 255;
            } else {
                data[p] = 0;
                data[p + 1] = 0;
                data[p + 2] = 0;
                data[p + 3] = 0;
            }
        }
    }

    const maxDilate = Math.max(0, Math.min(options.dilateRadius, narrowDim * 0.25));
    const radius = Math.max(0, Math.min(20, Math.round(maxDilate * scale)));
    if (radius > 0) {
        const copy = new Uint8ClampedArray(data);
        for (let y = 0; y < sh; y++) {
            for (let x = 0; x < sw; x++) {
                const idx = (y * sw + x) * 4;
                if (copy[idx + 3] === 0) continue;
                const x0 = Math.max(0, x - radius);
                const x1 = Math.min(sw - 1, x + radius);
                const y0 = Math.max(0, y - radius);
                const y1 = Math.min(sh - 1, y + radius);
                for (let yy = y0; yy <= y1; yy++) {
                    for (let xx = x0; xx <= x1; xx++) {
                        const ii = (yy * sw + xx) * 4;
                        data[ii] = color[0];
                        data[ii + 1] = color[1];
                        data[ii + 2] = color[2];
                        data[ii + 3] = 255;
                    }
                }
            }
        }
    }

    return data;
}

export interface CrackRaster {
    data: Uint8ClampedArray;
    width: number;
    height: number;
    quality: number;
    color: [number, number, number];
    // Optional debug info for noise bucket region visualization (legacy naming kept for backwards compatibility)
    debugRegion?: {
        map: Uint8Array;
        w: number;
        h: number;
        buckets: number;
        cellW: number;
        cellH: number;
        minX: number;
        minY: number;
        quality: number;
        activeBucketIds?: number[];
    };
    noiseMask?: {
        data: Uint8Array;
        width: number;
        height: number;
    };
}

export interface CrackRasterOptions {
    width: number;
    height: number;
    minX: number;
    minY: number;
    renderConfig: any;
    isoToWorld: (point: { x: number; y: number }) => { x: number; y: number };
}

export function generateCrackRaster(options: CrackRasterOptions): CrackRaster | null {
    const {
        width: widthRaw,
        height: heightRaw,
        minX,
        minY,
        renderConfig,
        isoToWorld,
    } = options;
    const width = Math.max(1, Math.round(widthRaw));
    const height = Math.max(1, Math.round(heightRaw));
    const crackCfg = renderConfig?.crackProceduralParams || {};
    const fallbackQuality = (typeof crackCfg.quality === 'number' && isFinite(crackCfg.quality))
        ? crackCfg.quality
        : ((typeof window !== 'undefined' && typeof window.devicePixelRatio === 'number') ? window.devicePixelRatio : 1);
    const minQuality = Math.max(0.1, Math.min(1, (typeof crackCfg.minQuality === 'number' && isFinite(crackCfg.minQuality)) ? crackCfg.minQuality : 0.25));
    const clampQuality = (q: number) => Math.max(minQuality, Math.min(4, q || minQuality));
    const maxCanvasDimension = Math.max(64, Math.min(8192, (typeof crackCfg.maxCanvasDimension === 'number' && isFinite(crackCfg.maxCanvasDimension)) ? crackCfg.maxCanvasDimension : 4096));
    const maxCanvasPixels = Math.max(16384, Math.min(67108864, (typeof crackCfg.maxCanvasPixels === 'number' && isFinite(crackCfg.maxCanvasPixels)) ? crackCfg.maxCanvasPixels : 5_000_000));

    let quality = clampQuality(fallbackQuality || 1);
    let canvasW = 0;
    let canvasH = 0;
    const recomputeCanvasSize = () => {
        canvasW = Math.max(1, Math.round(width * quality));
        canvasH = Math.max(1, Math.round(height * quality));
    };
    recomputeCanvasSize();

    const applyQualityReduction = (factor: number) => {
        if (!(factor > 1)) return;
        quality = clampQuality(quality / factor);
        recomputeCanvasSize();
    };

    if (canvasW > maxCanvasDimension || canvasH > maxCanvasDimension) {
        const factor = Math.max(canvasW / maxCanvasDimension, canvasH / maxCanvasDimension);
        applyQualityReduction(factor);
    }

    if (canvasW * canvasH > maxCanvasPixels) {
        const factor = Math.sqrt((canvasW * canvasH) / maxCanvasPixels);
        applyQualityReduction(factor);
    }

    const exceedsHardLimits = () => (
        canvasW > maxCanvasDimension
        || canvasH > maxCanvasDimension
        || canvasW * canvasH > maxCanvasPixels
    );

    if (exceedsHardLimits()) {
        const safeDivisor = (value: number) => (value > 0 ? value : 1);
        const dimLimit = Math.min(
            quality,
            maxCanvasDimension / safeDivisor(width),
            maxCanvasDimension / safeDivisor(height),
        );
        const pixelLimit = Math.sqrt(maxCanvasPixels / safeDivisor(width * height));
        const desiredQuality = Math.min(quality, dimLimit, pixelLimit);
        if (desiredQuality < quality) {
            quality = Math.max(1e-4, desiredQuality);
            recomputeCanvasSize();
        }
    }

    if (exceedsHardLimits()) {
        let guard = 0;
        while (exceedsHardLimits() && guard < 5) {
            const factor = Math.max(
                canvasW / maxCanvasDimension,
                canvasH / maxCanvasDimension,
                Math.sqrt((canvasW * canvasH) / maxCanvasPixels),
            );
            if (!(factor > 1.0001)) break;
            quality = Math.max(1e-4, quality / factor);
            recomputeCanvasSize();
            guard++;
        }
    }

    if (exceedsHardLimits()) {
        if (typeof console !== 'undefined' && console.warn) {
            console.warn('[crackGenerator] Procedural crack raster skipped – area too large after clamping', { canvasW, canvasH, quality });
        }
        // If the caller explicitly requested legacy noise debug delimitations, return a
        // tiny placeholder raster that includes a coarse `debugRegion` so the
        // UI can still visualize noise buckets even when the full raster is
        // skipped due to clamping limits.
        if (renderConfig?.showNoiseDelimitations && renderConfig?.crackUseNoise) {
            try {
                const seed = Math.floor((renderConfig?.crackSeed ?? Date.now())) >>> 0;
                const noiseCfg = renderConfig.crackNoiseParams || { baseScale: 1 / 480, octaves: 4, lacunarity: 2, gain: 0.5, buckets: 3, crackBandWidth: 0.012 };
                const baseScale = noiseCfg.baseScale || 1 / 480;
                const octaves = noiseCfg.octaves || 4;
                const lacunarity = noiseCfg.lacunarity || 2;
                const gain = noiseCfg.gain || 0.5;
                const buckets = Math.max(1, Math.min(8, noiseCfg.buckets || 3));
                const debug_regionW = Math.max(4, Math.min(64, Math.floor(Math.min(width, height) / 32) || 8));
                const debug_regionH = Math.max(4, Math.min(64, Math.floor(Math.min(width, height) / 32) || 8));
                const regionNoise = new Noise(seed || 1);
                const debug_regionMap = new Uint8Array(debug_regionW * debug_regionH);
                for (let ry = 0; ry < debug_regionH; ry++) {
                    for (let rx = 0; rx < debug_regionW; rx++) {
                        const sampleX = ((rx + 0.5) / debug_regionW) * width;
                        const sampleY = ((ry + 0.5) / debug_regionH) * height;
                        const screenPt = { x: sampleX + minX, y: sampleY + minY };
                        const worldPt = (renderConfig && renderConfig.mode === 'isometric')
                            ? { x: screenPt.x, y: screenPt.y }
                            : isoToWorld(screenPt);
                        const v = sampleWarpedNoise(regionNoise, worldPt.x * baseScale, worldPt.y * baseScale, octaves, lacunarity, gain);
                        let id = Math.floor(v * buckets);
                        if (id < 0) id = 0;
                        if (id >= buckets) id = buckets - 1;
                        debug_regionMap[ry * debug_regionW + rx] = id;
                    }
                }
                const placeholderData = new Uint8ClampedArray(4); // 1 pixel transparent placeholder
                placeholderData[0] = 0; placeholderData[1] = 0; placeholderData[2] = 0; placeholderData[3] = 0;
                const out: CrackRaster = { data: placeholderData, width: 1, height: 1, quality, color: [24,24,24] };
                out.debugRegion = {
                    map: debug_regionMap,
                    w: debug_regionW,
                    h: debug_regionH,
                    buckets,
                    cellW: debug_regionW > 0 ? width / debug_regionW : width,
                    cellH: debug_regionH > 0 ? height / debug_regionH : height,
                    minX,
                    minY,
                    quality,
                };
                return out;
            } catch (e) {
                // fall through to returning null if debug computation fails
            }
        }
        return null;
    }

    const seed = Math.floor((renderConfig?.crackSeed ?? Date.now())) >>> 0;
    const divisions = (typeof crackCfg.divisions === 'number' && crackCfg.divisions > 0) ? crackCfg.divisions : 400;
    const thickness = (typeof crackCfg.thickness === 'number' && crackCfg.thickness > 0) ? crackCfg.thickness : 6;
    const dilateRadius = (typeof crackCfg.dilateRadius === 'number' && crackCfg.dilateRadius >= 0) ? crackCfg.dilateRadius : 2;

    const data = generateVoronoiCrackImage(canvasW, canvasH, {
        divisions,
        thickness,
        dilateRadius,
        seed,
        scale: quality,
        color: [24, 24, 24],
    });

    // Keep a copy of the raw Voronoi result as a fallback in case later
    // noise filtering removes all pixels (so the user isn't left with
    // an empty transparent result because of restrictive params).
    const _voronoiCopy = new Uint8ClampedArray(data);
    const invQuality = 1 / quality;

    // Debug region variables (declared in outer scope so we can attach info after noise processing)
    let debug_regionMap: Uint8Array | null = null;
    let debug_regionW = 0;
    let debug_regionH = 0;
    let debug_regionCellW = 0;
    let debug_regionCellH = 0;
    let debug_buckets = 0;
    const attachDebugRegionRequested = !!(renderConfig && renderConfig.showNoiseDelimitations);
    let activeBuckets: Set<number> | null = null;
    let sampleBucketId: ((screenX: number, screenY: number) => number) | null = null;
    let noiseMaskData: Uint8Array | null = null;
    let noiseMaskHits = 0;

    if (renderConfig?.crackUseNoise) {
        const noiseCfg = renderConfig.crackNoiseParams || {
            baseScale: 1 / 480,
            buckets: 3,
            maxActiveBuckets: 2,
            activeBucketStrategy: 'smallest',
            crackBandWidth: 0.012,
            octaves: 4,
            lacunarity: 2,
            gain: 0.5,
        };
        const baseScale = noiseCfg.baseScale || 1 / 480;
        const octaves = Math.max(1, noiseCfg.octaves || 4);
        const lacunarity = noiseCfg.lacunarity || 2;
        const gain = noiseCfg.gain || 0.5;
        const crackBandWidth = Math.max(0.0005, Math.min(0.25, noiseCfg.crackBandWidth || 0.012));
        const buckets = Math.max(1, Math.min(8, noiseCfg.buckets || 3));
        const maxActive = Math.max(1, Math.min(buckets, noiseCfg.maxActiveBuckets || 2));
        const strategy = noiseCfg.activeBucketStrategy || 'smallest';
        const regionSample = Math.max(16, Math.min(128, Math.floor(Math.min(width, height) / 6) || 16));
        debug_regionW = Math.max(1, Math.floor(width / regionSample));
        debug_regionH = Math.max(1, Math.floor(height / regionSample));
        const regionNoise = new Noise(seed || 1);
        debug_regionMap = new Uint8Array(debug_regionW * debug_regionH);
        const countsAll = new Array<number>(buckets).fill(0);
        for (let ry = 0; ry < debug_regionH; ry++) {
            for (let rx = 0; rx < debug_regionW; rx++) {
                const sampleX = ((rx + 0.5) / debug_regionW) * width;
                const sampleY = ((ry + 0.5) / debug_regionH) * height;
                const screenPt = { x: sampleX + minX, y: sampleY + minY };
                // In isometric mode other overlays (NoiseZoning) sample noise using
                // projected/screen coordinates (they map canvas pixels -> scene using
                // cameraX/cameraY/zoom). To keep behavior consistent and ensure the
                // Noise area follows zoom/pan, when renderConfig indicates isometric
                // mode we sample directly in projected coordinates. For non-
                // isometric mode fall back to the provided isoToWorld mapping.
                const worldPt = (renderConfig && renderConfig.mode === 'isometric')
                    ? { x: screenPt.x, y: screenPt.y }
                    : isoToWorld(screenPt);
                const v = sampleWarpedNoise(regionNoise, worldPt.x * baseScale, worldPt.y * baseScale, octaves, lacunarity, gain);
                let id = Math.floor(v * buckets);
                if (id < 0) id = 0;
                if (id >= buckets) id = buckets - 1;
                debug_regionMap![ry * debug_regionW + rx] = id;
                countsAll[id]++;
            }
        }

        const statsAll = countsAll.map((c, i) => ({ i, c }));
        const positiveAll = statsAll.filter(s => s.c > 0);
        const selectionPool = positiveAll.length > 0 ? positiveAll : statsAll;
        const rng = (() => {
            let t = (seed ^ 0x9E3779B9) >>> 0;
            return () => {
                t = (t * 1664525 + 1013904223) >>> 0;
                return t / 0x100000000;
            };
        })();
        const pickByStrategy = (pool: { i: number; c: number }[], count: number) => {
            if (pool.length === 0 || count <= 0) return [] as { i: number; c: number }[];
            if (strategy === 'largest') {
                return pool.slice().sort((a, b) => (b.c - a.c) || (a.i - b.i)).slice(0, count);
            }
            if (strategy === 'random') {
                const arr = pool.slice();
                for (let i = arr.length - 1; i > 0; i--) {
                    const j = Math.floor(rng() * (i + 1));
                    const tmp = arr[i];
                    arr[i] = arr[j];
                    arr[j] = tmp;
                }
                return arr.slice(0, count);
            }
            return pool.slice().sort((a, b) => (a.c - b.c) || (a.i - b.i)).slice(0, count);
        };

        let picked = pickByStrategy(selectionPool, maxActive);
        if (picked.length < maxActive) {
            const fallbackPoolBase = positiveAll.length > 0 ? positiveAll : statsAll;
            const fallbackPool = fallbackPoolBase.filter(item => !picked.some(p => p.i === item.i));
            const extra = pickByStrategy(fallbackPool.length > 0 ? fallbackPool : statsAll.filter(item => !picked.some(p => p.i === item.i)), maxActive - picked.length);
            picked = picked.concat(extra);
        }
        if (picked.length < maxActive) {
            for (let b = 0; picked.length < maxActive && b < buckets; b++) {
                if (picked.some(p => p.i === b)) continue;
                picked.push({ i: b, c: 0 });
            }
        }
        let selectedBuckets = new Set<number>(picked.map(p => p.i));
        if (selectedBuckets.size === 0) {
            for (let b = 0; b < buckets; b++) selectedBuckets.add(b);
        }

        // Allow callers to explicitly force which bucket ids are active by
        // providing `renderConfig.forceActiveBucketIds` (array of numbers).
        if (renderConfig && Array.isArray((renderConfig as any).forceActiveBucketIds) && (renderConfig as any).forceActiveBucketIds.length > 0) {
            try {
                const forced = new Set<number>();
                for (const v of (renderConfig as any).forceActiveBucketIds) {
                    const n = Number(v);
                    if (isFinite(n) && n >= 0 && n < buckets) forced.add(Math.floor(n));
                }
                if (forced.size > 0) selectedBuckets = forced;
            } catch (e) {
                // ignore malformed input
            }
        }

        const initialActiveBuckets = new Set<number>(selectedBuckets);
        debug_regionCellW = debug_regionW > 0 ? width / debug_regionW : width;
        debug_regionCellH = debug_regionH > 0 ? height / debug_regionH : height;
        debug_buckets = buckets;
        sampleBucketId = (screenX: number, screenY: number) => {
            const rx = Math.max(0, Math.min(debug_regionW - 1, Math.floor(screenX / (debug_regionCellW || 1))));
            const ry = Math.max(0, Math.min(debug_regionH - 1, Math.floor(screenY / (debug_regionCellH || 1))));
            return debug_regionMap![ry * debug_regionW + rx];
        };
        const bucketNoise: Noise[] = new Array(buckets);
        const bucketCenters: number[] = new Array(buckets);
        const fineScales: number[] = new Array(buckets);
        for (let b = 0; b < buckets; b++) {
            bucketNoise[b] = new Noise((seed + b * 97 + 13) >>> 0);
            bucketCenters[b] = (b + 0.5) / buckets;
            fineScales[b] = baseScale * (1.5 + b * 0.6);
        }
        noiseMaskData = new Uint8Array(width * height);
        noiseMaskHits = 0;
        const computeWorldPoint = (screenX: number, screenY: number) => {
            const screenPt = { x: screenX + minX, y: screenY + minY };
            return (renderConfig && renderConfig.mode === 'isometric') ? screenPt : isoToWorld(screenPt);
        };
        const bucketIdsForSampling = Array.from({ length: buckets }, (_v, i) => i);
        const bucketSlot = new Map<number, number>();
        bucketIdsForSampling.forEach((bucketId, index) => bucketSlot.set(bucketId, index));
        const sampleStepPixels = pickMaskSampleStep(width, height, crackBandWidth);
        const coarseW = Math.max(2, Math.floor((width + sampleStepPixels - 1) / sampleStepPixels) + 1);
        const coarseH = Math.max(2, Math.floor((height + sampleStepPixels - 1) / sampleStepPixels) + 1);
        const coarseBase = bucketIdsForSampling.map(() => new Float32Array(coarseW * coarseH));
        const coarseFine = bucketIdsForSampling.map(() => new Float32Array(coarseW * coarseH));
        const maskBucketCounts = new Array<number>(buckets).fill(0);
        const stepOffset = sampleStepPixels * 0.5;
        for (let gy = 0; gy < coarseH; gy++) {
            const sampleY = Math.min(height - 0.5, Math.max(0.5, gy * sampleStepPixels + stepOffset));
            for (let gx = 0; gx < coarseW; gx++) {
                const sampleX = Math.min(width - 0.5, Math.max(0.5, gx * sampleStepPixels + stepOffset));
                const worldPt = computeWorldPoint(sampleX, sampleY);
                const idx = gy * coarseW + gx;
                for (let bi = 0; bi < bucketIdsForSampling.length; bi++) {
                    const bucketId = bucketIdsForSampling[bi];
                    const noiseInst = bucketNoise[bucketId];
                    coarseBase[bi][idx] = sampleWarpedNoise(noiseInst, worldPt.x * baseScale, worldPt.y * baseScale, octaves, lacunarity, gain);
                    coarseFine[bi][idx] = sampleWarpedNoise(
                        noiseInst,
                        worldPt.x * fineScales[bucketId] * 3.0,
                        worldPt.y * fineScales[bucketId] * 3.0,
                        2,
                        2,
                        0.6,
                    );
                }
            }
        }
        for (let y = 0; y < height; y++) {
            const pixelY = Math.min(height - 0.5, Math.max(0.5, y + 0.5));
            let gyFloat = (pixelY - stepOffset) / sampleStepPixels;
            if (!isFinite(gyFloat)) gyFloat = 0;
            if (gyFloat < 0) gyFloat = 0;
            if (gyFloat > coarseH - 1) gyFloat = coarseH - 1;
            let gy0 = Math.floor(gyFloat);
            if (gy0 >= coarseH - 1) gy0 = coarseH - 1;
            const gy1 = Math.min(gy0 + 1, coarseH - 1);
            const ty = gy1 === gy0 ? 0 : gyFloat - gy0;
            const row0 = gy0 * coarseW;
            const row1 = gy1 * coarseW;
            for (let x = 0; x < width; x++) {
                const baseIndex = y * width + x;
                const bucketId = sampleBucketId!(x + 0.5, y + 0.5);
                const slot = bucketSlot.get(bucketId);
                if (slot == null) {
                    noiseMaskData[baseIndex] = 0;
                    continue;
                }
                const pixelX = Math.min(width - 0.5, Math.max(0.5, x + 0.5));
                let gxFloat = (pixelX - stepOffset) / sampleStepPixels;
                if (!isFinite(gxFloat)) gxFloat = 0;
                if (gxFloat < 0) gxFloat = 0;
                if (gxFloat > coarseW - 1) gxFloat = coarseW - 1;
                let gx0 = Math.floor(gxFloat);
                if (gx0 >= coarseW - 1) gx0 = coarseW - 1;
                const gx1 = Math.min(gx0 + 1, coarseW - 1);
                const tx = gx1 === gx0 ? 0 : gxFloat - gx0;
                const baseGrid = coarseBase[slot];
                const v00 = baseGrid[row0 + gx0];
                const v10 = baseGrid[row0 + gx1];
                const v01 = baseGrid[row1 + gx0];
                const v11 = baseGrid[row1 + gx1];
                const baseVal = bilerp(v00, v10, v01, v11, tx, ty);
                const center = bucketCenters[bucketId];
                const dist = Math.abs(baseVal - center);
                if (dist > crackBandWidth) {
                    noiseMaskData[baseIndex] = 0;
                    continue;
                }
                const edge = Math.max(0, (crackBandWidth - dist) / crackBandWidth);
                const fineGrid = coarseFine[slot];
                const f00 = fineGrid[row0 + gx0];
                const f10 = fineGrid[row0 + gx1];
                const f01 = fineGrid[row1 + gx0];
                const f11 = fineGrid[row1 + gx1];
                const fine = bilerp(f00, f10, f01, f11, tx, ty);
                const modulation = Math.max(0, Math.min(1, Math.pow(edge, 1.15) * (0.45 + 0.55 * fine)));
                if (modulation <= 0.02) {
                    noiseMaskData[baseIndex] = 0;
                    continue;
                }
                noiseMaskData[baseIndex] = 255;
                noiseMaskHits++;
                maskBucketCounts[bucketId]++;
            }
        }
        const bucketsWithCoverage = maskBucketCounts
            .map((count, i) => ({ i, c: count }))
            .filter(entry => entry.c > 0);

        const ensureAddBucket = (set: Set<number>, id: number) => {
            if (!set.has(id) && set.size < maxActive) {
                set.add(id);
            }
        };
        const finalActiveBuckets = new Set<number>();
        initialActiveBuckets.forEach(id => {
            if (maskBucketCounts[id] > 0) ensureAddBucket(finalActiveBuckets, id);
        });
        if (finalActiveBuckets.size < Math.min(maxActive, bucketsWithCoverage.length)) {
            const fallbackPool = bucketsWithCoverage.filter(entry => !finalActiveBuckets.has(entry.i));
            const extra = pickByStrategy(fallbackPool, maxActive - finalActiveBuckets.size);
            extra.forEach(item => ensureAddBucket(finalActiveBuckets, item.i));
        }
        if (finalActiveBuckets.size === 0 && bucketsWithCoverage.length > 0) {
            const extra = pickByStrategy(bucketsWithCoverage, maxActive);
            extra.forEach(item => ensureAddBucket(finalActiveBuckets, item.i));
        }
        if (finalActiveBuckets.size === 0) {
            for (let b = 0; b < buckets && finalActiveBuckets.size < maxActive; b++) {
                ensureAddBucket(finalActiveBuckets, b);
            }
        }

        activeBuckets = finalActiveBuckets;
        if (activeBuckets.size === 0) {
            for (let b = 0; b < buckets; b++) activeBuckets.add(b);
        }

        if (noiseMaskHits === 0) {
            noiseMaskData = null;
        }

        const crackColor: [number, number, number] = [24, 24, 24];
        let hasCoverage = false;
        for (let y = 0; y < canvasH; y++) {
            for (let x = 0; x < canvasW; x++) {
                const idx = (y * canvasW + x) * 4;
                const alpha = data[idx + 3];
                if (alpha === 0) continue;
                const screenX = (x + 0.5) * invQuality;
                const screenY = (y + 0.5) * invQuality;
                const baseX = Math.max(0, Math.min(width - 1, Math.floor(screenX)));
                const baseY = Math.max(0, Math.min(height - 1, Math.floor(screenY)));
                const baseIndex = baseY * width + baseX;
                if (noiseMaskData && noiseMaskData[baseIndex] === 0) {
                    data[idx + 3] = 0;
                    continue;
                }
                const bucketId = sampleBucketId!(screenX, screenY);
                if (!activeBuckets!.has(bucketId)) {
                    if (noiseMaskData) noiseMaskData[baseIndex] = 0;
                    data[idx + 3] = 0;
                    continue;
                }
                if (noiseMaskData) {
                    const maskAlpha = Math.max(0, Math.min(1, noiseMaskData[baseIndex] / 255));
                    const finalAlpha = Math.max(0, Math.min(255, Math.round(alpha * maskAlpha)));
                    if (finalAlpha <= 0) {
                        data[idx + 3] = 0;
                        continue;
                    }
                    data[idx + 3] = finalAlpha;
                }
                data[idx] = crackColor[0];
                data[idx + 1] = crackColor[1];
                data[idx + 2] = crackColor[2];
                hasCoverage = true;
            }
        }
        if (!hasCoverage) {
            // Restore the original Voronoi image and warn so user can adjust
            if (typeof console !== 'undefined' && console.warn) {
                console.warn('[crackGenerator] Noise bucket filtering removed all pixels; restoring fallback Voronoi image. Try adjusting crackNoiseParams (buckets/maxActiveBuckets) or change seed.');
            }
            let fallbackHits = 0;
            for (let y = 0; y < canvasH; y++) {
                for (let x = 0; x < canvasW; x++) {
                    const idx = (y * canvasW + x) * 4;
                    const srcAlpha = _voronoiCopy[idx + 3];
                    if (srcAlpha === 0) {
                        data[idx] = 0;
                        data[idx + 1] = 0;
                        data[idx + 2] = 0;
                        data[idx + 3] = 0;
                        continue;
                    }
                    const screenX = (x + 0.5) * invQuality;
                    const screenY = (y + 0.5) * invQuality;
                    const baseX = Math.max(0, Math.min(width - 1, Math.floor(screenX)));
                    const baseY = Math.max(0, Math.min(height - 1, Math.floor(screenY)));
                    const baseIndex = baseY * width + baseX;
                    if (noiseMaskData && noiseMaskData[baseIndex] === 0) {
                        data[idx] = 0;
                        data[idx + 1] = 0;
                        data[idx + 2] = 0;
                        data[idx + 3] = 0;
                        continue;
                    }
                    if (!activeBuckets!.has(sampleBucketId!(screenX, screenY))) {
                        if (noiseMaskData) noiseMaskData[baseIndex] = 0;
                        data[idx] = 0;
                        data[idx + 1] = 0;
                        data[idx + 2] = 0;
                        data[idx + 3] = 0;
                        continue;
                    }
                    const maskAlpha = noiseMaskData ? Math.max(0, Math.min(1, noiseMaskData[baseIndex] / 255)) : 1;
                    const finalAlpha = Math.max(0, Math.min(255, Math.round(srcAlpha * maskAlpha)));
                    if (finalAlpha <= 0) {
                        data[idx] = 0;
                        data[idx + 1] = 0;
                        data[idx + 2] = 0;
                        data[idx + 3] = 0;
                        continue;
                    }
                    data[idx] = _voronoiCopy[idx];
                    data[idx + 1] = _voronoiCopy[idx + 1];
                    data[idx + 2] = _voronoiCopy[idx + 2];
                    data[idx + 3] = finalAlpha;
                    fallbackHits++;
                }
            }
            hasCoverage = fallbackHits > 0;
        }
    } else {
        for (let y = 0; y < canvasH; y++) {
            for (let x = 0; x < canvasW; x++) {
                const idx = (y * canvasW + x) * 4;
                if (data[idx + 3] === 0) continue;
                data[idx] = 24;
                data[idx + 1] = 24;
                data[idx + 2] = 24;
            }
        }
    }

    if (noiseMaskData) {
        let hits = 0;
        for (let i = 0; i < noiseMaskData.length; i++) {
            if (noiseMaskData[i] > 0) hits++;
        }
        noiseMaskHits = hits;
        if (noiseMaskHits === 0) {
            noiseMaskData = null;
        }
    }

    const out: CrackRaster = { data, width: canvasW, height: canvasH, quality, color: [24, 24, 24] };
    if (attachDebugRegionRequested && debug_regionMap) {
        out.debugRegion = {
            map: debug_regionMap,
            w: debug_regionW,
            h: debug_regionH,
            buckets: debug_buckets,
            cellW: debug_regionCellW,
            cellH: debug_regionCellH,
            minX,
            minY,
            quality,
            activeBucketIds: activeBuckets ? Array.from(activeBuckets) : undefined,
        };
    }
    if (noiseMaskData && noiseMaskHits > 0) {
        out.noiseMask = {
            data: noiseMaskData,
            width,
            height,
        };
    }
    return out;
}
