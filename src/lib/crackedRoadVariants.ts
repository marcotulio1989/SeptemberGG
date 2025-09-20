export type CrackedRoadVariantId =
    | 'default'
    | 'fissuras-finas'
    | 'aranha-densa'
    | 'veios-alongados'
    | 'fragmentado';

export type CrackedRoadVariantAssignments = Record<number, CrackedRoadVariantId>;

export type CrackedRoadVariantDefinition = {
    id: CrackedRoadVariantId;
    label: string;
    description: string;
    modifiers: {
        seedDensityMultiplier?: number;
        sampleAlongMultiplier?: number;
        sampleAcrossMultiplier?: number;
        thresholdOffset?: number;
        minLengthMultiplier?: number;
        maxSeedsMultiplier?: number;
        maxSamplesAlongMultiplier?: number;
        maxSamplesAcrossMultiplier?: number;
        probeStepMultiplier?: number;
        strokeMultiplier?: number;
        alphaMultiplier?: number;
    };
    color?: number;
};

export const CRACKED_ROAD_VARIANTS: ReadonlyArray<CrackedRoadVariantDefinition> = [
    {
        id: 'default',
        label: 'Padrão',
        description: 'Mantém os parâmetros globais configurados no painel.',
        modifiers: {},
    },
    {
        id: 'fissuras-finas',
        label: 'Fissuras Finas',
        description: 'Rachaduras mais esguias e espaçadas, com traços delicados.',
        modifiers: {
            seedDensityMultiplier: 0.7,
            sampleAlongMultiplier: 1.35,
            sampleAcrossMultiplier: 0.75,
            thresholdOffset: -0.08,
            minLengthMultiplier: 0.85,
            strokeMultiplier: 0.85,
        },
    },
    {
        id: 'aranha-densa',
        label: 'Aranha Densa',
        description: 'Rede mais ramificada, preenchendo a rua com muitos detalhes.',
        modifiers: {
            seedDensityMultiplier: 1.7,
            sampleAlongMultiplier: 1.05,
            sampleAcrossMultiplier: 1.55,
            thresholdOffset: -0.12,
            maxSamplesAcrossMultiplier: 1.25,
            strokeMultiplier: 0.95,
        },
    },
    {
        id: 'veios-alongados',
        label: 'Veios Alongados',
        description: 'Rachaduras longas com poucos ramais laterais.',
        modifiers: {
            seedDensityMultiplier: 0.95,
            sampleAlongMultiplier: 0.8,
            sampleAcrossMultiplier: 1.1,
            thresholdOffset: 0.05,
            minLengthMultiplier: 1.2,
            probeStepMultiplier: 0.85,
        },
    },
    {
        id: 'fragmentado',
        label: 'Fragmentado',
        description: 'Padrão fragmentado com blocos curtos e fortes contrastes.',
        modifiers: {
            seedDensityMultiplier: 2.0,
            sampleAlongMultiplier: 1.2,
            sampleAcrossMultiplier: 1.2,
            thresholdOffset: -0.02,
            maxSeedsMultiplier: 0.8,
            maxSamplesAlongMultiplier: 0.85,
            maxSamplesAcrossMultiplier: 1.3,
            strokeMultiplier: 1.1,
            alphaMultiplier: 0.9,
        },
    },
];

export const CRACKED_ROAD_VARIANT_MAP: Record<CrackedRoadVariantId, CrackedRoadVariantDefinition> =
    CRACKED_ROAD_VARIANTS.reduce((acc, variant) => {
        acc[variant.id] = variant;
        return acc;
    }, {} as Record<CrackedRoadVariantId, CrackedRoadVariantDefinition>);

export const RANDOMIZABLE_CRACK_VARIANT_IDS = CRACKED_ROAD_VARIANTS
    .map((variant) => variant.id)
    .filter((id) => id !== 'default') as CrackedRoadVariantId[];
