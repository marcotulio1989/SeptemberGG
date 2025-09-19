// Gerador de zonas aleatórias (conversão do script MATLAB)
// Produz um FeatureCollection GeoJSON com polígonos convexos rotulados por tipo

export type ZoneType = 'Comercial' | 'Industrial' | 'Residencial' | 'Rural';

export type ZoneSimParams = {
  numComercial: number;
  numIndustrial: number;
  numResidencial: number;
  numRural: number;
  bounds: { xmin: number; xmax: number; ymin: number; ymax: number };
  scaleMin: number; // área alvo mínima (unidades^2)
  scaleMax: number; // área alvo máxima (unidades^2)
  // separação mínima aproximada entre centros (multiplicador dos raios efetivos)
  minSepFactor?: number;
};

export const defaultZoneSimParams: ZoneSimParams = {
  numComercial: 3,
  numIndustrial: 3,
  numResidencial: 4,
  numRural: 2,
  bounds: { xmin: -5000, xmax: 5000, ymin: -5000, ymax: 5000 },
  scaleMin: 180 * 180,
  scaleMax: 600 * 600,
  minSepFactor: 0.6,
};

type Point = { x: number; y: number };

function randIn(min: number, max: number) { return min + Math.random() * (max - min); }

function polygonArea(points: Point[]): number {
  let a = 0;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    a += points[j].x * points[i].y - points[i].x * points[j].y;
  }
  return a / 2;
}

function centroid(points: Point[]): Point {
  const a = polygonArea(points) || 1;
  let cx = 0, cy = 0;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const f = points[j].x * points[i].y - points[i].x * points[j].y;
    cx += (points[j].x + points[i].x) * f;
    cy += (points[j].y + points[i].y) * f;
  }
  return { x: cx / (6 * a), y: cy / (6 * a) };
}

function scalePolygon(points: Point[], factor: number, center: Point): Point[] {
  return points.map(p => ({ x: center.x + (p.x - center.x) * factor, y: center.y + (p.y - center.y) * factor }));
}

// Monotone chain convex hull
function convexHull(pts: Point[]): Point[] {
  const points = pts.slice().sort((a, b) => (a.x - b.x) || (a.y - b.y));
  if (points.length <= 3) return points;
  const lower: Point[] = [];
  for (const p of points) {
    while (lower.length >= 2) {
      const q = lower[lower.length - 1];
      const r = lower[lower.length - 2];
      if ((q.x - r.x) * (p.y - r.y) - (q.y - r.y) * (p.x - r.x) <= 0) lower.pop(); else break;
    }
    lower.push(p);
  }
  const upper: Point[] = [];
  for (let i = points.length - 1; i >= 0; i--) {
    const p = points[i];
    while (upper.length >= 2) {
      const q = upper[upper.length - 1];
      const r = upper[upper.length - 2];
      if ((q.x - r.x) * (p.y - r.y) - (q.y - r.y) * (p.x - r.x) <= 0) upper.pop(); else break;
    }
    upper.push(p);
  }
  upper.pop(); lower.pop();
  return lower.concat(upper);
}

function randomConvexPolygon(cx: number, cy: number, areaTarget: number): Point[] {
  const n = Math.floor(randIn(6, 10.999));
  const theta = Array.from({ length: n }, () => Math.random() * Math.PI * 2).sort((a, b) => a - b);
  const r = Array.from({ length: n }, () => 0.5 + Math.random());
  const pts: Point[] = theta.map((t, i) => ({ x: cx + Math.cos(t) * r[i], y: cy + Math.sin(t) * r[i] }));
  let hull = convexHull(pts);
  // escalar até área alvo
  const a = Math.abs(polygonArea(hull)) || 1;
  const factor = Math.sqrt(areaTarget / a);
  hull = scalePolygon(hull, factor, { x: cx, y: cy });
  return hull;
}

export function generateRandomZones(params: ZoneSimParams = defaultZoneSimParams) {
  const { xmin, xmax, ymin, ymax } = params.bounds;
  const tipos: ZoneType[] = ['Comercial', 'Industrial', 'Residencial', 'Rural'];
  const nums = [params.numComercial, params.numIndustrial, params.numResidencial, params.numRural];
  const placed: { c: Point; r: number }[] = [];
  const minSepK = params.minSepFactor ?? 0.6;

  const features: any[] = [];
  for (let t = 0; t < tipos.length; t++) {
    const tipo = tipos[t];
    for (let i = 0; i < nums[t]; i++) {
      let hull: Point[] = [];
      let cx = 0, cy = 0; let areaT = 0; let tries = 0;
      while (tries++ < 200) {
        cx = randIn(xmin, xmax);
        cy = randIn(ymin, ymax);
        areaT = randIn(params.scaleMin, params.scaleMax);
        const rEff = Math.sqrt(areaT / Math.PI);
        // evitar sobreposição pesada por distância entre centros
        const ok = placed.every(p => {
          const dx = cx - p.c.x, dy = cy - p.c.y;
          const d = Math.hypot(dx, dy);
          return d >= minSepK * (rEff + p.r);
        });
        if (!ok) continue;
        hull = randomConvexPolygon(cx, cy, areaT);
        placed.push({ c: { x: cx, y: cy }, r: rEff });
        break;
      }
      if (!hull.length) continue;
      const coords = hull.map(p => [p.x, p.y]);
      coords.push([hull[0].x, hull[0].y]);
      features.push({
        type: 'Feature',
        properties: { zone: tipoToInternal(tipo), tipo },
        geometry: { type: 'Polygon', coordinates: [coords] },
      });
    }
  }

  return { type: 'FeatureCollection', features };
}

function tipoToInternal(t: ZoneType): 'downtown' | 'commercial' | 'residential' | 'industrial' | 'rural' {
  switch (t) {
    case 'Comercial': return 'commercial';
    case 'Industrial': return 'industrial';
    case 'Residencial': return 'residential';
    case 'Rural': return 'rural';
  }
}
