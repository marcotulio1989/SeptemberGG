/*
 * NoiseZoning Overlay
 * Warped-noise zoning overlay for city generator
 * Modifications:
 * - Restrict rendering to road areas only by building a coarse road mask using the MapStore quadtree
 *   and distance-to-segment checks. This prevents the noise overlay from showing on non-road areas.
 * - Pixelate the noise by sampling at a coarse grid and using nearest-neighbor lookup when writing
 *   pixels. This gives a blocky/pixelated look instead of smooth organic interpolation.
 * API: attach(canvas), toggle(), reseed(), redraw()
 * Independent of roads/buildings
 */
import { ZoneName } from '../game_modules/mapgen';
import { config } from '../game_modules/config';
import Zoning from '../game_modules/zoning';
import { Noise } from 'noisejs';
import { sampleWarpedNoise } from '../lib/noiseField';
import MapStore from '../stores/MapStore';
import * as math from '../generic_modules/math';


const bilerp = (v00: number, v10: number, v01: number, v11: number, tx: number, ty: number) => {
  const top = v00 + (v10 - v00) * tx;
  const bottom = v01 + (v11 - v01) * tx;
  return top + (bottom - top) * ty;
};

const computeSampleStep = (w: number, h: number, zoom: number) => {
  const diag = Math.sqrt(Math.max(1, w * h));
  const base = diag / 720;
  const zoomAdjust = zoom > 0 ? Math.pow(Math.max(zoom, 0.1), 0.35) : 1;
  const raw = base / zoomAdjust;
  const step = Math.round(raw);
  return Math.max(1, Math.min(5, step || 1));
};


export type NoiseZoningAPI = {
  attach: (canvas: HTMLCanvasElement) => void;
  toggle: () => void;
  setEnabled?: (on: boolean) => void;
  reseed: () => void;
  redraw: () => void;
  enabled: boolean;
  detach?: () => void;
  setView?: (view: { cameraX: number; cameraY: number; zoom: number }) => void;
  setParams?: (p: Partial<NoiseZoningParams>) => void;
  getParams?: () => NoiseZoningParams;
  // filter threshold: value between 0..1 that controls when noise pixels are shown
  setNoiseThreshold?: (v: number) => void;
  getNoiseThreshold?: () => number;
  setIntersectionOutlineEnabled?: (on: boolean) => void;
  getIntersectionOutlineEnabled?: () => boolean;
  setPixelSize?: (px: number) => void;
  getPixelSize?: () => number;
  getIntersectionMaskData?: () => {
    coarseW: number;
    coarseH: number;
    gridMinX: number;
    gridMinY: number;
    worldStep: number;
    pixelSizePx: number;
    intersectionMask: Uint8Array;
  } | null;
  createIntersectionTester?: () => ((x: number, y: number) => boolean) | null;
  getSeed?: () => number;
};

type InternalNoiseZoning = NoiseZoningAPI & {
  _baseCanvas: HTMLCanvasElement | null;
  _overlayCanvas: HTMLCanvasElement | null;
  _ctx: CanvasRenderingContext2D | null;
  _seed: number;
  _noise: Noise | null;
  _observer: ResizeObserver | null;
  _syncSizeAndRedraw: () => void;
  _view: { cameraX: number; cameraY: number; zoom: number };
  _params: NoiseZoningParams;
  _noiseThreshold: number;
  _showIntersectionOutline: boolean;
  _ensureSize: () => void;
  _precomputed?: any;
  _mapGeneratedHandler?: (ev: Event) => void;
  _contourCache?: { key: string; contours: number[][][] } | null;
  _DEBUG?: boolean;
  _pixelSize?: number;
  // _pixelCache.data may either be a full Uint8ClampedArray image buffer (legacy)
  // or a small coarse-cache object { type: 'coarse', coarseW, coarseH, intersectionMask: Uint8Array }
  _pixelCache?: {
    w: number; h: number; cameraX: number; cameraY: number; zoom: number; data: any; bbox?: [number, number, number, number];
  } | null;
  _notifyChange: () => void;
};

export type NoiseZoningParams = {
  baseScale: number; // 1/N, maior => ruído mais fino
  octaves: number;
  lacunarity: number;
  gain: number;
  thresholds: { r1: number; r2: number; r3: number; r4: number }; // 0..1 ascendentes
};

