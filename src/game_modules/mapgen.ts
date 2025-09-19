import * as _ from 'lodash';
import { Noise } from 'noisejs';
import Quadtree from '../lib/quadtree';
import seedrandom from 'seedrandom';

import * as math from '../generic_modules/math';
import * as util from '../generic_modules/utility';
import { CollisionObject, CollisionObjectType } from '../generic_modules/collision';
import { config, roadWidthM, highwayWidthM } from './config';
import Zoning from './zoning';
import { Point } from '../generic_modules/math';

export enum SegmentEnd {
    START = "start",
    END = "end"
}

interface SegmentRoad {
    start: Point;
    end: Point;
    setStart: (val: Point) => void;
    setEnd: (val: Point) => void;
}

interface SegmentMeta {
    highway?: boolean;
    color?: number;
    severed?: boolean;
}

export class Segment {
    width: number;
    collider: CollisionObject;

    roadRevision = 0;
    dirRevision: number | undefined = undefined;
    lengthRevision: number | undefined = undefined;

    cachedDir: number | undefined = undefined;
    cachedLength: number | undefined = undefined;

    r: SegmentRoad;
    links: { b: Segment[]; f: Segment[] } = { b: [], f: [] };
    users: any[] = [];
    maxSpeed: number;
    capacity: number;
    id?: number;
    setupBranchLinks?: () => void;

    constructor(
        start: Point,
        end: Point,
        public t: number = 0,
        public q: SegmentMeta = {}
    ) {
        start = _.cloneDeep(start);
        end = _.cloneDeep(end);

    // Largura em metros, escalada a partir da altura do personagem
    this.width = q.highway ? highwayWidthM() : roadWidthM();
        this.collider = new CollisionObject(this, CollisionObjectType.LINE, { start, end, width: this.width });

        this.r = {
            start: start,
            end: end,
            setStart: (val: Point) => {
                this.r.start = val;
                this.collider.updateCollisionProperties({ start: this.r.start });
                this.roadRevision++;
            },
            setEnd: (val: Point) => {
                this.r.end = val;
                this.collider.updateCollisionProperties({ end: this.r.end });
                this.roadRevision++;
            }
        };

        [this.maxSpeed, this.capacity] = q.highway ? [1200, 12] : [800, 6];
    }

    currentSpeed(): number {
        return Math.max(config.gameLogic.MIN_SPEED_PROPORTION, 1 - Math.max(0, this.users.length - 1) / this.capacity) * this.maxSpeed;
    }

    dir(): number {
        if (this.dirRevision !== this.roadRevision) {
            this.dirRevision = this.roadRevision;
            const vector = math.subtractPoints(this.r.end, this.r.start);
            this.cachedDir = -1 * math.sign(math.crossProduct({ x: 0, y: 1 }, vector)) * math.angleBetween({ x: 0, y: 1 }, vector);
        }
        return this.cachedDir!;
    }

    length(): number {
        if (this.lengthRevision !== this.roadRevision) {
            this.lengthRevision = this.roadRevision;
            this.cachedLength = math.length(this.r.start, this.r.end);
        }
        return this.cachedLength!;
    }

    debugLinks(): void {
        this.q.color = 0x00FF00;
        this.links.b.forEach(backwards => {
            backwards.q.color = 0xFF0000;
        });
        this.links.f.forEach(forwards => {
            forwards.q.color = 0x0000FF;
        });
    }

    startIsBackwards(): boolean {
        if (this.links.b.length > 0) {
            return math.equalV(this.links.b[0].r.start, this.r.start) ||
                   math.equalV(this.links.b[0].r.end, this.r.start);
        } else {
             return math.equalV(this.links.f[0].r.start, this.r.end) ||
                   math.equalV(this.links.f[0].r.end, this.r.end);
        }
    }

    cost(): number {
        return this.length() / this.currentSpeed();
    }

