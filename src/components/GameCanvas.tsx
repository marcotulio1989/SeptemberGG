import React, { useEffect, useRef } from 'react';
import * as PIXI from 'pixi.js';
import * as _ from 'lodash';
import * as math from '../generic_modules/math';
import * as util from '../generic_modules/utility';
import * as astar from '../generic_modules/astar';
import { buildingFactory, Building, BuildingType } from '../game_modules/build';
import * as blockGeometry from '../game_modules/block_geometry';
import { getZoneAt } from '../game_modules/mapgen';
import { config, scale } from '../game_modules/config';
import { Segment, MapGenerationResult } from '../game_modules/mapgen';
import { MapActions } from '../actions/MapActions';
import MapStore from '../stores/MapStore';
import type { Point } from '../generic_modules/math';
import NoiseZoning from '../overlays/NoiseZoning';
import { createGrassTexture } from '../overlays/grassTexture';
import Quadtree from '../lib/quadtree';
import { CrackPatternAssignments, getCrackPatternById } from '../lib/crackPatterns';
// ClipperLib (sem typings completos) - usar require para acessar classes
// eslint-disable-next-line @typescript-eslint/no-var-requires
const ClipperLib: any = require('clipper-lib');

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

const toUint32 = (value: number) => {
    if (!Number.isFinite(value)) return 0;
    const scaled = Math.floor(value * 1_000_003);
    const mod = ((scaled % 0x1_0000_0000) + 0x1_0000_0000) % 0x1_0000_0000;
    return mod >>> 0;
};

const hashNumbers = (...values: number[]) => {
    let h = 0x811c9dc5 >>> 0;
    for (const v of values) {
        h ^= toUint32(v);
        h = Math.imul(h, 0x01000193);
        h >>>= 0;
    }
    return h >>> 0;
};

const createPRNG = (seed: number) => {
    let s = (seed >>> 0) || 0x12345678;
    return () => {
        s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
        return (s >>> 0) / 0x1_0000_0000;
    };
};

interface RoadCrackSpriteData {
    buffer: Uint8Array;
    width: number;
    height: number;
    spriteX: number;
    spriteY: number;
    spriteWidth: number;
    spriteHeight: number;
}

interface RoadCrackParams {
    length: number;
    width: number;
    seedCount: number;
    samplesAlong: number;
    samplesAcross: number;
    maxSamplesAlong: number;
    maxSamplesAcross: number;
    epsilonPx: number;
    strokePx: number;
    resolutionMultiplier: number;
    seed: number;
    tester: (x: number, y: number) => boolean;
    baseX: number;
    baseY: number;
    ux: number;
    uy: number;
    nx: number;
    ny: number;
    worldToIso: (p: Point) => Point;
    isoToWorld: (p: Point) => Point;
}

const generateRoadCrackSprite = ({
    length,
    width,
    seedCount,
    samplesAlong,
    samplesAcross,
    maxSamplesAlong,
    maxSamplesAcross,
    epsilonPx,
    strokePx,
    resolutionMultiplier,
    seed,
    tester,
    baseX,
    baseY,
    ux,
    uy,
    nx,
    ny,
    worldToIso,
    isoToWorld,
}: RoadCrackParams): RoadCrackSpriteData | null => {
    if (!(length > 0) || !(width > 0)) return null;
    const halfWidth = width * 0.5;
    const rng = createPRNG(seed);
    const isoCorners = [
        worldToIso({ x: baseX + nx * -halfWidth, y: baseY + ny * -halfWidth }),
        worldToIso({ x: baseX + ux * length + nx * -halfWidth, y: baseY + uy * length + ny * -halfWidth }),
        worldToIso({ x: baseX + ux * length + nx * halfWidth, y: baseY + uy * length + ny * halfWidth }),
        worldToIso({ x: baseX + nx * halfWidth, y: baseY + ny * halfWidth }),
    ];
    let isoMinX = Infinity;
    let isoMaxX = -Infinity;
    let isoMinY = Infinity;
    let isoMaxY = -Infinity;
    for (const corner of isoCorners) {
        if (!corner) continue;
        if (!Number.isFinite(corner.x) || !Number.isFinite(corner.y)) continue;
        if (corner.x < isoMinX) isoMinX = corner.x;
        if (corner.x > isoMaxX) isoMaxX = corner.x;
        if (corner.y < isoMinY) isoMinY = corner.y;
        if (corner.y > isoMaxY) isoMaxY = corner.y;
    }
    if (!Number.isFinite(isoMinX) || !Number.isFinite(isoMaxX) || !Number.isFinite(isoMinY) || !Number.isFinite(isoMaxY)) {
        return null;
    }
    const isoSpanX = isoMaxX - isoMinX;
    const isoSpanY = isoMaxY - isoMinY;
    if (!(isoSpanX > 1e-4) || !(isoSpanY > 1e-4)) return null;

    const expandedMinX = Math.floor(isoMinX) - 2;
    const expandedMinY = Math.floor(isoMinY) - 2;
    const expandedMaxX = Math.ceil(isoMaxX) + 2;
    const expandedMaxY = Math.ceil(isoMaxY) + 2;
    const expandedSpanX = Math.max(2, expandedMaxX - expandedMinX);
    const expandedSpanY = Math.max(2, expandedMaxY - expandedMinY);

    const isoOriginX = expandedMinX;
    const isoOriginY = expandedMinY;

    const supersample = Math.max(1, Math.min(8, Number.isFinite(resolutionMultiplier) ? resolutionMultiplier : 1));
    const baseCols = Math.min(maxSamplesAlong, Math.max(2, samplesAlong));
    const baseRows = Math.min(maxSamplesAcross, Math.max(2, samplesAcross));
    const pixelCols = Math.max(16, Math.min(4096, Math.round(baseCols * 4 * supersample)));
    const pixelRows = Math.max(16, Math.min(4096, Math.round(baseRows * 4 * supersample)));
    if (!(pixelCols > 1) || !(pixelRows > 1)) return null;

    const spanScaleX = expandedSpanX / pixelCols;
    const spanScaleY = expandedSpanY / pixelRows;
    if (!(spanScaleX > 0) || !(spanScaleY > 0)) return null;

    const supersampleFactor = Math.max(1, supersample);
    const strokeWidthPx = Math.max(0.25, Number.isFinite(strokePx) ? strokePx : 1);
    const epsilonThreshold = Math.max(1e-4, Number.isFinite(epsilonPx) ? epsilonPx : 0.5);
    const strokeRadius = Math.max(0.2, Math.min(1.5, strokeWidthPx * supersampleFactor * 0.3));

    const targetSeeds = Math.max(2, Math.min(4096, Math.floor(seedCount)));
    const worldSeeds: number[] = [];
    const isoSeedPx: number[] = [];
    const maxAttempts = Math.max(500, targetSeeds * 80);
    let attempts = 0;
    while (worldSeeds.length < targetSeeds * 2 && attempts < maxAttempts) {
        attempts++;
        const along = rng() * length;
        const lateral = (rng() - 0.5) * width;
        const wx = baseX + ux * along + nx * lateral;
        const wy = baseY + uy * along + ny * lateral;
        if (!Number.isFinite(wx) || !Number.isFinite(wy)) continue;
        if (!tester(wx, wy)) continue;
        worldSeeds.push(wx, wy);
        const iso = worldToIso({ x: wx, y: wy });
        const sx = (iso.x - isoOriginX) / expandedSpanX * pixelCols;
        const sy = (iso.y - isoOriginY) / expandedSpanY * pixelRows;
        isoSeedPx.push(sx, sy);
    }
    const actualSeeds = worldSeeds.length / 2;
    if (actualSeeds < 2) return null;

    const gridSize = Math.max(8, Math.round(Math.sqrt(actualSeeds)));
    const gridCols = gridSize;
    const gridRows = gridSize;
    const cellPxX = Math.max(1, pixelCols / gridCols);
    const cellPxY = Math.max(1, pixelRows / gridRows);
    const buckets: number[][] = new Array(gridCols * gridRows);
    for (let i = 0; i < buckets.length; i++) buckets[i] = [];
    for (let i = 0; i < actualSeeds; i++) {
        const sx = isoSeedPx[2 * i];
        const sy = isoSeedPx[2 * i + 1];
        if (!Number.isFinite(sx) || !Number.isFinite(sy)) continue;
        const gx = Math.min(gridCols - 1, Math.max(0, Math.floor(sx / cellPxX)));
        const gy = Math.min(gridRows - 1, Math.max(0, Math.floor(sy / cellPxY)));
        buckets[gy * gridCols + gx].push(i);
    }
    const fallbackIndices = Array.from({ length: actualSeeds }, (_, i) => i);
    let drawingCanvas: HTMLCanvasElement | OffscreenCanvas | null = null;
    let drawingCtx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null = null;
    if (typeof OffscreenCanvas !== 'undefined') {
        try {
            const offscreen = new OffscreenCanvas(pixelCols, pixelRows);
            const ctx = offscreen.getContext('2d', { alpha: true });
            if (ctx) {
                drawingCanvas = offscreen;
                drawingCtx = ctx;
            }
        } catch (err) {
            drawingCanvas = null;
            drawingCtx = null;
        }
    }
    if (!drawingCtx && typeof document !== 'undefined' && typeof document.createElement === 'function') {
        const canvas = document.createElement('canvas');
        canvas.width = pixelCols;
        canvas.height = pixelRows;
        const ctx = canvas.getContext('2d', { alpha: true });
        if (ctx) {
            drawingCanvas = canvas;
            drawingCtx = ctx;
        }
    }
    if (!drawingCtx || !drawingCanvas) return null;
    drawingCtx.clearRect(0, 0, pixelCols, pixelRows);
    drawingCtx.fillStyle = '#ffffff';
    try { drawingCtx.imageSmoothingEnabled = true; } catch (e) {}

    const candidateBuf: number[] = [];
    let hits = 0;

    const stampStroke = (cx: number, cy: number, weight: number) => {
        const clamped = Math.max(0, Math.min(1, weight));
        if (!(clamped > 0)) return;
        const prevAlpha = drawingCtx.globalAlpha;
        drawingCtx.globalAlpha = clamped;
        if (strokeRadius <= 0.6) {
            drawingCtx.fillRect(cx, cy, 1, 1);
        } else {
            drawingCtx.beginPath();
            drawingCtx.arc(cx + 0.5, cy + 0.5, strokeRadius, 0, Math.PI * 2);
            drawingCtx.fill();
        }
        drawingCtx.globalAlpha = prevAlpha;
        hits++;
    };

    for (let py = 0; py < pixelRows; py++) {
        const isoY = isoOriginY + (py + 0.5) * spanScaleY;
        for (let px = 0; px < pixelCols; px++) {
            const isoX = isoOriginX + (px + 0.5) * spanScaleX;
            const world = isoToWorld({ x: isoX, y: isoY });
            if (!Number.isFinite(world.x) || !Number.isFinite(world.y)) continue;
            const relX = world.x - baseX;
            const relY = world.y - baseY;
            const along = relX * ux + relY * uy;
            const lateral = relX * nx + relY * ny;
            if (along < -1e-3 || along > length + 1e-3 || Math.abs(lateral) > halfWidth + 1e-3) continue;
            if (!tester(world.x, world.y)) continue;

            const sampleSx = px + 0.5;
            const sampleSy = py + 0.5;
            const sampleWorldX = world.x;
            const sampleWorldY = world.y;

            const gx = Math.min(gridCols - 1, Math.max(0, Math.floor(sampleSx / cellPxX)));
            const gy = Math.min(gridRows - 1, Math.max(0, Math.floor(sampleSy / cellPxY)));

            for (let r = 1; r <= 2; r++) {
                candidateBuf.length = 0;
                for (let yy = gy - r; yy <= gy + r; yy++) {
                    if (yy < 0 || yy >= gridRows) continue;
                    for (let xx = gx - r; xx <= gx + r; xx++) {
                        if (xx < 0 || xx >= gridCols) continue;
                        const arr = buckets[yy * gridCols + xx];
                        if (arr && arr.length) candidateBuf.push(...arr);
                    }
                }
                if (candidateBuf.length || r === 2) break;
            }

            const source = candidateBuf.length ? candidateBuf : fallbackIndices;
            if (!source.length) continue;

            let best1 = Infinity;
            let best2 = Infinity;
            for (let k = 0; k < source.length; k++) {
                const idx = source[k];
                const dx = sampleWorldX - worldSeeds[2 * idx];
                const dy = sampleWorldY - worldSeeds[2 * idx + 1];
                const dist2 = dx * dx + dy * dy;
                if (dist2 < best1) {
                    best2 = best1;
                    best1 = dist2;
                } else if (dist2 < best2) {
                    best2 = dist2;
                }
            }
            if (!Number.isFinite(best1) || !Number.isFinite(best2) || best2 === Infinity) continue;

            const delta = Math.sqrt(best2) - Math.sqrt(best1);
            if (!Number.isFinite(delta)) continue;

            if (delta <= epsilonThreshold) {
                const normalized = Math.max(0, Math.min(1, (epsilonThreshold - delta) / epsilonThreshold));
                if (!(normalized > 0)) continue;
                const weight = Math.pow(normalized, 1.5);
                if (weight <= 0.01) continue;
                stampStroke(px, py, weight);
            }
        }
    }

    if (hits === 0) return null;

    let buffer: Uint8Array;
    try {
        const imageData = drawingCtx.getImageData(0, 0, pixelCols, pixelRows);
        buffer = new Uint8Array(imageData.data);
    } catch (err) {
        return null;
    }

    return {
        buffer,
        width: pixelCols,
        height: pixelRows,
        spriteX: isoOriginX,
        spriteY: isoOriginY,
        spriteWidth: pixelCols * spanScaleX,
        spriteHeight: pixelRows * spanScaleY,
    };
};

interface GameCanvasProps {
    interiorTexture?: PIXI.Texture | null;
}

// NOVO: refs adicionais para camadas de ruas
interface GameCanvasPropsInternal extends GameCanvasProps {
    interiorTextureScale?: number;
    interiorTextureAlpha?: number;
    interiorTextureTint?: number;
    crossfadeEnabled?: boolean;
    crossfadeMs?: number;
    edgeTexture?: PIXI.Texture | null;
    edgeScale?: number;
    edgeAlpha?: number;
    roadLaneTexture?: PIXI.Texture | null;
    roadLaneScale?: number;
    roadLaneAlpha?: number;
}

