import * as _ from 'lodash';
import * as math from './math';
import * as util from './utility';
import { Point } from './math';

export enum CollisionObjectType {
    RECT = "rect",
    LINE = "line",
    CIRCLE = "circle"
}

export interface RectCollisionProperties {
    corners: Point[];
}

export interface LineCollisionProperties {
    start: Point;
    end: Point;
    width: number;
}

export interface CircleCollisionProperties {
    center: Point;
    radius: number;
}

export type CollisionProperties = RectCollisionProperties | LineCollisionProperties | CircleCollisionProperties;

export interface BoundingBox {
    x: number;
    y: number;
    width: number;
    height: number;
    o?: any;
}

export class CollisionObject {
    private collisionRevision = 0;
    private limitsRevision: number | undefined = undefined;
    private cachedLimits: BoundingBox | undefined = undefined;

    constructor(public o: any, public collisionType: CollisionObjectType, public collisionProperties: CollisionProperties) {}

    updateCollisionProperties(props: Partial<CollisionProperties>): void {
        this.collisionRevision++;
        this.collisionProperties = _.assign(this.collisionProperties, props);
    }

    limits(): BoundingBox {
        if (this.collisionRevision !== this.limitsRevision) {
            this.limitsRevision = this.collisionRevision;
            switch (this.collisionType) {
                case CollisionObjectType.RECT: {
                    const { corners } = this.collisionProperties as RectCollisionProperties;
                    const minX = _.minBy(corners, 'x')!.x;
                    const minY = _.minBy(corners, 'y')!.y;
                    this.cachedLimits = {
                        x: minX,
                        y: minY,
                        width: _.maxBy(corners, 'x')!.x - minX,
                        height: _.maxBy(corners, 'y')!.y - minY,
                        o: this.o
                    };
                    break;
                }
                case CollisionObjectType.LINE: {
                    const { start, end } = this.collisionProperties as LineCollisionProperties;
                    this.cachedLimits = {
                        x: Math.min(start.x, end.x),
                        y: Math.min(start.y, end.y),
                        width: Math.abs(start.x - end.x),
                        height: Math.abs(start.y - end.y),
                        o: this.o
                    };
                    break;
                }
                case CollisionObjectType.CIRCLE: {
                    const { center, radius } = this.collisionProperties as CircleCollisionProperties;
                    this.cachedLimits = {
                        x: center.x - radius,
                        y: center.y - radius,
                        width: radius * 2,
                        height: radius * 2,
                        o: this.o
                    };
                    break;
                }
            }
        }
        return this.cachedLimits!;
    }

    collide(other: CollisionObject): boolean | Point {
        const objLimits = this.limits();
        const otherLimits = other.limits();

        if (objLimits && otherLimits &&
            (objLimits.x + objLimits.width < otherLimits.x || otherLimits.x + otherLimits.width < objLimits.x ||
             objLimits.y + objLimits.height < otherLimits.y || otherLimits.y + otherLimits.height < objLimits.y)) {
            return false;
        }

        switch (this.collisionType) {
            case CollisionObjectType.CIRCLE:
                if (other.collisionType === CollisionObjectType.RECT) {
                    return this.rectCircleCollision(other.collisionProperties as RectCollisionProperties, this.collisionProperties as CircleCollisionProperties);
                }
                break;
            case CollisionObjectType.RECT:
                switch (other.collisionType) {
                    case CollisionObjectType.RECT:
                        return this.rectRectIntersection(this.collisionProperties as RectCollisionProperties, other.collisionProperties as RectCollisionProperties);
                    case CollisionObjectType.LINE:
                        return this.rectRectIntersection(this.collisionProperties as RectCollisionProperties, this.rectPropsFromLine(other.collisionProperties as LineCollisionProperties));
                    case CollisionObjectType.CIRCLE:
                        return this.rectCircleCollision(this.collisionProperties as RectCollisionProperties, other.collisionProperties as CircleCollisionProperties);
                }
                break;
            case CollisionObjectType.LINE:
                 switch (other.collisionType) {
                    case CollisionObjectType.RECT:
                        return this.rectRectIntersection(this.rectPropsFromLine(this.collisionProperties as LineCollisionProperties), other.collisionProperties as RectCollisionProperties);
                    case CollisionObjectType.LINE:
                        return this.rectRectIntersection(this.rectPropsFromLine(this.collisionProperties as LineCollisionProperties), this.rectPropsFromLine(other.collisionProperties as LineCollisionProperties));
                }
                break;
        }
        return false;
    }