    costTo(other: Segment, fromFraction?: number): number {
        const segmentEnd = this.endContaining(other);
        let multiplier = 0.5;
        if (fromFraction !== undefined) {
            switch (segmentEnd) {
                case SegmentEnd.START: multiplier = fromFraction; break;
                case SegmentEnd.END: multiplier = (1 - fromFraction); break;
            }
        }
        return this.cost() * multiplier;
    }

    neighbours(): Segment[] {
        return this.links.f.concat(this.links.b);
    }

    endContaining(segment: Segment): SegmentEnd | undefined {
        const startBackwards = this.startIsBackwards();
        if (this.links.b.includes(segment)) {
            return startBackwards ? SegmentEnd.START : SegmentEnd.END;
        } else if (this.links.f.includes(segment)) {
            return startBackwards ? SegmentEnd.END : SegmentEnd.START;
        }
        return undefined;
    }

    linksForEndContaining(segment: Segment): Segment[] | undefined {
        if (this.links.b.includes(segment)) {
            return this.links.b;
        } else if (this.links.f.includes(segment)) {
            return this.links.f;
        }
        return undefined;
    }

    split(point: Point, segment: Segment, segmentList: Segment[], qTree: Quadtree): void {
        const startIsBackwards = this.startIsBackwards();

        const splitPart = segmentFactory.fromExisting(this);
        addSegment(splitPart, segmentList, qTree);
        splitPart.r.setEnd(point);
        this.r.setStart(point);

        splitPart.links.b = this.links.b.slice(0);
        splitPart.links.f = this.links.f.slice(0);
        
        const [firstSplit, secondSplit, fixLinks] = startIsBackwards
            ? [splitPart, this, splitPart.links.b]
            : [this, splitPart, splitPart.links.f];

        fixLinks.forEach(link => {
            let index = link.links.b.indexOf(this);
            if (index !== -1) {
                link.links.b[index] = splitPart;
            } else {
                index = link.links.f.indexOf(this);
                if (index !== -1) {
                    link.links.f[index] = splitPart;
                }
            }
        });

        firstSplit.links.f = [segment, secondSplit];
        secondSplit.links.b = [segment, firstSplit];
        segment.links.f.push(firstSplit, secondSplit);
    }
}

const segmentFactory = {
    fromExisting(segment: Segment, t?: number, r?: SegmentRoad, q?: SegmentMeta): Segment {
        t = util.defaultFor(t, segment.t);
        r = util.defaultFor(r, segment.r);
        q = util.defaultFor(q, segment.q);
        return new Segment(r.start, r.end, t, q);
    },

    usingDirection(start: Point, dir?: number, length?: number, t?: number, q?: SegmentMeta): Segment {
        dir = util.defaultFor(dir, 90);
        length = util.defaultFor(length, config.mapGeneration.DEFAULT_SEGMENT_LENGTH);

        const end = {
            x: start.x + length * math.sinDegrees(dir),
            y: start.y + length * math.cosDegrees(dir)
        };
    return new Segment(start, end, t, q);
    }
};

let noise: Noise;

export type ZoneName = 'downtown' | 'residential' | 'commercial' | 'industrial' | 'rural';

export function getZoneAt(p: Point | { x: number; y: number }): ZoneName {
    // Zonas puramente por ruído distorcido (independente das ruas)
    return Zoning.zoneAt(p);
}

