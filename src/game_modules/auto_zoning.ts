import type { Segment } from './mapgen';
import { config } from './config';

export type DensityBuckets = { dist: number; weight: number }[];

function segmentLength(s: Segment): number {
  const dx = s.r.end.x - s.r.start.x;
  const dy = s.r.end.y - s.r.start.y;
  return Math.hypot(dx, dy);
}

export function estimateCityCenter(segments: Segment[]): { x: number; y: number } {
  // Centro ponderado pelo comprimento dos segmentos
  let sumW = 0, cx = 0, cy = 0;
  for (const s of segments) {
    const w = segmentLength(s);
    const mx = 0.5 * (s.r.start.x + s.r.end.x);
    const my = 0.5 * (s.r.start.y + s.r.end.y);
    sumW += w;
    cx += w * mx;
    cy += w * my;
  }
  if (!sumW) return { x: 0, y: 0 };
  return { x: cx / sumW, y: cy / sumW };
}

export function buildDensityByRadius(segments: Segment[], center: { x: number; y: number }, bucketM = 200): DensityBuckets {
  const buckets = new Map<number, number>();
  for (const s of segments) {
    const mx = 0.5 * (s.r.start.x + s.r.end.x);
    const my = 0.5 * (s.r.start.y + s.r.end.y);
    const d = Math.hypot(mx - center.x, my - center.y);
    const b = Math.floor(d / bucketM);
    const w = segmentLength(s);
    buckets.set(b, (buckets.get(b) || 0) + w);
  }
  return Array.from(buckets.entries()).sort((a,b)=>a[0]-b[0]).map(([b, w])=>({ dist: (b+0.5)*bucketM, weight: w }));
}

export function radiiFromDensity(buckets: DensityBuckets, thresholds = config.zoningModel.autoThresholds, minGaps = { dr: 50, rr: 200, ir: 300 }): { downtown: number; residential: number; industrial: number; rural: number } {
  const total = buckets.reduce((a, x) => a + x.weight, 0) || 1;
  let acc = 0;
  let Rc = 500, Rr = 2000, Ri = 3500, Ru = Math.hypot(config.mapGeneration.QUADTREE_PARAMS.width, config.mapGeneration.QUADTREE_PARAMS.height);
  for (const b of buckets) {
    acc += b.weight;
    const frac = acc / total;
    if (frac >= thresholds.downtown && Rc === 500) Rc = b.dist;
    if (frac >= thresholds.residential && Rr === 2000) Rr = b.dist;
    if (frac >= thresholds.industrial && Ri === 3500) Ri = b.dist;
  }
  // Impor ordem e folgas
  Rr = Math.max(Rr, Rc + minGaps.dr);
  Ri = Math.max(Ri, Rr + minGaps.rr);
  Ru = Math.max(Ru, Ri + minGaps.ir);
  return { downtown: Rc, residential: Rr, industrial: Ri, rural: Ru };
}

export function autoSetConcentric(segments: Segment[]): void {
  if (!config.zoningModel.autoConcentricFromDensity) return;
  if ((config.zoningModel.mode as any) !== 'concentric') return;
  const center = estimateCityCenter(segments);
  const buckets = buildDensityByRadius(segments, center, 200);
  const radii = radiiFromDensity(buckets);
  (config as any).zoningModel.cityCenter = center;
  (config as any).zoningModel.concentricRadiiM = radii;
}