const NoiseZoning: InternalNoiseZoning = {
  enabled: false,
  _baseCanvas: null,
  _overlayCanvas: null,
  _ctx: null,
  _seed: Math.floor(Math.random() * 10000),
  _noise: null,
  _observer: null,
  _view: { cameraX: 0, cameraY: 0, zoom: 1 },
  _params: Zoning.getParams(),
  _pixelCache: null,
  _contourCache: null as null | { key: string; contours: number[][][] },
  _showIntersectionOutline: false,
  _DEBUG: false,
  _pixelSize: 4,
  _noiseThreshold: 0.5,
  _notifyChange() {
    if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') return;
    try {
      const evt = new CustomEvent('noise-overlay-change', { detail: { enabled: !!this.enabled } });
      window.dispatchEvent(evt);
    } catch (err) {
      try { console.warn('[NoiseZoning] Failed to dispatch change event', err); } catch (e) {}
    }
  },
  _ensureSize() {
    if (!this._overlayCanvas || !this._baseCanvas) return;
    const parent = this._baseCanvas.parentElement as HTMLElement | null;
    const dpr = window.devicePixelRatio || 1;
    const cssW = parent?.clientWidth ?? this._baseCanvas.clientWidth;
    const cssH = parent?.clientHeight ?? this._baseCanvas.clientHeight;
    this._overlayCanvas.style.width = `${cssW}px`;
    this._overlayCanvas.style.height = `${cssH}px`;
    const pxW = Math.max(1, Math.floor(cssW * dpr));
    const pxH = Math.max(1, Math.floor(cssH * dpr));
    if (this._overlayCanvas.width !== pxW) this._overlayCanvas.width = pxW;
    if (this._overlayCanvas.height !== pxH) this._overlayCanvas.height = pxH;
  },

  attach(canvas: HTMLCanvasElement) {
    this._baseCanvas = canvas;
    // Criar canvas overlay posicionado acima do canvas base
    const overlay = document.createElement('canvas');
    overlay.style.position = 'absolute';
    overlay.style.left = '0';
    overlay.style.top = '0';
    overlay.style.pointerEvents = 'none';
    overlay.style.zIndex = '5';
    // Garantir que o container do canvas tenha position: relative
    const parent = canvas.parentElement;
    if (parent) {
      const cs = window.getComputedStyle(parent);
      if (cs.position === 'static') {
        (parent as HTMLElement).style.position = 'relative';
      }
      parent.appendChild(overlay);
    }
    this._overlayCanvas = overlay;
    this._ctx = overlay.getContext('2d');
    // Sincronizar com Zoning do jogo, se existir
    const zSeed = Zoning.getSeed();
    if (zSeed != null) {
      this._seed = zSeed;
      this._params = Zoning.getParams();
    }
  this._noise = new Noise(this._seed);
  // inicializar threshold padrão
  (this as any)._noiseThreshold = (this as any)._noiseThreshold ?? 0.5;
  (this as any)._showIntersectionOutline = (this as any)._showIntersectionOutline ?? false;
    // Sync size with base canvas using ResizeObserver
  const resize = () => this._syncSizeAndRedraw();
    this._observer?.disconnect();
    this._observer = new ResizeObserver(resize);
    if (parent) this._observer.observe(parent);
    resize();

    // Listen for map generation events so we can prepare noise immediately.
    // Use a named handler so we can remove it on detach. When a map is generated,
    // we request the current camera/zoom from the renderer (GameCanvas) by
    // dispatching 'noise-overlay-request-sync' and schedule the actual precompute
    // in requestAnimationFrame so the GameCanvas has a chance to call setView()
    // and keep the computed cache aligned with the visible view. Failures are
    // non-fatal.
    try {
      if (typeof window !== 'undefined') {
        this._mapGeneratedHandler = (ev: Event) => {
          try {
            const detail = (ev as CustomEvent<{ seed?: number }>).detail;
            if (detail && typeof detail.seed === 'number') {
              this._seed = detail.seed;
              this._noise = new Noise(this._seed);
              try { this._params = Zoning.getParams(); } catch (e) {}

              // Invalidate caches and prepare a temporary canvas if needed.
              this._pixelCache = null;
              (this as any)._maskCache = null;

              let tempCreated = false;
              let prevDisplay = '';
              if (!this._overlayCanvas) {
                const tmp = document.createElement('canvas');
                this._overlayCanvas = tmp;
                this._ctx = tmp.getContext('2d');
                tempCreated = true;
              }
              if (this._overlayCanvas) {
                prevDisplay = this._overlayCanvas.style.display || '';
                this._overlayCanvas.style.display = 'none';
              }

              const prevEnabled = this.enabled;
              // Temporarily enable so redraw will populate caches even when overlay is off
              this.enabled = true;

              // Ask the owner to sync the current camera/zoom -> GameCanvas listens for this
              try {
                if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
                  const ev2 = new CustomEvent('noise-overlay-request-sync');
                  window.dispatchEvent(ev2);
                }
              } catch (e) {}

              // Schedule the precompute on next animation frame so setView from GameCanvas
              // has a chance to update this._view before we run redraw().
              try {
                if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
                  window.requestAnimationFrame(() => {
                    try { this._ensureSize(); } catch (e) {}
                    try { this.redraw(); } catch (e) {}
                    // restore state
                    try { this.enabled = !!prevEnabled; } catch (e) {}
                    if (this._overlayCanvas) this._overlayCanvas.style.display = prevDisplay;
                    if (tempCreated) {
                      this._overlayCanvas = null;
                      this._ctx = null;
                    }
                  });
                } else {
                  try { this._ensureSize(); } catch (e) {}
                  try { this.redraw(); } catch (e) {}
                  this.enabled = !!prevEnabled;
                  if (this._overlayCanvas) this._overlayCanvas.style.display = prevDisplay;
                  if (tempCreated) { this._overlayCanvas = null; this._ctx = null; }
                }
              } catch (e) {}
            }
          } catch (e) {}
        };
        window.addEventListener('map-generated', this._mapGeneratedHandler);
      }
    } catch (e) {}
  },

  toggle() {
    this.enabled = !this.enabled;
    // Mostrar/ocultar canvas overlay
    if (this._overlayCanvas) {
      this._overlayCanvas.style.display = this.enabled ? 'block' : 'none';
    }
    // Clear pixel & mask caches when enabling to force fresh calculation (avoid stale empty cache)
    if (this.enabled) {
      this._pixelCache = null;
      (this as any)._maskCache = null;
    }
    // Só redesenha quando estiver habilitado. Use requestAnimationFrame so the overlay
    // canvas has its size/styles applied before we attempt to paint (avoids needing a
    // zoom/resize to trigger a redraw).
    if (this.enabled) {
      if ((this as any)._DEBUG) console.log('[NoiseZoning] toggle -> enabled true, dispatching request-sync');
      // Request an external sync so the owner (GameCanvas) can push the current camera/zoom
      try {
        if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
          const ev = new CustomEvent('noise-overlay-request-sync');
          window.dispatchEvent(ev);
        }
      } catch (e) {}
      try { this._ensureSize(); } catch (e) {}
      if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
        window.requestAnimationFrame(() => { if (this.enabled) this.redraw(); });
      } else {
        this.redraw();
      }
    }
    this._notifyChange();
  },

  reseed() {
    this._seed = Math.floor(Math.random() * 10000);
    this._noise = new Noise(this._seed);
    // Propagar para Zoning para manter consistência com as casas
    Zoning.init(this._seed, this._params);
    this._pixelCache = null;
    if (this.enabled) this.redraw();
  },

  redraw() {
    // Não faz trabalho algum se desabilitado
    if (!this.enabled) return;
    if (!this._overlayCanvas || !this._ctx || !this._noise) return;
    try {
      if ((this as any)._DEBUG) console.log('[NoiseZoning] redraw START enabled=', this.enabled, 'view=', this._view);
    } catch (e) {}
    // Garantir cobertura total antes de desenhar
    this._ensureSize();
    const w = this._overlayCanvas.width;
    const h = this._overlayCanvas.height;
  // pixelated mode: no large ImageData allocation
    const zoneColors = config.render.zoneColors;
    // Escala do ruído em coordenadas de cena (ajuste conforme necessário)
    const { baseScale, octaves, lacunarity, gain, thresholds } = this._params;
    const cx = w / 2, cy = h / 2;
    const cameraX = this._view.cameraX, cameraY = this._view.cameraY, zoom = this._view.zoom || 1;
    // Cache de pixels: se view for igual, reutiliza
    const alpha = this.enabled ? Math.floor((config.render.zoneOverlayAlpha ?? 0.12) * 255) : 0;
    // Calcular bounding box em pixels da área que contém ruas (projetada para tela)
    const roadSegments = MapStore.getSegments();
    const renderModeIsometric = (config.render as any).mode === 'isometric';
    const isoA = (config.render as any).isoA, isoB = (config.render as any).isoB, isoC = (config.render as any).isoC, isoD = (config.render as any).isoD;
    // GameCanvas passes camera coordinates that are ALREADY in isometric space.
    // We do not need to re-project them. This was the source of the offset.
    const cameraIsoX = renderModeIsometric ? cameraX : 0;
    const cameraIsoY = renderModeIsometric ? cameraY : 0;
    const projectWorldToScreen = (p: { x: number; y: number }) => {
      let screenX: number;
      let screenY: number;
      if (renderModeIsometric) {
        const isoX = isoA * p.x + isoC * p.y;
        const isoY = isoB * p.x + isoD * p.y;
        screenX = cx + (isoX - cameraIsoX) * zoom;
        screenY = cy + (isoY - cameraIsoY) * zoom;
      } else {
        screenX = cx + (p.x - cameraX) * zoom;
        screenY = cy + (p.y - cameraY) * zoom;
      }
      return { x: screenX, y: screenY };
    };
    let minPx = w, minPy = h, maxPx = 0, maxPy = 0;
    let hasSegments = false;
    for (const s of roadSegments) {
      if (!s || !s.r) continue;
      hasSegments = true;
      const a = projectWorldToScreen(s.r.start);
      const b = projectWorldToScreen(s.r.end);
      minPx = Math.min(minPx, a.x, b.x);
      minPy = Math.min(minPy, a.y, b.y);
      maxPx = Math.max(maxPx, a.x, b.x);
      maxPy = Math.max(maxPy, a.y, b.y);
    }
    if (!hasSegments) {
      minPx = 0; minPy = 0; maxPx = w - 1; maxPy = h - 1;
    }
    if (maxPx < minPx || maxPy < minPy) {
      minPx = 0; minPy = 0; maxPx = w - 1; maxPy = h - 1;
    }
    const pad = Math.ceil((config.render as any).noisePaddingPx ?? 64);
    minPx = Math.max(0, Math.floor(minPx - pad));
    minPy = Math.max(0, Math.floor(minPy - pad));
    maxPx = Math.min(w - 1, Math.ceil(maxPx + pad));
    maxPy = Math.min(h - 1, Math.ceil(maxPy + pad));

    try { if ((this as any)._DEBUG) console.log('[NoiseZoning] redraw pixel bbox', minPx, minPy, maxPx, maxPy); } catch (e) {}

    // NO legacy full-image cache path: always use pixelated coarse rendering
    // Determine sampling step in screen pixels (pixelated blocks)
    const requestedStep = computeSampleStep(w, h, zoom);
    const minPxSize = (this as any)._pixelSize ?? 4;
    let sampleStepPx = Math.max(requestedStep, minPxSize);
    // Compute coarse grid size in screen-space so the number of samples is bounded
    const regionPxW = (maxPx - minPx + 1);
    const regionPxH = (maxPy - minPy + 1);
    // Estimate coarse grid counts based on the requested sample step.
    const estimateCoarseDims = () => ({
      w: Math.max(2, Math.floor(regionPxW / sampleStepPx) + 1),
      h: Math.max(2, Math.floor(regionPxH / sampleStepPx) + 1),
    });
    let { w: estimatedCoarseW, h: estimatedCoarseH } = estimateCoarseDims();
    // Cap total cells to avoid explosion at high zoom — adaptively increase sampleStepPx
    const MAX_CELLS = 20000; // safe upper bound for cells (tunable)
    let totalCells = estimatedCoarseW * estimatedCoarseH;
    if (totalCells > MAX_CELLS) {
      const scale = Math.sqrt(totalCells / MAX_CELLS);
      // increase sample step in pixel-space to reduce sample count
      const newStep = Math.max(sampleStepPx, Math.ceil(sampleStepPx * scale));
      sampleStepPx = newStep;
      ({ w: estimatedCoarseW, h: estimatedCoarseH } = estimateCoarseDims());
      totalCells = estimatedCoarseW * estimatedCoarseH;
      try { if ((this as any)._DEBUG) console.log('[NoiseZoning] capped coarse cells', totalCells, 'using stepPx', sampleStepPx); } catch (e) {}
    }
    // helper: convert screen px -> world coords (handles isometric)
    // Precompute sample positions: sample at center of each coarse cell in screen-space, map back to world and sample noise
    const safeZoom = Math.max(zoom, 1e-6);
    const invZoom = 1 / safeZoom;
    const screenToWorld = (screenX: number, screenY: number) => {
      if (renderModeIsometric) {
        const isoX = cameraIsoX + (screenX - cx) * invZoom;
        const isoY = cameraIsoY + (screenY - cy) * invZoom;
        const det = (isoA * isoD) - (isoB * isoC);
        if (!isFinite(det) || Math.abs(det) < 1e-8 || !isFinite(isoX) || !isFinite(isoY)) {
          return {
            x: cameraX + (screenX - cx) * invZoom,
            y: cameraY + (screenY - cy) * invZoom,
          };
        }
        const worldX = (isoD * isoX - isoC * isoY) / det;
        const worldY = (-isoB * isoX + isoA * isoY) / det;
        if (!isFinite(worldX) || !isFinite(worldY)) {
          return {
            x: cameraX + (screenX - cx) * invZoom,
            y: cameraY + (screenY - cy) * invZoom,
          };
        }
        return { x: worldX, y: worldY };
      }
      return {
        x: cameraX + (screenX - cx) * invZoom,
        y: cameraY + (screenY - cy) * invZoom,
      };
    };

    const pixelSizePx = sampleStepPx;
    const worldStep = pixelSizePx / safeZoom;
    if (!(worldStep > 0) || !Number.isFinite(worldStep)) {
      return;
    }
    const invWorldStep = 1 / worldStep;

    const worldCorners = [
      screenToWorld(minPx, minPy),
      screenToWorld(maxPx, minPy),
      screenToWorld(minPx, maxPy),
      screenToWorld(maxPx, maxPy),
    ];
    let minWorldX = Infinity;
    let minWorldY = Infinity;
    let maxWorldX = -Infinity;
    let maxWorldY = -Infinity;
    for (const corner of worldCorners) {
      const wx = corner?.x;
      const wy = corner?.y;
      if (!Number.isFinite(wx) || !Number.isFinite(wy)) continue;
      if (wx < minWorldX) minWorldX = wx;
      if (wy < minWorldY) minWorldY = wy;
      if (wx > maxWorldX) maxWorldX = wx;
      if (wy > maxWorldY) maxWorldY = wy;
    }
    if (!Number.isFinite(minWorldX) || !Number.isFinite(minWorldY) || !Number.isFinite(maxWorldX) || !Number.isFinite(maxWorldY)) {
      minWorldX = cameraX - (cx - minPx) * invZoom;
      maxWorldX = cameraX + (maxPx - cx) * invZoom;
      minWorldY = cameraY - (cy - minPy) * invZoom;
      maxWorldY = cameraY + (maxPy - cy) * invZoom;
    }

    const padCells = 2;
    let gridMinX = Math.floor(minWorldX * invWorldStep) - padCells;
    let gridMaxX = Math.floor(maxWorldX * invWorldStep) + padCells;
    let gridMinY = Math.floor(minWorldY * invWorldStep) - padCells;
    let gridMaxY = Math.floor(maxWorldY * invWorldStep) + padCells;
    if (gridMaxX < gridMinX) {
      const tmp = gridMinX;
      gridMinX = gridMaxX;
      gridMaxX = tmp;
    }
    if (gridMaxY < gridMinY) {
      const tmp = gridMinY;
      gridMinY = gridMaxY;
      gridMaxY = tmp;
    }

    const coarseW = Math.max(1, gridMaxX - gridMinX + 1);
    const coarseH = Math.max(1, gridMaxY - gridMinY + 1);
    const coarse = new Float32Array(coarseW * coarseH);
    const coarseRoadMask = new Uint8Array(coarseW * coarseH); // 0/1 mask indicating presence of road
    const coarseCenters = new Float32Array(coarseW * coarseH * 2);

    for (let gy = 0; gy < coarseH; gy++) {
      const gridY = gridMinY + gy;
      const worldY = (gridY + 0.5) * worldStep;
      for (let gx = 0; gx < coarseW; gx++) {
        const idx = gy * coarseW + gx;
        const gridX = gridMinX + gx;
        const worldX = (gridX + 0.5) * worldStep;
        coarse[idx] = sampleWarpedNoise(this._noise, worldX * baseScale, worldY * baseScale, octaves, lacunarity, gain);
        const screenPt = projectWorldToScreen({ x: worldX, y: worldY });
        if (!Number.isFinite(screenPt.x) || !Number.isFinite(screenPt.y)) {
          coarseCenters[idx * 2] = NaN;
          coarseCenters[idx * 2 + 1] = NaN;
        } else {
          coarseCenters[idx * 2] = screenPt.x;
          coarseCenters[idx * 2 + 1] = screenPt.y;
        }
      }
    }

    // Build a rasterized low-resolution mask of roads once for this view (coarse grid). This is much faster
    // than querying the quadtree per sample. We draw all segments into an offscreen canvas sized to the
    // coarse grid, stroke with width proportional to segment width and then sample alpha to build mask.
    let maskOk = false;
    try {
      // cache key based on view
      const maskCache = (this as any)._maskCache as any | undefined;
      if (
        maskCache &&
        maskCache.w === coarseW &&
        maskCache.h === coarseH &&
        maskCache.gridMinX === gridMinX &&
        maskCache.gridMinY === gridMinY &&
        maskCache.worldStep === worldStep
      ) {
        // reuse
        const src = maskCache.data;
        for (let i = 0; i < coarseRoadMask.length; i++) coarseRoadMask[i] = src[i];
        maskOk = true;
      } else {
        const maskCanvas = document.createElement('canvas');
        maskCanvas.width = coarseW;
        maskCanvas.height = coarseH;
        const mctx = maskCanvas.getContext('2d');
        if (!mctx) throw new Error('no ctx');
        // clear
        mctx.clearRect(0, 0, coarseW, coarseH);
        mctx.fillStyle = 'black';
        mctx.fillRect(0, 0, coarseW, coarseH);
        mctx.strokeStyle = 'white';
        mctx.lineCap = 'butt';

        // Helpers: convert world point -> coarse grid coordinates
        const toCoarse = (worldPt: { x: number; y: number }) => ({
          x: worldPt.x * invWorldStep - gridMinX,
          y: worldPt.y * invWorldStep - gridMinY,
        });
        for (const seg of roadSegments) {
          if (!seg || !seg.r) continue;
          const a = toCoarse(seg.r.start);
          const b = toCoarse(seg.r.end);
          if (!Number.isFinite(a.x) || !Number.isFinite(a.y) || !Number.isFinite(b.x) || !Number.isFinite(b.y)) continue;
          const strokePx = Math.max(1, (seg.width || 1) / Math.max(1e-6, worldStep));
          mctx.lineWidth = strokePx;
          mctx.beginPath();
          mctx.moveTo(a.x, a.y);
          mctx.lineTo(b.x, b.y);
          mctx.stroke();
        }
        // Read mask and populate coarseRoadMask
        const md = mctx.getImageData(0, 0, coarseW, coarseH).data;
        for (let gy = 0; gy < coarseH; gy++) {
          for (let gx = 0; gx < coarseW; gx++) {
            const i = (gy * coarseW + gx) * 4;
            const alpha = md[i + 3];
            coarseRoadMask[gy * coarseW + gx] = alpha > 0 ? 1 : 0;
          }
        }
        // cache
        (this as any)._maskCache = {
          w: coarseW,
          h: coarseH,
          gridMinX,
          gridMinY,
          worldStep,
          data: new Uint8Array(coarseRoadMask),
        };
        maskOk = true;
      }
    } catch (e) {
      // fallback: if rasterization failed, leave mask as zeros
      maskOk = false;
    }
  // If mask rasterization failed or produced no road pixels, fallback to full mask so
    // the noise is visible across the region (this ensures enabling the overlay always shows noise).
    if (!maskOk) {
      // fill coarseRoadMask with 1s so noise can be rendered across the region
      for (let i = 0; i < coarseRoadMask.length; i++) coarseRoadMask[i] = 1;
      maskOk = true;
    } else {
      // check if mask is empty (no road pixels); if so, fallback to full mask
      let anyRoad = false;
      for (let i = 0; i < coarseRoadMask.length; i++) { if (coarseRoadMask[i]) { anyRoad = true; break; } }
      if (!anyRoad) {
        for (let i = 0; i < coarseRoadMask.length; i++) coarseRoadMask[i] = 1;
      }
    }

    // build intersection mask at coarse resolution: 1 where road mask AND noise > threshold
    const noiseThreshold = (this as any)._noiseThreshold ?? 0.5;
    const intersectionMask = new Uint8Array(coarseW * coarseH);
    for (let i = 0; i < coarse.length; i++) {
      intersectionMask[i] = (coarse[i] > noiseThreshold && coarseRoadMask[i]) ? 1 : 0;
    }
    // Pixelated rendering: draw one rect per coarse cell using nearest-neighbor.
    // This avoids allocating a full ImageData buffer and reduces memory churn.
    try {
      // Clear overlay
      this._ctx.clearRect(0, 0, w, h);
      this._ctx.save();
      // black fill style with desired alpha
      const aNorm = (alpha / 255) || 0;
      this._ctx.fillStyle = `rgba(0,0,0,${aNorm})`;

      const drawW = Math.max(1, Math.ceil(pixelSizePx));
      const drawH = Math.max(1, Math.ceil(pixelSizePx));
      const halfW = drawW * 0.5;
      const halfH = drawH * 0.5;

      for (let gy = 0; gy < coarseH; gy++) {
        for (let gx = 0; gx < coarseW; gx++) {
          const i = gy * coarseW + gx;
          if (!coarseRoadMask[i]) continue; // skip non-road blocks
          const n = coarse[i];
          if (n <= noiseThreshold) continue;
          const centerX = coarseCenters[i * 2];
          const centerY = coarseCenters[i * 2 + 1];
          if (!Number.isFinite(centerX) || !Number.isFinite(centerY)) continue;
          if (centerX + halfW < minPx || centerX - halfW > maxPx || centerY + halfH < minPy || centerY - halfH > maxPy) continue;
          const x0 = Math.round(centerX - halfW);
          const y0 = Math.round(centerY - halfH);
          this._ctx.fillRect(x0, y0, drawW, drawH);
        }
      }

      this._ctx.restore();
    } catch (e) {
      // If rect drawing fails, clear canvas as a safe fallback
      try { this._ctx.clearRect(0, 0, w, h); } catch (e2) {}
    }
    // If requested, draw outlines around the road geometry intersecting noisy areas
    if ((this as any)._showIntersectionOutline) {
      // Compute outlines by following the actual road geometry for the segments
      // whose centerline intersects noisy cells. This ensures the contour hugs
      // the affected streets instead of the noise field itself.
      const contourKey = `${this._seed}|intersection|${this._params.baseScale}|${this._params.octaves}|${this._params.lacunarity}|${this._params.gain}|${coarseW}x${coarseH}|grid:${gridMinX},${gridMinY}|step:${worldStep.toFixed(6)}|${cameraX.toFixed(3)}|${cameraY.toFixed(3)}|${zoom.toFixed(3)}|${noiseThreshold.toFixed(3)}|${roadSegments.length}`;
      let roadPolys: number[][][] = [];
      if (this._contourCache && this._contourCache.key === contourKey) {
        roadPolys = this._contourCache.contours || [];
      } else {
        const minCellSizePx = Math.max(1, Math.ceil(pixelSizePx));
        const polygons: number[][][] = [];
        const pointHitsIntersection = (pt: { x: number; y: number }) => {
          const worldPt = screenToWorld(pt.x, pt.y);
          const wx = worldPt?.x;
          const wy = worldPt?.y;
          if (!Number.isFinite(wx) || !Number.isFinite(wy)) return false;
          const gx = Math.floor(wx * invWorldStep) - gridMinX;
          const gy = Math.floor(wy * invWorldStep) - gridMinY;
          if (gx < 0 || gy < 0 || gx >= coarseW || gy >= coarseH) return false;
          return intersectionMask[gy * coarseW + gx] > 0;
        };
        for (const seg of roadSegments) {
          if (!seg || !seg.r) continue;
          const startWorld = seg.r.start;
          const endWorld = seg.r.end;
          const startScreen = projectWorldToScreen(startWorld);
          const endScreen = projectWorldToScreen(endWorld);
          const screenDx = endScreen.x - startScreen.x;
          const screenDy = endScreen.y - startScreen.y;
          const screenLen = Math.hypot(screenDx, screenDy);
          const steps = Math.max(1, Math.ceil(screenLen / minCellSizePx));
          const sampleAt = (t: number) => {
            const clampedT = Math.max(0, Math.min(1, t));
            const samplePt = {
              x: startScreen.x + screenDx * clampedT,
              y: startScreen.y + screenDy * clampedT,
            };
            return pointHitsIntersection(samplePt);
          };

          const intervals: Array<{ start: number; end: number }> = [];
          let runStart: number | null = null;
          const stepCount = Math.max(1, steps);
          for (let s = 0; s <= stepCount; s++) {
            const t = stepCount === 0 ? 0 : s / stepCount;
            const inside = sampleAt(t);
            if (inside) {
              if (runStart == null) runStart = t;
            } else if (runStart != null) {
              const endT = t;
              if (endT > runStart + 1e-4) intervals.push({ start: runStart, end: endT });
              runStart = null;
            }
          }
          if (runStart != null) {
            intervals.push({ start: runStart, end: 1 });
          }

          if (!intervals.length) continue;

          const dirX = endWorld.x - startWorld.x;
          const dirY = endWorld.y - startWorld.y;
          const dirLen = Math.hypot(dirX, dirY);
          if (!(dirLen > 1e-6)) continue;
          const invLen = 1 / dirLen;
          const ux = dirX * invLen;
          const uy = dirY * invLen;
          const nx = -uy;
          const ny = ux;
          const widthWorld = seg.width || 0;
          if (!(widthWorld > 0)) continue;
          const halfWidth = widthWorld * 0.5;
          const padT = Math.min(0.45, 0.5 / stepCount);

          const pushIntervalPolygon = (startT: number, endT: number) => {
            const lengthWorld = dirLen;
            const st = Math.max(0, Math.min(1, startT));
            const et = Math.max(0, Math.min(1, endT));
            if (!(et > st + 1e-4)) return;
            const sx = startWorld.x + ux * (lengthWorld * st);
            const sy = startWorld.y + uy * (lengthWorld * st);
            const ex = startWorld.x + ux * (lengthWorld * et);
            const ey = startWorld.y + uy * (lengthWorld * et);
            const cornersWorld = [
              { x: sx + nx * halfWidth, y: sy + ny * halfWidth },
              { x: ex + nx * halfWidth, y: ey + ny * halfWidth },
              { x: ex - nx * halfWidth, y: ey - ny * halfWidth },
              { x: sx - nx * halfWidth, y: sy - ny * halfWidth },
            ];
            const polygon = cornersWorld.map(pt => {
              const scr = projectWorldToScreen(pt);
              return [scr.x, scr.y];
            });
            if (polygon.some(([px, py]) => !Number.isFinite(px) || !Number.isFinite(py))) return;
            polygons.push(polygon);
          };

          for (const interval of intervals) {
            const expandedStart = interval.start - padT;
            const expandedEnd = interval.end + padT;
            pushIntervalPolygon(expandedStart, expandedEnd);
          }
        }
        roadPolys = polygons;
        this._contourCache = { key: contourKey, contours: roadPolys };
      }
      try {
        this._ctx.save();
        this._ctx.strokeStyle = '#ffffff';
        this._ctx.lineWidth = Math.max(1, 2 * (window.devicePixelRatio || 1));
        this._ctx.lineJoin = 'round';
        this._ctx.lineCap = 'round';
        for (const poly of roadPolys) {
          if (!poly || poly.length < 2) continue;
          this._ctx.beginPath();
          this._ctx.moveTo(poly[0][0], poly[0][1]);
          for (let i = 1; i < poly.length; i++) {
            this._ctx.lineTo(poly[i][0], poly[i][1]);
          }
          if (poly.length > 2) this._ctx.closePath();
          this._ctx.stroke();
        }
      } catch (e) {
        // ignore drawing errors
      } finally {
        this._ctx.restore();
      }
    }
    // Store a small coarse cache so subsequent redraws can reuse the intersection mask
    this._pixelCache = {
      w,
      h,
      cameraX,
      cameraY,
      zoom,
      bbox: [minPx, minPy, maxPx, maxPy],
      data: {
        type: 'coarse',
        coarseW,
        coarseH,
        gridMinX,
        gridMinY,
        worldStep,
        pixelSizePx,
        intersectionMask: intersectionMask,
      },
    };
    try {
      if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
        const evt = new CustomEvent('noise-overlay-intersection-updated', {
          detail: {
            coarseW,
            coarseH,
            gridMinX,
            gridMinY,
            worldStep,
            pixelSizePx,
          },
        });
        window.dispatchEvent(evt);
      }
    } catch (e) {}
    try { if ((this as any)._DEBUG) console.log('[NoiseZoning] redraw FINISHED and cached pixels'); } catch (e) {}
  },
  _syncSizeAndRedraw() {
    if (!this._overlayCanvas || !this._baseCanvas) return;
    const parent = this._baseCanvas.parentElement as HTMLElement | null;
    const dpr = window.devicePixelRatio || 1;
    const cssW = parent?.clientWidth ?? this._baseCanvas.clientWidth;
    const cssH = parent?.clientHeight ?? this._baseCanvas.clientHeight;
    this._overlayCanvas.style.width = `${cssW}px`;
    this._overlayCanvas.style.height = `${cssH}px`;
    const pxW = Math.max(1, Math.floor(cssW * dpr));
    const pxH = Math.max(1, Math.floor(cssH * dpr));
    if (this._overlayCanvas.width !== pxW || this._overlayCanvas.height !== pxH) {
      this._overlayCanvas.width = pxW;
      this._overlayCanvas.height = pxH;
    }
    if (this._overlayCanvas) this._overlayCanvas.style.display = this.enabled ? 'block' : 'none';
    if (this.enabled) this.redraw();
  },
  detach() {
    try { this._observer?.disconnect(); } catch {}
    this._observer = null;
    if (this._overlayCanvas && this._overlayCanvas.parentElement) {
      try { this._overlayCanvas.parentElement.removeChild(this._overlayCanvas); } catch (e) {}
    }
    this._overlayCanvas = null;
    this._ctx = null;
    this._noise = null;
    this.enabled = false;
    this._pixelCache = null;
    // remove map-generated handler
    try {
      if (this._mapGeneratedHandler && typeof window !== 'undefined' && typeof window.removeEventListener === 'function') {
        window.removeEventListener('map-generated', this._mapGeneratedHandler);
      }
    } catch (e) {}
    this._notifyChange();
  },
  setView(view: { cameraX: number; cameraY: number; zoom: number }) {
    this._view = view;
  },
  setEnabled(on: boolean) {
    this.enabled = !!on;
    if (this._overlayCanvas) this._overlayCanvas.style.display = this.enabled ? 'block' : 'none';
    if (this.enabled) {
      // ensure caches are invalidated so redraw always recomputes masks and noise
      this._pixelCache = null;
      (this as any)._maskCache = null;
      try { this._ensureSize(); } catch (e) {}
      if ((this as any)._DEBUG) console.log('[NoiseZoning] setEnabled true -> dispatching request-sync');
      try {
        if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
          const ev = new CustomEvent('noise-overlay-request-sync');
          window.dispatchEvent(ev);
        }
      } catch (e) {}
      if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
        window.requestAnimationFrame(() => { if (this.enabled) this.redraw(); });
      } else {
        this.redraw();
      }
    }
    this._notifyChange();
  },
  setParams(p?: Partial<NoiseZoningParams>) {
    if (!p) return;
    const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
    const cur = this._params;
    const thresholds = { ...cur.thresholds, ...(p.thresholds || {}) };
    // Impor ordem ascendente e 0..1
    let r1 = clamp01(thresholds.r1);
    let r2 = clamp01(Math.max(thresholds.r2, r1 + 1e-3));
    let r3 = clamp01(Math.max(thresholds.r3, r2 + 1e-3));
    let r4 = clamp01(Math.max(thresholds.r4, r3 + 1e-3));
    this._params = {
      baseScale: p.baseScale ?? cur.baseScale,
      octaves: p.octaves ?? cur.octaves,
      lacunarity: p.lacunarity ?? cur.lacunarity,
      gain: p.gain ?? cur.gain,
      thresholds: { r1, r2, r3, r4 },
    };
  // Propagar para Zoning para manter consistência com a geração
  Zoning.setParams(this._params);
  this._pixelCache = null;
  if (this.enabled) this.redraw();
  },
  getParams() {
    return JSON.parse(JSON.stringify(this._params)) as NoiseZoningParams;
  },
  setNoiseThreshold(v?: number) {
    if (typeof v !== 'number' || !isFinite(v)) return;
    const nv = Math.max(0, Math.min(1, v));
    (this as any)._noiseThreshold = nv;
    this._pixelCache = null;
    if (this.enabled) this.redraw();
  },
  getNoiseThreshold() {
    return (this as any)._noiseThreshold ?? 0.5;
  },
  setPixelSize(px?: number) {
    if (typeof px !== 'number' || !isFinite(px)) return;
    const n = Math.max(1, Math.floor(px));
    (this as any)._pixelSize = n;
    this._pixelCache = null;
    if (this.enabled) this.redraw();
  },
  getPixelSize() {
    return (this as any)._pixelSize ?? 4;
  },
  setIntersectionOutlineEnabled(on: boolean) {
    this._contourCache = null;
    (this as any)._showIntersectionOutline = !!on;
    if (this.enabled) this.redraw();
    try {
      if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
        const evt = new CustomEvent('noise-overlay-outline-change', { detail: { outline: !!on } });
        window.dispatchEvent(evt);
      }
    } catch (e) {}
  },
  getIntersectionOutlineEnabled() {
    return !!(this as any)._showIntersectionOutline;
  },
  getIntersectionMaskData() {
    const cache = this._pixelCache;
    if (!cache || !cache.data || cache.data.type !== 'coarse') return null;
    const data = cache.data;
    const mask = data.intersectionMask as Uint8Array | undefined;
    if (!mask || !mask.length) return null;
    if (!(data.coarseW > 0) || !(data.coarseH > 0) || !(data.worldStep > 0)) return null;
    return {
      coarseW: data.coarseW,
      coarseH: data.coarseH,
      gridMinX: data.gridMinX,
      gridMinY: data.gridMinY,
      worldStep: data.worldStep,
      pixelSizePx: data.pixelSizePx,
      intersectionMask: mask,
    };
  },
  createIntersectionTester() {
    const info = this.getIntersectionMaskData?.();
    if (!info || !(info.worldStep > 0)) return null;
    const { coarseW, coarseH, gridMinX, gridMinY, worldStep, intersectionMask } = info;
    const invStep = 1 / worldStep;
    return (x: number, y: number) => {
      if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
      const gx = Math.floor(x * invStep) - gridMinX;
      const gy = Math.floor(y * invStep) - gridMinY;
      if (gx < 0 || gy < 0 || gx >= coarseW || gy >= coarseH) return false;
      return intersectionMask[gy * coarseW + gx] > 0;
    };
  },
  getSeed() {
    return this._seed;
  },
};

