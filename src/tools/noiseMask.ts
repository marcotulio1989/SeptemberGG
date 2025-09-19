import { Noise } from 'noisejs';
import { sampleWarpedNoise } from '../lib/noiseField';

export interface NoiseMaskOptions {
    width: number;
    height: number;
    minX: number;
    minY: number;
    seed?: number;
    baseScale?: number;
    octaves?: number;
    lacunarity?: number;
    gain?: number;
    buckets?: number;
    maxActiveBuckets?: number;
    activeBucketStrategy?: 'smallest' | 'largest' | 'random';
    crackBandWidth?: number; // used for soft banding
    mode?: 'isometric' | 'normal';
    isoToWorld?: (p: { x: number; y: number }) => { x: number; y: number };
}

/**
 * Generate a binary (0/255) mask using the same warped-noise bucket strategy used by
 * the crack generator. Returns a Uint8Array of length width*height where 255 = allowed.
 */
export function generateNoiseMask(opts: NoiseMaskOptions): Uint8Array {
    const width = Math.max(1, Math.round(opts.width));
    const height = Math.max(1, Math.round(opts.height));
    const seed = (typeof opts.seed === 'number') ? (opts.seed >>> 0) : (Date.now() >>> 0);
    const baseScale = opts.baseScale ?? 1 / 480;
    const octaves = opts.octaves ?? 4;
    const lacunarity = opts.lacunarity ?? 2;
    const gain = opts.gain ?? 0.5;
    const buckets = Math.max(1, Math.min(8, opts.buckets ?? 3));
    const maxActive = Math.max(1, Math.min(buckets, opts.maxActiveBuckets ?? 2));
    const strategy = opts.activeBucketStrategy ?? 'smallest';
    const crackBandWidth = Math.max(0.0001, Math.min(1, opts.crackBandWidth ?? 0.012));

    // build coarse region map (similar to debug_region in crackGenerator)
    const regionSample = Math.max(8, Math.min(128, Math.floor(Math.min(width, height) / 6) || 16));
    const regionW = Math.max(1, Math.floor(width / regionSample));
    const regionH = Math.max(1, Math.floor(height / regionSample));
    const regionNoise = new Noise(seed || 1);
    const regionMap = new Uint8Array(regionW * regionH);
    const counts = new Array<number>(buckets).fill(0);
    for (let ry = 0; ry < regionH; ry++) {
        for (let rx = 0; rx < regionW; rx++) {
            const sampleX = ((rx + 0.5) / regionW) * width;
            const sampleY = ((ry + 0.5) / regionH) * height;
            const screenPt = { x: sampleX + (opts.minX || 0), y: sampleY + (opts.minY || 0) };
            const worldPt = (opts.mode === 'isometric') ? { x: screenPt.x, y: screenPt.y } : (opts.isoToWorld ? opts.isoToWorld(screenPt) : screenPt);
            const v = sampleWarpedNoise(regionNoise, worldPt.x * baseScale, worldPt.y * baseScale, octaves, lacunarity, gain);
            let id = Math.floor(v * buckets);
            if (id < 0) id = 0;
            if (id >= buckets) id = buckets - 1;
            regionMap[ry * regionW + rx] = id;
            counts[id]++;
        }
    }

    // pick active buckets
    const stats = counts.map((c, i) => ({ i, c }));
    let picked: { i: number; c: number }[] = [];
    if (strategy === 'largest') {
        picked = stats.slice().sort((a, b) => b.c - a.c).slice(0, maxActive);
    } else if (strategy === 'random') {
        const rng = (() => {
            let t = (seed ^ 0x9E3779B9) >>> 0;
            return () => {
                t = (t * 1664525 + 1013904223) >>> 0;
                return t / 0x100000000;
            };
        })();
        const arr = stats.slice();
        for (let i = arr.length - 1; i > 0; i--) {
            const j = Math.floor(rng() * (i + 1));
            const tmp = arr[i]; arr[i] = arr[j]; arr[j] = tmp;
        }
        picked = arr.slice(0, maxActive);
    } else {
        picked = stats.slice().sort((a, b) => a.c - b.c).slice(0, maxActive);
    }
    const activeBuckets = new Set<number>(picked.map(p => p.i));
    if (activeBuckets.size === 0) for (let b = 0; b < buckets; b++) activeBuckets.add(b);

    // prepare per-bucket noise instances and centers
    const bucketNoise: Noise[] = new Array(buckets);
    const bucketCenters: number[] = new Array(buckets);
    const fineScales: number[] = new Array(buckets);
    for (let b = 0; b < buckets; b++) {
        bucketNoise[b] = new Noise(seed + b * 97 + 13);
        bucketCenters[b] = (b + 0.5) / buckets;
        fineScales[b] = baseScale * (1.5 + b * 0.6);
    }

    // generate mask
    const mask = new Uint8Array(width * height);
    const cellW = regionW > 0 ? width / regionW : width;
    const cellH = regionH > 0 ? height / regionH : height;
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const rx = Math.max(0, Math.min(regionW - 1, Math.floor(x / (cellW || 1))));
            const ry = Math.max(0, Math.min(regionH - 1, Math.floor(y / (cellH || 1))));
            const bucketId = regionMap[ry * regionW + rx];
            if (!activeBuckets.has(bucketId)) {
                mask[y * width + x] = 0;
                continue;
            }
            const noiseInst = bucketNoise[bucketId];
            const samplePt = { x: x + 0.5 + (opts.minX || 0), y: y + 0.5 + (opts.minY || 0) };
            const worldPt = (opts.mode === 'isometric') ? { x: samplePt.x, y: samplePt.y } : (opts.isoToWorld ? opts.isoToWorld(samplePt) : samplePt);
            const baseVal = sampleWarpedNoise(noiseInst, worldPt.x * baseScale, worldPt.y * baseScale, octaves, lacunarity, gain);
            const dist = Math.abs(baseVal - bucketCenters[bucketId]);
            if (dist > crackBandWidth) {
                mask[y * width + x] = 0;
                continue;
            }
            const edge = Math.max(0, (crackBandWidth - dist) / crackBandWidth);
            const fine = sampleWarpedNoise(noiseInst, worldPt.x * fineScales[bucketId] * 3.0, worldPt.y * fineScales[bucketId] * 3.0, 2, 2, 0.6);
            const modulation = Math.max(0, Math.min(1, Math.pow(edge, 1.2) * (0.35 + 0.65 * fine)));
            const keep = modulation > 0.03; // threshold similar to alpha < 12
            mask[y * width + x] = keep ? 255 : 0;
        }
    }

    return mask;
}

