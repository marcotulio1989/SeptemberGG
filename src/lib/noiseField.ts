import { Noise } from 'noisejs';

export interface WarpedNoiseOptions {
    /** Strength multiplier applied to the domain warp displacements. */
    warpStrength?: number;
    /** Base frequency used by the warp noise fields. */
    warpScale?: number;
    /** Number of warp layers applied before sampling the base noise. */
    warpOctaves?: number;
    /** Frequency multiplier between warp layers. */
    warpLacunarity?: number;
    /** Amplitude multiplier between warp layers. */
    warpGain?: number;
    /** Additional layers of detail when sampling the base pattern. */
    baseLayers?: number;
    /** Frequency multiplier for base layers. */
    baseLacunarity?: number;
    /** Amplitude multiplier for base layers. */
    baseGain?: number;
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/**
 * Sample a 2D noise field using domain-warped Perlin + Simplex noise.
 *
 * The goal is to produce organic looking regions without relying on the
 * traditional layered accumulation that was previously used throughout the
 * project. Domain warping adds large-scale drifts, while a handful of
 * base layers provide localized variation.
 */
export function sampleWarpedNoise(
    noise: Noise,
    x: number,
    y: number,
    octaves = 3,
    lacunarity = 2,
    gain = 0.5,
    options: WarpedNoiseOptions = {},
): number {
    const warpOctaves = Math.max(1, Math.floor(options.warpOctaves ?? octaves));
    const warpScale = options.warpScale ?? 0.75;
    const warpStrengthBase = options.warpStrength ?? 0.65;
    const warpLacunarity = options.warpLacunarity ?? lacunarity;
    const warpGain = options.warpGain ?? gain;

    let warpedX = x;
    let warpedY = y;
    let warpStrength = warpStrengthBase;
    let freq = 1;
    for (let i = 0; i < warpOctaves; i++) {
        const dx = noise.simplex2((x + 17.13) * warpScale * freq, (y - 41.97) * warpScale * freq);
        const dy = noise.simplex2((x - 93.11) * warpScale * freq, (y + 26.41) * warpScale * freq);
        warpedX += dx * warpStrength;
        warpedY += dy * warpStrength;
        freq *= warpLacunarity;
        warpStrength *= warpGain;
    }

    const baseLayers = Math.max(1, Math.floor(options.baseLayers ?? 2));
    const baseLacunarity = options.baseLacunarity ?? (lacunarity * 0.85);
    const baseGain = options.baseGain ?? (gain * 0.9);

    let layerFreq = 1;
    let layerAmp = 1;
    let accum = 0;
    let weight = 0;
    for (let i = 0; i < baseLayers; i++) {
        const perlin = noise.perlin2(warpedX * layerFreq, warpedY * layerFreq);
        const simplex = noise.simplex2((warpedX + 12.7) * layerFreq, (warpedY - 3.8) * layerFreq);
        const ridge = 1 - Math.abs(perlin);
        const combined = (perlin * 0.5 + simplex * 0.35 + (ridge * 2 - 1) * 0.15);
        accum += combined * layerAmp;
        weight += layerAmp;
        layerFreq *= baseLacunarity;
        layerAmp *= baseGain;
    }

    const normalized = (weight > 0 ? accum / weight : accum) * 0.5 + 0.5;
    return clamp01(normalized);
}