// marching squares: extract contours from binary grid (values 0/1)

function marchingSquaresContoursScreen(grid: Uint8Array, w: number, h: number, minPx: number, minPy: number, cellPxW: number, cellPxH: number) {
  const segments: Array<[[number, number], [number, number]]> = [];
  const get = (x: number, y: number) => (x >= 0 && y >= 0 && x < w && y < h) ? (grid[y * w + x] ? 1 : 0) : 0;
  const sx = (gx: number) => minPx + gx * cellPxW;
  const sy = (gy: number) => minPy + gy * cellPxH;
  for (let y = 0; y < h - 1; y++) {
    for (let x = 0; x < w - 1; x++) {
      const tl = get(x, y);
      const tr = get(x + 1, y);
      const br = get(x + 1, y + 1);
      const bl = get(x, y + 1);
      const code = (tl << 3) | (tr << 2) | (br << 1) | bl;
      if (code === 0 || code === 15) continue;
      const top: [number, number] = [(sx(x) + sx(x + 1)) * 0.5, sy(y)];
      const right: [number, number] = [sx(x + 1), (sy(y) + sy(y + 1)) * 0.5];
      const bottom: [number, number] = [(sx(x) + sx(x + 1)) * 0.5, sy(y + 1)];
      const left: [number, number] = [sx(x), (sy(y) + sy(y + 1)) * 0.5];
      switch (code) {
        case 1: segments.push([bottom, left]); break;
        case 2: segments.push([right, bottom]); break;
        case 3: segments.push([right, left]); break;
        case 4: segments.push([top, right]); break;
        case 5: segments.push([top, left]); segments.push([right, bottom]); break;
        case 6: segments.push([top, bottom]); break;
        case 7: segments.push([top, left]); break;
        case 8: segments.push([left, top]); break;
        case 9: segments.push([bottom, top]); break;
        case 10: segments.push([left, right]); segments.push([top, bottom]); break;
        case 11: segments.push([right, top]); break;
        case 12: segments.push([left, right]); break;
        case 13: segments.push([bottom, right]); break;
        case 14: segments.push([left, bottom]); break;
        default: break;
      }
    }
  }
  const key = (p: [number, number]) => `${p[0].toFixed(3)}:${p[1].toFixed(3)}`;
  const mapNext = new Map<string, Array<string>>();
  const pointMap = new Map<string, [number, number]>();
  const edgeVisited = new Set<string>();
  for (const seg of segments) {
    const a = seg[0]; const b = seg[1];
    const ka = key(a); const kb = key(b);
    pointMap.set(ka, a); pointMap.set(kb, b);
    if (!mapNext.has(ka)) mapNext.set(ka, []);
    if (!mapNext.has(kb)) mapNext.set(kb, []);
    mapNext.get(ka)!.push(kb);
    mapNext.get(kb)!.push(ka);
  }
  const contours: number[][][] = [];
  for (const startKey of mapNext.keys()) {
    if (!mapNext.has(startKey)) continue;
    for (const neighbor of mapNext.get(startKey) || []) {
      const edgeId = `${startKey}->${neighbor}`;
      if (edgeVisited.has(edgeId)) continue;
      const poly: Array<[number, number]> = [];
      let cur = startKey; let next = neighbor;
      poly.push(pointMap.get(cur)!);
      while (true) {
        const eId = `${cur}->${next}`;
        if (edgeVisited.has(eId)) break;
        edgeVisited.add(eId);
        const nextPt = pointMap.get(next)!;
        poly.push(nextPt);
        const neighbors = mapNext.get(next) || [];
        let chosen: string | null = null;
        for (const nb of neighbors) {
          if (nb === cur) continue;
          if (!edgeVisited.has(`${next}->${nb}`)) { chosen = nb; break; }
        }
        if (!chosen) break;
        cur = next; next = chosen;
      }
      if (poly.length >= 2) contours.push(poly.map(p => [p[0], p[1]]));
    }
  }
  return contours;
}

