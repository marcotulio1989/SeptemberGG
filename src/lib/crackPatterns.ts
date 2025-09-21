export interface CrackPatternMultipliers {
    seedDensity?: number;
    sampleAlong?: number;
    sampleAcross?: number;
    minLength?: number;
    maxSeeds?: number;
    maxSamplesAlong?: number;
    maxSamplesAcross?: number;
    probeStep?: number;
    strokePx?: number;
    alpha?: number;
    supersample?: number;
}

export interface CrackPattern {
    id: string;
    label: string;
    description: string;
    seedOffset: number;
    multipliers?: CrackPatternMultipliers;
    thresholdOffset?: number;
    color?: number;
}

export interface CrackPatternAssignments {
    version: number;
    segments: Record<string, string>;
}

export const CRACK_PATTERNS: CrackPattern[] = [
    {
        id: 'hairline',
        label: 'Fissuras Finas',
        description: 'Trincas discretas com menor densidade e traços suaves.',
        seedOffset: 101,
        multipliers: {
            seedDensity: 0.55,
            sampleAlong: 0.85,
            sampleAcross: 0.9,
            strokePx: 0.75,
            alpha: 0.9,
            minLength: 1.05,
        },
        thresholdOffset: 0.08,
        color: 0x8ed9ff,
    },
    {
        id: 'dense-web',
        label: 'Rede Densa',
        description: 'Malha intensa com muitas fissuras curtas e conectadas.',
        seedOffset: 211,
        multipliers: {
            seedDensity: 1.6,
            sampleAlong: 1.35,
            sampleAcross: 1.25,
            strokePx: 1.1,
            alpha: 1.05,
            maxSeeds: 1.1,
            maxSamplesAlong: 1.1,
            maxSamplesAcross: 1.05,
        },
        thresholdOffset: -0.12,
        color: 0x00c2ff,
    },
    {
        id: 'deep-fracture',
        label: 'Fissura Profunda',
        description: 'Poucas rachaduras longas e marcadas, lembrando rupturas estruturais.',
        seedOffset: 349,
        multipliers: {
            seedDensity: 0.9,
            sampleAlong: 1.05,
            sampleAcross: 0.7,
            strokePx: 1.3,
            alpha: 0.95,
            maxSeeds: 0.75,
            minLength: 1.35,
        },
        thresholdOffset: -0.05,
        color: 0x00b0ff,
    },
    {
        id: 'craquelure',
        label: 'Craquelado',
        description: 'Padrão irregular com fragmentos quebrados e variações bruscas.',
        seedOffset: 463,
        multipliers: {
            seedDensity: 1.25,
            sampleAlong: 0.95,
            sampleAcross: 0.85,
            maxSeeds: 0.85,
            maxSamplesAlong: 0.9,
            maxSamplesAcross: 0.85,
            strokePx: 0.95,
        },
        thresholdOffset: -0.02,
        color: 0x00d1ff,
    },
    {
        id: 'veined',
        label: 'Veios Tortos',
        description: 'Veios sinuosos com variação lateral mais acentuada.',
        seedOffset: 587,
        multipliers: {
            seedDensity: 0.8,
            sampleAlong: 1.2,
            sampleAcross: 1.4,
            maxSamplesAcross: 1.25,
            probeStep: 0.85,
            strokePx: 1.05,
        },
        thresholdOffset: 0.03,
        color: 0x00e0ff,
    },
];

const PATTERN_LOOKUP: Record<string, CrackPattern> = CRACK_PATTERNS.reduce((acc, pattern) => {
    acc[pattern.id] = pattern;
    return acc;
}, {} as Record<string, CrackPattern>);

export const getCrackPatternById = (id?: string | null): CrackPattern | undefined => {
    if (!id) return undefined;
    return PATTERN_LOOKUP[id] ?? undefined;
};