export const heatmap = {
    // deslocamento global para alinhar regiões quentes com a cidade
    shiftX: 0,
    shiftY: 0,
    // unidade de raio (R): definido como maxDist/5 após gerar as ruas
    rUnit: 3000,
    popOnRoad(r: { start: Point, end: Point }): number {
        return (this.populationAt(r.start.x, r.start.y) + this.populationAt(r.end.x, r.end.y)) / 2;
    },
    populationAt(x: number, y: number): number {
        // Bandas por distância com base em R = rUnit (maxDist/5)
        const cx = config.zoningModel.cityCenter.x + this.shiftX;
        const cy = config.zoningModel.cityCenter.y + this.shiftY;
        const r = Math.hypot(x - cx, y - cy);
        const R = Math.max(200, this.rUnit || 3000);
        // faixa: [0,R) [R,2R) [2R,3R) [3R,4R) [4R,inf)
        let band = 0;
        if (r < R) band = 4; // mais quente
        else if (r < 2 * R) band = 3;
        else if (r < 3 * R) band = 2;
        else if (r < 4 * R) band = 1;
        else band = 0;
        // leve variação interna de banda para não ficar chapado
        const X = (x + this.shiftX) / 12000;
        const Y = (y + this.shiftY) / 12000;
        const n = (noise.simplex2(X, Y) + 1) / 2;
        const jitter = (n - 0.5) * 0.08; // +-0.04
        const base = band / 4; // 0..1
        const val = Math.max(0, Math.min(1, base + jitter));
        return val;
    },
    calibrateTo(_target: Point) {
        // No perfil radial, manter o centro fixo em zoningModel.cityCenter
        this.shiftX = 0;
        this.shiftY = 0;
    }
};

function doRoadSegmentsIntersect(r1: { start: Point, end: Point }, r2: { start: Point, end: Point }): ReturnType<typeof math.doLineSegmentsIntersect> {
    return math.doLineSegmentsIntersect(r1.start, r1.end, r2.start, r2.end, true);
}

