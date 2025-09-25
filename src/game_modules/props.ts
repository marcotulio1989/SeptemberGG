import seedrandom from 'seedrandom';
import Quadtree from '../lib/quadtree';
import * as math from '../generic_modules/math';
import { CollisionObject, CollisionObjectType } from '../generic_modules/collision';
import { Segment, ZoneName } from './mapgen';

export enum PropType {
    TREE = 'tree',
    BUSH = 'bush',
    LAMP = 'lamp',
    TRASH = 'trash',
}

export interface PropMetadata {
    variant?: number;
    height?: number;
    side?: 1 | -1;
}

export class Prop {
    collider: CollisionObject;

    constructor(
        public center: math.Point,
        public radius: number,
        public type: PropType,
        public rotation: number = 0,
        public metadata: PropMetadata = {},
    ) {
        this.collider = new CollisionObject(
            this,
            CollisionObjectType.CIRCLE,
            { center: { ...center }, radius },
        );
    }

    setCenter(val: math.Point): void {
        this.center = val;
        this.collider.updateCollisionProperties({ center: val });
    }

    setRadius(val: number): void {
        this.radius = val;
        this.collider.updateCollisionProperties({ radius: val });
    }
}

interface ScatterContext {
    segments: Segment[];
    qTree: Quadtree;
    zoneAt: (p: math.Point) => ZoneName;
    randomSeed?: number | string;
}

type ZoneSettings = {
    treesPer100: number;
    lampsPer100: number;
    trashPer100: number;
    treeLateralExtra: [number, number];
    lampLateralExtra: [number, number];
    trashLateralExtra: [number, number];
    treeJitterM: number;
    trashChanceNearLamp: number;
    lampHeightRange: [number, number];
    allowTrees: boolean;
    allowLamps: boolean;
    allowTrash: boolean;
};

const zoneSettings: Record<ZoneName, ZoneSettings> = {
    downtown: {
        treesPer100: 2.8,
        lampsPer100: 4.6,
        trashPer100: 2.4,
        treeLateralExtra: [5.5, 7.5],
        lampLateralExtra: [3, 4.5],
        trashLateralExtra: [2.2, 3.4],
        treeJitterM: 6,
        trashChanceNearLamp: 0.6,
        lampHeightRange: [6.2, 7.2],
        allowTrees: true,
        allowLamps: true,
        allowTrash: true,
    },
    residential: {
        treesPer100: 5.6,
        lampsPer100: 3.1,
        trashPer100: 1.2,
        treeLateralExtra: [6.5, 9.5],
        lampLateralExtra: [2.6, 3.8],
        trashLateralExtra: [1.6, 2.6],
        treeJitterM: 7,
        trashChanceNearLamp: 0.35,
        lampHeightRange: [5.4, 6.4],
        allowTrees: true,
        allowLamps: true,
        allowTrash: true,
    },
    commercial: {
        treesPer100: 3.4,
        lampsPer100: 4.1,
        trashPer100: 2.9,
        treeLateralExtra: [5.5, 8.5],
        lampLateralExtra: [3.2, 4.4],
        trashLateralExtra: [2.0, 3.0],
        treeJitterM: 6,
        trashChanceNearLamp: 0.55,
        lampHeightRange: [6.0, 7.0],
        allowTrees: true,
        allowLamps: true,
        allowTrash: true,
    },
    industrial: {
        treesPer100: 1.1,
        lampsPer100: 2.2,
        trashPer100: 1.7,
        treeLateralExtra: [7.5, 10.5],
        lampLateralExtra: [3.4, 4.8],
        trashLateralExtra: [2.2, 3.8],
        treeJitterM: 8,
        trashChanceNearLamp: 0.45,
        lampHeightRange: [6.5, 7.5],
        allowTrees: true,
        allowLamps: true,
        allowTrash: true,
    },
    rural: {
        treesPer100: 6.8,
        lampsPer100: 0.9,
        trashPer100: 0.4,
        treeLateralExtra: [8.5, 13.0],
        lampLateralExtra: [4.0, 6.0],
        trashLateralExtra: [2.5, 3.5],
        treeJitterM: 9,
        trashChanceNearLamp: 0.15,
        lampHeightRange: [5.8, 6.6],
        allowTrees: true,
        allowLamps: true,
        allowTrash: true,
    },
};