function marchingSquaresContours(grid: Uint8Array, w: number, h: number, sampleStep: number, minPx: number, minPy: number, stepOffset: number) {
  const segments: Array<[[number, number], [number, number]]> = [];
  const get = (x: number, y: number) => (x >= 0 && y >= 0 && x < w && y < h) ? (grid[y * w + x] ? 1 : 0) : 0;
  const sx = (gx: number) => minPx + gx * sampleStep + stepOffset;
  const sy = (gy: number) => minPy + gy * sampleStep + stepOffset;

  // For each cell, compute case and produce 0..2 segments between edge midpoints
  for (let y = 0; y < h - 1; y++) {
    for (let x = 0; x < w - 1; x++) {
      const tl = get(x, y);
      const tr = get(x + 1, y);
      const br = get(x + 1, y + 1);
      const bl = get(x, y + 1);
      const code = (tl << 3) | (tr << 2) | (br << 1) | bl;
      if (code === 0 || code === 15) continue;
      // edge midpoints
  const top: [number, number] = [(sx(x) + sx(x + 1)) * 0.5, sy(y)];
  const right: [number, number] = [sx(x + 1), (sy(y) + sy(y + 1)) * 0.5];
  const bottom: [number, number] = [(sx(x) + sx(x + 1)) * 0.5, sy(y + 1)];
  const left: [number, number] = [sx(x), (sy(y) + sy(y + 1)) * 0.5];

      // mapping standard marching squares cases to segments (pairs of points)
      switch (code) {
        case 1: segments.push([bottom, left]); break;
        case 2: segments.push([right, bottom]); break;
        case 3: segments.push([right, left]); break;
        case 4: segments.push([top, right]); break;
        case 5: segments.push([top, left]); segments.push([right, bottom]); break;
        case 6: segments.push([top, bottom]); break;
        case 7: segments.push([top, left]); break;
        case 8: segments.push([left, top]); break;
        case 9: segments.push([bottom, top]); break;
        case 10: segments.push([left, right]); segments.push([top, bottom]); break;
        case 11: segments.push([right, top]); break;
        case 12: segments.push([left, right]); break;
        case 13: segments.push([bottom, right]); break;
        case 14: segments.push([left, bottom]); break;
        default: break;
      }
    }
  }

  // Chain segments into polylines
  // use higher precision when keying points to avoid accidentally merging nearby
  // midpoints (which causes straight-line artifacts in contours)
  const key = (p: [number, number]) => `${p[0].toFixed(6)}:${p[1].toFixed(6)}`;
  const mapNext = new Map<string, Array<string>>();
  const pointMap = new Map<string, [number, number]>();
  const edgeVisited = new Set<string>();
  for (const seg of segments) {
    const a = seg[0]; const b = seg[1];
    const ka = key(a); const kb = key(b);
    pointMap.set(ka, a); pointMap.set(kb, b);
    if (!mapNext.has(ka)) mapNext.set(ka, []);
    if (!mapNext.has(kb)) mapNext.set(kb, []);
    mapNext.get(ka)!.push(kb);
    mapNext.get(kb)!.push(ka);
  }

  const contours: number[][][] = [];
  for (const startKey of mapNext.keys()) {
    if (!mapNext.has(startKey)) continue;
    // try to build a loop starting from startKey
    for (const neighbor of mapNext.get(startKey) || []) {
      const edgeId = `${startKey}->${neighbor}`;
      if (edgeVisited.has(edgeId)) continue;
      const poly: Array<[number, number]> = [];
      let cur = startKey; let prev = neighbor; // we'll walk and invert later
      // walk forward
      poly.push(pointMap.get(cur)!);
      let next = neighbor;
      while (true) {
        const eId = `${cur}->${next}`;
        if (edgeVisited.has(eId)) break;
        edgeVisited.add(eId);
        // append next point
        const nextPt = pointMap.get(next)!;
        poly.push(nextPt);
        // find next neighbor to continue (choose one that's not cur)
        const neighbors = mapNext.get(next) || [];
        let chosen: string | null = null;
        for (const nb of neighbors) {
          if (nb === cur) continue;
          // prefer unvisited edge
          if (!edgeVisited.has(`${next}->${nb}`)) { chosen = nb; break; }
        }
        if (!chosen) {
          // closed or dead end
          break;
        }
        cur = next; next = chosen;
      }
      if (poly.length >= 2) {
        // convert to simple number[][] and push
        contours.push(poly.map(p => [p[0], p[1]]));
      }
    }
  }

  return contours;
}