function localConstraints(segment: Segment, segments: Segment[], qTree: Quadtree, debugData: any): boolean {
    let action = { priority: 0, func: undefined as (() => boolean) | undefined, q: {} as any };

    // helper: distância ponto->segmento com projeção clampada
    const distPointToSegment = (P: Point, A: Point, B: Point): number => {
        const AB = math.subtractPoints(B, A);
        const AP = math.subtractPoints(P, A);
        const ab2 = math.lengthV2(AB as any as Point);
        if (ab2 <= 1e-9) return Math.hypot(P.x - A.x, P.y - A.y);
        let t = (math.dotProduct(AP as any as Point, AB as any as Point)) / ab2;
        t = Math.max(0, Math.min(1, t));
        const D = { x: A.x + AB.x * t, y: A.y + AB.y * t };
        return Math.hypot(P.x - D.x, P.y - D.y);
    };

    // largura efetiva do segmento em validação (uniforme por tipo: highway vs rua)
    // Removemos multiplicadores por zona para evitar “duas espessuras” na mesma via
    const segEffWidth = segment.q.highway ? highwayWidthM() : roadWidthM();

    // PASSO 1: varrer com bbox original para decidir interseções/encaixes e capturar endpoint candidato
    const matches = qTree.retrieve(segment.collider.limits()) as {o: Segment}[];
    for (const match of matches) {
        const other = match.o;
        if (other === segment) continue;

        if (action.priority <= 4) {
            const intersection = doRoadSegmentsIntersect(segment.r, other.r);
            if (intersection) {
                if (!action.q.t || intersection.t < action.q.t) {
                    action.q.t = intersection.t;
                    action.priority = 4;
                    action.q.endCandidate = intersection;
                    action.func = () => {
                        if (util.minDegreeDifference(other.dir(), segment.dir()) < config.mapGeneration.MINIMUM_INTERSECTION_DEVIATION) {
                            return false;
                        }
                        other.split(intersection, segment, segments, qTree);
                        segment.r.setEnd(intersection);
                        segment.q.severed = true;
                        if (debugData) {
                            debugData.intersections = debugData.intersections || [];
                            debugData.intersections.push({ x: intersection.x, y: intersection.y });
                        }
                        return true;
                    };
                }
            }
        }
        
        if (action.priority <= 3) {
            if (math.length(segment.r.end, other.r.end) <= config.mapGeneration.ROAD_SNAP_DISTANCE) {
                const point = other.r.end;
                action.priority = 3;
                action.q.endCandidate = point;
                action.func = () => {
                    segment.r.setEnd(point);
                    segment.q.severed = true;

                    const links = other.startIsBackwards() ? other.links.f : other.links.b;
                    if (_.some(links, link =>
                        (math.equalV(link.r.start, segment.r.end) && math.equalV(link.r.end, segment.r.start)) ||
                        (math.equalV(link.r.start, segment.r.start) && math.equalV(link.r.end, segment.r.end))
                    )) {
                        return false;
                    }

                    links.forEach(link => {
                        link.linksForEndContaining(other)?.push(segment);
                        segment.links.f.push(link);
                    });

                    links.push(segment);
                    segment.links.f.push(other);
                    
                    if (debugData) {
                        debugData.snaps = debugData.snaps || [];
                        debugData.snaps.push({ x: point.x, y: point.y });
                    }
                    return true;
                };
            }
        }

        if (action.priority <= 2) {
            const { distance2, pointOnLine, lineProj2, length2 } = math.distanceToLine(segment.r.end, other.r.start, other.r.end);
            if (distance2 < config.mapGeneration.ROAD_SNAP_DISTANCE * config.mapGeneration.ROAD_SNAP_DISTANCE &&
                lineProj2 >= 0 && lineProj2 <= length2) {
                
                const point = pointOnLine;
                action.priority = 2;
                action.q.endCandidate = point;
                action.func = () => {
                    segment.r.setEnd(point);
                    segment.q.severed = true;

                    if (util.minDegreeDifference(other.dir(), segment.dir()) < config.mapGeneration.MINIMUM_INTERSECTION_DEVIATION) {
                        return false;
                    }

                    other.split(point, segment, segments, qTree);

                    if (debugData) {
                        debugData.intersectionsRadius = debugData.intersectionsRadius || [];
                        debugData.intersectionsRadius.push({ x: point.x, y: point.y });
                    }
                    return true;
                };
            }
        }
    }
    
    // PASSO 2: aplicar regra de afastamento lateral com endpoint candidato e bbox expandido
    // helper: distância mínima entre dois segmentos 2D (AB e CD)
    const segSegDistance = (A: Point, B: Point, C: Point, D: Point): number => {
        // baseado em algoritmo clássico de proximidade entre segmentos
        const u = math.subtractPoints(B, A);
        const v = math.subtractPoints(D, C);
        const w = math.subtractPoints(A, C);
        const a = math.dotProduct(u as any as Point, u as any as Point); // always >= 0
        const b = math.dotProduct(u as any as Point, v as any as Point);
        const c = math.dotProduct(v as any as Point, v as any as Point); // always >= 0
        const d = math.dotProduct(u as any as Point, w as any as Point);
        const e = math.dotProduct(v as any as Point, w as any as Point);
        const Dden = a * c - b * b; // always >= 0
        let sc, sN, sD = Dden;
        let tc, tN, tD = Dden;

        const EPS = 1e-9;
        // compute the line parameters of the two closest points
        if (Dden < EPS) { // the lines are almost parallel
            sN = 0.0; // force using point A on segment AB
            sD = 1.0; // to prevent possible division by 0.0 later
            tN = e;
            tD = c;
        } else {
            sN = (b * e - c * d);
            tN = (a * e - b * d);
            if (sN < 0) { // sc < 0 => the s=0 edge is visible
                sN = 0;
                tN = e;
                tD = c;
            } else if (sN > sD) { // sc > 1 => the s=1 edge is visible
                sN = sD;
                tN = e + b;
                tD = c;
            }
        }

        if (tN < 0) { // tc < 0 => the t=0 edge is visible
            tN = 0;
            if (-d < 0) sN = 0;
            else if (-d > a) sN = sD;
            else { sN = -d; sD = a; }
        } else if (tN > tD) { // tc > 1 => the t=1 edge is visible
            tN = tD;
            if ((-d + b) < 0) sN = 0;
            else if ((-d + b) > a) sN = sD;
            else { sN = (-d + b); sD = a; }
        }

        sc = Math.abs(sN) < EPS ? 0 : (sN / sD);
        tc = Math.abs(tN) < EPS ? 0 : (tN / tD);

        // difference of the two closest points
        const dPx = w.x + (sc * u.x) - (tc * v.x);
        const dPy = w.y + (sc * u.y) - (tc * v.y);
        return Math.hypot(dPx, dPy);
    };
    const candEnd: Point = action.q.endCandidate ?? segment.r.end;
    const minX = Math.min(segment.r.start.x, candEnd.x);
    const minY = Math.min(segment.r.start.y, candEnd.y);
    const dx = Math.abs(segment.r.start.x - candEnd.x);
    const dy = Math.abs(segment.r.start.y - candEnd.y);
    // margem de busca baseada no pior caso de outra via (considerando apenas larguras globais)
    const maxOtherWidth = Math.max(highwayWidthM(), roadWidthM());
    const margin = 0.5 * (segEffWidth + maxOtherWidth) + config.mapGeneration.CLEARANCE_EXTRA_M;
    const queryBox = { x: minX - margin, y: minY - margin, width: dx + 2 * margin, height: dy + 2 * margin } as any;

    const nearMatches = qTree.retrieve(queryBox) as {o: Segment}[];
    const paramOnSegment = (P: Point, A: Point, B: Point): number => {
        const AB = math.subtractPoints(B, A);
        const AP = math.subtractPoints(P, A);
        const ab2 = math.lengthV2(AB as any as Point);
        if (ab2 <= 1e-9) return 0;
        const t = (math.dotProduct(AP as any as Point, AB as any as Point)) / ab2;
        return Math.max(0, Math.min(1, t));
    };
    for (const m of nearMatches) {
        const other = m.o;
        if (other === segment) continue;
        // requisito de afastamento lateral com larguras uniformes por tipo de via
    const req = 0.5 * (segEffWidth + (other.q.highway ? highwayWidthM() : roadWidthM())) + config.mapGeneration.CLEARANCE_EXTRA_M;

        const inter = math.doLineSegmentsIntersect(segment.r.start, candEnd, other.r.start, other.r.end, true) as any;
        // detectar compartilhamento de endpoint
        const shareEndpoint = (
            math.length(segment.r.start, other.r.start) < 1e-6 ||
            math.length(segment.r.start, other.r.end) < 1e-6 ||
            math.length(candEnd, other.r.start) < 1e-6 ||
            math.length(candEnd, other.r.end) < 1e-6
        );

        // ângulo entre os segmentos (para detectar paralelismo)
        const vSeg = math.subtractPoints(candEnd, segment.r.start);
        const vOth = math.subtractPoints(other.r.end, other.r.start);
        const Ls = Math.hypot(vSeg.x, vSeg.y) || 1;
        const Lo = Math.hypot(vOth.x, vOth.y) || 1;
        const uSeg = { x: vSeg.x / Ls, y: vSeg.y / Ls };
        const uOth = { x: vOth.x / Lo, y: vOth.y / Lo };
        const dot = Math.max(-1, Math.min(1, uSeg.x * uOth.x + uSeg.y * uOth.y));
        const angDeg = Math.acos(dot) * 180 / Math.PI;
        const nearParallel = angDeg < 20 || angDeg > 160; // ~±20° de tolerância

        // exceção: continuação colinear a partir do mesmo nó deve ser permitida
        const dStartToOtherLine = math.distanceToLine(segment.r.start, other.r.start, other.r.end).distance2;
        const dEndToOtherLine = math.distanceToLine(candEnd, other.r.start, other.r.end).distance2;
        const colinearWithOther = (dStartToOtherLine < 1e-8 && dEndToOtherLine < 1e-8);
        if (shareEndpoint && colinearWithOther) {
            continue; // não aplicar clearance para continuação na mesma linha
        }
        // Só aplicamos a regra lateral para vias quase paralelas
        if (!nearParallel) {
            continue;
        }
        if (inter || shareEndpoint) {
            const I = inter ? { x: inter.x, y: inter.y } : (
                math.length(segment.r.start, other.r.start) < 1e-6 ? segment.r.start :
                math.length(segment.r.start, other.r.end) < 1e-6 ? segment.r.start :
                math.length(candEnd, other.r.start) < 1e-6 ? candEnd :
                candEnd
            );
            // Amostrar pontos afastados da interseção ao longo de ambos os segmentos
            const lenSeg = Math.hypot(candEnd.x - segment.r.start.x, candEnd.y - segment.r.start.y);
            const lenOther = Math.hypot(other.r.end.x - other.r.start.x, other.r.end.y - other.r.start.y);
            // Extensões dinâmicas: A é estendida pela metade da espessura de B, e B pela metade da espessura de A
            const otherWidthEff = other.q.highway ? highwayWidthM() : roadWidthM();
            const sSeg = Math.min(0.5 * lenSeg, Math.max(2, otherWidthEff / 2));
            const sOther = Math.min(0.5 * lenOther, Math.max(2, segEffWidth / 2));
            const t0 = inter ? (inter.t as number) : paramOnSegment(I, segment.r.start, candEnd); // parâmetro no segmento candidato
            const deltaSeg = lenSeg > 1e-6 ? (sSeg / lenSeg) : 1;
            const tPlus = Math.min(1, t0 + deltaSeg);
            const tMinus = Math.max(0, t0 - deltaSeg);
            const Pplus = { x: segment.r.start.x + (candEnd.x - segment.r.start.x) * tPlus, y: segment.r.start.y + (candEnd.y - segment.r.start.y) * tPlus };
            const Pminus = { x: segment.r.start.x + (candEnd.x - segment.r.start.x) * tMinus, y: segment.r.start.y + (candEnd.y - segment.r.start.y) * tMinus };

            const tOther0 = paramOnSegment(I, other.r.start, other.r.end);
            const deltaOther = lenOther > 1e-6 ? (sOther / lenOther) : 1;
            const uPlus = Math.min(1, tOther0 + deltaOther);
            const uMinus = Math.max(0, tOther0 - deltaOther);
            const Qplus = { x: other.r.start.x + (other.r.end.x - other.r.start.x) * uPlus, y: other.r.start.y + (other.r.end.y - other.r.start.y) * uPlus };
            const Qminus = { x: other.r.start.x + (other.r.end.x - other.r.start.x) * uMinus, y: other.r.start.y + (other.r.end.y - other.r.start.y) * uMinus };

            const EPS = 1e-4;
            // construir amostras apenas se estiverem no interior (longe de endpoints)
            const samples: {point: Point, on: 'seg'|'other', t: number}[] = [];
            if (tPlus < 1 - EPS) samples.push({ point: Pplus, on: 'seg', t: tPlus });
            if (tMinus > EPS) samples.push({ point: Pminus, on: 'seg', t: tMinus });
            if (uPlus < 1 - EPS) samples.push({ point: Qplus, on: 'other', t: uPlus });
            if (uMinus > EPS) samples.push({ point: Qminus, on: 'other', t: uMinus });

            // Afunilamento (taper): reduzir espessura próximo às cabeças para alinhar A na linha de B (e vice-versa)
            const taperLenSeg = Math.max(2, otherWidthEff); // A afunila ao longo de ~largura(B)
            const taperLenOther = Math.max(2, segEffWidth); // B afunila ao longo de ~largura(A)
            const distToNearestEnd = (P: Point, A: Point, B: Point) => Math.min(Math.hypot(P.x - A.x, P.y - A.y), Math.hypot(P.x - B.x, P.y - B.y));
            for (const S of samples) {
                const d1 = distPointToSegment(S.point, other.r.start, other.r.end);
                const d2 = distPointToSegment(S.point, segment.r.start, candEnd);
                const dmin = Math.min(d1, d2);

                // larguras locais com afunilamento até zero na cabeça
                const dSegToEnd = distToNearestEnd(S.point, segment.r.start, candEnd);
                const dOtherToEnd = distToNearestEnd(S.point, other.r.start, other.r.end);
                const widthSegLocal = segEffWidth * Math.min(1, dSegToEnd / taperLenSeg);
                const widthOtherLocal = otherWidthEff * Math.min(1, dOtherToEnd / taperLenOther);
                const reqLocal = 0.5 * (widthSegLocal + widthOtherLocal) + config.mapGeneration.CLEARANCE_EXTRA_M;

                if (dmin < reqLocal) {
                    return false;
                }
            }
        } else {
            // sem interseção: distância mínima segmento-segmento
            const dmin = segSegDistance(segment.r.start, candEnd, other.r.start, other.r.end);
            if (dmin < req) {
                return false;
            }
        }
    }

    // Se passou no clearance, aplicamos a ação (se existir) ou aceitamos
    if (action.func) return action.func();
    return true;
}