export function scatterProps({ segments, qTree, zoneAt, randomSeed }: ScatterContext): Prop[] {
    const rng = seedrandom(String(randomSeed ?? Date.now()));
    const random = () => rng();
    const randBetween = (min: number, max: number) => min + (max - min) * random();

    const props: Prop[] = [];
    const localProps: Prop[] = [];

    const collides = (prop: Prop): boolean => {
        const bounds = prop.collider.limits();
        const candidates = qTree.retrieve(bounds) as Array<{ o?: any } | undefined>;
        for (const candidate of candidates || []) {
            if (!candidate) continue;
            const other = (candidate as any).o || candidate;
            if (!other || other === prop || !other.collider) continue;
            if (prop.collider.collide(other.collider)) {
                return true;
            }
        }
        for (const other of localProps) {
            if (other === prop) continue;
            if (prop.collider.collide(other.collider)) {
                return true;
            }
        }
        return false;
    };

    const tryAddProp = (prop: Prop): boolean => {
        if (collides(prop)) {
            return false;
        }
        qTree.insert(prop.collider.limits());
        localProps.push(prop);
        props.push(prop);
        return true;
    };

    const countFromDensity = (lengthM: number, densityPer100: number): number => {
        if (densityPer100 <= 0 || lengthM <= 0) return 0;
        const expected = (lengthM / 100) * densityPer100;
        const base = Math.floor(expected);
        const remainder = expected - base;
        return base + (random() < remainder ? 1 : 0);
    };

    for (let i = 0; i < segments.length; i += 4) {
        const segment = segments[i];
        if (!segment) continue;

        const dir = math.subtractPoints(segment.r.end, segment.r.start);
        const segLen = Math.hypot(dir.x, dir.y);
        if (!isFinite(segLen) || segLen < 12) continue;

        const ux = dir.x / segLen;
        const uy = dir.y / segLen;
        const nx = -uy;
        const ny = ux;

        const midPoint = math.fractionBetween(segment.r.start, segment.r.end, 0.5);
        const zone = zoneAt(midPoint);
        const settings = zoneSettings[zone];

        const marginBase = Math.max(8, segment.width * 0.5 + 4);
        const availableLen = segLen - marginBase * 2;

        const placeAlong = (
            count: number,
            cb: (offset: number, index: number) => void,
        ) => {
            if (count <= 0) return;
            if (availableLen <= 1) return;
            for (let j = 0; j < count; j++) {
                const t = (j + 0.5) / count;
                const offset = marginBase + availableLen * t;
                cb(offset, j);
            }
        };

        if (settings?.allowTrees) {
            const treeCount = countFromDensity(segLen, settings.treesPer100);
            placeAlong(treeCount, (offset, idx) => {
                const base: math.Point = {
                    x: segment.r.start.x + ux * offset,
                    y: segment.r.start.y + uy * offset,
                };
                const initialSide: 1 | -1 = random() > 0.5 ? 1 : -1;
                const attempt = (side: 1 | -1) => {
                    const extra = randBetween(settings.treeLateralExtra[0], settings.treeLateralExtra[1]);
                    const lateral = segment.width / 2 + extra;
                    const jitter = randBetween(-settings.treeJitterM, settings.treeJitterM);
                    const center: math.Point = {
                        x: base.x + nx * lateral * side + ux * jitter * 0.05,
                        y: base.y + ny * lateral * side + uy * jitter * 0.05,
                    };
                    const largeTree = random() > 0.35;
                    const radius = largeTree ? randBetween(2.6, 3.8) : randBetween(1.4, 2.2);
                    const type = largeTree ? PropType.TREE : PropType.BUSH;
                    const prop = new Prop(center, radius * (zone === 'rural' ? 1.15 : 1), type, randBetween(-Math.PI, Math.PI), {
                        variant: random(),
                        side,
                    });
                    return tryAddProp(prop);
                };
                if (!attempt(initialSide)) {
                    attempt((initialSide === 1 ? -1 : 1) as 1 | -1);
                }
            });
        }

        if (settings?.allowLamps) {
            const lampCount = countFromDensity(segLen, settings.lampsPer100);
            placeAlong(lampCount, (offset, idx) => {
                const side: 1 | -1 = (idx % 2 === 0) ? 1 : -1;
                const base: math.Point = {
                    x: segment.r.start.x + ux * offset,
                    y: segment.r.start.y + uy * offset,
                };
                const extra = randBetween(settings.lampLateralExtra[0], settings.lampLateralExtra[1]);
                const lateral = segment.width / 2 + extra;
                const jitter = randBetween(-2.5, 2.5);
                const center: math.Point = {
                    x: base.x + nx * lateral * side + ux * jitter,
                    y: base.y + ny * lateral * side + uy * jitter,
                };
                const lamp = new Prop(center, 0.9, PropType.LAMP, 0, {
                    variant: random(),
                    height: randBetween(settings.lampHeightRange[0], settings.lampHeightRange[1]),
                    side,
                });
                if (tryAddProp(lamp) && settings.allowTrash && random() < settings.trashChanceNearLamp) {
                    const trashOffset = randBetween(2.2, 4.0);
                    const trashCenter: math.Point = {
                        x: center.x + nx * trashOffset * side,
                        y: center.y + ny * trashOffset * side,
                    };
                    const trash = new Prop(trashCenter, 0.85, PropType.TRASH, 0, {
                        variant: random(),
                        side,
                    });
                    tryAddProp(trash);
                }
            });
        }

        if (settings?.allowTrash && settings.trashPer100 > 0.01) {
            const trashCount = countFromDensity(segLen, settings.trashPer100 * 0.6);
            for (let j = 0; j < trashCount; j++) {
                const offset = marginBase + randBetween(0, availableLen);
                const side: 1 | -1 = random() > 0.5 ? 1 : -1;
                const base: math.Point = {
                    x: segment.r.start.x + ux * offset,
                    y: segment.r.start.y + uy * offset,
                };
                const extra = randBetween(settings.trashLateralExtra[0], settings.trashLateralExtra[1]);
                const lateral = segment.width / 2 + extra;
                const center: math.Point = {
                    x: base.x + nx * lateral * side,
                    y: base.y + ny * lateral * side,
                };
                const trash = new Prop(center, 0.8, PropType.TRASH, 0, {
                    variant: random(),
                    side,
                });
                tryAddProp(trash);
            }
        }
    }

    return props;
}

