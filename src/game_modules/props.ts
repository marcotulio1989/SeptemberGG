import * as collision from '../generic_modules/collision';
import * as math from '../generic_modules/math';

export enum PropType {
    TREE = 'tree',
    STREETLIGHT = 'streetLight',
    TRASH = 'trash',
}

export interface PropStyle {
    fillColor: number;
    secondaryColor?: number;
    accentColor?: number;
    glowColor?: number;
    strokeColor?: number;
    strokeAlpha?: number;
    strokeWidth?: number;
    height?: number;
}

const clampByte = (value: number): number => {
    if (!Number.isFinite(value)) return 0;
    return Math.max(0, Math.min(255, Math.round(value)));
};

const adjustColor = (color: number, factor: number): number => {
    const r = (color >> 16) & 0xFF;
    const g = (color >> 8) & 0xFF;
    const b = color & 0xFF;
    const f = 1 + factor;
    const nr = clampByte(r * f);
    const ng = clampByte(g * f);
    const nb = clampByte(b * f);
    return (nr << 16) | (ng << 8) | nb;
};

export class Prop {
    static idCounter = 0;

    id: number;
    collider: collision.CollisionObject;

    constructor(
        public center: math.Point,
        public radius: number,
        public type: PropType,
        public style: PropStyle,
    ) {
        this.collider = new collision.CollisionObject(this, collision.CollisionObjectType.CIRCLE, {
            center: { ...center },
            radius,
        });
        this.id = Prop.idCounter++;
    }

    setCenter(val: math.Point): void {
        this.center = { ...val };
        this.collider.updateCollisionProperties({ center: this.center });
    }

    setRadius(radius: number): void {
        this.radius = radius;
        this.collider.updateCollisionProperties({ radius });
    }
}

interface PropDefinition {
    radius: number;
    radiusJitter?: number;
    style: PropStyle;
}

const PROP_DEFINITIONS: Record<PropType, PropDefinition> = {
    [PropType.TREE]: {
        radius: 2.6,
        radiusJitter: 0.35,
        style: {
            fillColor: 0x2E7D32,
            secondaryColor: 0x1B5E20,
            accentColor: 0x5D4037,
        },
    },
    [PropType.STREETLIGHT]: {
        radius: 0.75,
        radiusJitter: 0.12,
        style: {
            fillColor: 0x424242,
            glowColor: 0xFFF9C4,
            secondaryColor: 0xF57F17,
            height: 4.8,
        },
    },
    [PropType.TRASH]: {
        radius: 0.9,
        radiusJitter: 0.18,
        style: {
            fillColor: 0x546E7A,
            secondaryColor: 0x263238,
            accentColor: 0x212121,
        },
    },
};

const randomRadius = (definition: PropDefinition): number => {
    const base = definition.radius;
    const jitter = definition.radiusJitter ?? 0;
    if (!(jitter > 0)) return base;
    const scale = math.randomRange(1 - jitter, 1 + jitter);
    return Math.max(0.2, base * scale);
};

export const propFactory = {
    byType(type: PropType): Prop {
        const definition = PROP_DEFINITIONS[type] ?? PROP_DEFINITIONS[PropType.TREE];
        const radius = randomRadius(definition);
        const style: PropStyle = { ...definition.style };

        if (type === PropType.TREE) {
            const jitter = math.randomRange(-0.18, 0.18);
            style.fillColor = adjustColor(definition.style.fillColor, jitter);
            if (definition.style.secondaryColor !== undefined) {
                style.secondaryColor = adjustColor(definition.style.secondaryColor, jitter * 0.75);
            }
        }

        return new Prop({ x: 0, y: 0 }, radius, type, style);
    },
};