const globalGoals = {
    generate(previousSegment: Segment): Segment[] {
        const newBranches: Segment[] = [];
        if (!previousSegment.q.severed) {
            const template = (direction: number, length: number, t: number, q: SegmentMeta) =>
                segmentFactory.usingDirection(previousSegment.r.end, direction, length, t, q);

            const templateContinue = (direction: number) => template(direction, previousSegment.length(), 0, previousSegment.q);
            const localZone = getZoneAt(previousSegment.r.end);
            const zoneBlockLen = (config as any).zones?.[localZone]?.blockLengthM || config.mapGeneration.DEFAULT_SEGMENT_LENGTH;
            const templateBranch = (direction: number) => template(direction, zoneBlockLen, previousSegment.q.highway ? config.mapGeneration.NORMAL_BRANCH_TIME_DELAY_FROM_HIGHWAY : 0, {});

            const continueStraight = templateContinue(previousSegment.dir());
            const straightPop = heatmap.popOnRoad(continueStraight.r);

            if (previousSegment.q.highway) {
                const randomStraight = templateContinue(previousSegment.dir() + config.mapGeneration.RANDOM_STRAIGHT_ANGLE());
                const randomPop = heatmap.popOnRoad(randomStraight.r);
                
                let roadPop;
                if (randomPop > straightPop) {
                    newBranches.push(randomStraight);
                    roadPop = randomPop;
                } else {
                    newBranches.push(continueStraight);
                    roadPop = straightPop;
                }
                if (roadPop > config.mapGeneration.HIGHWAY_BRANCH_POPULATION_THRESHOLD) {
                    if (Math.random() < config.mapGeneration.HIGHWAY_BRANCH_PROBABILITY) {
                        newBranches.push(templateContinue(previousSegment.dir() - 90 + config.mapGeneration.RANDOM_BRANCH_ANGLE()));
                    } else if (Math.random() < config.mapGeneration.HIGHWAY_BRANCH_PROBABILITY) {
                        newBranches.push(templateContinue(previousSegment.dir() + 90 + config.mapGeneration.RANDOM_BRANCH_ANGLE()));
                    }
                }
            } else if (straightPop > config.mapGeneration.NORMAL_BRANCH_POPULATION_THRESHOLD) {
                newBranches.push(continueStraight);
            }

            if (straightPop > config.mapGeneration.NORMAL_BRANCH_POPULATION_THRESHOLD) {
                if (Math.random() < config.mapGeneration.DEFAULT_BRANCH_PROBABILITY) {
                    newBranches.push(templateBranch(previousSegment.dir() - 90 + config.mapGeneration.RANDOM_BRANCH_ANGLE()));
                } else if (Math.random() < config.mapGeneration.DEFAULT_BRANCH_PROBABILITY) {
                    newBranches.push(templateBranch(previousSegment.dir() + 90 + config.mapGeneration.RANDOM_BRANCH_ANGLE()));
                }
            }
        }

        newBranches.forEach(branch => {
            branch.setupBranchLinks = function() {
                previousSegment.links.f.forEach(link => {
                    this.links.b.push(link);
                    link.linksForEndContaining(previousSegment)?.push(this);
                });
                previousSegment.links.f.push(this);
                this.links.b.push(previousSegment);
            };
        });

        return newBranches;
    }
};