// marching squares that returns contours in WORLD coordinates (not screen).
function marchingSquaresContoursWorld(grid: Uint8Array, w: number, h: number, worldStep: number, minWx: number, minWy: number, stepOffsetWorld: number) {
  // reuse same logic but map cell centers to world positions
  const sx = (gx: number) => minWx + gx * worldStep + stepOffsetWorld;
  const sy = (gy: number) => minWy + gy * worldStep + stepOffsetWorld;
  // We'll call the original marchingSquaresContours but need to return world coords.
  // Create a temporary wrapper that maps edges to midpoints in world-space and chains segments similarly.
  const segments: Array<[[number, number], [number, number]]> = [];
  const get = (x: number, y: number) => (x >= 0 && y >= 0 && x < w && y < h) ? (grid[y * w + x] ? 1 : 0) : 0;
  for (let y = 0; y < h - 1; y++) {
    for (let x = 0; x < w - 1; x++) {
      const tl = get(x, y);
      const tr = get(x + 1, y);
      const br = get(x + 1, y + 1);
      const bl = get(x, y + 1);
      const code = (tl << 3) | (tr << 2) | (br << 1) | bl;
      if (code === 0 || code === 15) continue;
      const top: [number, number] = [(sx(x) + sx(x + 1)) * 0.5, sy(y)];
      const right: [number, number] = [sx(x + 1), (sy(y) + sy(y + 1)) * 0.5];
      const bottom: [number, number] = [(sx(x) + sx(x + 1)) * 0.5, sy(y + 1)];
      const left: [number, number] = [sx(x), (sy(y) + sy(y + 1)) * 0.5];
      switch (code) {
        case 1: segments.push([bottom, left]); break;
        case 2: segments.push([right, bottom]); break;
        case 3: segments.push([right, left]); break;
        case 4: segments.push([top, right]); break;
        case 5: segments.push([top, left]); segments.push([right, bottom]); break;
        case 6: segments.push([top, bottom]); break;
        case 7: segments.push([top, left]); break;
        case 8: segments.push([left, top]); break;
        case 9: segments.push([bottom, top]); break;
        case 10: segments.push([left, right]); segments.push([top, bottom]); break;
        case 11: segments.push([right, top]); break;
        case 12: segments.push([left, right]); break;
        case 13: segments.push([bottom, right]); break;
        case 14: segments.push([left, bottom]); break;
        default: break;
      }
    }
  }

  // Chain segments into polylines (same algorithm as before but points are world coords)
  // use higher precision when keying world coordinates for the same reason
  const key = (p: [number, number]) => `${p[0].toFixed(6)}:${p[1].toFixed(6)}`;
  const mapNext = new Map<string, Array<string>>();
  const pointMap = new Map<string, [number, number]>();
  const edgeVisited = new Set<string>();
  for (const seg of segments) {
    const a = seg[0]; const b = seg[1];
    const ka = key(a); const kb = key(b);
    pointMap.set(ka, a); pointMap.set(kb, b);
    if (!mapNext.has(ka)) mapNext.set(ka, []);
    if (!mapNext.has(kb)) mapNext.set(kb, []);
    mapNext.get(ka)!.push(kb);
    mapNext.get(kb)!.push(ka);
  }
  const contours: number[][][] = [];
  for (const startKey of mapNext.keys()) {
    if (!mapNext.has(startKey)) continue;
    for (const neighbor of mapNext.get(startKey) || []) {
      const edgeId = `${startKey}->${neighbor}`;
      if (edgeVisited.has(edgeId)) continue;
      const poly: Array<[number, number]> = [];
      let cur = startKey; let next = neighbor;
      poly.push(pointMap.get(cur)!);
      while (true) {
        const eId = `${cur}->${next}`;
        if (edgeVisited.has(eId)) break;
        edgeVisited.add(eId);
        const nextPt = pointMap.get(next)!;
        poly.push(nextPt);
        const neighbors = mapNext.get(next) || [];
        let chosen: string | null = null;
        for (const nb of neighbors) {
          if (nb === cur) continue;
          if (!edgeVisited.has(`${next}->${nb}`)) { chosen = nb; break; }
        }
        if (!chosen) break;
        cur = next; next = chosen;
      }
      if (poly.length >= 2) contours.push(poly.map(p => [p[0], p[1]]));
    }
  }
  return contours;
}


function intToRgb(intColor: number): [number, number, number] {
  return [(intColor >> 16) & 255, (intColor >> 8) & 255, intColor & 255];
}

export default NoiseZoning;
