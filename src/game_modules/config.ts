import { randomRange } from '../generic_modules/math';

const branchAngleDev = 3;
const forwardAngleDev = 15;

const randomAngle = (limit: number): number => {
    // non-linear distribution
    const nonUniformNorm = Math.pow(Math.abs(limit), 3);
    let val = 0;
    while (val === 0 || Math.random() < Math.pow(Math.abs(val), 3) / nonUniformNorm) {
        val = randomRange(-limit, +limit);
    }
    return val;
};

// Escala e unidades
export const units = {
    world: 'meters', // 1 unidade do mundo = 1 metro
};

export const scale = {
    // Altura do personagem em metros (175 cm)
    characterHeightM: 1.75,
    // Aproximação: diâmetro (largura) ~ 1/4 da altura (ombros ~ 44cm)
    get characterDiameterM() { return this.characterHeightM / 4; },
    // Multiplicadores relativos ao personagem
    multipliers: {
        // Dobrando as larguras atuais:
        // Ruas: 20x -> 40x o diâmetro do personagem
        // Rodovias: 30x -> 60x o diâmetro do personagem
        streetVsCharacter: 40,
        highwayVsCharacter: 60,
    }
};

// Larguras baseadas no diâmetro do personagem (ombros) com opção de override direto em metros
export const roadWidthM = () => {
    const o = (config as any)?.mapGeneration?.ROAD_WIDTH_OVERRIDE_M;
    return (typeof o === 'number' && o > 0) ? o : scale.characterDiameterM * scale.multipliers.streetVsCharacter;
};
export const highwayWidthM = () => {
    const o = (config as any)?.mapGeneration?.HIGHWAY_WIDTH_OVERRIDE_M;
    return (typeof o === 'number' && o > 0) ? o : scale.characterDiameterM * scale.multipliers.highwayVsCharacter;
};

