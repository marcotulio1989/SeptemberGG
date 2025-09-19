import { Noise } from 'noisejs';
import type { Point } from '../generic_modules/math';
import type { ZoneName } from './mapgen';
import { heatmap } from './mapgen';
import { config } from './config';
import { sampleWarpedNoise } from '../lib/noiseField';

export type ZoningParams = {
  baseScale: number;
  octaves: number;
  lacunarity: number;
  gain: number;
  thresholds: { r1: number; r2: number; r3: number; r4: number };
};

const Zoning = new (class {
  private _noise: Noise | null = null;
  private _seed: number | null = null;
  private _params: ZoningParams = {
  // Parâmetros mais "macro" para áreas mais coesas
  baseScale: 1 / 800,   // ruído mais largo => blocos maiores
  octaves: 3,           // menos detalhe fino
  lacunarity: 2.0,
  gain: 0.5,
  // Faixas mais separadas para distinguir usos do solo
  thresholds: { r1: 0.30, r2: 0.52, r3: 0.70, r4: 0.88 },
  };
  // Cache simples de zonas por coordenadas quantizadas (no domínio do ruído)
  private _cache: Map<string, ZoneName> = new Map();
  private _cacheMax = 200000; // limite para evitar crescimento indefinido
  // Geo features opcionais
  private _geoFeatures: Array<{ type: 'Polygon' | 'MultiPolygon'; properties?: Record<string, any>; coords: number[][][] }> | null = null;

  private _clearCache() { this._cache.clear(); }
  private _maybeEvict() {
    if (this._cache.size > this._cacheMax) {
      // Estratégia simples: limpar tudo quando estourar limite
      this._cache.clear();
    }
  }

  init(seed: number, params?: Partial<ZoningParams>) {
    this._seed = seed;
    this._noise = new Noise(seed);
    if (params) this.setParams(params);
  this._clearCache();
  }

  setParams(p: Partial<ZoningParams>) {
    const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
    const cur = this._params;
    const thresholds = { ...cur.thresholds, ...(p.thresholds || {}) };
    let r1 = clamp01(thresholds.r1);
    let r2 = clamp01(Math.max(thresholds.r2, r1 + 1e-3));
    let r3 = clamp01(Math.max(thresholds.r3, r2 + 1e-3));
    let r4 = clamp01(Math.max(thresholds.r4, r3 + 1e-3));
    this._params = {
      baseScale: p.baseScale ?? cur.baseScale,
      octaves: p.octaves ?? cur.octaves,
      lacunarity: p.lacunarity ?? cur.lacunarity,
      gain: p.gain ?? cur.gain,
      thresholds: { r1, r2, r3, r4 },
    };
  this._clearCache();
  }

  getParams(): ZoningParams { return this._params; }
  getNoise(): Noise | null { return this._noise; }
  getSeed(): number | null { return this._seed; }
  setGeoJSON(fc: { type: 'FeatureCollection'; features: any[] } | null) {
    if (!fc) { this._geoFeatures = null; this._clearCache(); return; }
    const feats: Array<{ type: 'Polygon' | 'MultiPolygon'; properties?: any; coords: number[][][] }> = [];
    for (const f of fc.features || []) {
      const g = f.geometry || {};
      if (g.type === 'Polygon') {
        feats.push({ type: 'Polygon', properties: f.properties || {}, coords: g.coordinates });
      } else if (g.type === 'MultiPolygon') {
        for (const poly of g.coordinates) {
          feats.push({ type: 'Polygon', properties: f.properties || {}, coords: poly });
        }
      }
    }
    this._geoFeatures = feats;
    this._clearCache();
  }

  private _macroNoise(x: number, y: number): number {
    const mn = config.zoningModel.macroNoise;
    if (!this._noise) return 0;
    return sampleWarpedNoise(this._noise, x * mn.baseScale, y * mn.baseScale, mn.octaves, mn.lacunarity, mn.gain) * 2 - 1; // [-1,1]
  }

  private _scoreProcedural(p: Point): Record<ZoneName, number> {
    const c = config.zoningModel.cityCenter;
    const dx = p.x - c.x, dy = p.y - c.y;
    const d = Math.hypot(dx, dy);
    const { downtownRadiusM: R0, innerRingRadiusM: R1, outerRingRadiusM: R2 } = config.zoningModel;
    // Bases radiais com transições suaves
    const s = (x: number) => 1 / (1 + Math.exp(-x));
    const k = 1 / 300; // dureza das bordas
    const w = config.zoningModel.weights;
    const n = this._macroNoise(p.x, p.y) * 300; // perturba borda em metros
    // Escores (sem normalizar, apenas relativos)
    const downtown = w.downtown * s((R0 - d + n) * k);
    const commercial = w.commercial * s((R1 - d + n) * k) * (1 - downtown * 0.7);
    const residential = w.residential * s((R2 - d + n) * k) * (1 - commercial * 0.5) * (1 - downtown * 0.7);
    const industrial = w.industrial * s((d - R1 * 0.7 + n) * k) * (1 - downtown) * (1 - commercial * 0.6);
    const rural = w.rural * s((d - R2 + n) * k);
    return { downtown, commercial, residential, industrial, rural } as Record<ZoneName, number>;
  }

  private _classify(scores: Record<ZoneName, number>): ZoneName {
    let best: ZoneName = 'residential';
    let val = -Infinity;
    for (const k of Object.keys(scores) as ZoneName[]) {
      const v = scores[k];
      if (v > val) { val = v; best = k; }
    }
    return best;
  }

  zoneAt(p: Point | { x: number; y: number }): ZoneName {
    if (!this._noise) return 'residential';
    // Cache em grade world-space mais grossa para procedural (metros)
    const grid = 64; // 64m por célula
    const qx = Math.floor(p.x / grid);
    const qy = Math.floor(p.y / grid);
    const key = `${qx}:${qy}`;
    const cached = this._cache.get(key);
    if (cached) return cached;

    let z: ZoneName;
  if (config.zoningModel.mode === 'concentric') {
      // Classificação por anéis concêntricos: downtown -> residential -> industrial -> rural
      const c = config.zoningModel.cityCenter;
      const dx = (p as Point).x - c.x;
      const dy = (p as Point).y - c.y;
      const d = Math.hypot(dx, dy);
      const R = config.zoningModel.concentricRadiiM;
      if (d <= R.downtown) z = 'downtown';
      else if (d <= R.residential) z = 'residential';
      else if (d <= R.industrial) z = 'industrial';
      else z = 'rural';
  } else if (config.zoningModel.mode === 'perlin') {
      const { baseScale, octaves, lacunarity, gain, thresholds } = this._params;
      const n = sampleWarpedNoise(this._noise, p.x * baseScale, p.y * baseScale, octaves, lacunarity, gain);
      if (n < thresholds.r1) z = 'rural';
      else if (n < thresholds.r2) z = 'residential';
      else if (n < thresholds.r3) z = 'commercial';
      else if (n < thresholds.r4) z = 'industrial';
      else z = 'downtown';
  } else if (config.zoningModel.mode === 'geo' && this._geoFeatures) {
      // Simplificação: usa propriedade `zone` no GeoJSON; fallback para perlin
      const hit = this._geoFeatures.find(f => pointInPolygon([p.x, p.y], f.coords[0]));
      z = (hit?.properties?.zone as ZoneName) || 'residential';
    } else if (config.zoningModel.mode === 'heatmap') {
    // Mapear por 5 bandas de distância usando R = rUnit
    // R1: [0, R) => downtown
    // R2: [R, 2R) => commercial
    // R3: [2R, 3R) => residential
    // R4: [3R, 4R) => industrial
    // R5: [4R, +inf) => rural
    const c = config.zoningModel.cityCenter;
    const R = Math.max(200, (heatmap as any).rUnit || 3000);
    const d = Math.hypot(p.x - c.x, p.y - c.y);
    if (d < R) z = 'downtown';
    else if (d < 2 * R) z = 'commercial';
    else if (d < 3 * R) z = 'residential';
    else if (d < 4 * R) z = 'industrial';
    else z = 'rural';
    } else {
      // Procedural radial + macro-noise
      const scores = this._scoreProcedural(p as Point);
      z = this._classify(scores);
    }
    this._cache.set(key, z);
    this._maybeEvict();
    return z;
  }
})();

export default Zoning;

// Teste de ponto-em-polígono (ray casting)
function pointInPolygon(pt: [number, number], poly: number[][]): boolean {
  const [x, y] = pt;
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0], yi = poly[i][1];
    const xj = poly[j][0], yj = poly[j][1];
    const intersect = ((yi > y) !== (yj > y)) && (x < ((xj - xi) * (y - yi)) / ((yj - yi) || 1e-9) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}