function addSegment(segment: Segment, segmentList: Segment[], qTree: Quadtree): void {
    segmentList.push(segment);
    qTree.insert(segment.collider.limits());
}

export interface MapGenerationResult {
    segments: Segment[];
    qTree: Quadtree;
    heatmap: typeof heatmap;
    debugData: any;
}

export function generate(seed: string | number): MapGenerationResult {
    const debugData = {};

    seedrandom(seed.toString(), { global: true });
    // Seeded noise instance for deterministic generation
    const noiseSeed = Math.floor(Math.random() * 65536);
    noise = new Noise(noiseSeed);
    // Inicializar Zoning com o novo campo de ruído distorcido antes da criação das ruas
    Zoning.init(noiseSeed);
    // alinhar heatmap próximo da origem (centro inicial da cidade)
    heatmap.calibrateTo({ x: 0, y: 0 });

    const priorityQ = new util.PriorityQueue<Segment>();

    const rootLen = config.mapGeneration.HIGHWAY_SEGMENT_LENGTH;
    const rootSegment = new Segment({ x: 0, y: 0 }, { x: rootLen, y: 0 }, 0, { highway: true });
    const oppositeDirection = segmentFactory.fromExisting(rootSegment);
    const newEnd = { x: rootSegment.r.start.x - rootLen, y: oppositeDirection.r.end.y };
    oppositeDirection.r.setEnd(newEnd);
    oppositeDirection.links.b.push(rootSegment);
    rootSegment.links.b.push(oppositeDirection);
    priorityQ.put(rootSegment, rootSegment.t);
    priorityQ.put(oppositeDirection, oppositeDirection.t);

    const segments: Segment[] = [];
    const qTree = new Quadtree(config.mapGeneration.QUADTREE_PARAMS, config.mapGeneration.QUADTREE_MAX_OBJECTS, config.mapGeneration.QUADTREE_MAX_LEVELS);

    while (priorityQ.length() > 0 && segments.length < config.mapGeneration.SEGMENT_COUNT_LIMIT) {
        const minSegment = priorityQ.get()!;

        const accepted = localConstraints(minSegment, segments, qTree, debugData);
        if (accepted) {
            minSegment.setupBranchLinks?.();
            addSegment(minSegment, segments, qTree);
            globalGoals.generate(minSegment).forEach(newSegment => {
                newSegment.t += minSegment.t + 1;
                // Largura consistente por tipo: remover variação por zona
                newSegment.width = newSegment.q.highway ? highwayWidthM() : roadWidthM();
                newSegment.collider.updateCollisionProperties({ width: newSegment.width });
                priorityQ.put(newSegment, newSegment.t);
            });
        }
    }

    segments.forEach((segment, i) => segment.id = i);
    console.log(`${segments.length} segments generated.`);

    // Calcular rUnit (R) com base nas extremidades das ruas: R = maxDist/5
    const c = config.zoningModel.cityCenter;
    let maxDist = 0;
    for (const s of segments) {
        const d1 = Math.hypot(s.r.start.x - c.x, s.r.start.y - c.y);
        const d2 = Math.hypot(s.r.end.x - c.x, s.r.end.y - c.y);
        if (d1 > maxDist) maxDist = d1;
        if (d2 > maxDist) maxDist = d2;
    }
    if (maxDist > 0) {
        heatmap.rUnit = maxDist / 5;
    }

    return { segments, qTree, heatmap, debugData };
}