export const config = {
    mapGeneration: {
        BUILDING_PLACEMENT_LOOP_LIMIT: 3,
        // Comprimentos continuam em metros (unidades do mundo)
    DEFAULT_SEGMENT_LENGTH: 90, // quadra mais curta para reforçar malha densa
    HIGHWAY_SEGMENT_LENGTH: 260,
        // Margem extra absoluta (em metros) usada no cálculo de afastamento e na busca de vizinhos
        // Regra completa: distancia_minima_lateral = 0.5*(w1 + w2) + CLEARANCE_EXTRA_M
        CLEARANCE_EXTRA_M: 2,
        // Larguras derivadas da escala; manter os campos para retrocompat, mas não usar diretamente
        DEFAULT_SEGMENT_WIDTH: 0, // ignorado (usamos roadWidthM())
        HIGHWAY_SEGMENT_WIDTH: 0, // ignorado (usamos highwayWidthM())
        RANDOM_BRANCH_ANGLE: () => randomAngle(branchAngleDev),
        RANDOM_STRAIGHT_ANGLE: () => randomAngle(forwardAngleDev),
    DEFAULT_BRANCH_PROBABILITY: 0.55,
    HIGHWAY_BRANCH_PROBABILITY: 0.08,
        HIGHWAY_BRANCH_POPULATION_THRESHOLD: 0.1,
        NORMAL_BRANCH_POPULATION_THRESHOLD: 0.1,
        NORMAL_BRANCH_TIME_DELAY_FROM_HIGHWAY: 5,
        MINIMUM_INTERSECTION_DEVIATION: 30, // degrees
        SEGMENT_COUNT_LIMIT: 2000,
        DEBUG_DELAY: 0, // ms
    ROAD_SNAP_DISTANCE: 55,
    // Fator para afastamento mínimo lateral entre vias quase paralelas, relativo à soma das meias-larguras
    // clearance = 0.5*(w1+w2) * MIN_PARALLEL_CLEARANCE_FACTOR
    MIN_PARALLEL_CLEARANCE_FACTOR: 0.9,
    // (regra de afastamento lateral é sempre ativa no gerador)
    // Overrides opcionais de largura (em metros). Se null/indefinido/<=0, usa a escala padrão.
    ROAD_WIDTH_OVERRIDE_M: null as number | null,
    HIGHWAY_WIDTH_OVERRIDE_M: null as number | null,
    HEAT_MAP_PIXEL_DIM: 50, // px
        DRAW_HEATMAP: false,
        QUADTREE_PARAMS: {
            x: -20000,
            y: -20000,
            width: 40000,
            height: 40000,
        },
        QUADTREE_MAX_OBJECTS: 10,
        QUADTREE_MAX_LEVELS: 10,
        DEBUG: false,
    },
    zoningModel: {
    mode: 'heatmap' as 'perlin' | 'procedural' | 'geo' | 'concentric' | 'heatmap',
        cityCenter: { x: 0, y: 0 },
    // Escala do raio efetivo do heatmap radial (0.0..1.0) — menor => bandas menores
    heatmapRadiusScale: 0.35,
    // Peso da textura (ruído) no heatmap — menor => anéis mais limpos
    heatmapTextureWeight: 0.10,
        downtownRadiusM: 1200,
        innerRingRadiusM: 2600,
        outerRingRadiusM: 5200,
        // Raios para o modo "concêntrico" (do centro para fora)
        concentricRadiiM: {
            downtown: 800,
            residential: 2200,
            industrial: 3800,
            rural: 5200,
        },
        // Auto-cálculo de raios com base na densidade de ruas
    autoConcentricFromDensity: false,
        autoThresholds: { // fração acumulada de densidade por distância
            downtown: 0.20,
            residential: 0.60,
            industrial: 0.88,
        },
    // Pesos para composição dos escores
    weights: {
            downtown: 1.0,
            commercial: 0.9,
            residential: 0.8,
            industrial: 0.85,
            rural: 1.0,
        },
    // Ruído macro para variar as bordas das manchas
    macroNoise: {
            baseScale: 1 / 3000,
            octaves: 2,
            lacunarity: 1.8,
            gain: 0.55,
        },
    // Thresholds para mapeamento direto do heatmap -> zonas
    heatmapThresholds: {
            // pop < t1 => rural; t1..t2 => industrial; t2..t3 => residential; t3..t4 => commercial; >= t4 => downtown
            // Ajustado para o perfil radial atual (valores altos no centro; bordas ~0.5):
            // - downtown pequeno (>= t4)
            // - comercial estreito
            // - residencial mais largo
            // - industrial como antepenúltimo anel
            // - rural somente na periferia
            t1: 0.56,
            t2: 0.70,
            t3: 0.82,
            t4: 0.93,
    }
    },
    buildings: {
        // Fator de área dos prédios (1.0 = original). 0.5 => metade da área
    areaScale: 1.0,
        // Dimensões reais aproximadas (em metros) para footprint (largura x profundidade)
        dimensions: {
            house: { width: 8, depth: 12 },           // casa térrea média ~ 96 m²
            // Residencial detalhado
            houseSmall: { width: 6, depth: 10 },      // 60 m²
            houseHigh: { width: 14, depth: 16 },      // 224 m²
            apartmentBlock: { width: 22, depth: 35 }, // 770 m² footprint (100+ unidades possíveis)
            condoTower: { width: 28, depth: 40 },     // 1120 m² footprint (vertical)
            school: { width: 35, depth: 60 },         // 2100 m² (500–5000 m²)
            leisureArea: { width: 30, depth: 50 },    // 1500 m² (praça/quadra)
            residential: { width: 18, depth: 30 },    // edifício residencial footprint
            commercial: { width: 22, depth: 35 },     // loja/prédio comercial base (legado)
            commercialMedium: { width: 25, depth: 40 }, // comércio médio ~ 1.000 m²
            commercialLarge: { width: 60, depth: 90 },  // big box/shopping ~ 5.400 m²
            // Comercial detalhado
            shopSmall: { width: 8, depth: 12 },       // 96 m² (30–120 m²)
            kiosk: { width: 4, depth: 6 },            // 24 m² (10–30 m²)
            bakery: { width: 10, depth: 18 },         // 180 m² (80–250 m²)
            restaurant: { width: 12, depth: 16 },     // 192 m² (80–300 m²)
            bar: { width: 10, depth: 15 },            // 150 m² (50–150 m²)
            pharmacy: { width: 12, depth: 14 },       // 168 m² (100–200 m²)
            grocery: { width: 18, depth: 22 },        // 396 m² (150–400 m²)
            supermarket: { width: 40, depth: 60 },    // 2400 m² (800–3000 m²)
            shoppingCenter: { width: 120, depth: 220 }, // 26.400 m² (5k–100k m²)
            office: { width: 30, depth: 45 },         // 1350 m² footprint por torre
            hotel: { width: 45, depth: 65 },          // 2925 m² footprint
            conventionCenter: { width: 120, depth: 180 }, // 21.600 m² (3k–50k m²)
            cinema: { width: 40, depth: 50 },         // 2000 m² (800–5000 m²)
            hospitalPrivate: { width: 90, depth: 140 }, // 12.600 m² (5k–50k m²)
            clinic: { width: 25, depth: 35 },         // 875 m² (300–1500 m²)
            publicOffice: { width: 30, depth: 50 },   // 1500 m² (delegacias/órgãos públicos)
            parkingLot: { width: 60, depth: 100 },    // 6000 m²
            gasStation: { width: 30, depth: 45 },       // posto ~ 1.350 m²
            bank: { width: 20, depth: 30 },            // agência bancária ~ 600 m²
            park: { width: 80, depth: 120 },           // parque de bairro ~ 9.600 m²
            green: { width: 30, depth: 30 },           // espaço verde/vazio ~ 900 m²
            church: { width: 25, depth: 50 },          // igreja ~ 1.250 m²
            import: { width: 40, depth: 60 },          // galpão/armazém (legado)
            factory: { width: 50, depth: 80 },         // fábrica ~ 4.000 m²
            // Industrial detalhado
            warehouseSmall: { width: 28, depth: 45 },  // 1260 m²
            factoryMedium: { width: 70, depth: 110 },  // 7700 m²
            industrialComplex: { width: 180, depth: 260 }, // 46.800 m²
            distributionCenter: { width: 140, depth: 220 }, // 30.800 m²
            workshop: { width: 20, depth: 30 },        // 600 m² (200–800 m²)
            powerPlant: { width: 260, depth: 380 },    // 98.800 m²
            // Novo tipo para zonas rurais: fazendas (lotes grandes)
            farm: { width: 60, depth: 80 },
            // Rural detalhado
            farmhouse: { width: 12, depth: 18 },       // 216 m² (80–250 m²)
            silo: { width: 20, depth: 20 },            // 400 m² (circular, aproximado quadrado)
            animalBarn: { width: 24, depth: 36 },      // 864 m²
            machineryShed: { width: 22, depth: 32 },   // 704 m²
            cooperative: { width: 40, depth: 70 },     // 2800 m²
            field: { width: 100, depth: 150 },         // 15.000 m² (um talhão)
            pond: { width: 40, depth: 60 },            // 2400 m²
        }
    },
    render: {
        // 'isometric' para visão isométrica, 'topdown' para ortográfica
        mode: 'isometric' as 'isometric' | 'topdown',
        // Gerar mapa automaticamente ao carregar (true) ou aguardar clique em "Regenerate" (false)
    autoGenerateOnLoad: false, // alterado para false: não gerar automaticamente; requer clique em "Regenerate"
        // Fatores da projeção isométrica clássica (2:1):
        // x' = isoA * x + isoC * y; y' = isoB * x + isoD * y
        isoA: 1,
        isoB: 0.5,
        isoC: -1,
        isoD: 0.5,
        cameraFollow: true,
    // Modo simples: desenhar ruas como linhas finas, sem espessura/preenchimento
    simpleRoads: false,
    // Overlay opcional: mostra o corredor de afastamento lateral (w/2+1 de cada lado)
    showClearanceDebug: false,
    // Mostrar preenchimento das vias (superfície). Desligue para ver apenas o contorno
    showRoadFill: true,
    // Exibir contorno externo da rede de estradas (começa visível)
    showRoadOuterOutline: true, // invertido conforme pedido: padrão oposto
    roadOutlineColor: 0x333740, // cor configurável do contorno externo (Camada 4)
    // Modo de contorno: 'segments' (cada via) ou 'hull' (envelope da malha)
    roadOutlineMode: 'segments' as 'segments' | 'hull',
    // Cor do preenchimento do gap entre a malha de ruas e os quarteirões (Camada 4 visual)
    gapFillColor: 0x969696, // Gap fixo RGB(150,150,150)
    // Paleta automática/gradiente removidos: usamos somente as cores fixas fornecidas
    // (Se precisar no futuro, reintroduzir campos: useGrayRoadPalette, grayRoadPaletteMid, etc.)
    // Fator da curva quadrática nas pontas (0..1) multiplicado por r=width/2
    joinCurveFactor: 0.6,
    // Suavização de ângulos agudos em interseções
    smoothSharpAngles: true,
    // Usar suavização direta com arcs (arcTo) ao invés de patches de interseção separados
    // removed: useArcToSmoothing (no longer needed, intersection patches are used)
    // Ângulo máximo (graus) considerado "agudo" que precisa de suavização
    sharpAngleThresholdDeg: 90,
    // Raio da suavização como fator da largura média das vias
    sharpAngleRadiusFactor: 2.0,
    // Camada extra de sobreposição estilizada das ruas principais
    overlayRoadEnabled: true,
    overlayRoadColor: 0xA8A8A8, // Overlay fixo RGB(168,168,168)
    overlayRoadAlpha: 1.0, // opaco (antes 0.85)
    overlayRoadWidthFactor: 0.45, // fração da largura original
    overlayRoadOffsetM: 2.0,      // deslocamento lateral perpendicular
    overlayRoadFilletRadiusFactor: 1.1, // fator de raio relativo à largura média
    overlayRoadJoinCurveFactor: 0.35,   // fator de curvatura nas junções (Bezier simplificada)
    // Aparência orgânica da camada overlay (camada 3) independente da base
    overlayOrganicEnabled: true,        // ativado por padrão
    overlayOrganicAmpFactor: 0.80,      // valor padrão solicitado
    overlayOrganicFreq: 6.0,            // valor padrão solicitado
    overlayOrganicOctaves: 5,           // valor padrão solicitado
    overlayOrganicRoughness: 0.50,      // valor padrão solicitado
    overlayOrganicSeed: 911,            // pode ajustar manualmente se quiser variar
    // Cor da camada base das ruas (preenchimento principal)
    baseRoadColor: 0xA0A0A0, // Base fixo RGB(160,160,160)
    baseRoadAlpha: 1.0,
    // Segunda camada de vias (overlay) para variação visual
    secondaryRoadLayerEnabled: true, // Habilitado por padrão para visualização
    secondaryRoadOffsetM: 2.5, // adicionar leve deslocamento para destacar
    secondaryRoadWidthFactor: 0.55, // um pouco mais larga para aparecer
    secondaryRoadLayerAlpha: 1.0, // opaca (removida translucidez)
    secondaryRoadRadiusFactor: 1.2, // Fator de raio para fillets/curvas da segunda camada
    secondaryRoadColor: 0xAEAEAE, // Secondary fixo RGB(174,174,174)
    // ---- Modo perfis finos aleatórios (Camada 2) ----
    secondaryRoadRandomEnabled: true, // ativa geração procedural fina
    secondaryRoadRandomMinWidthM: 3.3, // default ajustado (screenshot)
    secondaryRoadRandomMaxWidthM: 5.5, // default ajustado
    secondaryRoadRandomJitterAmpM: 3.5, // default ajustado
    secondaryRoadRandomFreq: 0.25, // default ajustado (ciclos por metro)
    secondaryRoadRandomOctaves: 4, // default ajustado
    secondaryRoadRandomRoughness: 0.86, // default ajustado
    secondaryRoadRandomSeed: 171,
    // Efeitos visuais da camada secundária
    secondaryRoadBlurEnabled: false, // blur desativado
    secondaryRoadBlurStrength: 0, // sem blur
    secondaryRoadBlendMode: 'add' as 'normal' | 'add' | 'screen' | 'multiply' | 'overlay' | 'lighter',
    // Cor de debug opcional para patches de interseção (null => usar mesma cor da rua)
    intersectionPatchDebugColor: null as number | null,
    // Aplicar trims automáticos nas pontas para abrir espaço visual aos patches
    applyIntersectionTrims: true,
    // Força container de patches no topo (acima de outlines e prédios) para debug
    intersectionPatchForceOnTop: false,
    // Mantém patches visíveis mesmo quando showRoadOuterOutline=false
    intersectionPatchAlwaysVisibleWithOutlines: true,
    // Mostrar contornos dos quarteirões
    showBlockOutlines: true,
    // Show warped-noise delimitations (separate toggle for noise regions / buckets)
    showNoiseDelimitations: false,
    showCrackedRoadsOutline: true,
    crackedRoadColor: 0x00E5FF,
    crackedRoadAlpha: 0.88,
    crackedRoadStrokePx: 1.35,
    crackedRoadResolutionMultiplier: 3.0,
    crackedRoadSeedDensity: 0.055,
    crackedRoadSampleDensityAlong: 1.6,
    crackedRoadSampleDensityAcross: 1.1,
    crackedRoadVoronoiThreshold: 0.65,
    crackedRoadMinLengthM: 5.0,
    crackedRoadMaxSeeds: 520,
    crackedRoadMaxSamplesAlong: 240,
    crackedRoadMaxSamplesAcross: 96,
    crackedRoadProbeStepM: 1.1,
    crackedRoadPatternAssignments: null as null | { version: number; segments: Record<string, string> },
    // Mostrar apenas os contornos dos quarteirões (esconde ruas e preenchimento dos prédios)
    showOnlyBlockOutlines: false,
    // Mostrar apenas o interior dos quarteirões (preenchidos), escondendo ruas e demais elementos
    showOnlyBlockInteriors: false,
    // Largura do vão (em metros) entre interiores de quarteirões ao exibir apenas interiores
    blockInteriorGapM: 3.0,
    // Mostrar/ocultar marcadores de junção/interseção (debug)
    showJunctionMarkers: false,
    // Usar patch Bézier para suavizar a QUINA EXTERNA das junções
    useOuterBezierPatch: false,
    // Usar arco interno para preencher o vão (padrão: desligado)
    useInnerArcPatch: false,
    // Resolução do patch Bézier externo (nº de amostras)
    outerBezierSampleCount: 32,
    // Raio absoluto das curvas externas em metros e sua faixa permitida
    outerCornerRadiusRangeM: { min: 3.0, max: 4.5 },
    outerCornerRadiusM: 3.5,
    // Referência para curvas externas: 'yellow' (interseção das bordas externas) ou 'node' (nó P)
    outerArcReference: 'yellow' as 'yellow' | 'node',
    // Overlay de zonas (debug visual)
    showZoneOverlay: false,
    zoneOverlayAlpha: 0.12,
    zoneOverlayTileM: 250,
    zoneColors: {
    downtown: 0xFF8A65,
        residential: 0x4FC3F7,
        commercial: 0xFFB74D,
        industrial: 0xBA68C8,
        rural: 0x81C784,
    },
        // Remover ruas de ponta solta (dead-ends) que não tocam a borda do mapa
        // Útil para evitar "cotocos" internos indesejados
        removeInnerDeadEnds: true,
        // Distância (em metros) considerada "perto da borda" para permitir dead-ends
        deadEndEdgeProximityM: 250,
        // HUD overlays
        showCompass: true,        // mostrar bússola N/S/L/O
        showAxesXY: true,         // mostrar eixos X/Y
        compassRadiusPx: 50,      // raio da rosa dos ventos em pixels
        compassMarginPx: 16,      // margem da bússola aos cantos da janela
    // Raio dos cantos arredondados dos quarteirões (em metros)
    // Define o comprimento de recuo em cada lado do vértice para desenhar uma
    // curva quadrática suave entre as arestas. 0 = sem arredondamento.
    blockCornerRadiusM: 12,
    // ================== Bandas Perimetrais de Quarteirão ==================
    // Em vez de linhas de contorno seletivas, desenhamos "retângulos" (faixas) ao longo
    // das arestas externas dos quarteirões. A espessura é dada em metros (largura constante
    // ao longo da aresta no espaço do mundo, antes de projetar para isométrico).
    blockEdgeBandsEnabled: true,
    // Espessura padrão agora ajustada para 1.0 m (100 cm) conforme solicitado
    blockEdgeBandThicknessM: 1.0,
    // Cor base (fallback) das bandas perimetrais: tom neutro pedido pelo usuário (RGB 120,120,120)
    blockEdgeBandColor: 0x787878,
    // Alpha das bandas (1 = opaco)
    blockEdgeBandAlpha: 1.0,
    // Cores específicas por face (opcionais). Apenas S e O definidas conforme pedido: cinza mais escuro e um menos escuro
    // Usar tons de cinza consistentes para todas as faces (evitar branco puro)
    blockEdgeBandFaceColors: {
    // Todas as faces agora usam o tom neutro 0x787878 (RGB 120,120,120)
    N: 0x787878,
    S: 0x787878,
    L: 0x787878,
    O: 0x787878,
    } as Partial<Record<'N'|'S'|'L'|'O', number>>,
    // Mostrar contorno das bandas por padrão (ON)
    blockEdgeBandOutlineEnabled: true,
    // Segunda banda empilhada (opcional). Desenha outra faixa imediatamente "abaixo" da primeira
    // (topo da nova toca a base da existente). Pode criar efeito de dupla margem.
    blockEdgeBandSecondEnabled: true,
    blockEdgeBand2ThicknessM: 1.0, // espessura da segunda banda (vertical) em metros
    blockEdgeBand2Alpha: 1.0,
    blockEdgeBand2FaceColors: {
        // Segunda banda: cinza escuro padrão solicitado (RGB 81,81,81)
        N: 0x515151,
        S: 0x515151,
        L: 0x515151,
        O: 0x515151,
    } as Partial<Record<'N'|'S'|'L'|'O', number>>,
    // Linhas paralelas internas à faixa (parecidas com demarcação interna)
    blockEdgeBandInnerLinesEnabled: false,
    // Espaçamento entre essas linhas em metros
    blockEdgeBandInnerLineIntervalM: 3.0,
    // Cor e espessura (pixels) da linha interna
    blockEdgeBandInnerLineColor: 0x7F7F7F,
    blockEdgeBandInnerLineStrokePx: 1,
    // Faces a excluir (códigos: N,S,L,O). Excluir Oeste (O) e Sul (S) conforme pedido.
    // Agora queremos mostrar apenas faces Sul (S) e Oeste (O), portanto excluímos Norte (N) e Leste (L)
    blockEdgeBandExcludedFaces: [],
    // Forçar extremidades (caps) verticais das bandas em tela (não inclinadas na direção isométrica)
    blockEdgeBandVerticalCaps: true,
    // Nova flag: força apenas a PRIMEIRA banda (mais clara) a seguir extrusão isométrica normal mesmo quando verticalCaps=true
    blockEdgeBandPrimaryIsometric: true,
    // Caso desejado no futuro: permitir estilos diferentes por face (N,S,L,O)
    // blockEdgeBandFaceStyles: { N:{color:0x..}, ... }
    // ================== Sombras de Quarteirões ==================
    // Ativa desenho de uma sombra simples (duplicação deslocada) sob cada quarteirão
    // Desligado por padrão conforme pedido do usuário
    blockShadowEnabled: false,
    // Deslocamento da sombra em pixels já no espaço isométrico (aplicado depois de worldToIso)
    blockShadowOffsetPx: { x: 6, y: 6 },
    // Cor/alpha da sombra
    blockShadowColor: 0x000000,
    blockShadowAlpha: 0.18,
    // Futuro: blur opcional (não aplicado ainda para manter performance)
    blockShadowUseBlur: false,
    blockShadowBlurStrength: 4,
    // (Depreciado) Parâmetros antigos de contorno seletivo removidos.
    // ================== Textura de Interiores de Quarteirão ==================
    // Permite substituir o preenchimento sólido verde dos quarteirões por uma textura enviada pelo usuário.
    // A textura é carregada via UI (componente App) e passada para GameCanvas.
    blockInteriorUseTexture: false,
    // Cor de tint para multiplicar a textura (0xFFFFFF = sem alteração)
    blockInteriorTextureTint: 0xFFFFFF,
    // Alpha da textura (1.0 = opaco)
    blockInteriorTextureAlpha: 1.0,
    // Escala aplicada na Matrix do beginTextureFill (1.0 = tamanho original). Valores maiores => textura "mais grossa".
    blockInteriorTextureScale: 1.0,
    // Configuração do padrão de ladrilhos aplicado aos quarteirões dentro do raio do heatmap
    centralTilePattern: {
        enabled: true,
        tileWidth: 128,
        tileHeight: 64,
        thickness: 0,
        seedCount: 420,
        damageProbability: 0.35,
        lateralFocus: 0.8,
        lateralBias: 1.4,
        randomAmplitude: 0.55,
        outlineColor: '#0B0B0B',
        fillColor: '#5E5E5E',
        crackColor: '#363636',
        sideColor: '#222222',
        backgroundColor: 'transparent',
        seedPosition: 133742,
        seedDamage: 98765,
        textureScale: 0.6,
        textureScaleY: 0.55,
        alpha: 1.0,
        tint: 0xFFFFFF,
        offsetXPx: 0,
        offsetYPx: 0,
    },
    },
    gameLogic: {
        SELECT_PAN_THRESHOLD: 50, // px
        SELECTION_RANGE: 50, // px
        DEFAULT_PICKUP_RANGE: 150, // world units
        DEFAULT_CARGO_CAPACITY: 1,
        MIN_SPEED_PROPORTION: 0.1,
    },
    controls: {
    characterSpeedMps: 25, // velocidade base em m/s (ajustável na UI)
    sprintMultiplier: 3,   // multiplicador ao segurar Shift
    },
    zones: {
        // Parâmetros por zona: comprimento típico de quadra e mix de tipos de prédio
        downtown: {
            blockLengthM: 80,
            // Centro com comércio e residencial vertical
            buildingMix: {
                shoppingCenter: 0.10, office: 0.22, hotel: 0.06, parkingLot: 0.05,
                commercialLarge: 0.12, commercialMedium: 0.16, commercial: 0.06, bank: 0.05, gasStation: 0.01,
                residential: 0.14, house: 0.01, park: 0.02, green: 0.0, church: 0.0
            },
            streetWidthMultiplier: 1.2,
            density: 10,
            scatterRadiusM: 140,
            coverageTarget: 0.40,
        },
        residential: {
            blockLengthM: 100,
            // Predominância de casas com alguns equipamentos
            buildingMix: {
                houseSmall: 0.20, house: 0.50, houseHigh: 0.07, apartmentBlock: 0.20, condoTower: 0.04,
                school: 0.015, leisureArea: 0.01, park: 0.03, green: 0.002, church: 0.03
            },
            streetWidthMultiplier: 0.9,
            density: 16,
            scatterRadiusM: 70,
            coverageTarget: 0.48,
            lot: {
                // Lote unifamiliar: 12 m (frente) x 25 m (profundidade)
                widthM: 10,
                depthM: 25,
                frontSetbackM: 5,
                sideSetbackM: 1.5,
                rearSetbackM: 6,
            }
        },
        commercial: {
            blockLengthM: 85,
            // Comércio dominante, com algum residencial
            buildingMix: {
                kiosk: 0.06, shopSmall: 0.16, bakery: 0.06, bar: 0.06, pharmacy: 0.05, grocery: 0.10,
                restaurant: 0.14, supermarket: 0.08,
                shoppingCenter: 0.06, cinema: 0.03, office: 0.08, hotel: 0.03, parkingLot: 0.05,
                commercial: 0.04, commercialMedium: 0.08, commercialLarge: 0.01,
                gasStation: 0.02, bank: 0.03, clinic: 0.03, hospitalPrivate: 0.005, publicOffice: 0.01, conventionCenter: 0.005,
                // Residencial leve na zona comercial
                houseSmall: 0.015, house: 0.01, apartmentBlock: 0.006, residential: 0.005,
                park: 0.02
            },
            streetWidthMultiplier: 1.15,
            density: 12,
            scatterRadiusM: 100,
            coverageTarget: 0.42,
        },
        industrial: {
            blockLengthM: 140,
            // Fábricas/galpões dominam
            buildingMix: {
                workshop: 0.08, warehouseSmall: 0.18, factory: 0.28, factoryMedium: 0.18,
                distributionCenter: 0.14, industrialComplex: 0.08, powerPlant: 0.02,
                commercialMedium: 0.04
            },
            streetWidthMultiplier: 1.3,
            density: 5,
            scatterRadiusM: 140,
            coverageTarget: 0.22,
            // Afastamento mínimo entre fábricas (m)
            minFactorySpacingM: 200,
        },
        rural: {
            blockLengthM: 190,
            // Fazendas e casas esparsas; pouco comércio
            buildingMix: {
                field: 0.40, farm: 0.22, farmhouse: 0.06,
                silo: 0.08, animalBarn: 0.08, machineryShed: 0.06,
                cooperative: 0.06, pond: 0.06
            },
            streetWidthMultiplier: 0.8,
            density: 2,
            scatterRadiusM: 180,
            coverageTarget: 0.06,
        }
    }
};