const GameCanvas: React.FC<GameCanvasPropsInternal> = ({ interiorTexture, interiorTextureScale, interiorTextureAlpha, interiorTextureTint, crossfadeEnabled, crossfadeMs, edgeTexture, edgeScale, edgeAlpha, roadLaneTexture, roadLaneScale, roadLaneAlpha }) => {
    const canvasContainerRef = useRef<HTMLDivElement>(null);
    const pixiRenderer = useRef<PIXI.IRenderer<PIXI.ICanvas> | null>(null);
    const stage = useRef<PIXI.Container | null>(null);
    const zoomContainer = useRef<PIXI.Container | null>(null);
    const drawables = useRef<PIXI.Container | null>(null);
    const dynamicDrawables = useRef<PIXI.Container | null>(null);
    const heatmaps = useRef<PIXI.Container | null>(null);
    const debugDrawables = useRef<PIXI.Container | null>(null);
    const debugSegments = useRef<PIXI.Container | null>(null);
    const debugMapData = useRef<PIXI.Container | null>(null);
    const characters = useRef<PIXI.Container | null>(null);
    const roadsFill = useRef<PIXI.Container | null>(null);
    const roadsSecondary = useRef<PIXI.Container | null>(null);
    const roadsOverlay = useRef<PIXI.Container | null>(null);
    const roadOutlines = useRef<PIXI.Container | null>(null);
    const intersectionPatches = useRef<PIXI.Container | null>(null);
    const blockOutlines = useRef<PIXI.Container | null>(null);
    const blockEdgeBands = useRef<PIXI.Container | null>(null);
    const hud = useRef<PIXI.Container | null>(null);
    const debugText = useRef<PIXI.Text | null>(null);
    const debugState = useRef<{ markerContainer: boolean; markerTex: boolean; children: number; bbox: string; lanePolys: number }>({ markerContainer: false, markerTex: false, children: 0, bbox: '', lanePolys: 0 });
    const roadLaneOverlay = useRef<PIXI.Container | null>(null);
    const roadLaneOutlines = useRef<PIXI.Container | null>(null);
    const crackedRoadOverlay = useRef<PIXI.Container | null>(null);
    const edgeOverlay = useRef<PIXI.Container | null>(null);
    const roadLaneTextureRef = useRef<PIXI.Texture | null>(roadLaneTexture || null);
    const edgeTextureRef = useRef<PIXI.Texture | null>(edgeTexture || null);
    const noiseOverlayViewRef = useRef<{ cameraX: number; cameraY: number; zoom: number } | null>(null);
    // Cache para evitar reconstruções pesadas dos marcadores/mascara quando nada mudou
    const laneMarkerCacheRef = useRef<{ key: string; container: PIXI.Container | null } | null>(null);
    const roadLaneScaleRef = useRef<number | undefined>(roadLaneScale);
    const roadLaneAlphaRef = useRef<number | undefined>(roadLaneAlpha);
    const crackedRoadsRaf = useRef<number | null>(null);

    // Keep refs in sync with incoming props so updates (from App TextureLoader) take effect
    useEffect(() => {
        try { roadLaneTextureRef.current = roadLaneTexture || null; } catch (e) {}
    }, [roadLaneTexture]);
    useEffect(() => {
        try { edgeTextureRef.current = edgeTexture || null; } catch (e) {}
    }, [edgeTexture]);
    useEffect(() => {
        try { onMapChange(false); } catch (e) {}
    }, [edgeTexture]);
    // When overlay textures change, force a light redraw so overlays are rebuilt
    useEffect(() => {
        try { roadLaneScaleRef.current = roadLaneScale; } catch (e) {}
    }, [roadLaneScale]);
    useEffect(() => {
        try { roadLaneAlphaRef.current = roadLaneAlpha; } catch (e) {}
    }, [roadLaneAlpha]);
    // Two tiling sprites used for crossfade transitions between interior textures
    const blockInteriorSpriteA = useRef<PIXI.TilingSprite | null>(null);
    const blockInteriorSpriteB = useRef<PIXI.TilingSprite | null>(null);
    const activeSprite = useRef<'A'|'B'>('A');

    // Estado mutável central
    const state = useRef({
        segments: [] as Segment[],
        qTree: null as Quadtree | null,
        heatmap: null as MapGenerationResult['heatmap'] | null,
        initialised: false,
        dt: 0,
        time: null as number | null,
        zoom: 0.01 * window.devicePixelRatio,
        camera: { x: 0, y: 0 },
        pathGraphics: null as PIXI.Graphics | null,
        debugSegmentI: 0,
        lastOutlineMode: '' as any,
    lastSmoothSharpAngles: false,
    lastShowOnlyBlockInteriors: false,
        character: { pos: { x: 0, y: 0 } as Point },
        characterGraphics: null as PIXI.Graphics | null,
        // sprite instance for the character (created on demand)
        characterSprite: null as PIXI.Sprite | null,
    }).current;

    const syncNoiseOverlayView = (cameraX: number, cameraY: number, zoom: number) => {
        const hasApi = !!NoiseZoning && typeof NoiseZoning.setView === 'function';
        if (!hasApi) return;
        const prev = noiseOverlayViewRef.current;
        const changed = !prev
            || Math.abs(prev.cameraX - cameraX) > 0.5
            || Math.abs(prev.cameraY - cameraY) > 0.5
            || Math.abs(prev.zoom - zoom) > 0.005;
        if (!changed) return;
        try {
            NoiseZoning.setView?.({ cameraX, cameraY, zoom });
            noiseOverlayViewRef.current = { cameraX, cameraY, zoom };
            if (NoiseZoning.enabled && typeof NoiseZoning.redraw === 'function') {
                NoiseZoning.redraw();
            }
        } catch (err) {
            try { console.warn('[GameCanvas] Failed to sync NoiseZoning view', err); } catch (e) {}
        }
    };

    const worldToIso = (p: Point): Point => {
        if (config.render.mode !== 'isometric') return p;
        const { isoA, isoB, isoC, isoD } = config.render;
        return { x: isoA * p.x + isoC * p.y, y: isoB * p.x + isoD * p.y };
    };

    // Inverse of worldToIso (assumes linear 2x2 matrix [A C; B D])
    const isoToWorld = (p: Point): Point => {
        if (config.render.mode !== 'isometric') return p;
        const { isoA: A, isoB: B, isoC: C, isoD: D } = config.render;
        const det = A * D - B * C;
        if (!isFinite(det) || Math.abs(det) < 1e-12) return { x: p.x, y: p.y };
        const invA = D / det;
        const invB = -B / det;
        const invC = -C / det;
        const invD = A / det;
        return { x: invA * p.x + invC * p.y, y: invB * p.x + invD * p.y };
    };

    // Stable node key generator: snap coordinates to a small grid before stringifying.
    // This avoids accidental separate keys for points that should be considered the same
    // intersection due to floating point jitter. Grid size is configurable via
    // (config as any).render.nodeSnapM (default 1.0 meter). Minimum grid 0.01m.
    const nodeKey = (p: Point, gridM?: number) => {
        const snap = Math.max(0.01, gridM ?? ((config as any).render.nodeSnapM ?? 1.0));
        return `${Math.round(p.x / snap)}:${Math.round(p.y / snap)}`;
    };

    // Criar textura local de grama caso não venha por props
    const localGrassTexture = useRef<PIXI.Texture | null>(null);
    if (!interiorTexture && !localGrassTexture.current && typeof document !== 'undefined') {
        try {
            localGrassTexture.current = createGrassTexture(512, 12345);
        } catch (e) { localGrassTexture.current = null; }
    }

    // If an exterior/interior texture is supplied by the parent, prefer it globally by
    // assigning it to localGrassTexture.current (so all fallback sites pick it up).
    React.useEffect(() => {
        if (interiorTexture) {
            try {
                // ensure tiling is enabled
                if ((interiorTexture as any).baseTexture) {
                    try { (interiorTexture as any).baseTexture.wrapMode = PIXI.WRAP_MODES.REPEAT; } catch (e) {}
                }
            } catch (e) {}
            localGrassTexture.current = interiorTexture;
            try { onMapChange(false); } catch (e) {}
        } else {
            // re-create procedural grass if cleared
            if (!localGrassTexture.current) {
                try { localGrassTexture.current = createGrassTexture(512, 12345); } catch (e) { localGrassTexture.current = null; }
            }
            try { onMapChange(false); } catch (e) {}
        }
    }, [interiorTexture]);

    // Initialize two tiling sprites used as texture holders for crossfading.
    React.useEffect(() => {
        // Keep this effect minimal: only ensure the crossfade tiling sprites exist
        // and are assigned a sane texture. Avoid referencing larger rendering
        // variables (cfg, segments, markerTex) here which are defined elsewhere.
        try {
            if (!blockInteriorSpriteA.current) {
                const tex = interiorTexture || localGrassTexture.current || PIXI.Texture.WHITE;
                blockInteriorSpriteA.current = new PIXI.TilingSprite(tex, 64, 64);
                blockInteriorSpriteA.current.alpha = 1.0;
            }
            if (!blockInteriorSpriteB.current) {
                const tex = interiorTexture || localGrassTexture.current || PIXI.Texture.WHITE;
                blockInteriorSpriteB.current = new PIXI.TilingSprite(tex, 64, 64);
                blockInteriorSpriteB.current.alpha = 0.0;
            }
        } catch (e) {
            // non-fatal
        }
    }, [interiorTexture]);
    // Minimal HUD drawer: keep it simple to avoid referencing large rendering
    // variables during this refactor. Other HUD details can be restored later.
    const drawHUD = () => {
        try {
            if (!hud.current) return;
            // clear previous HUD elements
            hud.current.removeChildren();
            // (Optional) we could draw a simple FPS or debug text here if needed.
            if (debugText.current) {
                hud.current.addChild(debugText.current);
            }
        } catch (e) {
            // swallow errors to avoid breaking rendering
        }
    };

    // (As funções drawSegment/drawRoundedSegment originais foram substituídas mais abaixo pela versão expandida – manteremos apenas a versão avançada existente no arquivo.)

    // ===== Helpers restaurados / reorganizados =====
    const drawPopulationHeatmap = () => {
        if (!heatmaps.current) return;
        heatmaps.current.removeChildren();
        if (!state.heatmap || !config.mapGeneration.DRAW_HEATMAP) return;

        const bounds = config.mapGeneration.QUADTREE_PARAMS;
        const step = 200; // m
        const g = new PIXI.Graphics();
        const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
        const colorLerp = (c1: number, c2: number, t: number) => {
            const r1 = (c1 >> 16) & 0xFF, g1 = (c1 >> 8) & 0xFF, b1 = c1 & 0xFF;
            const r2 = (c2 >> 16) & 0xFF, g2 = (c2 >> 8) & 0xFF, b2 = c2 & 0xFF;
            const r = Math.round(lerp(r1, r2, t));
            const g_ = Math.round(lerp(g1, g2, t));
            const b = Math.round(lerp(b1, b2, t));
            return (r << 16) | (g_ << 8) | b;
        };
        for (let y = bounds.y; y < bounds.y + bounds.height; y += step) {
            for (let x = bounds.x; x < bounds.x + bounds.width; x += step) {
                const cellCx = x + step * 0.5;
                const cellCy = y + step * 0.5;
                const c = (config as any).zoningModel.cityCenter;
                const R = Math.max(200, (state.heatmap as any).rUnit || 3000);
                const dist = Math.hypot(cellCx - c.x, cellCy - c.y);
                let band = 1;
                if (dist < R) band = 5; else if (dist < 2 * R) band = 4; else if (dist < 3 * R) band = 3; else if (dist < 4 * R) band = 2;
                const bandColors = [0,0x81C784,0xBA68C8,0x4FC3F7,0xFFB74D,0xFF8A65];
                const col = bandColors[band];
                const alpha = 0.35;
                const p1 = worldToIso({ x, y });
                const p2 = worldToIso({ x: x + step, y });
                const p3 = worldToIso({ x: x + step, y: y + step });
                const p4 = worldToIso({ x, y: y + step });
                g.beginFill(col, alpha);
                g.moveTo(p1.x, p1.y); g.lineTo(p2.x, p2.y); g.lineTo(p3.x, p3.y); g.lineTo(p4.x, p4.y); g.closePath(); g.endFill();
            }
        }
        // círculos guia
        try {
            const center = (config as any).zoningModel.cityCenter;
            const R = Math.max(200, (state.heatmap as any)?.rUnit || 3000);
            const samples = 128;
            for (let k = 1; k <= 4; k++) {
                const rad = k * R;
                g.lineStyle(2, 0xFFFFFF, 0.5);
                for (let i = 0; i <= samples; i++) {
                    const ang = (i / samples) * Math.PI * 2;
                    const wx = center.x + rad * Math.sin(ang);
                    const wy = center.y + rad * Math.cos(ang);
                    const p = worldToIso({ x: wx, y: wy });
                    if (i === 0) g.moveTo(p.x, p.y); else g.lineTo(p.x, p.y);
                }
            }
        } catch {}
        heatmaps.current.addChild(g);
        (state as any).populationHeatMap = g;
    };

    // Camada secundária (versão final – usada em onMapChange)
    const drawSecondaryRoadLayer = (segments: Segment[]) => {
        // Secundary road layer intentionally disabled.
        return;
    };

    const createSecondaryFillet = (center: Point, s1: Segment, s2: Segment, radiusFactor: number, color: number, alpha: number, widthFactor: number, offsetM: number) => {
        const dirFrom = (seg: Segment) => {
            const a = seg.r.start, b = seg.r.end; const fromStart = (a.x===center.x && a.y===center.y);
            const P = fromStart ? a : b; const Q = fromStart ? b : a; const vx = Q.x-P.x, vy = Q.y-P.y; const L = Math.hypot(vx,vy)||1; return { x: vx/L, y: vy/L, len: L };
        };
        const d1 = dirFrom(s1), d2 = dirFrom(s2);
        let dot = d1.x*d2.x + d1.y*d2.y; dot = Math.min(1, Math.max(-1, dot));
        const theta = Math.acos(dot);
        if (!isFinite(theta) || theta < 0.02 || theta > Math.PI-0.02) return null;
        const baseW = Math.min(s1.width, s2.width) * widthFactor;
        const Rraw = baseW*0.5*radiusFactor; if (Rraw < 0.3) return null;
        const dist = Rraw / Math.tan(theta/2);
        const along = Math.min(dist, Math.min(d1.len, d2.len)*0.5);
        const R = along * Math.tan(theta/2); if (R < 0.5) return null;
        // deslocar o centro do fillet pela mesma offset normal média dos segmentos
        // aproximação: usar normal média das direções
        const avgNx = -(d1.y + d2.y)*0.5; const avgNy = (d1.x + d2.x)*0.5;
        const nLen = Math.hypot(avgNx, avgNy)||1; const onx = avgNx/nLen, ony = avgNy/nLen;
        const cShift = { x: center.x + onx*offsetM, y: center.y + ony*offsetM };
        const T1 = { x: cShift.x + d1.x*along, y: cShift.y + d1.y*along };
        const T2 = { x: cShift.x + d2.x*along, y: cShift.y + d2.y*along };
        const ang1 = Math.atan2(T1.y-cShift.y, T1.x-cShift.x);
        const ang2 = Math.atan2(T2.y-cShift.y, T2.x-cShift.x);
        let delta = ang2 - ang1; while (delta <= -Math.PI) delta += Math.PI*2; while (delta > Math.PI) delta -= Math.PI*2;
        const ccw = delta > 0; let sweep = delta; if ((ccw && sweep < 0) || (!ccw && sweep > 0)) sweep += (ccw?Math.PI*2:-Math.PI*2);
        const steps = Math.max(6, Math.min(40, Math.round(R)));
        const g = new PIXI.Graphics(); g.beginFill(color, alpha);
        for (let i=0;i<=steps;i++){ const t=i/steps; const ang=ang1 + sweep*t; const wx=cShift.x+Math.cos(ang)*R; const wy=cShift.y+Math.sin(ang)*R; const iso=worldToIso({x:wx,y:wy}); if(i===0) g.moveTo(iso.x,iso.y); else g.lineTo(iso.x,iso.y);} g.endFill();
        return g;
    };

    const drawSegment = (segment: Segment, color?: number, width?: number, trimStart = 0, trimEnd = 0) => {
        color = util.defaultFor(color, segment.q.color);
        width = util.defaultFor(width, segment.width);

        // aplicar cortes (trim) nos extremos do segmento em direção ao centro
        const sW0 = segment.r.start;
        const eW0 = segment.r.end;
        const vx0 = eW0.x - sW0.x;
        const vy0 = eW0.y - sW0.y;
        const len0 = Math.hypot(vx0, vy0) || 1;
        const ux = vx0 / len0, uy = vy0 / len0;
        const sW = { x: sW0.x + ux * trimStart, y: sW0.y + uy * trimStart };
        const eW = { x: eW0.x - ux * trimEnd, y: eW0.y - uy * trimEnd };
        const vx = eW.x - sW.x;
        const vy = eW.y - sW.y;
        const len = Math.sqrt(vx * vx + vy * vy) || 1;
        const hx = (-vy / len) * (width / 2);
        const hy = (vx / len) * (width / 2);

        // cantos no espaço do mundo
        const p1 = { x: sW.x + hx, y: sW.y + hy };
        const p2 = { x: sW.x - hx, y: sW.y - hy };
        const p3 = { x: eW.x - hx, y: eW.y - hy };
        const p4 = { x: eW.x + hx, y: eW.y + hy };

        // projetar para tela (isométrico/topdown)
        const P1 = worldToIso(p1);
        const P2 = worldToIso(p2);
        const P3 = worldToIso(p3);
        const P4 = worldToIso(p4);

        const g = new PIXI.Graphics();
        const rCfg = (config as any).render; // gradiente removido
        const baseColor = rCfg.baseRoadColor ?? 0xA1AFA9;
        const baseAlpha = rCfg.baseRoadAlpha ?? 1.0;
        const outerColor = color ?? baseColor;
        g.beginFill(outerColor, baseAlpha);
        g.moveTo(P1.x, P1.y);
        g.lineTo(P2.x, P2.y);
        g.lineTo(P3.x, P3.y);
        g.lineTo(P4.x, P4.y);
        g.closePath();
        g.endFill();
        return g;
    };

    // Função para desenhar polígonos com esquinas curvas
    const drawPolygon = (polygon: blockGeometry.Polygon, color: number, alpha: number = 1.0) => {
        const g = new PIXI.Graphics();
        g.beginFill(color, alpha);

        if (polygon.vertices.length > 0) {
            const firstVertex = worldToIso(polygon.vertices[0]);
            g.moveTo(firstVertex.x, firstVertex.y);
            
            for (let i = 1; i < polygon.vertices.length; i++) {
                const vertex = worldToIso(polygon.vertices[i]);
                g.lineTo(vertex.x, vertex.y);
            }
            
            g.closePath();
        }
        
        g.endFill();
        return g;
    };

    const sqrDist = (a: Point, b: Point): number => {
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        return dx * dx + dy * dy;
    };

    const pushUniquePoint = (pts: Point[], pt: Point, eps = 1e-6) => {
        if (pts.length === 0) {
            pts.push({ x: pt.x, y: pt.y });
            return;
        }
        const last = pts[pts.length - 1];
        if (sqrDist(last, pt) < eps * eps) return;
        pts.push({ x: pt.x, y: pt.y });
    };

    const sanitizeLoopPoints = (points: Point[]): Point[] => {
        const sanitized: Point[] = [];
        const eps2 = 1e-8;
        for (let i = 0; i < points.length; i++) {
            const curr = points[i];
            const next = points[(i + 1) % points.length];
            sanitized.push({ x: curr.x, y: curr.y });
            if (i < points.length - 1 && sqrDist(curr, next) < eps2) {
                sanitized.pop();
            }
        }
        if (sanitized.length > 2) {
            const first = sanitized[0];
            const last = sanitized[sanitized.length - 1];
            if (sqrDist(first, last) < eps2) sanitized.pop();
        }
        return sanitized;
    };

    const roundPolygonPoints = (points: Point[], radius: number): Point[] => {
        if (!points || points.length < 3 || radius <= 0) {
            return points.map(p => ({ x: p.x, y: p.y }));
        }

        const sanitized = sanitizeLoopPoints(points);
        if (sanitized.length < 3) return sanitized;

        let area = 0;
        for (let i = 0; i < sanitized.length; i++) {
            const p = sanitized[i];
            const q = sanitized[(i + 1) % sanitized.length];
            area += p.x * q.y - q.x * p.y;
        }
        const isCCW = area > 0;

        type CornerData = {
            hasArc: boolean;
            start: Point;
            end: Point;
            center: Point;
            radius: number;
            startAngle: number;
            endAngle: number;
            original: Point;
        };

        const corners: CornerData[] = sanitized.map(p => ({
            hasArc: false,
            start: { x: p.x, y: p.y },
            end: { x: p.x, y: p.y },
            center: { x: p.x, y: p.y },
            radius: 0,
            startAngle: 0,
            endAngle: 0,
            original: { x: p.x, y: p.y }
        }));

        for (let i = 0; i < sanitized.length; i++) {
            const prev = sanitized[(i - 1 + sanitized.length) % sanitized.length];
            const curr = sanitized[i];
            const next = sanitized[(i + 1) % sanitized.length];

            const edgePrev = { x: curr.x - prev.x, y: curr.y - prev.y };
            const edgeNext = { x: next.x - curr.x, y: next.y - curr.y };
            const lenPrev = Math.hypot(edgePrev.x, edgePrev.y);
            const lenNext = Math.hypot(edgeNext.x, edgeNext.y);
            if (!isFinite(lenPrev) || !isFinite(lenNext) || lenPrev < 1e-6 || lenNext < 1e-6) {
                continue;
            }

            const cross = edgePrev.x * edgeNext.y - edgePrev.y * edgeNext.x;
            const isConvex = isCCW ? cross > 1e-6 : cross < -1e-6;
            if (!isConvex) continue;

            const inDir = { x: -edgePrev.x / lenPrev, y: -edgePrev.y / lenPrev };
            const outDir = { x: edgeNext.x / lenNext, y: edgeNext.y / lenNext };
            let dot = inDir.x * outDir.x + inDir.y * outDir.y;
            if (dot <= -1) dot = -1;
            if (dot >= 1) dot = 1;
            const angle = Math.acos(dot);
            if (!isFinite(angle) || angle < 1e-3) continue;
            const tanHalf = Math.tan(angle / 2);
            if (!isFinite(tanHalf) || tanHalf <= 1e-6) continue;

            const maxRadius = Math.min(radius, lenPrev * tanHalf, lenNext * tanHalf);
            if (!isFinite(maxRadius) || maxRadius <= 1e-6) continue;
            const offset = maxRadius / tanHalf;

            const start = { x: curr.x + inDir.x * offset, y: curr.y + inDir.y * offset };
            const end = { x: curr.x + outDir.x * offset, y: curr.y + outDir.y * offset };

            const dirPrev = { x: edgePrev.x / lenPrev, y: edgePrev.y / lenPrev };
            const dirNext = { x: edgeNext.x / lenNext, y: edgeNext.y / lenNext };
            const normalPrev = isCCW ? { x: -dirPrev.y, y: dirPrev.x } : { x: dirPrev.y, y: -dirPrev.x };
            const normalNext = isCCW ? { x: -dirNext.y, y: dirNext.x } : { x: dirNext.y, y: -dirNext.x };

            const center1 = { x: start.x + normalPrev.x * maxRadius, y: start.y + normalPrev.y * maxRadius };
            const center2 = { x: end.x + normalNext.x * maxRadius, y: end.y + normalNext.y * maxRadius };
            const center = { x: (center1.x + center2.x) / 2, y: (center1.y + center2.y) / 2 };

            let startAngle = Math.atan2(start.y - center.y, start.x - center.x);
            let endAngle = Math.atan2(end.y - center.y, end.x - center.x);
            if (isCCW) {
                if (endAngle <= startAngle) endAngle += Math.PI * 2;
            } else {
                if (endAngle >= startAngle) endAngle -= Math.PI * 2;
            }

            const angleSpan = Math.abs(endAngle - startAngle);
            if (!isFinite(angleSpan) || angleSpan < 1e-3) continue;

            corners[i] = {
                hasArc: true,
                start,
                end,
                center,
                radius: maxRadius,
                startAngle,
                endAngle,
                original: { x: curr.x, y: curr.y }
            };
        }

        const result: Point[] = [];
        const firstCorner = corners[0];
        if (firstCorner.hasArc) {
            pushUniquePoint(result, firstCorner.start);
        } else {
            pushUniquePoint(result, firstCorner.original);
        }

        for (let i = 0; i < corners.length; i++) {
            const data = corners[i];
            const next = corners[(i + 1) % corners.length];
            if (data.hasArc) {
                const span = data.endAngle - data.startAngle;
                const steps = Math.max(2, Math.ceil(Math.abs(span) / (Math.PI / 24)));
                for (let step = 1; step <= steps; step++) {
                    const t = step / steps;
                    const angle = data.startAngle + span * t;
                    const pt = {
                        x: data.center.x + Math.cos(angle) * data.radius,
                        y: data.center.y + Math.sin(angle) * data.radius
                    };
                    pushUniquePoint(result, pt);
                }
            } else {
                pushUniquePoint(result, data.original);
            }

            const nextStart = next.hasArc ? next.start : next.original;
            pushUniquePoint(result, nextStart);
        }

        if (result.length > 2) {
            const first = result[0];
            const last = result[result.length - 1];
            if (sqrDist(first, last) < 1e-8) result.pop();
        }

        return result;
    };

    const computeRoundedBlockPolygons = (paths: any[], radius: number, scaleFactor: number) => {
        const fallbackWorld: Point[][] = paths.map((path: any) => {
            const pts = path.map((p: any) => ({ x: p.X / scaleFactor, y: p.Y / scaleFactor }));
            return sanitizeLoopPoints(pts);
        });

        if (!radius || radius <= 0) {
            const clipperCopy = paths.map((path: any) => path.slice());
            return { world: fallbackWorld, clipper: clipperCopy };
        }

        const world: Point[][] = [];
        const clipper: any[] = [];

        fallbackWorld.forEach((pts, idx) => {
            const rounded = roundPolygonPoints(pts, radius);
            if (rounded.length >= 3) {
                world.push(rounded);
                clipper.push(rounded.map(pt => ({ X: Math.round(pt.x * scaleFactor), Y: Math.round(pt.y * scaleFactor) })));
            } else {
                world.push(pts);
                const original = paths[idx] || [];
                clipper.push(original.slice());
            }
        });

        return { world, clipper };
    };

    // Função para desenhar quarteirões com esquinas curvas
    const drawCurvedBlocks = () => {
        if (!blockOutlines.current) return;
        
        // Limpar visualizações anteriores
        blockOutlines.current.removeChildren();
        
        // Gerar alguns quarteirões de exemplo baseados na área dos segmentos
        if (!state.segments || state.segments.length === 0) return;
        
        // Encontrar limites da área construída
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        state.segments.forEach(segment => {
            minX = Math.min(minX, segment.r.start.x, segment.r.end.x);
            maxX = Math.max(maxX, segment.r.start.x, segment.r.end.x);
            minY = Math.min(minY, segment.r.start.y, segment.r.end.y);
            maxY = Math.max(maxY, segment.r.start.y, segment.r.end.y);
        });
        
        // Criar quarteirões em uma grade
        const blockSize = 400; // metros
        const curveRadius = 40; // raio das esquinas curvas
        
        for (let x = minX; x < maxX; x += blockSize * 1.5) {
            for (let y = minY; y < maxY; y += blockSize * 1.5) {
                const block: blockGeometry.Block = {
                    center: { x: x + blockSize / 2, y: y + blockSize / 2 },
                    width: blockSize,
                    height: blockSize,
                    corners: [],
                    curveRadius: curveRadius
                };
                
                // Gerar polígono original (sem curvas)
                const originalPolygon = blockGeometry.generateBasicBlockPolygon(block);
                
                // Gerar polígono com curvas
                const curvedPolygon = blockGeometry.generateCurvedBlockPolygon(block);
                
                // Calcular diferença (áreas das esquinas)
                const cornerAreas = blockGeometry.subtractPolygons(originalPolygon, curvedPolygon);
                
                // Desenhar o polígono curvo (quarteirão principal)
                const curvedGraphics = drawPolygon(curvedPolygon, 0x4CAF50, 0.3); // Verde claro
                if (blockOutlines.current) {
                    blockOutlines.current.addChild(curvedGraphics);
                }
                
                // Não desenhar as áreas das esquinas em cinza (apenas integramos na pista em outro ponto)
                
                // Desenhar contorno do polígono original para referência
                // Contorno removido – somente área interna mostrada
            }
        }
    };

    // Desenha uma "cápsula" arredondada (retângulo + semicículos nas extremidades) em coordenadas do mundo
    type CapStyle = 'round' | 'butt';
    const drawRoundedSegment = (segment: Segment, color?: number, width?: number, trimStart = 0, trimEnd = 0, capStart: CapStyle = 'round', capEnd: CapStyle = 'round') => {
        color = util.defaultFor(color, segment.q.color);
        width = util.defaultFor(width, segment.width);
        // aplicar trims ao longo do eixo da via
        const sW0 = segment.r.start;
        const eW0 = segment.r.end;
        const vx0 = eW0.x - sW0.x;
        const vy0 = eW0.y - sW0.y;
        const len0 = Math.hypot(vx0, vy0) || 1;
        const ux0 = vx0 / len0, uy0 = vy0 / len0;
    // raio (metade da espessura)
    const r = width / 2;
    // fator da curva nas junções (0..1)
    const k = Math.max(0, Math.min(1, (config as any).render.joinCurveFactor ?? 0.6));
        const sWtmp = { x: sW0.x + ux0 * trimStart, y: sW0.y + uy0 * trimStart };
        const eWtmp = { x: eW0.x - ux0 * trimEnd, y: eW0.y - uy0 * trimEnd };
    // Não estender nas pontas quando cap é 'butt'
    const sW = sWtmp;
    const eW = eWtmp;
        const vx = eW.x - sW.x;
        const vy = eW.y - sW.y;
        const len = Math.hypot(vx, vy) || 1;
        const nx = -(vy / len), ny = (vx / len); // normal à esquerda

        // Bordas do retângulo central
        const a = { x: sW.x + nx * r, y: sW.y + ny * r };
        const b = { x: sW.x - nx * r, y: sW.y - ny * r };
        const c = { x: eW.x - nx * r, y: eW.y - ny * r };
        const d = { x: eW.x + nx * r, y: eW.y + ny * r };

        // Amostrar semicículos nas pontas (mundo -> tela)
        const steps = Math.max(12, Math.min(48, Math.ceil((Math.PI * r) / 12))); // adaptativo
        const startAngle = Math.atan2(ny, nx); // normal como direção para “fora” do start
        const endAngle = Math.atan2(-ny, -nx); // normal oposta para o end

    const g = new PIXI.Graphics();
    const baseColor2 = (config as any).render.baseRoadColor ?? 0xA1AFA9;
    const baseAlpha2 = (config as any).render.baseRoadAlpha ?? 1.0;
    g.beginFill(color ?? baseColor2, baseAlpha2);

    // flags: arredondar apenas extremidades não aparadas e quando o estilo pedir
    const roundStart = trimStart <= 1e-6 && capStart === 'round';
    const roundEnd = trimEnd <= 1e-6 && capEnd === 'round';

        // Começa no lado externo próximo ao start (ponto a)
        let p = worldToIso(a);
        g.moveTo(p.x, p.y);

        if (roundStart) {
            // Semicírculo na ponta start: de +n até -n passando pelo sentido da direção -u
            for (let i = 0; i <= steps; i++) {
                const t = i / steps;
                const ang = startAngle + Math.PI * t;
                const wx = sW.x + Math.cos(ang) * r;
                const wy = sW.y + Math.sin(ang) * r;
                const sp = worldToIso({ x: wx, y: wy });
                g.lineTo(sp.x, sp.y);
            }
        } else {
            // Sem arco: fechar reto até o lado interno
            p = worldToIso(b); g.lineTo(p.x, p.y);
        }

        // lado interno (b -> c)
        if (roundStart) { p = worldToIso(b); g.lineTo(p.x, p.y); }
        p = worldToIso(c); g.lineTo(p.x, p.y);

        if (roundEnd) {
            // Semicírculo na ponta end: de -n até +n passando pelo sentido da direção +u
            for (let i = 0; i <= steps; i++) {
                const t = i / steps;
                const ang = endAngle + Math.PI * t;
                const wx = eW.x + Math.cos(ang) * r;
                const wy = eW.y + Math.sin(ang) * r;
                const sp = worldToIso({ x: wx, y: wy });
                g.lineTo(sp.x, sp.y);
            }
        } else {
            // Curva quadrática envolvendo o endpoint end (eW) até o lado externo d
            const cpEnd = worldToIso({ x: eW.x + (vx / len) * (r * k), y: eW.y + (vy / len) * (r * k) });
            const dIso = worldToIso(d);
            g.quadraticCurveTo(cpEnd.x, cpEnd.y, dIso.x, dIso.y);
        }

        // lado externo (d -> a)
        if (roundStart) {
            // Se já desenhamos semicículo no start, basta fechar com linha
            p = worldToIso(a); g.lineTo(p.x, p.y);
        } else {
            // Curva quadrática envolvendo o endpoint start (sW) de d até a
            const cpStart = worldToIso({ x: sW.x - (vx / len) * (r * k), y: sW.y - (vy / len) * (r * k) });
            const aIso = worldToIso(a);
            g.quadraticCurveTo(cpStart.x, cpStart.y, aIso.x, aIso.y);
        }

        g.closePath();
        g.endFill();

        // Contorno por segmento removido daqui; agora é desenhado por drawRoadOutlines()
        return g;
    };

    // Desenha uma malha de vias conectando segmentos com arcTo em interseções (modo alternativo)
    // Gera um fillet (arco tangente) entre dois segmentos que compartilham um nó.
    const createFillet = (center: Point, s1: Segment, s2: Segment, radiusFactor: number) => {
        // Direções dos segmentos a partir do nó (center) para fora
        const dirFrom = (seg: Segment) => {
            const a = seg.r.start, b = seg.r.end;
            const fromStart = (a.x === center.x && a.y === center.y);
            const P = fromStart ? a : b; // center
            const Q = fromStart ? b : a; // outro extremo
            const vx = Q.x - P.x, vy = Q.y - P.y;
            const L = Math.hypot(vx, vy) || 1;
            return { x: vx / L, y: vy / L, len: L };
        };
        const d1 = dirFrom(s1);
        const d2 = dirFrom(s2);
        // ângulo entre vetores (entre 0 e π)
        let dot = d1.x * d2.x + d1.y * d2.y;
        dot = Math.min(1, Math.max(-1, dot));
        const theta = Math.acos(dot);
        if (!isFinite(theta) || theta < 1e-3 || theta > Math.PI - 1e-3) return null; // quase colinear ou degenerado
        // Raio base limitado pelas larguras
        const w1 = s1.width, w2 = s2.width;
        const Rraw = Math.min(w1, w2) * 0.5 * radiusFactor;
        if (Rraw < 0.5) return null;
        // Distância desde o nó até o ponto de tangência em cada segmento
        // d = R * tan(theta/2)
        const distNeeded = Rraw / Math.tan(theta / 2);
        // Não pode ultrapassar 60% do comprimento de cada segmento
        const maxAlong = Math.min(d1.len, d2.len) * 0.6;
        const along = Math.min(distNeeded, maxAlong);
        // Se along reduziu, ajusta raio efetivo R = along * tan(theta/2)
        const R = along * Math.tan(theta / 2);
        if (R < 0.5) return null;
        // Pontos de tangência nos eixos centrais das vias
        const T1 = { x: center.x + d1.x * along, y: center.y + d1.y * along };
        const T2 = { x: center.x + d2.x * along, y: center.y + d2.y * along };
        // Construir plano local para girar d1 em direção a d2
        // Ângulo absoluto de cada direção
        const ang1 = Math.atan2(d1.y, d1.x);
        const ang2 = Math.atan2(d2.y, d2.x);
        // Determinar sentido (clockwise ou ccw) para girar de ang1 até ang2 no menor arco
        let delta = ang2 - ang1;
        while (delta <= -Math.PI) delta += Math.PI * 2;
        while (delta > Math.PI) delta -= Math.PI * 2;
        const ccw = delta > 0; // se delta positivo, arco anti-horário
        // Centro geométrico do arco: interseção das linhas normais em T1 e T2
        const n1 = { x: -d1.y, y: d1.x };
        const n2 = { x: -d2.y, y: d2.x };
        // Equações: C = T1 + n1 * R  e  C = T2 + n2 * R (ou -R dependendo do lado). Precisamos escolher sinais que alinhem o centro.
        // Para evitar ambiguidade, projetamos tentando ambos os sinais e escolhendo aquele que resulta em ângulo médio coerente.
        const candidates: Point[] = [];
        for (const sgn1 of [+1, -1]) {
            for (const sgn2 of [+1, -1]) {
                // Resolver C: T1 + n1*R*sgn1 = T2 + n2*R*sgn2  =>  n1*R*sgn1 - n2*R*sgn2 = T2 - T1
                // Rearranjo: C = T1 + n1*R*sgn1
                const C = { x: T1.x + n1.x * R * sgn1, y: T1.y + n1.y * R * sgn1 };
                // Verificar distância até T2
                const dx = T2.x - C.x, dy = T2.y - C.y;
                const dC = Math.hypot(dx, dy);
                if (Math.abs(dC - R) < R * 0.15) { // tolerância 15%
                    candidates.push(C);
                }
            }
        }
        if (!candidates.length) return null;
        // Escolher candidato cujo ângulo central abrange T1->T2 com o sentido esperado
        const pickCenter = () => {
            for (const C of candidates) {
                const a1c = Math.atan2(T1.y - C.y, T1.x - C.x);
                const a2c = Math.atan2(T2.y - C.y, T2.x - C.x);
                let dAng = a2c - a1c;
                while (dAng <= -Math.PI) dAng += Math.PI * 2;
                while (dAng > Math.PI) dAng -= Math.PI * 2;
                if ((ccw && dAng > 0) || (!ccw && dAng < 0)) {
                    return { C, a1c, a2c };
                }
            }
            return null;
        };
        const chosen = pickCenter();
        if (!chosen) return null;
        const { C, a1c, a2c } = chosen;
        // Ajustar variação para seguir sentido correto incremental ao amostrar
        let sweep = a2c - a1c;
        while (sweep <= -Math.PI) sweep += Math.PI * 2;
        while (sweep > Math.PI) sweep -= Math.PI * 2;
        if ((ccw && sweep < 0) || (!ccw && sweep > 0)) sweep += (ccw ? Math.PI * 2 : -Math.PI * 2);
        const steps = Math.max(6, Math.min(48, Math.round(R))); // detalhe proporcional ao raio
        const g = new PIXI.Graphics();
    g.beginFill((config as any).render.baseRoadColor ?? 0xA1AFA9, (config as any).render.baseRoadAlpha ?? 1.0);
        for (let i = 0; i <= steps; i++) {
            const t = i / steps;
            const ang = a1c + sweep * t;
            const wx = C.x + Math.cos(ang) * R;
            const wy = C.y + Math.sin(ang) * R;
            const iso = worldToIso({ x: wx, y: wy });
            if (i === 0) g.moveTo(iso.x, iso.y); else g.lineTo(iso.x, iso.y);
        }
        g.endFill();
        return g;
    };

    // Gera um "losango curvo" (diamond com lados arqueados) para interseções grau >= 3
    const createRoundedDiamond = (center: Point, connected: Segment[]) => {
        if (connected.length < 3) return null;
        // Ordenar direções angulares
        const dirs = connected.map(s => {
            const a = s.r.start, b = s.r.end;
            const fromStart = (a.x === center.x && a.y === center.y);
            const P = fromStart ? a : b; const Q = fromStart ? b : a;
            const vx = Q.x - P.x, vy = Q.y - P.y; const L = Math.hypot(vx, vy) || 1;
            return { ang: Math.atan2(vy, vx), ux: vx / L, uy: vy / L, w: s.width };
        }).sort((a,b)=>a.ang-b.ang);
        const n = dirs.length;
        // Raio base: média das metades de largura
        const avgR = dirs.reduce((acc,d)=>acc + d.w*0.5,0)/n;
        const R = Math.max(1, avgR*0.9);
        const bulge = 0.55; // fator de arqueamento
        const stepsPerSide = 6;
        const g = new PIXI.Graphics();
    g.beginFill((config as any).render.baseRoadColor ?? 0xA1AFA9,(config as any).render.baseRoadAlpha ?? 1.0);
        const points: Point[] = [];
        for (let i=0;i<n;i++) {
            const dA = dirs[i];
            const dB = dirs[(i+1)%n];
            // ponto entre direções para formar vértice do diamond
            let midAng = dA.ang + ((dB.ang - dA.ang + Math.PI*3) % (Math.PI*2) - Math.PI*1);
            // normalizar
            while (midAng <= -Math.PI) midAng += Math.PI*2;
            while (midAng > Math.PI) midAng -= Math.PI*2;
            // deslocar ligeiramente em direção ao espaço aberto
            const vx = Math.cos(midAng), vy = Math.sin(midAng);
            const vxOut = vx, vyOut = vy;
            const edgeLen = R * 0.9;
            const base = { x: center.x + vxOut * edgeLen, y: center.y + vyOut * edgeLen };
            // Arco entre base deste vértice e próximo usando direções originais
            // Para suavizar: gera pequena curva entre extremidades projetadas em cada segmento
            const aPt = { x: center.x + dA.ux * (R*0.6), y: center.y + dA.uy * (R*0.6) };
            const bPt = { x: center.x + dB.ux * (R*0.6), y: center.y + dB.uy * (R*0.6) };
            // Interpolar arco tipo bezier entre aPt -> base -> bPt
            for (let s=0; s<=stepsPerSide; s++) {
                const t = s/stepsPerSide;
                const u = 1-t;
                const x = u*u*aPt.x + 2*u*t*base.x + t*t*bPt.x;
                const y = u*u*aPt.y + 2*u*t*base.y + t*t*bPt.y;
                points.push({x,y});
            }
        }
        // Desenhar
        points.forEach((pt,i)=>{
            const iso = worldToIso(pt);
            if (i===0) g.moveTo(iso.x, iso.y); else g.lineTo(iso.x, iso.y);
        });
        g.closePath(); g.endFill();
        return g;
    };

    // Arc-based outline renderer removed — use rounded segment outlines and intersection patches

    // (Função antiga drawRoadFillWithArcs removida – lógica substituída por novo bloco direto na fase principal de desenho)

    // Desenha o contorno das vias conforme o modo atual
    const drawRoadOutlines = () => {
        if (!roadOutlines.current) return;
        roadOutlines.current.removeChildren();
        const segments = state.segments;
        if ((config as any).render.roadOutlineMode === 'segments') {
            for (const segment of segments) {
                const g = drawRoundedSegment(segment, (config as any).render.baseRoadColor ?? 0xA1AFA9, segment.width, 0, 0, 'butt', 'butt');
                roadOutlines.current.addChild(g);
            }
    } else if ((config as any).render.roadOutlineMode === 'hull') {
        const pts: Point[] = [];
        segments.forEach(segment => {
            const s = segment.r.start, e = segment.r.end;
            const vx = e.x - s.x, vy = e.y - s.y;
            const len = Math.hypot(vx, vy) || 1;
            const nx = -vy / len, ny = vx / len;
            const r = segment.width / 2;
            const a = { x: s.x + nx * r, y: s.y + ny * r };
            const d = { x: e.x + nx * r, y: e.y + ny * r };
            const b = { x: s.x - nx * r, y: s.y - ny * r };
            const c = { x: e.x - nx * r, y: e.y - ny * r };
            pts.push(a, b, c, d);
        });
        const hull = (() => {
            const P = pts
                .filter(p => Number.isFinite(p.x) && Number.isFinite(p.y))
                .sort((p1, p2) => (p1.x === p2.x ? p1.y - p2.y : p1.x - p2.x));
            const cross = (o: Point, a: Point, b: Point) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
            const lower: Point[] = [];
            for (const p of P) {
                while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
                lower.push(p);
            }
            const upper: Point[] = [];
            for (let i = P.length - 1; i >= 0; i--) {
                const p = P[i];
                while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
                upper.push(p);
            }
            upper.pop(); lower.pop();
            return lower.concat(upper);
        })();
        if (hull.length >= 3) {
            // Preenchimento cinza claro SEMPRE
            const gFill = new PIXI.Graphics();
            gFill.beginFill((config as any).render.baseRoadColor ?? 0xA1AFA9, (config as any).render.baseRoadAlpha ?? 1.0);
            const hullIso = hull.map(worldToIso);
            gFill.moveTo(hullIso[0].x, hullIso[0].y);
            for (let i = 1; i < hullIso.length; i++) gFill.lineTo(hullIso[i].x, hullIso[i].y);
            gFill.closePath();
            gFill.endFill();
            roadOutlines.current.addChild(gFill);
            // Contorno só se ativado (true)
            // Contorno externo removido (transparente) – apenas preenchimento
        }
        }
    };

    const drawCrackedRoads = (segments: Segment[]) => {
        const container = crackedRoadOverlay.current;
        if (!container) return;
        const previous = container.removeChildren();
        previous.forEach(child => {
            try {
                child.destroy({ children: true, texture: true, baseTexture: true });
            } catch (err) { try { console.warn('[CrackedRoads] Failed to destroy previous sprite', err); } catch (e) {} }
        });
        const cfg = (config as any).render;
        const show = !!cfg.showCrackedRoadsOutline;
        if (!show) {
            container.visible = false;
            return;
        }
        const getMask = (NoiseZoning as any)?.getIntersectionMaskData;
        const createTester = (NoiseZoning as any)?.createIntersectionTester;
        if (typeof createTester !== 'function') {
            container.visible = false;
            return;
        }
        const tester = createTester.call(NoiseZoning) as ((x: number, y: number) => boolean) | null;
        if (!tester) {
            container.visible = false;
            return;
        }
        const maskInfo = typeof getMask === 'function' ? getMask.call(NoiseZoning) as {
            coarseW: number;
            coarseH: number;
            gridMinX: number;
            gridMinY: number;
            worldStep: number;
            pixelSizePx: number;
            intersectionMask: Uint8Array;
        } | null : null;
        if (!maskInfo || !(maskInfo.worldStep > 0)) {
            container.visible = false;
            return;
        }
        const mask = maskInfo.intersectionMask;
        if (!mask || !mask.length) {
            container.visible = false;
            return;
        }
        let anyMask = false;
        for (let i = 0; i < mask.length; i++) {
            if (mask[i]) { anyMask = true; break; }
        }
        if (!anyMask) {
            container.visible = false;
            return;
        }
        const baseColor: number = cfg.crackedRoadColor ?? 0x00E5FF;
        const baseAlpha: number = Math.min(1, Math.max(0, cfg.crackedRoadAlpha ?? 0.88));
        const baseSeedDensity: number = Math.max(0.005, cfg.crackedRoadSeedDensity ?? 0.055);
        const baseSampleAlong: number = Math.max(0.25, cfg.crackedRoadSampleDensityAlong ?? 1.6);
        const baseSampleAcross: number = Math.max(0.25, cfg.crackedRoadSampleDensityAcross ?? 1.1);
        const baseEpsilon: number = Math.max(0.01, cfg.crackedRoadVoronoiThreshold ?? 0.65);
        const baseMinLength: number = Math.max(1, cfg.crackedRoadMinLengthM ?? 5.0);
        const baseMaxSeeds: number = Math.max(8, cfg.crackedRoadMaxSeeds ?? 520);
        const baseMaxSamplesAlong: number = Math.max(4, cfg.crackedRoadMaxSamplesAlong ?? 240);
        const baseMaxSamplesAcross: number = Math.max(4, cfg.crackedRoadMaxSamplesAcross ?? 96);
        const baseProbeStep: number = Math.max(0.4, cfg.crackedRoadProbeStepM ?? 1.1);
        const baseStrokePx: number = Math.max(0.35, cfg.crackedRoadStrokePx ?? 1.35);
        const baseResolutionMultiplier: number = Math.max(1, cfg.crackedRoadResolutionMultiplier ?? 3);
        const assignments = ((cfg.crackedRoadPatternAssignments as CrackPatternAssignments | undefined)?.segments) ?? null;
        const globalSeed: number = (NoiseZoning as any)?.getSeed?.call(NoiseZoning) ?? 0;

        let drewAny = false;

        segments.forEach((segment, segmentIndex) => {
            if (!segment || !segment.r) return;
            const start = segment.r.start;
            const end = segment.r.end;
            const vx = end.x - start.x;
            const vy = end.y - start.y;
            const segLen = Math.hypot(vx, vy);
            if (!(segLen > 1e-3)) return;
            const roadWidth = Math.max(1.5, segment.width || 0);
            const ux = vx / segLen;
            const uy = vy / segLen;
            const nx = -uy;
            const ny = ux;
            const segKey = segment?.id != null ? String(segment.id) : `idx:${segmentIndex}`;
            const patternId = assignments ? assignments[segKey] : undefined;
            const pattern = patternId ? getCrackPatternById(patternId) : undefined;
            const mult = pattern?.multipliers || {};
            const segSeedDensity = Math.max(0.005, baseSeedDensity * (mult.seedDensity ?? 1));
            const segSampleAlong = Math.max(0.25, baseSampleAlong * (mult.sampleAlong ?? 1));
            const segSampleAcross = Math.max(0.25, baseSampleAcross * (mult.sampleAcross ?? 1));
            const segRawEpsilon = Math.max(0.005, baseEpsilon + (pattern?.thresholdOffset ?? 0));
            const segMinLength = Math.max(0.5, baseMinLength * (mult.minLength ?? 1));
            const segMaxSeeds = Math.max(8, Math.round(baseMaxSeeds * (mult.maxSeeds ?? 1)));
            const segMaxSamplesAlong = Math.max(4, Math.round(baseMaxSamplesAlong * (mult.maxSamplesAlong ?? 1)));
            const segMaxSamplesAcross = Math.max(4, Math.round(baseMaxSamplesAcross * (mult.maxSamplesAcross ?? 1)));
            const segProbeStep = Math.max(0.25, baseProbeStep * (mult.probeStep ?? 1));
            const segAlpha = Math.max(0.05, Math.min(1, baseAlpha * (mult.alpha ?? 1)));
            const segColor = pattern?.color ?? baseColor;
            const segStrokePxRaw = baseStrokePx * (mult.strokePx ?? 1);
            const segStrokePx = Math.max(0.3, Number.isFinite(segStrokePxRaw) ? segStrokePxRaw : baseStrokePx);
            const segResolutionMultiplierRaw = baseResolutionMultiplier * (mult.resolutionMultiplier ?? 1);
            const segResolutionMultiplier = Math.max(1, Math.min(8, Number.isFinite(segResolutionMultiplierRaw) ? segResolutionMultiplierRaw : baseResolutionMultiplier));
            const segSeedOffset = pattern?.seedOffset ?? 0;
            const steps = Math.max(4, Math.ceil(segLen / segProbeStep));
            const intervals: Array<{ start: number; end: number }> = [];
            let runStart: number | null = null;
            for (let s = 0; s <= steps; s++) {
                const t = steps === 0 ? 0 : s / steps;
                const px = start.x + vx * t;
                const py = start.y + vy * t;
                const inside = tester(px, py);
                if (inside) {
                    if (runStart === null) runStart = t;
                } else if (runStart !== null) {
                    if (t > runStart + 1e-4) intervals.push({ start: runStart, end: t });
                    runStart = null;
                }
            }
            if (runStart !== null) {
                intervals.push({ start: runStart, end: 1 });
            }

            intervals.forEach((interval, intervalIndex) => {
                const startT = clamp(interval.start, 0, 1);
                const endT = clamp(interval.end, 0, 1);
                if (!(endT > startT + 1e-4)) return;
                const intervalLen = segLen * (endT - startT);
                if (intervalLen < segMinLength) return;
                const area = intervalLen * roadWidth;
                let seeds = Math.max(8, Math.round(area * segSeedDensity));
                seeds = Math.min(seeds, segMaxSeeds);
                if (seeds < 2) return;
                let samplesU = Math.max(2, Math.round(intervalLen * segSampleAlong));
                let samplesV = Math.max(2, Math.round(roadWidth * segSampleAcross));
                samplesU = Math.min(samplesU, segMaxSamplesAlong);
                samplesV = Math.min(samplesV, segMaxSamplesAcross);
                if (samplesU < 2 || samplesV < 2) return;
                const hash = hashNumbers(globalSeed, segmentIndex, intervalIndex, startT * 1000, endT * 1000, roadWidth, segSeedOffset);
                const startOffset = segLen * startT;
                const baseX = start.x + ux * startOffset;
                const baseY = start.y + uy * startOffset;
                const spriteData = generateRoadCrackSprite({
                    length: intervalLen,
                    width: roadWidth,
                    seedCount: seeds,
                    samplesAlong: samplesU,
                    samplesAcross: samplesV,
                    maxSamplesAlong: segMaxSamplesAlong,
                    maxSamplesAcross: segMaxSamplesAcross,
                    epsilonPx: segRawEpsilon,
                    strokePx: segStrokePx,
                    resolutionMultiplier: segResolutionMultiplier,
                    seed: hash,
                    tester,
                    baseX,
                    baseY,
                    ux,
                    uy,
                    nx,
                    ny,
                    worldToIso,
                    isoToWorld,
                });
                if (!spriteData) return;
                try {
                    const baseTexture = PIXI.BaseTexture.fromBuffer(spriteData.buffer, spriteData.width, spriteData.height, {
                        scaleMode: PIXI.SCALE_MODES.LINEAR,
                        mipmap: PIXI.MIPMAP_MODES.ON,
                    });
                    try { (baseTexture as any).mipmap = PIXI.MIPMAP_MODES.ON; } catch (e) {}
                    const aniso = (baseTexture as any).anisotropicLevel;
                    if (typeof aniso === 'number' && aniso < 4) {
                        (baseTexture as any).anisotropicLevel = 4;
                    }
                    const texture = new PIXI.Texture(baseTexture);
                    const sprite = new PIXI.Sprite(texture);
                    sprite.x = spriteData.spriteX;
                    sprite.y = spriteData.spriteY;
                    sprite.width = spriteData.spriteWidth;
                    sprite.height = spriteData.spriteHeight;
                    sprite.tint = segColor;
                    sprite.alpha = segAlpha;
                    sprite.roundPixels = false;
                    container.addChild(sprite);
                    drewAny = true;
                } catch (err) {
                    try { console.warn('[CrackedRoads] Failed to build sprite', err); } catch (e) {}
                }
            });
        });

        container.visible = drewAny;
    };

    const scheduleCrackedRoadRedraw = () => {
        const run = () => {
            crackedRoadsRaf.current = null;
            try { drawCrackedRoads(state.segments); } catch (e) {}
        };
        if (crackedRoadsRaf.current != null) return;
        if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
            crackedRoadsRaf.current = window.requestAnimationFrame(run);
        } else {
            run();
        }
    };

    // Desenha os patches ("losangos" / travesseiros) de interseção em container separado
    const drawIntersectionPatches = () => {
        if (!intersectionPatches.current) return;
        intersectionPatches.current.removeChildren();
        const dbg = !!(config as any).render.intersectionPatchDebugMode;
        const forceShowForDbg = dbg; // agora sempre mostra algo quando debug ligado
        if (!(config as any).render.smoothSharpAngles && !forceShowForDbg) { if (dbg) console.log('[Patches] skip: smoothSharpAngles=false (no force)'); return; }
        if ((config as any).render.useArcToSmoothing && !forceShowForDbg) { if (dbg) console.log('[Patches] skip: useArcToSmoothing=true (no force)'); return; }
        const segments = state.segments;
        if (!segments.length) { if (dbg) console.log('[Patches] skip: no segments'); return; }
        if (dbg) console.log('[Patches] begin segments=', segments.length, 'forceShowForDbg=', forceShowForDbg);

        const nodeMap: Record<string, { p: Point; segs: Segment[] }> = {};
                const key = (p: Point) => nodeKey(p);
        for (const seg of segments) {
            (nodeMap[key(seg.r.start)] ||= { p: seg.r.start, segs: [] }).segs.push(seg);
            (nodeMap[key(seg.r.end)] ||= { p: seg.r.end, segs: [] }).segs.push(seg);
        }

        const radiusFactor = (config as any).render.sharpAngleRadiusFactor || 1.5;
        const concaveFactor = (config as any).render.intersectionConcaveFactor || 0.4;
        const debugMode = !!(config as any).render.intersectionPatchDebugMode;
    const debugColor = debugMode ? 0xFF00FF : ((config as any).render.intersectionPatchDebugColor ?? (config as any).render.baseRoadColor ?? 0xA1AFA9);
        let count = 0;
        const overlayDbg = dbg ? new PIXI.Graphics() : null;
        for (const node of Object.values(nodeMap)) {
            if (node.segs.length < 2) continue;
            let maxWidth = 0;
            for (const seg of node.segs) if (seg.width > maxWidth) maxWidth = seg.width;
            const patchRadius = (maxWidth / 2) * radiusFactor;
            if (patchRadius <= 0.5) continue;
            const gPatch = new PIXI.Graphics();
            if (debugMode) gPatch.lineStyle(2, 0x000000, 0.6);
            gPatch.beginFill(debugColor, debugMode ? 0.9 : 1.0);
            const samples = 24;
            for (let k = 0; k <= samples; k++) {
                const t = (k / samples) * Math.PI * 2;
                const distortion = Math.cos(4 * t) * (1 - concaveFactor);
                const actualRadius = patchRadius * (concaveFactor + distortion * 0.5);
                const wx = node.p.x + Math.cos(t) * actualRadius;
                const wy = node.p.y + Math.sin(t) * actualRadius;
                const pIso = worldToIso({ x: wx, y: wy });
                if (k === 0) gPatch.moveTo(pIso.x, pIso.y); else gPatch.lineTo(pIso.x, pIso.y);
            }
            gPatch.closePath();
            gPatch.endFill();
            // Only add the generated patch geometry when explicit debug mode is enabled.
            // This avoids drawing the diamond/cross shapes in normal rendering.
            if (dbg) intersectionPatches.current.addChild(gPatch);
            if (overlayDbg) {
                // Only draw the base radius circle for debug, not the cross
                overlayDbg.lineStyle(1, 0xFFFFFF, 0.7);
                const circSamples = 20;
                for (let c = 0; c <= circSamples; c++) {
                    const ang = (c / circSamples) * Math.PI * 2;
                    const wx = node.p.x + Math.cos(ang) * patchRadius;
                    const wy = node.p.y + Math.sin(ang) * patchRadius;
                    const ci = worldToIso({ x: wx, y: wy });
                    if (c === 0) overlayDbg.moveTo(ci.x, ci.y); else overlayDbg.lineTo(ci.x, ci.y);
                }
            }
            count++;
        }
        if (overlayDbg) intersectionPatches.current.addChild(overlayDbg);
        // debug logs removidos
    };

    // Pool for reusing per-marker tiling sprites to reduce allocations and improve performance.
    const laneMarkerPoolRef = React.useRef<PIXI.TilingSprite[]>([]);
    const laneMarkerContainerRef = React.useRef<PIXI.Container | null>(null);

    // helper: acquire a tiling sprite from pool or create new
    const acquireMarkerTile = (w: number, h: number, tex: PIXI.Texture) => {
        const pool = laneMarkerPoolRef.current;
        let sprite: PIXI.TilingSprite | undefined = undefined;
        while (pool.length > 0) {
            const s = pool.pop()!;
            // if texture matches reuse, otherwise discard
            if ((s.texture as any) === (tex as any) || (s.texture as any)?.baseTexture?.uid === (tex as any)?.baseTexture?.uid) {
                sprite = s; break;
            } else {
                try { s.destroy({ texture: false, baseTexture: false }); } catch (e) {}
            }
        }
        if (!sprite) {
            sprite = new PIXI.TilingSprite(tex, Math.max(1, w), Math.max(1, h));
        } else {
            sprite.texture = tex;
            sprite.width = Math.max(1, w);
            sprite.height = Math.max(1, h);
        }
        // reset common props
        if (sprite.anchor && sprite.anchor.set) sprite.anchor.set(0.5, 0.5);
        sprite.rotation = 0;
        try { sprite.tilePosition && (sprite.tilePosition.x = 0); } catch (e) {}
        try { sprite.tilePosition && (sprite.tilePosition.y = 0); } catch (e) {}
        try { sprite.tileScale && sprite.tileScale.set(1,1); } catch (e) {}
        sprite.alpha = 1.0;
        return sprite;
    };

    const releaseMarkerTile = (tile: PIXI.TilingSprite) => {
        // detach from parent and push to pool
        try {
            if (tile.parent) {
                try { tile.parent.removeChild(tile); } catch (e) { }
            }
            // clear mask/children safely if used as container child earlier
            try { (tile as any).mask = null; } catch (e) {}
        } catch (e) {}
        // keep maximum pool size modest to avoid memory blowup
        const pool = laneMarkerPoolRef.current;
        const MAX_POOL = 256;
        if (pool.length < MAX_POOL) pool.push(tile);
        else try { tile.destroy({ texture: false, baseTexture: false }); } catch (e) {}
    };

    const onMapChange = (rebuildBuildings: boolean = true) => {
    if (!dynamicDrawables.current || !debugMapData.current || !debugSegments.current || !roadOutlines.current || !intersectionPatches.current) return;

    if (state.pathGraphics) state.pathGraphics.clear();
    if (rebuildBuildings) dynamicDrawables.current.removeChildren();
    roadsFill.current?.removeChildren();
    // Limpar camada secundária (overlay) antes de redesenhar
    roadsSecondary.current?.removeChildren();
    roadOutlines.current.removeChildren();
    intersectionPatches.current.removeChildren();
    crackedRoadOverlay.current?.removeChildren();
    if (rebuildBuildings) blockOutlines.current?.removeChildren();
    // Limpeza adicional: bandas de borda devem ser sempre limpas ao atualizar mapa
    blockEdgeBands.current?.removeChildren();
        debugMapData.current.removeChildren();
        debugSegments.current.removeChildren();
        state.debugSegmentI = 0;

    let segments = MapStore.getSegments();
    const qTree = MapStore.getQTree() || null;
        const heatmap = MapStore.getHeatmap();
    const debugData = MapStore.getDebugData();

    // Opcionalmente remover ruas de ponta solta (dead-ends) que não encostam na borda do mapa
    const removeInnerDeadEnds = (config as any).render.removeInnerDeadEnds;
    const edgeProx = Math.max(0, (config as any).render.deadEndEdgeProximityM ?? 250);
    const bounds = (config as any).mapGeneration.QUADTREE_PARAMS || { x: -20000, y: -20000, width: 40000, height: 40000 };
    let filteredSegments = segments;
    if (removeInnerDeadEnds) {
        const key = (p: Point) => `${Math.round(p.x)}:${Math.round(p.y)}`;
        const isNearEdge = (p: Point) => {
            const x0 = bounds.x, y0 = bounds.y, x1 = bounds.x + bounds.width, y1 = bounds.y + bounds.height;
            const dx = Math.min(Math.abs(p.x - x0), Math.abs(x1 - p.x));
            const dy = Math.min(Math.abs(p.y - y0), Math.abs(y1 - p.y));
            return (dx <= edgeProx) || (dy <= edgeProx);
        };
        const computeDegree = (list: Segment[]) => {
            // Trata o grafo como NÃO-DIRECIONADO: conta vizinhos únicos por nó
            const adj: Record<string, Set<string>> = {};
            for (const s of list) {
                const ks = key(s.r.start), ke = key(s.r.end);
                if (ks === ke) continue;
                (adj[ks] ||= new Set()).add(ke);
                (adj[ke] ||= new Set()).add(ks);
            }
            const deg: Record<string, number> = {};
            Object.keys(adj).forEach(k => { deg[k] = adj[k].size; });
            return deg;
        };
        // Poda iterativa: remove segmentos cujo start ou end tem grau 1 e NENHUMA ponta está perto da borda
        let current = segments.slice();
        for (let iter = 0; iter < 5_000; iter++) { // limite de segurança
            const degree = computeDegree(current);
            const toKeep: Segment[] = [];
            let removed = 0;
            for (const s of current) {
                const ks = key(s.r.start), ke = key(s.r.end);
                const degS = degree[ks] || 0, degE = degree[ke] || 0;
                const isDeadEnd = (degS <= 1) || (degE <= 1);
                if (isDeadEnd && !isNearEdge(s.r.start) && !isNearEdge(s.r.end)) {
                    removed++;
                    continue; // poda dead-end interno
                }
                toKeep.push(s);
            }
            current = toKeep;
            if (removed === 0) break; // estabilizou
        }
        filteredSegments = current;
    }

    state.segments = filteredSegments;
    segments = filteredSegments;
        state.qTree = qTree;
    state.heatmap = heatmap || null;
    // redesenhar heatmap sempre que o mapa muda
        drawPopulationHeatmap();
        
        const R_SMALL = 6; // marcadores discretos
    debugData?.snaps?.forEach((point: Point) => {
            const p = worldToIso(point);
            const g = new PIXI.Graphics().beginFill(0x00FF00).drawCircle(p.x, p.y, R_SMALL).endFill();
            debugMapData.current?.addChild(g);
        });
    debugData?.intersectionsRadius?.forEach((point: Point) => {
            const p = worldToIso(point);
            const g = new PIXI.Graphics().beginFill(0x0000FF).drawCircle(p.x, p.y, R_SMALL).endFill();
            debugMapData.current?.addChild(g);
        });
    debugData?.intersections?.forEach((point: Point) => {
            const p = worldToIso(point);
            const g = new PIXI.Graphics().beginFill(0xFF0000).drawCircle(p.x, p.y, R_SMALL).endFill();
            debugMapData.current?.addChild(g);
        });

        // Se estivermos no modo simples de ruas (linhas finas), pular toda lógica de trims/edifícios/blocks
        if ((config as any).render.simpleRoads) {
            // Limpar camadas pesadas
            roadsFill.current?.removeChildren();
            roadOutlines.current?.removeChildren();
            blockOutlines.current?.removeChildren();
            dynamicDrawables.current?.removeChildren();

            // Desenhar cada segmento como uma linha fina na sua cor original
            for (const segment of segments) {
                const color = segment.q.color ?? (config as any).render.baseRoadColor ?? 0xA1AFA9;
                const g = new PIXI.Graphics();
                g.lineStyle(2, color, 1.0);
                const p0 = worldToIso(segment.r.start);
                const p1 = worldToIso(segment.r.end);
                g.moveTo(p0.x, p0.y);
                g.lineTo(p1.x, p1.y);
                roadsFill.current?.addChild(g);
            }

            // Não desenhar outlines/blocks nesse modo
            return;
        }

        // ==== Calcular trims por nó (antes de desenhar vias) ====
        // Map de trims por segmento
        const trimMap = new Map<Segment, { start: number; end: number }>();
        const ensureTrim = (seg: Segment) => {
            if (!trimMap.has(seg)) trimMap.set(seg, { start: 0, end: 0 });
            return trimMap.get(seg)!;
        };

        // Build nó -> entradas
    const keyOf = (p: Point) => nodeKey(p);
        type NodeEntry = { seg: Segment; atStart: boolean };
        const nodeMapForTrim: Record<string, { P: Point; entries: NodeEntry[] }> = {};
        for (const seg of segments) {
            (nodeMapForTrim[keyOf(seg.r.start)] ||= { P: seg.r.start, entries: [] }).entries.push({ seg, atStart: true });
            (nodeMapForTrim[keyOf(seg.r.end)] ||= { P: seg.r.end, entries: [] }).entries.push({ seg, atStart: false });
        }

        // Nó de grau 1 => rua sem saída. Vamos marcar para definir cap "butt" nessa ponta
        const deadEndCaps = new Map<Segment, { startButt: boolean; endButt: boolean }>();
        Object.values(nodeMapForTrim).forEach(node => {
            const { entries } = node;
            if (entries.length === 1) {
                const e = entries[0];
                const info = deadEndCaps.get(e.seg) || { startButt: false, endButt: false };
                if (e.atStart) info.startButt = true; else info.endButt = true;
                deadEndCaps.set(e.seg, info);
            }
        });

        // Nova camada overlay estilizada
        const drawOverlayRoadLayer = (segments: Segment[]) => {
            const rCfg = (config as any).render;
            if (!rCfg.overlayRoadEnabled) return;
            if (!roadsOverlay.current) return;
            roadsOverlay.current.removeChildren();

            const color: number = rCfg.overlayRoadColor ?? 0xCCCCD5;
            const alpha: number = rCfg.overlayRoadAlpha ?? 0.85;
            const widthFactor: number = rCfg.overlayRoadWidthFactor ?? 0.45;
            const offsetM: number = rCfg.overlayRoadOffsetM ?? 2.0;
            const filletRadiusFactor: number = rCfg.overlayRoadFilletRadiusFactor ?? 1.1;

            const organicEnabled: boolean = rCfg.overlayOrganicEnabled ?? false;
            const organicAmpFactor: number = rCfg.overlayOrganicAmpFactor ?? 0.35; // relativo a half-width
            const organicFreq: number = rCfg.overlayOrganicFreq ?? 1.6;
            const organicOctaves: number = rCfg.overlayOrganicOctaves ?? 3;
            const organicRoughness: number = rCfg.overlayOrganicRoughness ?? 0.45;
            const organicSeed: number = rCfg.overlayOrganicSeed ?? 0;

            // Construir mapa de nós (usado para fillets se não orgânico)
            const key = (p: Point) => nodeKey(p);
            const nodeMap: Record<string, { p: Point; segs: Segment[] }> = {};
            for (const s of segments) {
                (nodeMap[key(s.r.start)] ||= { p: s.r.start, segs: [] }).segs.push(s);
                (nodeMap[key(s.r.end)] ||= { p: s.r.end, segs: [] }).segs.push(s);
            }

            if (organicEnabled) {
                // Função de "noise" procedural baseada em soma de senos multi-octave
                const layeredNoise = (t: number, basePhase: number) => {
                    let value = 0; let amp = 1; let freq = organicFreq; let sumAmp = 0;
                    for (let o = 0; o < organicOctaves; o++) {
                        const phase = t * freq + basePhase + o * 11.371;
                        value += Math.sin(phase) * amp;
                        sumAmp += amp;
                        freq *= 2;
                        amp *= organicRoughness;
                    }
                    if (sumAmp < 1e-6) return 0;
                    return value / sumAmp; // -1 .. 1
                };

                for (const s of segments) {
                    const a = s.r.start, b = s.r.end;
                    const vx = b.x - a.x, vy = b.y - a.y; const L = Math.hypot(vx, vy) || 1;
                    const ux = vx / L, uy = vy / L; // direção
                    const nx = -uy, ny = ux; // normal
                    const w = s.width * widthFactor;
                    const hw = w * 0.5;
                    const amp = hw * organicAmpFactor; // amplitude absoluta
                    const offx = nx * offsetM, offy = ny * offsetM; // deslocamento lateral global

                    // Número de amostras baseado no comprimento (limitado)
                    const steps = Math.max(8, Math.min(96, Math.round(L / 3)));
                    const top: Point[] = [];
                    const bottom: Point[] = [];
                    const basePhase = organicSeed * 17.123 + (s as any).id * 3.137 + 0.5;

                    for (let i = 0; i <= steps; i++) {
                        const t = i / steps; // 0..1
                        const cx = a.x + vx * t + offx; // ponto central da faixa deslocada
                        const cy = a.y + vy * t + offy;
                        const nVal = layeredNoise(t, basePhase); // -1..1
                        const lateral = nVal * amp;
                        // espessura orgânica levemente variável mantendo centro
                        const tx = cx + nx * (hw + lateral);
                        const ty = cy + ny * (hw + lateral);
                        const bx = cx - nx * (hw - lateral);
                        const by = cy - ny * (hw - lateral);
                        top.push({ x: tx, y: ty });
                        bottom.push({ x: bx, y: by });
                    }

                    const poly = top.concat(bottom.reverse());
                    const g = new PIXI.Graphics();
                    g.beginFill(color, alpha);
                    poly.forEach((pt, idx) => { const iso = worldToIso(pt); if (idx === 0) g.moveTo(iso.x, iso.y); else g.lineTo(iso.x, iso.y); });
                    g.closePath();
                    g.endFill();
                    roadsOverlay.current?.addChild(g);
                }
            } else {
                // Modo retangular simples original
                for (const s of segments) {
                    const a = s.r.start, b = s.r.end;
                    const vx = b.x - a.x, vy = b.y - a.y; const L = Math.hypot(vx, vy) || 1;
                    const ux = vx / L, uy = vy / L; // direção
                    const nx = -uy, ny = ux; // normal
                    const w = s.width * widthFactor;
                    const hw = w * 0.5;
                    const offx = nx * offsetM, offy = ny * offsetM;
                    const sShift = { x: a.x + offx, y: a.y + offy };
                    const eShift = { x: b.x + offx, y: b.y + offy };
                    const p1 = { x: sShift.x + nx * hw, y: sShift.y + ny * hw };
                    const p2 = { x: sShift.x - nx * hw, y: sShift.y - ny * hw };
                    const p3 = { x: eShift.x - nx * hw, y: eShift.y - ny * hw };
                    const p4 = { x: eShift.x + nx * hw, y: eShift.y + ny * hw };
                    const g = new PIXI.Graphics();
                    g.beginFill(color, alpha);
                    [p1, p2, p3, p4].forEach((pt, i) => { const iso = worldToIso(pt); if (i === 0) g.moveTo(iso.x, iso.y); else g.lineTo(iso.x, iso.y); });
                    g.closePath(); g.endFill();
                    roadsOverlay.current?.addChild(g);
                }
            }

            // Fillets simplificados só quando NÃO orgânico (para evitar conflitos visuais)
            if (!organicEnabled) {
                for (const node of Object.values(nodeMap)) {
                    if (node.segs.length !== 2) continue;
                    const [s1, s2] = node.segs;
                    const makeShifted = (seg: Segment) => {
                        const a = seg.r.start, b = seg.r.end;
                        const vx = b.x - a.x, vy = b.y - a.y; const L = Math.hypot(vx, vy) || 1; const ux = vx / L, uy = vy / L; const nx = -uy, ny = ux;
                        const offx = nx * offsetM, offy = ny * offsetM;
                        return { start: { x: a.x + offx, y: a.y + offy }, end: { x: b.x + offx, y: b.y + offy }, width: seg.width * widthFactor } as Segment['r'] & { width: number };
                    };
                    const s1Shift = makeShifted(s1); const s2Shift = makeShifted(s2);

                // Overlay road layer disabled intentionally (Camada 3 removed)
                return;
                    const center = node.p;
                    const dirFrom = (r: any, original: Segment) => {
                        const a = original.r.start, b = original.r.end; const fromStart = (a.x === center.x && a.y === center.y);
                        const P = fromStart ? r.start : r.end; const Q = fromStart ? r.end : r.start; const vx = Q.x - P.x, vy = Q.y - P.y; const L = Math.hypot(vx, vy) || 1; return { x: vx / L, y: vy / L, len: L };
                    };
                    const d1 = dirFrom(s1Shift, s1), d2 = dirFrom(s2Shift, s2);
                    let dotv = d1.x * d2.x + d1.y * d2.y; dotv = Math.min(1, Math.max(-1, dotv));
                    const theta = Math.acos(dotv);
                    if (!isFinite(theta) || theta < 0.05 || theta > Math.PI - 0.05) continue;
                    const baseW = Math.min(s1Shift.width, s2Shift.width);
                    const Rraw = (baseW * 0.5) * filletRadiusFactor;
                    const dist = Rraw / Math.tan(theta / 2);
                    const along = Math.min(dist, Math.min(d1.len, d2.len) * 0.5);
                    const R = along * Math.tan(theta / 2); if (R < 0.3) continue;
                    const T1 = { x: center.x + d1.x * along, y: center.y + d1.y * along };
                    const T2 = { x: center.x + d2.x * along, y: center.y + d2.y * along };
                    const ang1 = Math.atan2(T1.y - center.y, T1.x - center.x);
                    const ang2 = Math.atan2(T2.y - center.y, T2.x - center.x);
                    let delta = ang2 - ang1; while (delta <= -Math.PI) delta += Math.PI * 2; while (delta > Math.PI) delta -= Math.PI * 2;
                    const ccw = delta > 0; let sweep = delta; if ((ccw && sweep < 0) || (!ccw && sweep > 0)) sweep += (ccw ? Math.PI * 2 : -Math.PI * 2);
                    const steps = Math.max(5, Math.min(32, Math.round(R)));
                    const g = new PIXI.Graphics(); g.beginFill(color, alpha);
                    for (let i = 0; i <= steps; i++) {
                        const t = i / steps; const ang = ang1 + sweep * t; const wx = center.x + Math.cos(ang) * R; const wy = center.y + Math.sin(ang) * R; const iso = worldToIso({ x: wx, y: wy }); if (i === 0) g.moveTo(iso.x, iso.y); else g.lineTo(iso.x, iso.y);
                    }
                    g.endFill();
                    roadsOverlay.current?.addChild(g);
                }
            }
        };

    const EPS = 1e-6;
    const add = (a: Point, b: Point): Point => ({ x: a.x + b.x, y: a.y + b.y });
    const sub = (a: Point, b: Point): Point => ({ x: a.x - b.x, y: a.y - b.y });
    const mul = (v: Point, s: number): Point => ({ x: v.x * s, y: v.y * s });
    const dot = (a: Point, b: Point): number => a.x * b.x + a.y * b.y;
    const cross = (a: Point, b: Point): number => a.x * b.y - a.y * b.x;
    const norm = (v: Point): Point => { const L = Math.hypot(v.x, v.y) || 1; return { x: v.x / L, y: v.y / L }; };

        Object.values(nodeMapForTrim).forEach(node => {
            const { P, entries } = node;
            if (entries.length < 2) return;
            for (let i = 0; i < entries.length; i++) {
                for (let j = i + 1; j < entries.length; j++) {
                    const e1 = entries[i], e2 = entries[j];
                    const s1 = e1.seg, s2 = e2.seg;
                    const v1 = norm(e1.atStart ? sub(s1.r.end, s1.r.start) : sub(s1.r.start, s1.r.end));
                    const v2 = norm(e2.atStart ? sub(s2.r.end, s2.r.start) : sub(s2.r.start, s2.r.end));
                    const c = Math.max(-1, Math.min(1, dot(v1, v2)));
                    const alpha = Math.acos(c);
                    if (!(alpha > 2 * Math.PI / 180 && alpha < Math.PI - 2 * Math.PI / 180)) continue;
                    // Só aplicar trims se estivermos usando o patch interno; caso contrário, não aparar para evitar buracos
                    if ((config as any).render.useInnerArcPatch) {
                        const w1 = s1.width, w2 = s2.width;
                        const r_in = Math.min(w1, w2) / 2; // raio interno para tangência nas bordas internas
                        const t_in = r_in / Math.tan(alpha / 2);
                        const tr1 = ensureTrim(s1);
                        const tr2 = ensureTrim(s2);
                        if (e1.atStart) tr1.start = Math.max(tr1.start, t_in); else tr1.end = Math.max(tr1.end, t_in);
                        if (e2.atStart) tr2.start = Math.max(tr2.start, t_in); else tr2.end = Math.max(tr2.end, t_in);
                    }
                }
            }
        });

        // Trims adicionais para abrir espaço para o patch (caso ativado em config.render.applyIntersectionTrims)
        if ((config as any).render.applyIntersectionTrims) {
            const keyNode = (p: Point) => `${Math.round(p.x)}:${Math.round(p.y)}`;
            const nodeMap: Record<string, { p: Point; segs: Segment[] }> = {};
            for (const seg of segments) {
                (nodeMap[keyNode(seg.r.start)] ||= { p: seg.r.start, segs: [] }).segs.push(seg);
                (nodeMap[keyNode(seg.r.end)] ||= { p: seg.r.end, segs: [] }).segs.push(seg);
            }
            const extraFactor = ((config as any).render.sharpAngleRadiusFactor || 1.5) * 0.6; // recuo parcial
            for (const n of Object.values(nodeMap)) {
                if (n.segs.length < 2) continue;
                let maxWidth = 0;
                for (const s of n.segs) if (s.width > maxWidth) maxWidth = s.width;
                const base = (maxWidth / 2) * extraFactor;
                for (const s of n.segs) {
                    // recuo = min(base, 30% do comprimento do segmento) para não sumir segmento curto
                    const segLen = Math.hypot(s.r.end.x - s.r.start.x, s.r.end.y - s.r.start.y);
                    const trimDist = Math.min(base, segLen * 0.3);
                    const tr = ensureTrim(s);
                    // descobrir se o nó é start ou end deste segmento
                    const isStart = Math.round(s.r.start.x) === Math.round(n.p.x) && Math.round(s.r.start.y) === Math.round(n.p.y);
                    if (isStart) tr.start = Math.max(tr.start, trimDist); else tr.end = Math.max(tr.end, trimDist);
                }
            }
        }

        let buildings: Building[] = rebuildBuildings ? [] : dynamicDrawables.current ? [] : [];
    if (rebuildBuildings) for (let i = 0; i < segments.length; i += 4) {
            const segment = segments[i];
            const zone = getZoneAt(segment.r.end);
            const zc = (config as any).zones?.[zone] || {};
            // Regra: não construir em quarteirões muito pequenos (< 100 m²)
            const blockAreaEstimate = segment.width * (zc.blockLengthM ?? config.mapGeneration.DEFAULT_SEGMENT_LENGTH);
            if (blockAreaEstimate < 100) {
                continue;
            }
            // Densidade e raio de dispersão vindos do config para permitir ajuste via UI
            const baseCount = zc.density ?? (zone === 'residential' ? 10 : 6);
            const popLocal = state.heatmap ? state.heatmap.populationAt(segment.r.end.x, segment.r.end.y) : 0.5;
            // Modular densidade por valor do heatmap (0..1) => 0.6x .. 1.6x
            const densityMult = 0.6 + 1.0 * Math.max(0, Math.min(1, popLocal));
            let count = Math.max(1, Math.round(baseCount * densityMult));
            const radius = zc.scatterRadiusM ?? 420;
            // Ajuste por cobertura alvo (aproxima % de área ocupada por quarteirão)
            const w = segment.width;
            const segArea = w * (zc.blockLengthM ?? config.mapGeneration.DEFAULT_SEGMENT_LENGTH);
            const targetCoverage = zc.coverageTarget ?? 0;
            if (targetCoverage > 0) {
                // média de área por construção (aproxima pelas dimensões dos tipos com pesos do mix)
                const mix = (zc.buildingMix || {}) as Record<string, number>;
                    const dim = ((config as any).buildings as any).dimensions;
                let avgArea = 0, sumP = 0;
                Object.keys(mix).forEach(k => {
                    const p = mix[k] || 0; sumP += p;
                    const d = dim[k];
                    if (d) avgArea += p * (d.width * d.depth);
                });
                if (sumP > 0) avgArea /= sumP; else avgArea = 120; // fallback ~ casa pequena
                const targetCount = Math.max(1, Math.round((segArea * targetCoverage) / avgArea));
                // suavizar para não oscilar muito
                count = Math.max(1, Math.round(0.5 * count + 0.5 * targetCount));
            }
            const timeNow = new Date().getTime();
            // Ajustar o mix de tipos pelo heatmap: áreas quentes => +comercial/+residencial; frias => +casa/+fazenda/+import
            const baseMix = (zc.buildingMix || {}) as Record<string, number>;
            const heat = Math.max(0, Math.min(1, popLocal));
            const s = (heat - 0.5) * 2; // [-1,1]
            const boostHigh: Record<string, number> = { 
                commercial: 0.4, commercialMedium: 0.5, commercialLarge: 0.6,
                kiosk: 0.25, shopSmall: 0.35, bakery: 0.3, bar: 0.32, pharmacy: 0.28, grocery: 0.34,
                restaurant: 0.4, supermarket: 0.5, shoppingCenter: 0.65, cinema: 0.5,
                office: 0.55, hotel: 0.45, parkingLot: 0.2, conventionCenter: 0.55,
                gasStation: 0.2, bank: 0.3, clinic: 0.25, hospitalPrivate: 0.4, publicOffice: 0.25,
                residential: 0.3, house: -0.4, houseSmall: -0.3, houseHigh: -0.2, apartmentBlock: 0.2, condoTower: 0.4,
                school: 0.1, leisureArea: -0.1, import: -0.2, factory: -0.3, factoryMedium: -0.35, distributionCenter: -0.4,
                industrialComplex: -0.45, powerPlant: -0.5, workshop: -0.2, warehouseSmall: -0.25,
                farm: -0.6, farmhouse: -0.5, silo: -0.5, animalBarn: -0.5, machineryShed: -0.5, cooperative: -0.4, field: -0.6, pond: -0.3,
                park: -0.2, green: -0.2, church: 0.0
            } as any;
            const boostLow: Record<string, number>  = { 
                commercial: -0.3, commercialMedium: -0.35, commercialLarge: -0.5,
                kiosk: -0.1, shopSmall: -0.15, bakery: -0.12, bar: -0.12, pharmacy: -0.1, grocery: -0.14,
                restaurant: -0.15, supermarket: -0.25, shoppingCenter: -0.5, cinema: -0.3,
                office: -0.35, hotel: -0.3, parkingLot: -0.1, conventionCenter: -0.45,
                gasStation: -0.2, bank: -0.2, clinic: -0.1, hospitalPrivate: -0.35, publicOffice: -0.1,
                residential: -0.2, house: 0.45, houseSmall: 0.4, houseHigh: 0.2, apartmentBlock: -0.1, condoTower: -0.4,
                school: 0.15, leisureArea: 0.2, import: 0.2, factory: 0.3, factoryMedium: 0.35, distributionCenter: 0.4,
                industrialComplex: 0.45, powerPlant: 0.5, workshop: 0.25, warehouseSmall: 0.2,
                farm: 0.7, farmhouse: 0.6, silo: 0.5, animalBarn: 0.5, machineryShed: 0.5, cooperative: 0.4, field: 0.6, pond: 0.3,
                park: 0.25, green: 0.35, church: 0.05
            } as any;
            const adj: Record<string, number> = {};
            let keys = ['house','houseSmall','houseHigh','apartmentBlock','condoTower','school','leisureArea','residential','commercial','commercialMedium','commercialLarge','kiosk','shopSmall','bakery','bar','pharmacy','grocery','restaurant','supermarket','shoppingCenter','cinema','office','hotel','conventionCenter','parkingLot','gasStation','bank','clinic','hospitalPrivate','publicOffice','park','green','church','import','factory','factoryMedium','warehouseSmall','distributionCenter','industrialComplex','workshop','powerPlant','farm','farmhouse','silo','animalBarn','machineryShed','cooperative','field','pond'] as const;
            // Filtrar por zona do segmento: evita prédios grandes em residencial
            if (zc === (config as any).zones.residential) {
                keys = ['houseSmall','house','houseHigh','apartmentBlock','school','leisureArea','park','green','church'] as any;
            } else if (zc === (config as any).zones.commercial) {
                keys = ['kiosk','shopSmall','bakery','bar','pharmacy','grocery','restaurant','supermarket','commercial','commercialMedium','bank','gasStation','office','hotel','parkingLot','cinema','clinic','hospitalPrivate','publicOffice','conventionCenter','park','houseSmall','house','apartmentBlock','residential'] as any;
            } else if (zc === (config as any).zones.industrial) {
                keys = ['workshop','warehouseSmall','factory','factoryMedium','distributionCenter','industrialComplex','powerPlant'] as any;
            } else if (zc === (config as any).zones.rural) {
                keys = ['field','farm','farmhouse','silo','animalBarn','machineryShed','cooperative','pond'] as any;
            }
            for (const k of keys) {
                const base = baseMix[k] ?? 0;
                const b = s >= 0 ? boostHigh[k] : boostLow[k];
                const m = 1 + Math.abs(s) * b; // multiplicador
                adj[k] = Math.max(0, base * m);
            }
            // Proibir parques apenas nas zonas industrial e rural
            if (zone === 'industrial' || zone === 'rural') {
                adj['park' as any] = 0;
            }
            // normalizar
            let sum = 0; keys.forEach(k => sum += adj[k]);
            if (sum <= 0) { keys.forEach(k => adj[k] = (k === 'house' ? 1 : 0)); sum = 1; }
            keys.forEach(k => adj[k] /= sum);

            const pickByAdjustedMix = () => {
                let r = Math.random();
                for (const k of keys) {
                    const p = adj[k] || 0;
                    if (r < p) {
                        switch (k) {
                            case 'kiosk': return buildingFactory.byType((BuildingType as any).KIOSK, timeNow);
                            case 'house': return buildingFactory.byType(BuildingType.HOUSE, timeNow);
                            case 'houseSmall': return buildingFactory.byType((BuildingType as any).HOUSE_SMALL, timeNow);
                            case 'houseHigh': return buildingFactory.byType((BuildingType as any).HOUSE_HIGH, timeNow);
                            case 'apartmentBlock': return buildingFactory.byType((BuildingType as any).APARTMENT_BLOCK, timeNow);
                            case 'condoTower': return buildingFactory.byType((BuildingType as any).CONDO_TOWER, timeNow);
                            case 'school': return buildingFactory.byType((BuildingType as any).SCHOOL, timeNow);
                            case 'leisureArea': return buildingFactory.byType((BuildingType as any).LEISURE, timeNow);
                            case 'residential': return buildingFactory.byType(BuildingType.RESIDENTIAL, timeNow);
                            case 'commercial': return buildingFactory.byType(BuildingType.COMMERCIAL, timeNow);
                            case 'commercialMedium': return buildingFactory.byType((BuildingType as any).COMMERCIAL_MEDIUM, timeNow);
                            case 'commercialLarge': return buildingFactory.byType((BuildingType as any).COMMERCIAL_LARGE, timeNow);
                            case 'bakery': return buildingFactory.byType((BuildingType as any).BAKERY, timeNow);
                            case 'shopSmall': return buildingFactory.byType((BuildingType as any).SHOP_SMALL, timeNow);
                            case 'restaurant': return buildingFactory.byType((BuildingType as any).RESTAURANT, timeNow);
                            case 'bar': return buildingFactory.byType((BuildingType as any).BAR, timeNow);
                            case 'pharmacy': return buildingFactory.byType((BuildingType as any).PHARMACY, timeNow);
                            case 'grocery': return buildingFactory.byType((BuildingType as any).GROCERY, timeNow);
                            case 'supermarket': return buildingFactory.byType((BuildingType as any).SUPERMARKET, timeNow);
                            case 'shoppingCenter': return buildingFactory.byType((BuildingType as any).SHOPPING_CENTER, timeNow);
                            case 'cinema': return buildingFactory.byType((BuildingType as any).CINEMA, timeNow);
                            case 'office': return buildingFactory.byType((BuildingType as any).OFFICE, timeNow);
                            case 'hotel': return buildingFactory.byType((BuildingType as any).HOTEL, timeNow);
                            case 'conventionCenter': return buildingFactory.byType((BuildingType as any).CONVENTION_CENTER, timeNow);
                            case 'parkingLot': return buildingFactory.byType((BuildingType as any).PARKING, timeNow);
                            case 'gasStation': return buildingFactory.byType((BuildingType as any).GAS_STATION, timeNow);
                            case 'bank': return buildingFactory.byType((BuildingType as any).BANK, timeNow);
                            case 'clinic': return buildingFactory.byType((BuildingType as any).CLINIC, timeNow);
                            case 'hospitalPrivate': return buildingFactory.byType((BuildingType as any).HOSPITAL_PRIVATE, timeNow);
                            case 'publicOffice': return buildingFactory.byType((BuildingType as any).PUBLIC_OFFICE, timeNow);
                            case 'park': return buildingFactory.byType((BuildingType as any).PARK, timeNow);
                            case 'green': return buildingFactory.byType((BuildingType as any).GREEN, timeNow);
                            case 'church': return buildingFactory.byType((BuildingType as any).CHURCH, timeNow);
                            case 'import': return buildingFactory.byType(BuildingType.IMPORT, timeNow);
                            case 'factory': return buildingFactory.byType((BuildingType as any).FACTORY, timeNow);
                            case 'factoryMedium': return buildingFactory.byType((BuildingType as any).FACTORY_MEDIUM, timeNow);
                            case 'warehouseSmall': return buildingFactory.byType((BuildingType as any).WAREHOUSE_SMALL, timeNow);
                            case 'distributionCenter': return buildingFactory.byType((BuildingType as any).DISTRIBUTION_CENTER, timeNow);
                            case 'industrialComplex': return buildingFactory.byType((BuildingType as any).INDUSTRIAL_COMPLEX, timeNow);
                            case 'workshop': return buildingFactory.byType((BuildingType as any).WORKSHOP, timeNow);
                            case 'powerPlant': return buildingFactory.byType((BuildingType as any).POWER_PLANT, timeNow);
                            case 'farm': return buildingFactory.byType(BuildingType.FARM, timeNow);
                            case 'farmhouse': return buildingFactory.byType((BuildingType as any).FARMHOUSE, timeNow);
                            case 'silo': return buildingFactory.byType((BuildingType as any).SILO, timeNow);
                            case 'animalBarn': return buildingFactory.byType((BuildingType as any).ANIMAL_BARN, timeNow);
                            case 'machineryShed': return buildingFactory.byType((BuildingType as any).MACHINERY_SHED, timeNow);
                            case 'cooperative': return buildingFactory.byType((BuildingType as any).COOPERATIVE, timeNow);
                            case 'field': return buildingFactory.byType((BuildingType as any).FIELD, timeNow);
                            case 'pond': return buildingFactory.byType((BuildingType as any).POND, timeNow);
                        }
                    }
                    r -= p;
                }
                return buildingFactory.byType(BuildingType.HOUSE, timeNow);
            };
            // Para zonas residenciais, preferir lotes alinhados ao longo da rua (organização tipo quarteirão)
            let newBuildings: Building[] = [];
            if (zone === 'residential') {
                const margin = Math.max(8, (zc.blockLengthM ?? config.mapGeneration.DEFAULT_SEGMENT_LENGTH) * 0.1);
                const len = Math.hypot(segment.r.end.x - segment.r.start.x, segment.r.end.y - segment.r.start.y);
                const segArea = segment.width * (zc.blockLengthM ?? config.mapGeneration.DEFAULT_SEGMENT_LENGTH);
                const targetCoverage = Math.max(0, Math.min(0.9, zc.coverageTarget ?? 0.3));
                    const houseDim = ((config as any).buildings as any).dimensions.house;
                const avgArea = (houseDim.width * houseDim.depth) || 120;
                const targetCount = Math.max(2, Math.round((segArea * targetCoverage) / avgArea));
                const perSide = Math.max(1, Math.ceil(targetCount / 2));
                const useful = Math.max(10, len - 2 * margin);
                const rawSpacing = useful / perSide;
                // Se houver configuração de lote, priorizar a frente (larguraM do lote) como espaçamento realista
                const lot = (zc.lot || {}) as any;
                const lotFront = Math.max(8, Math.min(22, lot.widthM ?? rawSpacing));
                const spacingM = Math.max(8, Math.min(24, lotFront)); // permitir adensar mais
                const frontSetback = Math.max(4, Math.min(9, lot.frontSetbackM ?? 6));
                // Exigir que exista espaço útil para pelo menos meia vaga em cada extremidade
                const cornerBuffer = Math.max(spacingM * 0.5, lotFront * 0.5, 6) + 4;
                // Variedade com gradiente: mais verticais perto do centro (popLocal alto)
                const pickResidentialVariety = () => {
                    const dens = Math.max(0, Math.min(1, popLocal)); // 0..1
                    // Pesos baseados na densidade local
                    const wHouseSmall = (1 - dens) * 0.28 + dens * 0.14;
                    const wHouse      = (1 - dens) * 0.62 + dens * 0.46;
                    const wHouseHigh  = (1 - dens) * 0.06 + dens * 0.12;
                    const wApt        = (1 - dens) * 0.08 + dens * 0.24;
                    const wCondo      = (1 - dens) * 0.00 + dens * 0.03;
                    const wSchool     = (1 - dens) * 0.02 + dens * 0.015;
                    const wLeisure    = (1 - dens) * 0.02 + dens * 0.01;
                    const wChurch     = (1 - dens) * 0.02 + dens * 0.005;
                    let sum = wHouseSmall + wHouse + wHouseHigh + wApt + wCondo + wSchool + wLeisure + wChurch;
                    if (sum <= 0) sum = 1;
                    let r = Math.random() * sum;
                    if ((r -= wHouseSmall) < 0) return buildingFactory.byType((BuildingType as any).HOUSE_SMALL, timeNow);
                    if ((r -= wHouse) < 0) return buildingFactory.byType(BuildingType.HOUSE, timeNow);
                    if ((r -= wHouseHigh) < 0) return buildingFactory.byType((BuildingType as any).HOUSE_HIGH, timeNow);
                    if ((r -= wApt) < 0) return buildingFactory.byType((BuildingType as any).APARTMENT_BLOCK, timeNow);
                    if ((r -= wCondo) < 0) return buildingFactory.byType((BuildingType as any).CONDO_TOWER, timeNow);
                    if ((r -= wSchool) < 0) return buildingFactory.byType((BuildingType as any).SCHOOL, timeNow);
                    if ((r -= wLeisure) < 0) return buildingFactory.byType((BuildingType as any).LEISURE, timeNow);
                    return buildingFactory.byType((BuildingType as any).CHURCH, timeNow);
                };
                const opts = {
                    marginM: Math.max(margin, cornerBuffer),
                    spacingM,
                    setbackM: frontSetback,
                    sideSetbackM: Math.max(1.5, Math.min(4, (zc.lot?.sideSetbackM ?? 2))),
                    sideJitterM: 0.25,
                    alongJitterM: 0.15,
                    // centralizar as fileiras: começar no meio do espaço útil menos meio passo
                    startOffsetM: Math.max(0, (useful % spacingM) * 0.5),
                    staggerOppositeSide: true,
                    placeBothSides: true,
                };
                newBuildings = buildingFactory.lotsAlongSegment(pickResidentialVariety, segment, qTree!, opts, getZoneAt, timeNow);
            } else if (zone === 'commercial') {
                const len = Math.hypot(segment.r.end.x - segment.r.start.x, segment.r.end.y - segment.r.start.y);
                // Picker com variedade (sem comerciais gigantes nas fileiras)
                const pickCommercialVariety = () => {
                    const r = Math.random();
                    if (r < 0.06) return buildingFactory.byType((BuildingType as any).KIOSK, timeNow);
                    if (r < 0.12) return buildingFactory.byType((BuildingType as any).SHOP_SMALL, timeNow);
                    if (r < 0.18) return buildingFactory.byType((BuildingType as any).BAKERY, timeNow);
                    if (r < 0.24) return buildingFactory.byType((BuildingType as any).BAR, timeNow);
                    if (r < 0.29) return buildingFactory.byType((BuildingType as any).PHARMACY, timeNow);
                    if (r < 0.37) return buildingFactory.byType((BuildingType as any).GROCERY, timeNow);
                    if (r < 0.47) return buildingFactory.byType((BuildingType as any).RESTAURANT, timeNow);
                    if (r < 0.55) return buildingFactory.byType((BuildingType as any).SUPERMARKET, timeNow);
                    if (r < 0.60) return buildingFactory.byType((BuildingType as any).COMMERCIAL, timeNow);
                    if (r < 0.68) return buildingFactory.byType((BuildingType as any).COMMERCIAL_MEDIUM, timeNow);
                    if (r < 0.74) return buildingFactory.byType((BuildingType as any).OFFICE, timeNow);
                    if (r < 0.77) return buildingFactory.byType((BuildingType as any).HOTEL, timeNow);
                    if (r < 0.83) return buildingFactory.byType((BuildingType as any).PARKING, timeNow);
                    if (r < 0.86) return buildingFactory.byType((BuildingType as any).BANK, timeNow);
                    if (r < 0.89) return buildingFactory.byType((BuildingType as any).CLINIC, timeNow);
                    if (r < 0.91) return buildingFactory.byType((BuildingType as any).CINEMA, timeNow);
                    if (r < 0.93) return buildingFactory.byType((BuildingType as any).PUBLIC_OFFICE, timeNow);
                    if (r < 0.94) return buildingFactory.byType((BuildingType as any).CONVENTION_CENTER, timeNow);
                    if (r < 0.96) return buildingFactory.byType((BuildingType as any).PARK, timeNow); // pequena presença de parques na comercial
                    // Pequena presença residencial em zona comercial (misto), mantendo foco em comércio
                    if (r < 0.972) return buildingFactory.byType((BuildingType as any).HOUSE_SMALL, timeNow);
                    if (r < 0.985) return buildingFactory.byType((BuildingType as any).HOUSE, timeNow);
                    if (r < 0.992) return buildingFactory.byType((BuildingType as any).APARTMENT_BLOCK, timeNow);
                    if (r < 0.996) return buildingFactory.byType((BuildingType as any).RESIDENTIAL, timeNow);
                    return buildingFactory.byType((BuildingType as any).GAS_STATION, timeNow);
                };
                const baseSpacing = 24; // mais denso; ainda comporta tipos médios
                const margin = Math.max(10, baseSpacing * 0.6) + 4;
                const opts = {
                    marginM: margin,
                    spacingM: baseSpacing,
                    setbackM: 2,
                    sideSetbackM: 1.5,
                    sideJitterM: 0.2,
                    alongJitterM: 0.1,
                    startOffsetM: Math.max(0, (len - 2 * margin) % baseSpacing * 0.5),
                    staggerOppositeSide: false,
                    placeBothSides: true,
                };
                newBuildings = buildingFactory.lotsAlongSegment(pickCommercialVariety, segment, qTree!, opts, getZoneAt, timeNow);
            } else {
                newBuildings = buildingFactory.aroundSegment(
                    pickByAdjustedMix,
                    segment, count, radius, qTree!, getZoneAt, timeNow
                );
            }
            newBuildings.forEach(b => qTree!.insert(b.collider.limits()));
            buildings = buildings.concat(newBuildings);
        }

        // Passada final: remover quaisquer colisões residuais entre construções
        const resolved: Building[] = [];
        outer: for (const b of buildings) {
            for (const o of resolved) {
                if (b.collider.collide(o.collider)) {
                    continue outer; // descarta b em caso de conflito
                }
            }
            resolved.push(b);
        }
        buildings = resolved;

        // Garante pelo menos uma construção próxima a ruas sem saída (cul-de-sac)
        try {
            const deadEndNodes = Object.values(nodeMapForTrim).filter(n => n.entries.length === 1);
            const nearRadius = 80; // m: raio para considerar "próximo ao fim"
            const nearR2 = nearRadius * nearRadius;
            const timeNow2 = new Date().getTime();
            const setbackByZone: Record<string, number> = { downtown: 2, commercial: 2, industrial: 4, rural: 6, residential: 6 } as any;

            const hasBuildingNear = (p: Point) => buildings.some(b => {
                const dx = b.center.x - p.x; const dy = b.center.y - p.y; return dx*dx + dy*dy <= nearR2;
            });

            for (const node of deadEndNodes) {
                const P: Point = node.P;
                if (hasBuildingNear(P)) continue;
                const entry = node.entries[0];
                const seg = entry.seg;
                // direção para "dentro" da rua (afastando do fim sem saída)
                const dirVec = entry.atStart
                    ? { x: seg.r.end.x - seg.r.start.x, y: seg.r.end.y - seg.r.start.y }
                    : { x: seg.r.start.x - seg.r.end.x, y: seg.r.start.y - seg.r.end.y };
                const L = Math.hypot(dirVec.x, dirVec.y) || 1;
                const ux = dirVec.x / L, uy = dirVec.y / L;
                const nx = -uy, ny = ux;
                const w = seg.width;
                const zone = getZoneAt(P) as any;
                const baseSetback = (setbackByZone as any)[zone] ?? 4;

                // Escolher um tipo pequeno por zona para caber mais fácil
                const pickSmallByZone = () => {
                    const BT: any = BuildingType as any;
                    switch (zone) {
                        case 'residential': return buildingFactory.byType(BT.HOUSE_SMALL, timeNow2);
                        case 'commercial': return buildingFactory.byType(BT.KIOSK, timeNow2);
                        case 'industrial': return buildingFactory.byType(BT.WORKSHOP, timeNow2);
                        case 'rural': return buildingFactory.byType(BT.FARMHOUSE, timeNow2);
                        case 'downtown': default: return buildingFactory.byType(BT.SHOP_SMALL, timeNow2);
                    }
                };

                // ponto base alguns metros para dentro da rua a partir do fim
                const margin = Math.max(14, w * 0.6 + 4) + 4;
                const base: Point = { x: P.x + ux * margin, y: P.y + uy * margin };

                const tryPlace = (): Building | null => {
                    // tenta alguns tipos pequenos antes de desistir
                    const templates = [pickSmallByZone(), buildingFactory.fromZone(zone, timeNow2)];
                    for (const tmpl of templates) {
                        // clonar building template em uma instância nova simples
                        const b = buildingFactory.byType((tmpl.type as any), timeNow2);
                        b.setDir(seg.dir());
                        const halfAcross = b.diagonal * Math.sin(Math.PI * (b.aspectDegree / 180));
                        const off = (w / 2) + baseSetback + Math.max(2, halfAcross);
                        const alongStep = Math.max(6, (2 * b.diagonal * Math.cos(Math.PI * (b.aspectDegree / 180))) * 0.6);
                        const slideK = [0, 1, -1, 2, -2];
                        const sides: (1|-1)[] = [+1, -1];
                        for (const side of sides) {
                            for (const k of slideK) {
                                const px = base.x + ux * (alongStep * k);
                                const py = base.y + uy * (alongStep * k);
                                const cx = px + nx * off * side;
                                const cy = py + ny * off * side;
                                b.setCenter({ x: cx, y: cy });
                                // colisão simples com quadtree + locais
                                let collisions = 0;
                                const bounds = b.collider.limits();
                                const cands: any[] = qTree!.retrieve(bounds);
                                const locals = buildings.filter(ob => {
                                    const lim = ob.collider.limits();
                                    return !(lim.x + lim.width < bounds.x || bounds.x + bounds.width < lim.x || lim.y + lim.height < bounds.y || bounds.y + bounds.height < lim.y);
                                });
                                for (const obj of [...cands, ...locals]) {
                                    const other = (obj as any).o || obj;
                                    if (other === b) continue;
                                    if (b.collider.collide(other.collider)) { collisions++; break; }
                                }
                                if (collisions === 0) {
                                    return b;
                                }
                            }
                        }
                    }
                    return null;
                };

                const placed = tryPlace();
                if (placed) {
                    buildings.push(placed);
                    qTree!.insert(placed.collider.limits());
                }
            }
        } catch {}

    if (rebuildBuildings) buildings.forEach(building => {
            // Espaço verde (lote vazio): não desenhar, mas manter ocupação espacial
            if ((building.type as any) === 'green') {
                return;
            }
            const colorByType: Record<string, number> = {
                house: 0xE0F7FA,
                houseSmall: 0xD0F0F8,
                houseHigh: 0xB3E5FC,
                apartmentBlock: 0x90CAF9,
                condoTower: 0x64B5F6,
                school: 0xA5D6A7,
                leisureArea: 0xAED581,
                residential: 0x90CAF9,
                commercial: 0xFFE082,
                commercialMedium: 0xFFD54F,
                commercialLarge: 0xFFB300,
                kiosk: 0xFFF3E0,
                shopSmall: 0xFFE0B2,
                bakery: 0xFFD180,
                restaurant: 0xFFCC80,
                bar: 0xFFAB91,
                pharmacy: 0xE6EE9C,
                grocery: 0xDCEDC8,
                supermarket: 0xFFB74D,
                shoppingCenter: 0xFFA000,
                cinema: 0x9FA8DA,
                office: 0x81D4FA,
                hotel: 0x80DEEA,
                conventionCenter: 0x90CAF9,
                parkingLot: 0xB0BEC5,
                gasStation: 0xFF8A80,
                bank: 0xFFE0B2,
                clinic: 0xC5CAE9,
                hospitalPrivate: 0x9FA8DA,
                publicOffice: 0xB39DDB,
                park: 0xC8E6C9,
                church: 0xD1C4E9,
                import: 0xCE93D8,
                factory: 0xB39DDB,
                warehouseSmall: 0xB0A8D9,
                factoryMedium: 0x9E9DCD,
                distributionCenter: 0x8C9ACD,
                industrialComplex: 0x7E57C2,
                workshop: 0xB388FF,
                powerPlant: 0x5E35B1,
                farm: 0x81C784,
                farmhouse: 0xA5D6A7,
                silo: 0xC5E1A5,
                animalBarn: 0x9CCC65,
                machineryShed: 0x8BC34A,
                cooperative: 0x66BB6A,
                field: 0xAED581,
                pond: 0x4FC3F7,
            };
            const fill = colorByType[(building.type as any)] ?? 0x0C161F;
            const g = new PIXI.Graphics().beginFill(fill).lineStyle(5, 0x555555, 0.7);
            const c0 = worldToIso(building.corners[0]);
            g.moveTo(c0.x, c0.y);
            building.corners.slice(1).forEach(c => {
                const p = worldToIso(c);
                g.lineTo(p.x, p.y);
            });
            g.lineTo(c0.x, c0.y);
            dynamicDrawables.current?.addChild(g);
        });

    // Removido overlay de zonas em tiles (agora usamos canvas overlay Perlin)

        // Desenhar vias (preenchimento) sempre visível
        roadsFill.current?.removeChildren();
            if ((config as any).render.useArcToSmoothing) {
                // Novo: aplicar mesmos fillets dentro do preenchimento
                const container = new PIXI.Container();
                const radiusFactor = (config as any).render.sharpAngleRadiusFactor || 2.0;
                // Retângulos (trim)
                segments.forEach(segment => {
                    const tr = trimMap.get(segment) || { start: 0, end: 0 };
                    container.addChild(drawRoundedSegment(segment, (config as any).render.baseRoadColor ?? 0xA1AFA9, segment.width, tr.start, tr.end, 'butt', 'butt'));
                });
                // Do not add fillet/dia mond shapes into the fill — draw only rounded segments.
                // This avoids creating the 'cross' shaped diamonds at intersections.
                roadsFill.current?.addChild(container);
            } else {
                segments.forEach(segment => {
                    const tr = trimMap.get(segment) || { start: 0, end: 0 };
                    roadsFill.current?.addChild(drawRoundedSegment(segment, (config as any).render.baseRoadColor ?? 0xA1AFA9, segment.width, tr.start, tr.end, 'butt', 'butt'));
                });
            }
        // Desenhar camada secundária de vias (overlay) se habilitada
        drawSecondaryRoadLayer(segments);
        // Aplicar overlay de faixas nas vias se houver textura definida
        try {
            // Recycle tiling sprites currently on the overlay into the pool to avoid
            // destroying textures and reduce allocations.
            try {
                const ov = roadLaneOverlay.current;
                if (ov) {
                    for (const ch of [...ov.children]) {
                        try {
                            // direct tiling sprite child -> release to pool
                            if ((ch as any) instanceof PIXI.TilingSprite) {
                                releaseMarkerTile(ch as PIXI.TilingSprite);
                            } else if ((ch as any) instanceof PIXI.Container) {
                                // container child may hold a masked tiling sprite; release any nested tiling sprites
                                try {
                                    for (const sub of [...(ch as PIXI.Container).children]) {
                                        try {
                                            if ((sub as any) instanceof PIXI.TilingSprite) {
                                                releaseMarkerTile(sub as PIXI.TilingSprite);
                                            } else if ((sub as any).parent) {
                                                sub.parent.removeChild(sub);
                                            }
                                        } catch (e) {}
                                    }
                                } catch (e) {}
                                try { if (ch.parent) ch.parent.removeChild(ch); } catch (e) {}
                            } else if (ch.parent) {
                                ch.parent.removeChild(ch);
                            }
                        } catch (e) {}
                    }
                }
                // also clear any cached union container
                if (laneMarkerCacheRef.current && laneMarkerCacheRef.current.container) {
                    laneMarkerCacheRef.current.container = null;
                }
                laneMarkerContainerRef.current = null;
            } catch (e) {}
            const cfg = (config as any).render;
            // compute lane polygons and bbox regardless of texture presence so outlines can be drawn
            const lanePolys: Array<Array<{ x:number; y:number }>> = [];
            let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
            const laneWidthM = cfg.roadLaneWidthM ?? 0.6;
            segments.forEach(segment => {
                const sW = segment.r.start; const eW = segment.r.end;
                const vx = eW.x - sW.x, vy = eW.y - sW.y; const L = Math.hypot(vx, vy) || 1;
                const ux = vx / L, uy = vy / L; const nx = -uy, ny = ux;
                const r = laneWidthM / 2;
                const p1 = { x: sW.x + nx * r, y: sW.y + ny * r };
                const p2 = { x: sW.x - nx * r, y: sW.y - ny * r };
                const p3 = { x: eW.x - nx * r, y: eW.y - ny * r };
                const p4 = { x: eW.x + nx * r, y: eW.y + ny * r };
                const poly = [p1, p2, p3, p4].map(pt => worldToIso(pt));
                if (poly.length > 2) {
                    lanePolys.push(poly);
                    poly.forEach(p => { minX = Math.min(minX, p.x); minY = Math.min(minY, p.y); maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y); });
                }
            });

            // If a texture was provided, treat it as the marker texture (fill for each marker)
            // Instead of creating a sprite per marker, build a mask from the exact marker contours
            // (rectangle polygons) and then add a single TilingSprite masked to that union. This
            // both ensures the texture respects marker contours and greatly reduces sprite count.
            const markerTex = roadLaneTextureRef.current || null;
            try { console.debug('[LaneMarkers] markerTex present=', !!markerTex, 'lanePolys=', lanePolys.length); } catch (e) {}
            // If we have a marker texture, create one TilingSprite per rectangle
            // (reusing from pool). This keeps behavior simple: one image fills each
            // rectangle exactly as you requested.
            if (markerTex && lanePolys.length > 0) {
                const markerW = (cfg.laneMarkerWidthM && isFinite(cfg.laneMarkerWidthM)) ? cfg.laneMarkerWidthM : 0.5;
                const markerL = (cfg.laneMarkerLengthM && isFinite(cfg.laneMarkerLengthM)) ? cfg.laneMarkerLengthM : 1.0;
                const gap = (cfg.laneMarkerGapM && isFinite(cfg.laneMarkerGapM)) ? cfg.laneMarkerGapM : 0.5;
                const step = markerL + gap;
                // Estimate number of markers to decide if we should fallback to a single masked tiling sprite
                let estimatedCount = 0;
                let fallbackUsed = false;
                for (const segment of segments) {
                    const a = segment.r.start; const b = segment.r.end;
                    const segLen = Math.hypot(b.x - a.x, b.y - a.y) || 1;
                    estimatedCount += Math.max(0, Math.floor(segLen / step));
                }
                const FALLBACK_COUNT = 4000; // heuristic threshold (tunable)
                // Debug: log estimated count and threshold so we can measure behavior in-browser
                try {
                    console.debug('[LaneMarkers] estimatedCount=', estimatedCount, 'FALLBACK_COUNT=', FALLBACK_COUNT);
                } catch (e) {}

                if (estimatedCount > FALLBACK_COUNT) {
                    // Fallback: build a single mask composed of all marker rectangles and
                    // add one TilingSprite that is masked to that union. This avoids creating
                    // thousands of sprites and keeps texture clipped to markers.
                    try {
                        const maskG = new PIXI.Graphics();
                        maskG.beginFill(0xFFFFFF);
                        let minXf = Infinity, minYf = Infinity, maxXf = -Infinity, maxYf = -Infinity;
                        for (const segment of segments) {
                            const a = segment.r.start; const b = segment.r.end;
                            const vx = b.x - a.x, vy = b.y - a.y; const segLen = Math.hypot(vx, vy) || 1;
                            const ux = vx / segLen, uy = vy / segLen; const nx = -uy, ny = ux;
                            let pos = 0;
                            while (pos + markerL <= segLen + 1e-6) {
                                const centerOffset = pos + markerL / 2;
                                const cx = a.x + ux * centerOffset;
                                const cy = a.y + uy * centerOffset;
                                const halfL = markerL / 2; const halfW = markerW / 2;
                                const p1 = { x: cx + ux * halfL + nx * halfW, y: cy + uy * halfL + ny * halfW };
                                const p2 = { x: cx + ux * halfL - nx * halfW, y: cy + uy * halfL - ny * halfW };
                                const p3 = { x: cx - ux * halfL - nx * halfW, y: cy - uy * halfL - ny * halfW };
                                const p4 = { x: cx - ux * halfL + nx * halfW, y: cy - uy * halfL + ny * halfW };
                                const ip1 = worldToIso(p1); const ip2 = worldToIso(p2); const ip3 = worldToIso(p3); const ip4 = worldToIso(p4);
                                maskG.moveTo(ip1.x, ip1.y);
                                maskG.lineTo(ip2.x, ip2.y);
                                maskG.lineTo(ip3.x, ip3.y);
                                maskG.lineTo(ip4.x, ip4.y);
                                maskG.closePath();
                                [ip1, ip2, ip3, ip4].forEach(p => { minXf = Math.min(minXf, p.x); minYf = Math.min(minYf, p.y); maxXf = Math.max(maxXf, p.x); maxYf = Math.max(maxYf, p.y); });
                                pos += step;
                            }
                        }
                        maskG.endFill();
                        if (isFinite(minXf) && isFinite(minYf) && maxXf > minXf && maxYf > minYf) {
                            const w = Math.max(4, Math.ceil(maxXf - minXf));
                            const h = Math.max(4, Math.ceil(maxYf - minYf));
                            const sprite = new PIXI.TilingSprite(markerTex, w, h);
                            const scaleVal = (typeof roadLaneScaleRef.current === 'number' && isFinite(roadLaneScaleRef.current)) ? Math.max(0.000001, roadLaneScaleRef.current) : 1.0;
                            if (scaleVal && sprite.tileScale) sprite.tileScale.set(scaleVal, scaleVal);
                            sprite.alpha = (typeof roadLaneAlphaRef.current === 'number') ? roadLaneAlphaRef.current : 1.0;
                            // container positioned at minXf,minYf so mask and sprite share local coords
                            const container = new PIXI.Container();
                            container.x = minXf; container.y = minYf;
                            sprite.x = 0; sprite.y = 0;
                            // offset mask into local coords
                            const localMask = new PIXI.Graphics();
                            try {
                                // translate mask geometry by -minXf/-minYf
                                // naive approach: draw mask shapes into localMask using same rects offset
                                localMask.beginFill(0xFFFFFF);
                                for (const segment of segments) {
                                    const a = segment.r.start; const b = segment.r.end;
                                    const vx = b.x - a.x, vy = b.y - a.y; const segLen = Math.hypot(vx, vy) || 1;
                                    const ux = vx / segLen, uy = vy / segLen; const nx = -uy, ny = ux;
                                    let pos = 0;
                                    while (pos + markerL <= segLen + 1e-6) {
                                        const centerOffset = pos + markerL / 2;
                                        const cx = a.x + ux * centerOffset;
                                        const cy = a.y + uy * centerOffset;
                                        const halfL = markerL / 2; const halfW = markerW / 2;
                                        const p1 = worldToIso({ x: cx + ux * halfL + nx * halfW, y: cy + uy * halfL + ny * halfW });
                                        const p2 = worldToIso({ x: cx + ux * halfL - nx * halfW, y: cy + uy * halfL - ny * halfW });
                                        const p3 = worldToIso({ x: cx - ux * halfL - nx * halfW, y: cy - uy * halfL - ny * halfW });
                                        const p4 = worldToIso({ x: cx - ux * halfL + nx * halfW, y: cy - uy * halfL + ny * halfW });
                                        localMask.moveTo(p1.x - minXf, p1.y - minYf);
                                        localMask.lineTo(p2.x - minXf, p2.y - minYf);
                                        localMask.lineTo(p3.x - minXf, p3.y - minYf);
                                        localMask.lineTo(p4.x - minXf, p4.y - minYf);
                                        localMask.closePath();
                                        pos += step;
                                    }
                                }
                                localMask.endFill();
                            } catch (e) { try { localMask.endFill(); } catch (e) {} }
                            container.addChild(sprite);
                            container.addChild(localMask);
                            container.mask = localMask;
                            roadLaneOverlay.current?.addChild(container);
                            fallbackUsed = true;
                            try { console.debug('[LaneMarkers] fallbackUsed=true, overlayChildren=', roadLaneOverlay.current?.children.length); } catch (e) {}
                        }
                    } catch (e) {
                        // if fallback fails, silently continue to try per-rectangle below
                    }
                } else {
                    try { console.debug('[LaneMarkers] fallbackUsed=false, estimatedCount=', estimatedCount); } catch (e) {}
                    // normal per-rectangle path (below)
                }
                if (!fallbackUsed) {
                for (const segment of segments) {
                    const a = segment.r.start; const b = segment.r.end;
                    const vx = b.x - a.x, vy = b.y - a.y; const segLen = Math.hypot(vx, vy) || 1;
                    const ux = vx / segLen, uy = vy / segLen; // along
                    const nx = -uy, ny = ux; // normal
                    let pos = 0;
                    while (pos + markerL <= segLen + 1e-6) {
                        const centerOffset = pos + markerL / 2;
                        const cx = a.x + ux * centerOffset;
                        const cy = a.y + uy * centerOffset;
                        const halfL = markerL / 2; const halfW = markerW / 2;
                        const p1 = { x: cx + ux * halfL + nx * halfW, y: cy + uy * halfL + ny * halfW };
                        const p2 = { x: cx + ux * halfL - nx * halfW, y: cy + uy * halfL - ny * halfW };
                        const p3 = { x: cx - ux * halfL - nx * halfW, y: cy - uy * halfL - ny * halfW };
                        const p4 = { x: cx - ux * halfL + nx * halfW, y: cy - uy * halfL + ny * halfW };
                        const ip1 = worldToIso(p1); const ip2 = worldToIso(p2); const ip3 = worldToIso(p3); const ip4 = worldToIso(p4);
                        // compute screen-space size and center
                        const localCenterX = (ip1.x + ip2.x + ip3.x + ip4.x) / 4;
                        const localCenterY = (ip1.y + ip2.y + ip3.y + ip4.y) / 4;
                        const wPx = Math.hypot(ip2.x - ip1.x, ip2.y - ip1.y);
                        const hPx = Math.hypot(ip3.x - ip2.x, ip3.y - ip2.y);
                        const tile = acquireMarkerTile(Math.max(1, wPx), Math.max(1, hPx), markerTex);
                        tile.anchor && tile.anchor.set && tile.anchor.set(0.5, 0.5);
                        tile.x = localCenterX;
                        tile.y = localCenterY;
                        const angle = Math.atan2(ip2.y - ip1.y, ip2.x - ip1.x);
                        tile.rotation = angle;
                        const tileScale = (typeof roadLaneScaleRef.current === 'number' && isFinite(roadLaneScaleRef.current)) ? Math.max(0.000001, roadLaneScaleRef.current) : 1.0;
                        tile.tileScale.set(tileScale, tileScale);
                        tile.alpha = (typeof roadLaneAlphaRef.current === 'number') ? roadLaneAlphaRef.current : 1.0;
                        roadLaneOverlay.current?.addChild(tile);
                        pos += step;
                    }
                }
                }
            }

            // Draw outlines independent of texture presence if requested
            try {
                roadLaneOutlines.current?.removeChildren();
                if (cfg.showLaneOutlines && lanePolys.length > 0) {
                    // Removed: do not draw a solid black outline around lane polygons per user request.
                    // If future styling is needed, add it here (e.g. subtle highlight).

                    // Add rectangular markers along each segment: 0.5m width x 1.0m length,
                    // spaced 0.5m apart. Drawn as filled white rectangles centered on the
                    // segment centerline and rotated to match segment orientation.
                    try {
                        // outlines-only pass when no texture exists; otherwise tiles were added above
                        if (!markerTex) {
                            const markerW = (cfg.laneMarkerWidthM && isFinite(cfg.laneMarkerWidthM)) ? cfg.laneMarkerWidthM : 0.5;
                            const markerL = (cfg.laneMarkerLengthM && isFinite(cfg.laneMarkerLengthM)) ? cfg.laneMarkerLengthM : 1.0;
                            const gap = (cfg.laneMarkerGapM && isFinite(cfg.laneMarkerGapM)) ? cfg.laneMarkerGapM : 0.5;
                            const markerColor = (typeof cfg.laneMarkerColor === 'number') ? cfg.laneMarkerColor : 0xFFFFFF;
                            const step = markerL + gap;
                            segments.forEach(segment => {
                                const a = segment.r.start; const b = segment.r.end;
                                const vx = b.x - a.x, vy = b.y - a.y; const segLen = Math.hypot(vx, vy) || 1;
                                const ux = vx / segLen, uy = vy / segLen; // along segment
                                const nx = -uy, ny = ux; // normal
                                let pos = 0;
                                while (pos + markerL <= segLen + 1e-6) {
                                    const centerOffset = pos + markerL / 2;
                                    const cx = a.x + ux * centerOffset;
                                    const cy = a.y + uy * centerOffset;
                                    const halfL = markerL / 2; const halfW = markerW / 2;
                                    const p1 = { x: cx + ux * halfL + nx * halfW, y: cy + uy * halfL + ny * halfW };
                                    const p2 = { x: cx + ux * halfL - nx * halfW, y: cy + uy * halfL - ny * halfW };
                                    const p3 = { x: cx - ux * halfL - nx * halfW, y: cy - uy * halfL - ny * halfW };
                                    const p4 = { x: cx - ux * halfL + nx * halfW, y: cy - uy * halfL + ny * halfW };
                                    const ip1 = worldToIso(p1); const ip2 = worldToIso(p2); const ip3 = worldToIso(p3); const ip4 = worldToIso(p4);
                                    const mg = new PIXI.Graphics();
                                    const targetPx = 0.1;
                                    const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) ? window.devicePixelRatio : 1;
                                    const denom = Math.max(0.0001, (state.zoom || 1) * dpr);
                                    const strokeW = Math.max(0.02, targetPx / denom);
                                    mg.lineStyle(strokeW, markerColor, 1.0);
                                    mg.moveTo(ip1.x, ip1.y);
                                    mg.lineTo(ip2.x, ip2.y);
                                    mg.lineTo(ip3.x, ip3.y);
                                    mg.lineTo(ip4.x, ip4.y);
                                    mg.closePath();
                                    roadLaneOutlines.current?.addChild(mg);
                                    pos += step;
                                }
                            });
                        }
                    } catch (e) { /* non-fatal if marker drawing fails */ }
                }
            } catch (e) { /* ignore outline errors */ }
        } catch (e) {
            // non-fatal
        }
    // Desenhar overlay estilizado adicional
    drawOverlayRoadLayer(segments);
    drawCrackedRoads(segments);
        // ...existing code...

        // Contornos conforme modo atual
        drawRoadOutlines();
    // Patches de interseção (independentes da visibilidade do contorno externo)
    drawIntersectionPatches();

    // Desenhar quarteirões com esquinas curvas (integrado abaixo com polígonos reais)

        // Desenhar contornos de QUARTEIRÕES reais (áreas delimitadas pelas vias)
        if (blockOutlines.current) {
            blockOutlines.current.removeChildren();
            const CLIP_SCALE = (config as any).render.clipperScale ?? 100;
            const showOnlyInteriors = !!(config as any).render.showOnlyBlockInteriors;

            // 1. Converter todos os segmentos de via em polígonos para o Clipper
            const roadPolygons = segments.map(segment => {
                const w = segment.width;
                const r = w / 2;
                const sW = segment.r.start;
                const eW = segment.r.end;
                const vx = eW.x - sW.x, vy = eW.y - sW.y;
                const len = Math.hypot(vx, vy) || 1;
                const ux = vx / len, uy = vy / len;
                const nx = -uy, ny = ux; // normal

                const p1 = { x: sW.x + nx * r, y: sW.y + ny * r };
                const p2 = { x: sW.x - nx * r, y: sW.y - ny * r };
                const p3 = { x: eW.x - nx * r, y: eW.y - ny * r };
                const p4 = { x: eW.x + nx * r, y: eW.y + ny * r };

                return [
                    { X: p1.x * CLIP_SCALE, Y: p1.y * CLIP_SCALE },
                    { X: p4.x * CLIP_SCALE, Y: p4.y * CLIP_SCALE },
                    { X: p3.x * CLIP_SCALE, Y: p3.y * CLIP_SCALE },
                    { X: p2.x * CLIP_SCALE, Y: p2.y * CLIP_SCALE },
                ];
            });

            // 2. Unir todos os polígonos de via em uma PolyTree.
            // A PolyTree nos dará a hierarquia de polígonos, permitindo identificar os buracos (quarteirões).
            const cpr = new ClipperLib.Clipper();
            const unionPolyTree = new ClipperLib.PolyTree();
            cpr.AddPaths(roadPolygons, ClipperLib.PolyType.ptSubject, true);
            cpr.Execute(ClipperLib.ClipType.ctUnion, unionPolyTree, ClipperLib.PolyFillType.pftNonZero, ClipperLib.PolyFillType.pftNonZero);

            // 3. Extrair os "buracos" da PolyTree. Estes são os nossos quarteirões.
            const blockPaths = new ClipperLib.Paths();
            const topNodes = unionPolyTree.Childs();
            for (const topNode of topNodes) {
                // Os filhos diretos da união são os contornos externos das redes de ruas.
                // Os filhos DESTES nós (netos da raiz) são os buracos que queremos.
                const holeNodes = topNode.Childs();
                for (const holeNode of holeNodes) {
                    if (holeNode.IsHole()) {
                        blockPaths.push(holeNode.Contour());
                    }
                }
            }
            
            const insideBlocks = blockPaths;
            const cornerRadiusM = Math.max(0, (config as any).render.blockCornerRadiusM ?? 0);
            const roundedBlocks = computeRoundedBlockPolygons(insideBlocks, cornerRadiusM, CLIP_SCALE);
            const blockWorldPaths = roundedBlocks.world;
            const blockClipperPaths = roundedBlocks.clipper;

            // Se o modo "apenas interiores" estiver ativo, desenhe-os com um recuo e retorne.
            if (showOnlyInteriors) {
                // Garantir limpeza das bandas caso estivéssemos exibindo antes
                blockEdgeBands.current?.removeChildren();
                // Limpar outras camadas para focar apenas nos quarteirões
                roadsFill.current?.removeChildren();
                roadOutlines.current?.removeChildren();
                dynamicDrawables.current?.removeChildren();

                const g = new PIXI.Graphics();
                const gap = (config as any).render.blockInteriorGapM;

                // Aplicar um recuo (inset) se houver um gap configurado
                let pathsToDraw = blockClipperPaths;
                if (gap > 0 && blockClipperPaths.length > 0) {
                    const co = new ClipperLib.ClipperOffset();
                    co.AddPaths(blockClipperPaths, ClipperLib.JoinType.jtRound, ClipperLib.EndType.etClosedPolygon);
                    const insetPaths = new ClipperLib.Paths();
                    co.Execute(insetPaths, -gap * CLIP_SCALE);
                    pathsToDraw = insetPaths;
                }

                const worldPathsToDraw: Point[][] = (gap > 0)
                    ? pathsToDraw.map((path: any) => path.map((p: any) => ({ x: p.X / CLIP_SCALE, y: p.Y / CLIP_SCALE })))
                    : blockWorldPaths;

                // Desenhar os polígonos resultantes
                worldPathsToDraw.forEach((worldPts: Point[]) => {
                    const points = worldPts.map(p => worldToIso(p));
                    if (points.length > 2) {
                        const useTex = !!(config as any).render.blockInteriorUseTexture && interiorTexture;
                        if (useTex) {
                            try {
                                const scale = (config as any).render.blockInteriorTextureScale || 1.0;
                                const alpha = (config as any).render.blockInteriorTextureAlpha ?? 1.0;
                                const tint = (config as any).render.blockInteriorTextureTint ?? 0xFFFFFF;
                                const matrix = new PIXI.Matrix();
                                if (scale !== 1) matrix.scale(scale, scale);
                                g.beginTextureFill({ texture: interiorTexture!, alpha, matrix });
                                g.tint = tint;
                            } catch (e) {
                                g.beginFill(0x4CAF50);
                            }
                        } else {
                            g.beginFill(0x4CAF50); // fallback verde
                        }
                        g.drawPolygon(points);
                        g.endFill();
                    }
                });

                blockOutlines.current.addChild(g);
                return; // Pula o resto do desenho que não é necessário neste modo
            }

            // Lógica de desenho para o modo normal (fundo cinza, quarteirões verdes)
            // Criar gráficos locais para interior e bandas (evita uso acidental de variáveis de outro escopo)
            const gInner = new PIXI.Graphics();
            const gBands = new PIXI.Graphics();
            const roadGapM = (config as any).render.roadGapM ?? 2.0;
            // Extrai todos os contornos da PolyTree manualmente
            const extractContours = (polyTree: any): any[] => {
                const contours: any[] = [];
                const walk = (node: any) => {
                    if (node && node.Contour && node.Contour().length > 2) {
                        contours.push(node.Contour());
                    }
                    if (node && node.Childs) {
                        const childs = node.Childs();
                        for (let i = 0; i < childs.length; i++) {
                            walk(childs[i]);
                        }
                    }
                };
                walk(polyTree);
                return contours;
            };
            const roadUnionPaths = extractContours(unionPolyTree);

            // Expandir a união das ruas para criar a área do "gap"
            const co = new ClipperLib.ClipperOffset();
            co.AddPaths(roadUnionPaths, ClipperLib.JoinType.jtRound, ClipperLib.EndType.etClosedPolygon);
            const expandedPaths = new ClipperLib.Paths();
            co.Execute(expandedPaths, roadGapM * CLIP_SCALE);

            // Subtrair a união original da união expandida para obter apenas o "gap"
            const gapFillerClipper = new ClipperLib.Clipper();
            const gapFillerPaths = new ClipperLib.Paths();
            gapFillerClipper.AddPaths(expandedPaths, ClipperLib.PolyType.ptSubject, true);
            gapFillerClipper.AddPaths(roadUnionPaths, ClipperLib.PolyType.ptClip, true);
            gapFillerClipper.Execute(ClipperLib.ClipType.ctDifference, gapFillerPaths, ClipperLib.PolyFillType.pftNonZero, ClipperLib.PolyFillType.pftNonZero);

            const g = new PIXI.Graphics();

            // Desenhar o preenchimento do gap usando cor configurável (Camada 4)
            const gapFillColor = (config as any).render.gapFillColor ?? 0x616161;
            gapFillerPaths.forEach((path: any) => {
                const points = path.map((p: any) => worldToIso({ x: p.X / CLIP_SCALE, y: p.Y / CLIP_SCALE }));
                if (points.length > 2) {
                    gInner.beginFill(gapFillColor); // Gap
                    gInner.drawPolygon(points);
                    gInner.endFill();
                }
            });

            // Desenhar o interior dos quarteirões em verde
            // Sombra dos quarteirões (se habilitada) - desenhada ANTES dos próprios quarteirões
            // Nota: suporte a sombra de quarteirões mantido como código comentado
            // Para remover completamente a lógica, o bloco foi convertido em no-op.
            // Se precisar reativar, defina (config.render.blockShadowEnabled = true)
            // e remova o `false &&` abaixo.
            const rCfg = (config as any).render;
            if (false && rCfg.blockShadowEnabled) {
                const rCfg = (config as any).render;
                const shadowContainer = new PIXI.Graphics();
                const off = rCfg.blockShadowOffsetPx || { x: 6, y: 6 };
                const scol = rCfg.blockShadowColor ?? 0x000000;
                const salpha = rCfg.blockShadowAlpha ?? 0.2;
                shadowContainer.alpha = salpha;
                blockWorldPaths.forEach((worldPts: Point[]) => {
                    const points = worldPts.map(p => {
                        const iso = worldToIso(p);
                        return { x: iso.x + off.x, y: iso.y + off.y };
                    });
                    if (points.length > 2) {
                        shadowContainer.beginFill(scol);
                        shadowContainer.drawPolygon(points);
                        shadowContainer.endFill();
                    }
                });
                gInner.addChild(shadowContainer);
            }

            blockWorldPaths.forEach((worldPts: Point[]) => {
                const points = worldPts.map(p => worldToIso(p));
                if (points.length > 2) {
                    const useTex = !!(config as any).render.blockInteriorUseTexture && interiorTexture;
                    if (useTex) {
                        try {
                            const scale = (config as any).render.blockInteriorTextureScale || 1.0;
                            const alpha = (config as any).render.blockInteriorTextureAlpha ?? 1.0;
                            const tint = (config as any).render.blockInteriorTextureTint ?? 0xFFFFFF;
                            const matrix = new PIXI.Matrix();
                            if (scale !== 1) matrix.scale(scale, scale);
                            gInner.beginTextureFill({ texture: interiorTexture!, alpha, matrix });
                            gInner.tint = tint;
                        } catch (e) {
                            gInner.beginFill(0x4CAF50);
                        }
                    } else {
                        // fallback: usar textura procedural de grama se disponível
                        const tex = interiorTexture || localGrassTexture.current;
                        if (tex) {
                            try {
                                const scale = (config as any).render.blockInteriorTextureScale || 1.0;
                                const alpha = (config as any).render.blockInteriorTextureAlpha ?? 1.0;
                                const tint = (config as any).render.blockInteriorTextureTint ?? 0xFFFFFF;
                                const matrix = new PIXI.Matrix();
                                if (scale !== 1) matrix.scale(scale, scale);
                                gInner.beginTextureFill({ texture: tex, alpha, matrix });
                                gInner.tint = tint;
                            } catch (e) {
                                gInner.beginFill(0x4CAF50);
                            }
                        } else {
                            gInner.beginFill(0x4CAF50); // fallback verde
                        }
                    }
                    gInner.drawPolygon(points);
                    gInner.endFill();
                    // Desenhar bandas perimetrais (faixas de 10 cm) se habilitado
                    if (rCfg.blockEdgeBandsEnabled) {
                        const thicknessM = rCfg.blockEdgeBandThicknessM ?? 2.5; // primeira banda
                        const bandColor = rCfg.blockEdgeBandColor ?? 0x333333;
                        const bandAlpha = rCfg.blockEdgeBandAlpha ?? 1.0;
                        const secondEnabled = !!rCfg.blockEdgeBandSecondEnabled;
                        const thickness2M = rCfg.blockEdgeBand2ThicknessM ?? 1.0;
                        const band2Alpha = rCfg.blockEdgeBand2Alpha ?? bandAlpha;
                        // Determinar orientação do polígono (para garantir normal externa correta)
                        let area2 = 0;
                        for (let i = 0; i < worldPts.length; i++) {
                            const p = worldPts[i];
                            const q = worldPts[(i + 1) % worldPts.length];
                            area2 += p.x * q.y - q.x * p.y;
                        }
                        const clockwise = area2 < 0; // negativo => CW
                        const excluded = new Set(rCfg.blockEdgeBandExcludedFaces || []);
                        const verticalCapsGlobal = !!rCfg.blockEdgeBandVerticalCaps;
                        const primaryIso = !!rCfg.blockEdgeBandPrimaryIsometric; // se true, primeira banda ignora verticalCaps
                        for (let i = 0; i < worldPts.length; i++) {
                            const a = worldPts[i];
                            const b = worldPts[(i + 1) % worldPts.length];
                            const dx = b.x - a.x;
                            const dy = b.y - a.y;
                            const length = Math.hypot(dx, dy);
                            if (length < 1e-6) continue;
                            // Normal externa (sempre calculada para classificar a face)
                            let nx = -dy / length, ny = dx / length; // CCW
                            if (clockwise) { nx = dy / length; ny = -dx / length; }
                            // Determinar face aproximada a partir do normal dominante
                            let face: string;
                            const absNx = Math.abs(nx);
                            const absNy = Math.abs(ny);
                            if (absNx >= absNy) {
                                face = nx > 0 ? 'L' : 'O';
                            } else {
                                face = ny > 0 ? 'N' : 'S';
                            }
                            if (excluded.has(face)) continue; // pular faces excluídas
                            if (!(verticalCapsGlobal && !primaryIso)) {
                                const offset = thicknessM;
                                const aOff = { x: a.x + nx * offset, y: a.y + ny * offset };
                                const bOff = { x: b.x + nx * offset, y: b.y + ny * offset };
                                const ia = worldToIso(a);
                                const ib = worldToIso(b);
                                const iao = worldToIso(aOff);
                                const ibo = worldToIso(bOff);
                                // Cor específica por face (se existir) senão cor base
                                const faceColors = rCfg.blockEdgeBandFaceColors || {};
                                const faceColor = faceColors[face as 'N'|'S'|'L'|'O'] ?? bandColor;
                                // Desenhar preenchimento
                                gBands.beginFill(faceColor, bandAlpha);
                                // Desenhar contorno usando cor de contorno de estrada se disponível,
                                // caso contrário, usar uma versão escura da cor da banda
                                const outlineColor = (rCfg.roadOutlineColor !== undefined) ? (rCfg.roadOutlineColor as number) : ((faceColor & 0xFFFFFF) * 0.72 >>> 0);
                                // Linha fina para contorno (1 px) com alpha parecido — desenhar somente se habilitado
                                if ((rCfg as any).blockEdgeBandOutlineEnabled) {
                                    gBands.lineStyle(0.1, outlineColor, Math.min(1, bandAlpha + 0.0));
                                } else {
                                    gBands.lineStyle(0, 0, 0, 0);
                                }
                                gBands.drawPolygon([ia.x, ia.y, ib.x, ib.y, ibo.x, ibo.y, iao.x, iao.y]);
                                gBands.endFill();
                                // Linhas paralelas internas (paralelas à aresta), espaçadas por configuração
                                try {
                                    const innerEnabled = !!rCfg.blockEdgeBandInnerLinesEnabled;
                                    const innerInterval = (rCfg.blockEdgeBandInnerLineIntervalM && rCfg.blockEdgeBandInnerLineIntervalM > 0) ? rCfg.blockEdgeBandInnerLineIntervalM : 3.0;
                                    const innerColor = (rCfg.blockEdgeBandInnerLineColor !== undefined) ? (rCfg.blockEdgeBandInnerLineColor as number) : 0x7F7F7F;
                                    const innerStroke = (rCfg.blockEdgeBandInnerLineStrokePx && rCfg.blockEdgeBandInnerLineStrokePx > 0) ? rCfg.blockEdgeBandInnerLineStrokePx : 1;
                                    if (innerEnabled && length > 0.001) {
                                        // percorre a aresta no espaço mundial e desenha linhas paralelas deslocadas para dentro da banda
                                        const total = length;
                                        // distância do bordo interno (metade da espessura) para posicionar a primeira linha
                                        const halfBand = thicknessM * 0.5;
                                        for (let s = innerInterval; s < total; s += innerInterval) {
                                            const t = s / total;
                                            const wx = a.x + dx * t;
                                            const wy = a.y + dy * t;
                                            // ponto central na aresta projetado
                                            const centerScreen = worldToIso({ x: wx, y: wy });
                                            // deslocar para dentro da banda um pouco (normal * halfBand)
                                            const innerWorld = { x: wx + nx * (halfBand * 0.5), y: wy + ny * (halfBand * 0.5) };
                                            const innerScreen = worldToIso(innerWorld);
                                            // direção ao longo da aresta em tela
                                            const screenA = worldToIso(a);
                                            const screenB = worldToIso(b);
                                            const sx = screenB.x - screenA.x; const sy = screenB.y - screenA.y;
                                            const sLen = Math.hypot(sx, sy) || 1;
                                            const ux = sx / sLen, uy = sy / sLen;
                                            // comprimento da linha interna: um pouco menor que a banda em tela
                                            const lineLen = Math.max(8, Math.round((thicknessM * 10))); // heurística: 10 px por metro
                                            const half = lineLen * 0.5;
                                            const x1 = innerScreen.x - ux * half; const y1 = innerScreen.y - uy * half;
                                            const x2 = innerScreen.x + ux * half; const y2 = innerScreen.y + uy * half;
                                            const gL = new PIXI.Graphics();
                                            gL.lineStyle(innerStroke, innerColor, 1.0);
                                            gL.moveTo(x1, y1);
                                            gL.lineTo(x2, y2);
                                            blockEdgeBands.current?.addChild(gL);
                                        }
                                    }
                                } catch (e) { }
                                // Segunda banda: queremos que permaneça vertical (efeito "parede") mesmo que a primeira seja isométrica
                                // Segunda banda (vertical) não deve aparecer nas faces Norte (N) e Leste (L)
                                if (secondEnabled && face !== 'N' && face !== 'L') {
                                    const base0 = worldToIso({ x: 0, y: 0 });
                                    const down1 = worldToIso({ x: 0, y: thickness2M });
                                    const dyScreenSecond = (down1.y - base0.y);
                                    const faceColors2 = rCfg.blockEdgeBand2FaceColors || rCfg.blockEdgeBandFaceColors || {};
                                    const faceColor2 = faceColors2[face as 'N'|'S'|'L'|'O'] ?? faceColor;
                                    // Topo da segunda = aresta original (ia/ib); base desce thickness2M
                                    const ia2v = { x: ia.x, y: ia.y + dyScreenSecond };
                                    const ib2v = { x: ib.x, y: ib.y + dyScreenSecond };
                                    gBands.beginFill(faceColor2, band2Alpha);
                                    const outlineColor2 = (rCfg.roadOutlineColor !== undefined) ? (rCfg.roadOutlineColor as number) : ((faceColor2 & 0xFFFFFF) * 0.72 >>> 0);
                                    if ((rCfg as any).blockEdgeBandOutlineEnabled) {
                                        gBands.lineStyle(0.1, outlineColor2, Math.min(1, band2Alpha + 0.0));
                                    } else { gBands.lineStyle(0,0,0,0); }
                                    gBands.drawPolygon([ia.x, ia.y, ib.x, ib.y, ib2v.x, ib2v.y, ia2v.x, ia2v.y]);
                                    gBands.endFill();
                                }
                            } else {
                                // Extrusão vertical em coordenadas de tela: projetar aresta original e gerar segunda aresta deslocada para baixo
                                const ia = worldToIso(a);
                                const ib = worldToIso(b);
                                // Converter espessura em metros para deslocamento vertical de tela
                                // Aproximação: projetar um ponto deslocado em Y mundial (0, thicknessM) relativo a (0,0)
                                const base = worldToIso({ x: 0, y: 0 });
                                const down = worldToIso({ x: 0, y: thicknessM });
                                const dyScreen = (down.y - base.y); // deslocamento vertical resultante na projeção
                                const ia2 = { x: ia.x, y: ia.y + dyScreen };
                                const ib2 = { x: ib.x, y: ib.y + dyScreen };
                                const faceColors = rCfg.blockEdgeBandFaceColors || {};
                                const faceColor = faceColors[face as 'N'|'S'|'L'|'O'] ?? bandColor;
                                gBands.beginFill(faceColor, bandAlpha);
                                const outlineColor = (rCfg.roadOutlineColor !== undefined) ? (rCfg.roadOutlineColor as number) : ((faceColor & 0xFFFFFF) * 0.72 >>> 0);
                                if ((rCfg as any).blockEdgeBandOutlineEnabled) {
                                    gBands.lineStyle(0.1, outlineColor, Math.min(1, bandAlpha + 0.0));
                                } else { gBands.lineStyle(0,0,0,0); }
                                gBands.drawPolygon([ia.x, ia.y, ib.x, ib.y, ib2.x, ib2.y, ia2.x, ia2.y]);
                                gBands.endFill();
                                // Segunda banda (vertical empilhada) pulada em N e L conforme solicitação
                                if (secondEnabled && face !== 'N' && face !== 'L') {
                                    // Segunda banda vertical: topo = base da primeira (ia2/ib2), base desce thickness2M adicional
                                    const down2 = worldToIso({ x: 0, y: thicknessM + thickness2M });
                                    const dyScreen2 = (down2.y - base.y); // deslocamento total até o fim da segunda
                                    const ia3 = { x: ia.x, y: ia.y + dyScreen2 };
                                    const ib3 = { x: ib.x, y: ib.y + dyScreen2 };
                                    const faceColors2 = rCfg.blockEdgeBand2FaceColors || rCfg.blockEdgeBandFaceColors || {};
                                    const faceColor2 = faceColors2[face as 'N'|'S'|'L'|'O'] ?? faceColor;
                                    gBands.beginFill(faceColor2, band2Alpha);
                                    const outlineColor2 = (rCfg.roadOutlineColor !== undefined) ? (rCfg.roadOutlineColor as number) : ((faceColor2 & 0xFFFFFF) * 0.72 >>> 0);
                                    if ((rCfg as any).blockEdgeBandOutlineEnabled) {
                                        gBands.lineStyle(0.1, outlineColor2, Math.min(1, band2Alpha + 0.0));
                                    } else { gBands.lineStyle(0,0,0,0); }
                                    gBands.drawPolygon([ia2.x, ia2.y, ib2.x, ib2.y, ib3.x, ib3.y, ia3.x, ia3.y]);
                                    gBands.endFill();
                                }
                            }
                        }
                    }
                }
            });
            blockOutlines.current.addChild(gInner);
            blockEdgeBands.current?.addChild(gBands);
            // Create edge overlay (concrete texture) masked by the same bands
            try {
                edgeOverlay.current?.removeChildren();
                try { console.debug('[GameCanvas] edgeTexture prop present=', !!edgeTextureRef.current, 'edgeOverlayChildrenBefore=', edgeOverlay.current?.children.length); } catch (e) {}
                const useEdge = !!edgeTexture && !!(config as any).render.edgeUseTexture;
                // debug log
                try { console.log('[edgeOverlay] useEdge=', useEdge, 'edgeTex=', !!edgeTexture, 'blocks=', blockWorldPaths.length); } catch(e) {}
                if (useEdge) {
                    const maskG = new PIXI.Graphics();
                    maskG.beginFill(0xFFFFFF);
                    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
                    // iterate again over blocks to replicate band polygons
                    blockWorldPaths.forEach((worldPts: Point[]) => {
                        // compute band polygons similarly to above: we can approximate by offsetting edges
                        for (let i = 0; i < worldPts.length; i++) {
                            const a = worldPts[i];
                            const b = worldPts[(i+1) % worldPts.length];
                            const vx = b.x - a.x; const vy = b.y - a.y; const L = Math.hypot(vx, vy) || 1;
                            const ux = vx / L, uy = vy / L; const nx = -uy, ny = ux;
                            const thicknessM = (config as any).render.blockEdgeBandThicknessM || 0.1;
                            const p1 = { x: a.x + nx * (thicknessM/2), y: a.y + ny * (thicknessM/2) };
                            const p2 = { x: a.x - nx * (thicknessM/2), y: a.y - ny * (thicknessM/2) };
                            const p3 = { x: b.x - nx * (thicknessM/2), y: b.y - ny * (thicknessM/2) };
                            const p4 = { x: b.x + nx * (thicknessM/2), y: b.y + ny * (thicknessM/2) };
                            const poly = [p1, p2, p3, p4].map(pt => worldToIso(pt));
                            if (poly.length > 2) {
                                maskG.moveTo(poly[0].x, poly[0].y);
                                for (let k = 1; k < poly.length; k++) maskG.lineTo(poly[k].x, poly[k].y);
                                maskG.closePath();
                                poly.forEach(p => { minX = Math.min(minX, p.x); minY = Math.min(minY, p.y); maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y); });
                            }
                        }
                    });
                    maskG.endFill();
                    if (isFinite(minX) && isFinite(minY) && maxX > minX && maxY > minY) {
                        const tex = edgeTextureRef.current || PIXI.Texture.WHITE;
                        const w = Math.max(4, maxX - minX);
                        const h = Math.max(4, maxY - minY);
                        const sprite = new PIXI.TilingSprite(tex, w, h);
                        if (edgeScale && edgeScale !== 1) sprite.tileScale.set(edgeScale, edgeScale);
                        sprite.alpha = (typeof edgeAlpha === 'number') ? edgeAlpha : 1.0;
                        // create container positioned at minX,minY and draw mask with local coords
                        const container = new PIXI.Container();
                        container.x = minX; container.y = minY;
                        // adjust sprite to local coordinates
                        sprite.x = 0; sprite.y = 0;
                        // rebuild maskG locally (offset polygons by minX/minY)
                        const localMask = new PIXI.Graphics();
                        localMask.beginFill(0xFFFFFF);
                        // iterate again over blocks to replicate band polygons exactly as gBands
                        const rCfg = (config as any).render;
                        const secondEnabled = !!rCfg.blockEdgeBandSecondEnabled;
                        const thickness2M = rCfg.blockEdgeBand2ThicknessM ?? 1.0;
                        const verticalCapsGlobal = !!rCfg.blockEdgeBandVerticalCaps;
                        const primaryIso = !!rCfg.blockEdgeBandPrimaryIsometric;
                        blockWorldPaths.forEach((worldPts: Point[]) => {
                            // Determine orientation as gBands does (clockwise/ccw) to match face determination
                            let area2 = 0;
                            for (let ii = 0; ii < worldPts.length; ii++) {
                                const p = worldPts[ii];
                                const q = worldPts[(ii + 1) % worldPts.length];
                                area2 += p.x * q.y - q.x * p.y;
                            }
                            const clockwise = area2 < 0;
                            for (let i = 0; i < worldPts.length; i++) {
                                const a = worldPts[i];
                                const b = worldPts[(i + 1) % worldPts.length];
                                const dx = b.x - a.x;
                                const dy = b.y - a.y;
                                const length = Math.hypot(dx, dy);
                                if (length < 1e-6) continue;
                                let nx = -dy / length, ny = dx / length; // CCW
                                if (clockwise) { nx = dy / length; ny = -dx / length; }
                                const thicknessM = (config as any).render.blockEdgeBandThicknessM ?? 0.1;
                                const offset = thicknessM;
                                const aOff = { x: a.x + nx * offset, y: a.y + ny * offset };
                                const bOff = { x: b.x + nx * offset, y: b.y + ny * offset };
                                const ia = worldToIso(a);
                                const ib = worldToIso(b);
                                const iao = worldToIso(aOff);
                                const ibo = worldToIso(bOff);
                                // draw polygon in same order as gBands: [ia, ib, ibo, iao]
                                localMask.moveTo(ia.x - minX, ia.y - minY);
                                localMask.lineTo(ib.x - minX, ib.y - minY);
                                localMask.lineTo(ibo.x - minX, ibo.y - minY);
                                localMask.lineTo(iao.x - minX, iao.y - minY);
                                localMask.closePath();
                                // Now add second band (vertical wall) when gBands would draw it
                                try {
                                    // determine face as earlier
                                    let face: string;
                                    const absNx = Math.abs(nx);
                                    const absNy = Math.abs(ny);
                                    if (absNx >= absNy) {
                                        face = nx > 0 ? 'L' : 'O';
                                    } else {
                                        face = ny > 0 ? 'N' : 'S';
                                    }
                                    if (secondEnabled) {
                                        if (!(verticalCapsGlobal && !primaryIso)) {
                                            // primary iso case: second band is vertical (screen-space dy from thickness2M)
                                            if (face !== 'N' && face !== 'L') {
                                                const base0 = worldToIso({ x: 0, y: 0 });
                                                const down1 = worldToIso({ x: 0, y: thickness2M });
                                                const dyScreenSecond = (down1.y - base0.y);
                                                const ia2v = { x: ia.x, y: ia.y + dyScreenSecond };
                                                const ib2v = { x: ib.x, y: ib.y + dyScreenSecond };
                                                localMask.moveTo(ia.x - minX, ia.y - minY);
                                                localMask.lineTo(ib.x - minX, ib.y - minY);
                                                localMask.lineTo(ib2v.x - minX, ib2v.y - minY);
                                                localMask.lineTo(ia2v.x - minX, ia2v.y - minY);
                                                localMask.closePath();
                                            }
                                        } else {
                                            // vertical extrusion case: compute dyScreen for thicknessM and add stacked second band
                                            const base = worldToIso({ x: 0, y: 0 });
                                            const down = worldToIso({ x: 0, y: thicknessM });
                                            const dyScreen = (down.y - base.y);
                                            const ia2 = { x: ia.x, y: ia.y + dyScreen };
                                            const ib2 = { x: ib.x, y: ib.y + dyScreen };
                                            // first vertical polygon was already added by primary (ia,ib,ib2,ia2) in this branch
                                            // add stacked second band if allowed and face not N/L
                                            if (face !== 'N' && face !== 'L') {
                                                const down2 = worldToIso({ x: 0, y: thicknessM + thickness2M });
                                                const dyScreen2 = (down2.y - base.y);
                                                const ia3 = { x: ia.x, y: ia.y + dyScreen2 };
                                                const ib3 = { x: ib.x, y: ib.y + dyScreen2 };
                                                // draw polygon [ia2, ib2, ib3, ia3]
                                                localMask.moveTo(ia2.x - minX, ia2.y - minY);
                                                localMask.lineTo(ib2.x - minX, ib2.y - minY);
                                                localMask.lineTo(ib3.x - minX, ib3.y - minY);
                                                localMask.lineTo(ia3.x - minX, ia3.y - minY);
                                                localMask.closePath();
                                            }
                                        }
                                    }
                                } catch (e) { /* ignore mask secondary errors */ }
                            }
                        });
                        localMask.endFill();
                        container.addChild(sprite);
                        container.addChild(localMask);
                        container.mask = localMask;
                        edgeOverlay.current?.addChild(container);
                        try { console.debug('[GameCanvas] edgeOverlay added container, childrenNow=', edgeOverlay.current?.children.length); } catch (e) {}
                        // Add small debug label so user sees overlay was created (local coords)
                        try {
                            const dbg = new PIXI.Text(`EdgeOverlay: ${Math.round(minX)},${Math.round(minY)} ${Math.round(w)}x${Math.round(h)}`, { fill: 0xFFFFFF, fontSize: 12 });
                            dbg.x = minX + 4; dbg.y = minY + 4; dbg.alpha = 0.9;
                            edgeOverlay.current?.addChild(dbg);
                        } catch (e) {}
                    }
                }
            } catch (e) { }
        }
        try { console.debug('[GameCanvas] onMapChange done: overlays children counts -> edge=', edgeOverlay.current?.children.length, 'lanes=', roadLaneOverlay.current?.children.length); } catch (e) {}
    };

    // Re-draw map when the supplied interiorTexture prop changes so uploaded textures take effect.
    React.useEffect(() => {
        try {
            // do a light redraw (don't rebuild buildings) to update block fills
            onMapChange(false);
        } catch (e) { }
        // intentionally depend on interiorTexture so effect runs when it changes
    }, [interiorTexture]);

    useEffect(() => {
        MapStore.addChangeListener(() => onMapChange(true));
        if ((config as any).render.autoGenerateOnLoad) {
            const seed = new Date().getTime();
            console.log(`[autoGenerate] seed: ${seed}`);
            MapActions.generate(seed);
        } else {
            console.log('[autoGenerate] desativado – aguardando clique em Regenerate');
        }

    const canvasEl = document.createElement('canvas');
    canvasContainerRef.current?.appendChild(canvasEl);
    canvasEl.tabIndex = 0;
    canvasEl.focus();

    try {
        NoiseZoning.attach(canvasEl);
        NoiseZoning.setEnabled?.(!!((config as any).render?.showNoiseDelimitations));
        syncNoiseOverlayView(state.camera.x, state.camera.y, state.zoom);
    } catch (e) {
        try { console.warn('[GameCanvas] Failed to attach NoiseZoning overlay', e); } catch (err) {}
    }

        // If NoiseZoning requests a sync (e.g. when it was just enabled), push current view
        const onNoiseReq = () => {
            try { syncNoiseOverlayView(state.camera.x, state.camera.y, state.zoom); } catch (e) {}
        };
        window.addEventListener('noise-overlay-request-sync', onNoiseReq as EventListener);

        const onNoiseMaskUpdated = () => { scheduleCrackedRoadRedraw(); };
        const onNoiseOverlayToggle = () => { scheduleCrackedRoadRedraw(); };
        const onNoiseOutlineToggle = () => { scheduleCrackedRoadRedraw(); };
        const onCrackedConfigChange = () => { scheduleCrackedRoadRedraw(); };
        window.addEventListener('noise-overlay-intersection-updated', onNoiseMaskUpdated as EventListener);
        window.addEventListener('noise-overlay-change', onNoiseOverlayToggle as EventListener);
        window.addEventListener('noise-overlay-outline-change', onNoiseOutlineToggle as EventListener);
        window.addEventListener('cracked-roads-config-change', onCrackedConfigChange as EventListener);

        const handleResize = () => {
            if (!canvasContainerRef.current) return;
            const { offsetWidth, offsetHeight } = canvasContainerRef.current;
            canvasEl.style.width = `${offsetWidth}px`;
            canvasEl.style.height = `${offsetHeight}px`;
            const rendererWidth = offsetWidth * window.devicePixelRatio;
            const rendererHeight = offsetHeight * window.devicePixelRatio;
            if (pixiRenderer.current) {
                pixiRenderer.current.resize(rendererWidth, rendererHeight);
            }
            if (zoomContainer.current) {
                zoomContainer.current.x = rendererWidth / 2;
                zoomContainer.current.y = rendererHeight / 2;
            }
            // Redesenhar HUD no novo tamanho
            drawHUD();
        };

        const { offsetWidth, offsetHeight } = canvasContainerRef.current!;
        pixiRenderer.current = PIXI.autoDetectRenderer({
            width: offsetWidth * window.devicePixelRatio,
            height: offsetHeight * window.devicePixelRatio,
            view: canvasEl,
            antialias: true,
            backgroundAlpha: 1,
            backgroundColor: 0x2e7d32
        });

    stage.current = new PIXI.Container();
    heatmaps.current = new PIXI.Container();
    debugDrawables.current = new PIXI.Container();
        debugSegments.current = new PIXI.Container();
        debugMapData.current = new PIXI.Container();
    zoomContainer.current = new PIXI.Container();
    drawables.current = new PIXI.Container();
    // Mantemos sortableChildren apenas para permitir personagem no topo com zIndex alto sem alterar ordem
    drawables.current.sortableChildren = true;
        dynamicDrawables.current = new PIXI.Container();
    roadsFill.current = new PIXI.Container();
    roadsSecondary.current = new PIXI.Container();
    // roadsOverlay intentionally disabled (Camada 3)
    roadsOverlay.current = null;
    // Aplicar efeitos visuais iniciais na camada secundária (blur/blend) conforme config
    try {
        const rCfg = (config as any).render;
        if (rCfg.secondaryRoadBlurEnabled) {
            const blur = new PIXI.filters.BlurFilter(rCfg.secondaryRoadBlurStrength ?? 4);
            // Qualidade menor para performance (1 ou 2). 1 = fastest.
            blur.quality = 1;
            roadsSecondary.current.filters = [blur];
        }
        // Mapear string -> blendMode Pixi
        const blendMap: Record<string, number> = {
            normal: PIXI.BLEND_MODES.NORMAL,
            add: PIXI.BLEND_MODES.ADD,
            lighter: PIXI.BLEND_MODES.LIGHTEN,
            screen: PIXI.BLEND_MODES.SCREEN,
            multiply: PIXI.BLEND_MODES.MULTIPLY,
            overlay: PIXI.BLEND_MODES.OVERLAY,
        };
        if (rCfg.secondaryRoadBlendMode && blendMap[rCfg.secondaryRoadBlendMode]) {
            (roadsSecondary.current as any).blendMode = blendMap[rCfg.secondaryRoadBlendMode];
        }
    } catch (e) {
        console.warn('Secondary layer FX setup failed', e);
    }
    blockOutlines.current = new PIXI.Container();
    blockEdgeBands.current = new PIXI.Container();
    // ensure base layers have lower zIndex
    (roadsFill.current as any).zIndex = 10; // Camada 1
    (blockOutlines.current as any).zIndex = 20; // Camada 4 (gap/interiors)
    // give block bands a low zIndex so overlays can be placed above
    (blockEdgeBands.current as any).zIndex = 100;
    roadOutlines.current = new PIXI.Container();
    (roadOutlines.current as any).zIndex = 30; // Camada 5 (contorno externo)
    intersectionPatches.current = new PIXI.Container();
    roadLaneOverlay.current = new PIXI.Container();
    // lane overlay should sit above lane outlines so marker texture appears above outlines
    (roadLaneOverlay.current as any).zIndex = 41;
    roadLaneOutlines.current = new PIXI.Container();
    // outlines slightly below lane overlay so they don't occlude marker texture
    (roadLaneOutlines.current as any).zIndex = 40;
    crackedRoadOverlay.current = new PIXI.Container();
    (crackedRoadOverlay.current as any).zIndex = 45;
    crackedRoadOverlay.current.visible = false;
    edgeOverlay.current = new PIXI.Container();
    // ensure concrete overlay renders above the bands
    (edgeOverlay.current as any).zIndex = 200;
    characters.current = new PIXI.Container();
    (characters.current as any).zIndex = 10000; // somente personagem tem zIndex alto

    // heatmap deve acompanhar pan/zoom: colocá-lo dentro de drawables, no fundo
    debugDrawables.current.addChild(debugSegments.current);
    debugDrawables.current.addChild(debugMapData.current);
    // visibilidade inicial dos marcadores/junções
    debugMapData.current.visible = (config as any).render.showJunctionMarkers;
    // Inserir heatmaps como primeira criança para ficar no fundo
    drawables.current.addChildAt(heatmaps.current, 0);
    // ruas (preenchimento) abaixo de prédios e contornos
    drawables.current.addChild(roadsFill.current);
    // adicionar patches dependendo da flag de debug (antes dos quarteirões ou depois de tudo)
    if (!(config as any).render.intersectionPatchForceOnTop) {
    drawables.current.addChild(intersectionPatches.current);
    }
    // contornos dos quarteirões (interiores) logo acima do fill das ruas
    drawables.current.addChild(blockOutlines.current);
    // prédios e demais dinâmicos acima das ruas e interiores
    drawables.current.addChild(dynamicDrawables.current);
    // contornos das vias acima das vias e abaixo do personagem
    drawables.current.addChild(roadOutlines.current);
    // bandas de quarteirão (adicionadas antes do overlay de bordas)
    drawables.current.addChild(blockEdgeBands.current);
    // overlay de bordas (concreto) deve ficar acima das bandas
    drawables.current.addChild(edgeOverlay.current);
    // faixa das vias (linhas/texture)
    drawables.current.addChild(roadLaneOverlay.current);
    // linhas de contorno das faixas
    drawables.current.addChild(roadLaneOutlines.current);
    drawables.current.addChild(crackedRoadOverlay.current);
    if ((config as any).render.intersectionPatchForceOnTop) {
        drawables.current.addChild(intersectionPatches.current);
    }
    // personagem e debug permanecem acima
    drawables.current.addChild(characters.current); // personagem
    // Colocar o debug DENTRO de drawables para herdar o offset de câmera
    drawables.current.addChild(debugDrawables.current);
    // Overlay (Camada 3) intentionally disabled; only add secondary layer
    drawables.current.addChild(roadsSecondary.current);
    // Bandas acima de todas as camadas de rua e do interior, mas abaixo do personagem
    drawables.current.addChild(blockEdgeBands.current);
    // Não forçar sort; evitar sumiço por ordem inesperada
    zoomContainer.current.addChild(drawables.current);
    stage.current.addChild(zoomContainer.current);
    // HUD fixo acima de tudo
    hud.current = new PIXI.Container();
    stage.current.addChild(hud.current);

    // character graphics / sprite setup
    state.characterGraphics = new PIXI.Graphics();
    characters.current.addChild(state.characterGraphics);

    scheduleCrackedRoadRedraw();

    handleResize();
    // Redesenhar handler
    window.addEventListener('resize', handleResize);

        // Sinaliza que toda a cena/renderer estão prontos para iniciar o loop
        state.initialised = true;

        // Keyboard controls
        const keys: Record<string, boolean> = {};
        const onKeyDown = (e: KeyboardEvent) => {
            const k = e.key.toLowerCase();
            if (k === 'arrowup' || k === 'arrowdown' || k === 'arrowleft' || k === 'arrowright' || k === ' ' || k === 'w' || k === 'a' || k === 's' || k === 'd') {
                e.preventDefault();
            }
            if (k === 'n') {
                // Toggle overlay via teclado
                NoiseZoning.setEnabled?.(!NoiseZoning.enabled);
            }
            keys[e.key] = true;
            keys[k] = true;
        };
        const onKeyUp = (e: KeyboardEvent) => {
            const k = e.key.toLowerCase();
            keys[e.key] = false;
            keys[k] = false;
        };
        window.addEventListener('keydown', onKeyDown, { passive: false });
        window.addEventListener('keyup', onKeyUp, { passive: true });

        // Criação do sprite do personagem
        const buildCharacterSprite = () => {
            if (!pixiRenderer.current) return;
            const h = scale.characterHeightM;
            const d = scale.characterDiameterM;
            const r = d / 2;
            const g = new PIXI.Graphics();
            // corpo
            g.beginFill(0x3399FF, 0.9);
            g.drawRoundedRect(-r, 0, d, h, r * 0.6);
            g.endFill();
            // cabeça
            g.beginFill(0xFFD166, 1.0);
            g.drawCircle(0, h + r * 0.9, r);
            g.endFill();
            const tex = pixiRenderer.current.generateTexture(g);
            const sprite = new PIXI.Sprite(tex);
            sprite.anchor.set(0.5, 0); // base no pé (y=0)
            if (state.characterGraphics) { state.characterGraphics?.destroy(); state.characterGraphics = null; }
            return sprite;
        };

                // arcTo smoothing removed — no watcher necessary

                // visibilidade do preenchimento das vias
                if (roadsFill.current) {
                    // No modo simples usamos roadsFill como "layer" das linhas finas
                    const simple = (config as any).render.simpleRoads;
                    roadsFill.current.visible = simple || (!!(config as any).render.showRoadFill && !(config as any).render.showOnlyBlockOutlines && !(config as any).render.showOnlyBlockInteriors);
                }

                // visibilidade da camada secundária de vias
                if (roadsSecondary.current) {
                    const simple = (config as any).render.simpleRoads;
                    const onlyBlocksOutline = (config as any).render.showOnlyBlockOutlines;
                    const onlyBlocksInterior = (config as any).render.showOnlyBlockInteriors;
                    roadsSecondary.current.visible = !simple && !!(config as any).render.secondaryRoadLayerEnabled && !onlyBlocksOutline && !onlyBlocksInterior;
                    // Atualizar filtros/blend dinamicamente se flags mudarem
                    const rCfg = (config as any).render;
                    const existingBlur = (roadsSecondary.current.filters || []).find(f => (f as any).blur !== undefined) as any;
                    const wantBlur = !!rCfg.secondaryRoadBlurEnabled;
                    const blurStrength = rCfg.secondaryRoadBlurStrength ?? 4;
                    if (wantBlur) {
                        if (!existingBlur) {
                            const blur = new PIXI.filters.BlurFilter(blurStrength);
                            blur.quality = 1;
                            roadsSecondary.current.filters = [...(roadsSecondary.current.filters||[]), blur];
                        } else if (Math.abs(existingBlur.blur - blurStrength) > 0.5) {
                            existingBlur.blur = blurStrength;
                        }
                    } else if (existingBlur) {
                        // remover blur
                        roadsSecondary.current.filters = (roadsSecondary.current.filters||[]).filter(f => f !== existingBlur);
                    }
                    const blendMap: Record<string, number> = {
                        normal: PIXI.BLEND_MODES.NORMAL,
                        add: PIXI.BLEND_MODES.ADD,
                        lighter: PIXI.BLEND_MODES.LIGHTEN,
                        screen: PIXI.BLEND_MODES.SCREEN,
                        multiply: PIXI.BLEND_MODES.MULTIPLY,
                        overlay: PIXI.BLEND_MODES.OVERLAY,
                    };
                    const desiredBlend = blendMap[rCfg.secondaryRoadBlendMode] ?? PIXI.BLEND_MODES.ADD;
                    const rsAny = roadsSecondary.current as any;
                    if (rsAny.blendMode !== desiredBlend) {
                        rsAny.blendMode = desiredBlend;
                    }
                }

                // Camada overlay (Camada 3) desabilitada — não há nada a atualizar aqui.

                // Visibilidade de quarteirões
                if (dynamicDrawables.current) {
                    dynamicDrawables.current.visible = !((config as any).render.showOnlyBlockOutlines || (config as any).render.showOnlyBlockInteriors);
                }
                if (blockOutlines.current) {
                    const simple = (config as any).render.simpleRoads;
                    const showBlocks = !!(config as any).render.showBlockOutlines || !!(config as any).render.showOnlyBlockOutlines || !!(config as any).render.showOnlyBlockInteriors;
                    blockOutlines.current.visible = !simple && showBlocks;
                }

                // Visibilidade do personagem
                if (characters.current) {
                    characters.current.visible = !((config as any).render.showOnlyBlockInteriors);
                }

                // atualizar HUD, personagem e render por frame
                // Loop de animação com atualização de personagem (teclas) e câmera
                let lastTime = Date.now();
                const animate = () => {
                    if (state.initialised && stage.current && pixiRenderer.current) {
                        const now = Date.now();
                        state.dt = now - (state.time || now);
                        state.time = now;
                        const dtSec = Math.max(0, state.dt) / 1000;

                        // movimento do personagem a partir das teclas
                        try {
                            const speed = (config as any).controls?.characterSpeedMps || 25;
                            // keys objeto está no escopo do useEffect
                            const vx = ((keys['arrowright'] || keys['d']) ? 1 : 0) - ((keys['arrowleft'] || keys['a']) ? 1 : 0);
                            const vy = ((keys['arrowdown'] || keys['s']) ? 1 : 0) - ((keys['arrowup'] || keys['w']) ? 1 : 0);
                            let mx = vx, my = vy;
                            if (mx !== 0 || my !== 0) {
                                const L = Math.hypot(mx, my) || 1;
                                mx = mx / L; my = my / L;
                                state.character.pos.x += mx * speed * dtSec;
                                state.character.pos.y += my * speed * dtSec;
                            }
                        } catch (e) {}

                        // atualizar zoom com suavização simples
                        try {
                            const targetZoom = (MapStore.getTargetZoom && typeof MapStore.getTargetZoom === 'function') ? MapStore.getTargetZoom() : state.zoom;
                            state.zoom = (state.zoom + targetZoom) / 2.0;
                        } catch {}
                        if (zoomContainer.current) {
                            zoomContainer.current.scale.x = state.zoom;
                            zoomContainer.current.scale.y = state.zoom;
                        }

                        // garantir sprite do personagem e posicioná-lo
                        try {
                            const charH = scale.characterHeightM;
                            const charD = scale.characterDiameterM;
                            const charR = charD / 2;
                            const base = worldToIso(state.character.pos);
                            const circleC = worldToIso({ x: state.character.pos.x, y: state.character.pos.y + charR });

                            if (!(state as any).characterSprite && pixiRenderer.current) {
                                (state as any).characterSprite = buildCharacterSprite();
                                if ((state as any).characterSprite) {
                                    characters.current!.addChild((state as any).characterSprite!);
                                }
                            }
                            const sprite: PIXI.Sprite | undefined = (state as any).characterSprite || undefined;
                            if (sprite) {
                                sprite.position.set(base.x, base.y);
                            }

                            // câmera segue o personagem (projetado) se habilitado
                            if ((config as any).render.cameraFollow) {
                                const targetCamX = circleC.x;
                                const targetCamY = circleC.y;
                                const follow = 0.2; // suavização
                                state.camera.x += (targetCamX - state.camera.x) * follow;
                                state.camera.y += (targetCamY - state.camera.y) * follow;
                            }
                            if (zoomContainer.current && pixiRenderer.current) {
                                // Centralizar a view na posição da câmera (em pixels projetados):
                                // calcular o centro do renderer e deslocar a zoomContainer de forma que
                                // state.camera (em coords projetadas) fique no centro da tela.
                                const rw = (pixiRenderer.current as any).width as number;
                                const rh = (pixiRenderer.current as any).height as number;
                                const cx = rw * 0.5;
                                const cy = rh * 0.5;
                                // zoomContainer está sendo escalado por state.zoom, então o offset do mundo
                                // deve ser multiplicado pela mesma escala.
                                zoomContainer.current.x = cx - state.camera.x * state.zoom;
                                zoomContainer.current.y = cy - state.camera.y * state.zoom;
                            }
                            syncNoiseOverlayView(state.camera.x, state.camera.y, state.zoom);
                        } catch (e) {
                            // non-fatal
                        }

                        drawHUD();
                        pixiRenderer.current?.render(stage.current!);
                    }
                    requestAnimationFrame(animate);
                };
                requestAnimationFrame(animate);

        return () => {
            window.removeEventListener('resize', handleResize);
            window.removeEventListener('keydown', onKeyDown);
            window.removeEventListener('keyup', onKeyUp);
            window.removeEventListener('noise-overlay-request-sync', onNoiseReq as EventListener);
            window.removeEventListener('noise-overlay-intersection-updated', onNoiseMaskUpdated as EventListener);
            window.removeEventListener('noise-overlay-change', onNoiseOverlayToggle as EventListener);
            window.removeEventListener('noise-overlay-outline-change', onNoiseOutlineToggle as EventListener);
            window.removeEventListener('cracked-roads-config-change', onCrackedConfigChange as EventListener);
            if (crackedRoadsRaf.current != null && typeof window !== 'undefined' && typeof window.cancelAnimationFrame === 'function') {
                window.cancelAnimationFrame(crackedRoadsRaf.current);
                crackedRoadsRaf.current = null;
            }
            MapStore.removeChangeListener(onMapChange);
            pixiRenderer.current?.destroy();
            canvasContainerRef.current?.removeChild(canvasEl);
            if (NoiseZoning.detach) NoiseZoning.detach();
        };
    }, []);


    return <div id="canvas-container" ref={canvasContainerRef} style={{ position: 'relative' }} />;
};

export default GameCanvas;