export interface NoiseRegion {
    map: Uint8Array;
    w: number;
    h: number;
    buckets: number;
}

/**
 * Generate the coarse bucket region map (values 0..buckets-1) without per-pixel
 * band filtering. Useful for visual debugging.
 */
export function generateNoiseRegionMap(opts: NoiseMaskOptions): NoiseRegion {
    const width = Math.max(1, Math.round(opts.width));
    const height = Math.max(1, Math.round(opts.height));
    const seed = (typeof opts.seed === 'number') ? (opts.seed >>> 0) : (Date.now() >>> 0);
    const baseScale = opts.baseScale ?? 1 / 480;
    const octaves = opts.octaves ?? 4;
    const lacunarity = opts.lacunarity ?? 2;
    const gain = opts.gain ?? 0.5;
    const buckets = Math.max(1, Math.min(8, opts.buckets ?? 3));

    const regionSample = Math.max(8, Math.min(128, Math.floor(Math.min(width, height) / 6) || 16));
    const regionW = Math.max(1, Math.floor(width / regionSample));
    const regionH = Math.max(1, Math.floor(height / regionSample));
    const regionNoise = new Noise(seed || 1);
    const regionMap = new Uint8Array(regionW * regionH);
    for (let ry = 0; ry < regionH; ry++) {
        for (let rx = 0; rx < regionW; rx++) {
            const sampleX = ((rx + 0.5) / regionW) * width;
            const sampleY = ((ry + 0.5) / regionH) * height;
            const screenPt = { x: sampleX + (opts.minX || 0), y: sampleY + (opts.minY || 0) };
            const worldPt = (opts.mode === 'isometric') ? { x: screenPt.x, y: screenPt.y } : (opts.isoToWorld ? opts.isoToWorld(screenPt) : screenPt);
            const v = sampleWarpedNoise(regionNoise, worldPt.x * baseScale, worldPt.y * baseScale, octaves, lacunarity, gain);
            let id = Math.floor(v * buckets);
            if (id < 0) id = 0;
            if (id >= buckets) id = buckets - 1;
            regionMap[ry * regionW + rx] = id;
        }
    }
    return { map: regionMap, w: regionW, h: regionH, buckets };
}

/**
 * Convert a coarse region map to a visual RGBA image stretched to target width/height.
 * Each bucket gets a simple color; colors are deterministic but arbitrary for debugging.
 */
export function regionMapToRgbaImage(region: NoiseRegion, targetW: number, targetH: number): Uint8ClampedArray {
    const out = new Uint8ClampedArray(targetW * targetH * 4);
    // simple color palette (repeatable)
    const palette: [number, number, number][] = [
        [200, 40, 40], [40, 200, 40], [40, 40, 200], [200, 200, 40], [200, 40, 200], [40, 200, 200], [120,120,120], [220,120,40]
    ];
    const cellW = region.w > 0 ? Math.max(1, Math.floor(targetW / region.w)) : targetW;
    const cellH = region.h > 0 ? Math.max(1, Math.floor(targetH / region.h)) : targetH;
    for (let ry = 0; ry < region.h; ry++) {
        for (let rx = 0; rx < region.w; rx++) {
            const id = region.map[ry * region.w + rx];
            const col = palette[id % palette.length];
            const x0 = Math.min(targetW, rx * cellW);
            const y0 = Math.min(targetH, ry * cellH);
            const x1 = Math.min(targetW, x0 + cellW);
            const y1 = Math.min(targetH, y0 + cellH);
            for (let y = y0; y < y1; y++) {
                for (let x = x0; x < x1; x++) {
                    const i = (y * targetW + x) * 4;
                    out[i] = col[0]; out[i+1] = col[1]; out[i+2] = col[2]; out[i+3] = 255;
                }
            }
        }
    }
    return out;
}
