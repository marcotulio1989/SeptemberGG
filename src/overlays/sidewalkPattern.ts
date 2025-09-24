import * as PIXI from 'pixi.js';
import { generateIsometricTilePattern, TileGeneratorOptions } from '../lib/isometricTileGenerator';

export type SidewalkOptions = Partial<TileGeneratorOptions> & {
    // no extras yet; placeholder for future knobs
};

/**
 * Gera uma textura PIXI repetível com piso isométrico procedural para calçadas.
 */
export function createProceduralSidewalkTexture(options: SidewalkOptions = {}): PIXI.Texture | null {
    if (typeof document === 'undefined') return null;
    const canvas = generateIsometricTilePattern(options);
    if (!canvas) return null;
    const texture = PIXI.Texture.from(canvas);
    try {
        const base = (texture as any).baseTexture;
        if (base) {
            try { base.wrapMode = PIXI.WRAP_MODES.REPEAT; } catch (e) {}
            try { base.scaleMode = PIXI.SCALE_MODES.LINEAR; } catch (e) {}
        }
    } catch (e) {}
    return texture;
}
