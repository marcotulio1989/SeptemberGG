export type CrackVariant = {
    key: string;
    label: string;
    description: string;
    strokeMultiplier?: number;
    alphaMultiplier?: number;
    seedDensityMultiplier?: number;
    sampleAlongMultiplier?: number;
    sampleAcrossMultiplier?: number;
    thresholdOffset?: number;
    minLengthMultiplier?: number;
    maxSeedsMultiplier?: number;
    maxSamplesAlongMultiplier?: number;
    maxSamplesAcrossMultiplier?: number;
    contourLengthMultiplier?: number;
    hashOffset?: number;
};

const variants: CrackVariant[] = [
    {
        key: 'hairline',
        label: 'Fissuras Finas',
        description: 'Traços muito finos e delicados, com maior espaçamento lateral.',
        strokeMultiplier: 0.6,
        alphaMultiplier: 0.9,
        seedDensityMultiplier: 0.85,
        sampleAlongMultiplier: 1.35,
        sampleAcrossMultiplier: 0.75,
        thresholdOffset: 0.12,
        contourLengthMultiplier: 0.85,
        hashOffset: 0x11,
    },
    {
        key: 'cobweb',
        label: 'Teia Densa',
        description: 'Rede densa com ramificações laterais bem visíveis.',
        strokeMultiplier: 1.15,
        alphaMultiplier: 1.0,
        seedDensityMultiplier: 1.4,
        sampleAlongMultiplier: 1.1,
        sampleAcrossMultiplier: 1.25,
        thresholdOffset: -0.05,
        maxSeedsMultiplier: 1.15,
        hashOffset: 0x22,
    },
    {
        key: 'fracture',
        label: 'Fraturas Longas',
        description: 'Fissuras espessas e extensas, priorizando linhas longas.',
        strokeMultiplier: 1.45,
        alphaMultiplier: 0.95,
        seedDensityMultiplier: 1.05,
        sampleAlongMultiplier: 0.9,
        sampleAcrossMultiplier: 0.9,
        thresholdOffset: -0.12,
        minLengthMultiplier: 1.2,
        contourLengthMultiplier: 1.3,
        hashOffset: 0x33,
    },
    {
        key: 'veins',
        label: 'Veias Suaves',
        description: 'Linhas suaves com ramificações orgânicas e mais espaçamento.',
        strokeMultiplier: 0.85,
        alphaMultiplier: 0.85,
        seedDensityMultiplier: 0.75,
        sampleAlongMultiplier: 1.1,
        sampleAcrossMultiplier: 1.45,
        thresholdOffset: 0.02,
        contourLengthMultiplier: 0.9,
        hashOffset: 0x44,
    },
    {
        key: 'jagged',
        label: 'Estilhaçada',
        description: 'Padrão agressivo com muitos pontos quebrados e cruzamentos.',
        strokeMultiplier: 1.25,
        alphaMultiplier: 1.05,
        seedDensityMultiplier: 1.2,
        sampleAlongMultiplier: 1.4,
        sampleAcrossMultiplier: 1.0,
        thresholdOffset: -0.02,
        maxSamplesAlongMultiplier: 1.1,
        contourLengthMultiplier: 1.05,
        hashOffset: 0x55,
    },
];

export const CRACK_VARIANTS: readonly CrackVariant[] = Object.freeze(variants);

export const CRACK_VARIANT_MAP: Readonly<Record<string, CrackVariant>> = Object.freeze(
    variants.reduce((acc, variant) => {
        acc[variant.key] = Object.freeze({ ...variant });
        return acc;
    }, {} as Record<string, CrackVariant>),
);

export const CRACK_VARIANT_KEYS: readonly string[] = Object.freeze(variants.map(v => v.key));