    private rectCircleCollision(rectProps: RectCollisionProperties, circleProps: CircleCollisionProperties): boolean {
        const { corners } = rectProps;
        const { center, radius } = circleProps;

        for (const corner of corners) {
            if (math.length2(corner, center) <= radius * radius) {
                return true;
            }
        }

        for (let i = 0; i < corners.length; i++) {
            const start = corners[i];
            const end = corners[(i + 1) % corners.length];
            const { distance2, lineProj2, length2 } = math.distanceToLine(center, start, end);
            if (lineProj2 > 0 && lineProj2 < length2 && distance2 <= radius * radius) {
                return true;
            }
        }

        const axes = [
            math.subtractPoints(corners[3], corners[0]),
            math.subtractPoints(corners[3], corners[2])
        ];

        const projections = [
            math.project(math.subtractPoints(center, corners[0]), axes[0]),
            math.project(math.subtractPoints(center, corners[2]), axes[1])
        ];

        if (projections[0].dotProduct < 0 || math.lengthV2(projections[0].projected) > math.lengthV2(axes[0]) ||
            projections[1].dotProduct < 0 || math.lengthV2(projections[1].projected) > math.lengthV2(axes[1])) {
            return false;
        }

        return true;
    }

    private rectPropsFromLine(lineProps: LineCollisionProperties): RectCollisionProperties {
        const dir = math.subtractPoints(lineProps.end, lineProps.start);
        const perpDir = { x: -dir.y, y: dir.x };
        const halfWidthPerpDir = math.multVScalar(perpDir, 0.5 * lineProps.width / math.lengthV(perpDir));
        return {
            corners: [
                math.addPoints(lineProps.start, halfWidthPerpDir),
                math.subtractPoints(lineProps.start, halfWidthPerpDir),
                math.subtractPoints(lineProps.end, halfWidthPerpDir),
                math.addPoints(lineProps.end, halfWidthPerpDir)
            ]
        };
    }

    private rectRectIntersection(rectAProps: RectCollisionProperties, rectBProps: RectCollisionProperties): Point | false {
        const cA = rectAProps.corners;
        const cB = rectBProps.corners;
        
        const axes = [
            math.subtractPoints(cA[3], cA[0]),
            math.subtractPoints(cA[3], cA[2]),
            math.subtractPoints(cB[0], cB[1]),
            math.subtractPoints(cB[0], cB[3])
        ];

        const axisOverlaps: Point[] = [];

        for (const axis of axes) {
            const projectedVectorsA = cA.map(corner => math.project(corner, axis).projected);
            const projectedVectorsB = cB.map(corner => math.project(corner, axis).projected);

            const positionsOnAxisA = projectedVectorsA.map(v => math.dotProduct(v, axis));
            const positionsOnAxisB = projectedVectorsB.map(v => math.dotProduct(v, axis));

            const [maxA, maxA_i] = util.extendedMax(positionsOnAxisA) as [number, number];
            const [minA, minA_i] = util.extendedMin(positionsOnAxisA) as [number, number];
            const [maxB, maxB_i] = util.extendedMax(positionsOnAxisB) as [number, number];
            const [minB, minB_i] = util.extendedMin(positionsOnAxisB) as [number, number];

            if (maxA < minB || maxB < minA) {
                return false;
            } else {
                const diff1 = math.subtractPoints(projectedVectorsA[maxA_i], projectedVectorsB[minB_i]);
                const diff2 = math.subtractPoints(projectedVectorsB[maxB_i], projectedVectorsA[minA_i]);

                if (math.lengthV2(diff1) < math.lengthV2(diff2)) {
                    axisOverlaps.push(diff1);
                } else {
                    axisOverlaps.push(math.multVScalar(diff2, -1));
                }
            }
        }

        const [minVector] = util.extendedMin(axisOverlaps, v => math.lengthV2(v));
        
        return minVector ? math.multVScalar(minVector, -1) : false;
    }
}