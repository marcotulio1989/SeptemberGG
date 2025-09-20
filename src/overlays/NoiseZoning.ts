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
    const segsForBbox = MapStore.getSegments();
    const renderModeIsometric = (config.render as any).mode === 'isometric';
    const isoA = (config.render as any).isoA, isoB = (config.render as any).isoB, isoC = (config.render as any).isoC, isoD = (config.render as any).isoD;
    const cameraIsoX = renderModeIsometric ? (isoA * cameraX + isoC * cameraY) : 0;
    const cameraIsoY = renderModeIsometric ? (isoB * cameraX + isoD * cameraY) : 0;
    let minPx = w, minPy = h, maxPx = 0, maxPy = 0;
    for (const s of segsForBbox) {
      if (!s || !s.r) continue;
      const proj = (p: { x: number; y: number }) => {
        let screenX: number, screenY: number;
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
      const a = proj(s.r.start);
      const b = proj(s.r.end);
      minPx = Math.min(minPx, a.x, b.x);
      minPy = Math.min(minPy, a.y, b.y);
      maxPx = Math.max(maxPx, a.x, b.x);
      maxPy = Math.max(maxPy, a.y, b.y);
    }
    // Se não houver segmentos, ocupar todo o canvas
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
    // compute initial coarse grid size
    let coarseW = Math.max(2, Math.floor(regionPxW / sampleStepPx) + 1);
    let coarseH = Math.max(2, Math.floor(regionPxH / sampleStepPx) + 1);
    // Cap total cells to avoid explosion at high zoom — adaptively increase sampleStepPx
    const MAX_CELLS = 20000; // safe upper bound for cells (tunable)
    let totalCells = coarseW * coarseH;
    if (totalCells > MAX_CELLS) {
      const scale = Math.sqrt(totalCells / MAX_CELLS);
      // increase sample step in pixel-space to reduce sample count
      const newStep = Math.max(sampleStepPx, Math.ceil(sampleStepPx * scale));
      sampleStepPx = newStep;
      coarseW = Math.max(2, Math.floor(regionPxW / sampleStepPx) + 1);
      coarseH = Math.max(2, Math.floor(regionPxH / sampleStepPx) + 1);
      totalCells = coarseW * coarseH;
      try { if ((this as any)._DEBUG) console.log('[NoiseZoning] capped coarse cells', totalCells, 'using stepPx', sampleStepPx); } catch (e) {}
    }
    // helper: convert screen px -> world coords (handles isometric)
    const screenToWorld = (screenX: number, screenY: number) => {
      if (renderModeIsometric) {
        const isoX = cameraIsoX + (screenX - cx) / zoom;
        const isoY = cameraIsoY + (screenY - cy) / zoom;
        const det = isoA * isoD - isoB * isoC;
        if (Math.abs(det) < 1e-12) return { x: cameraX, y: cameraY };
        const wx = (isoD * isoX - isoC * isoY) / det;
        const wy = (-isoB * isoX + isoA * isoY) / det;
        return { x: wx, y: wy };
      }
      return { x: cameraX + (screenX - cx) / zoom, y: cameraY + (screenY - cy) / zoom };
    };
    const worldToScreen = (wx: number, wy: number) => {
      if (renderModeIsometric) {
        const isoX = isoA * wx + isoC * wy;
        const isoY = isoB * wx + isoD * wy;
        return { x: cx + (isoX - cameraIsoX) * zoom, y: cy + (isoY - cameraIsoY) * zoom };
      }
      return { x: cx + (wx - cameraX) * zoom, y: cy + (wy - cameraY) * zoom };
    };

    const viewWorldCorners = [
      screenToWorld(minPx, minPy),
      screenToWorld(maxPx, minPy),
      screenToWorld(minPx, maxPy),
      screenToWorld(maxPx, maxPy),
    ];
    let worldMinX = Infinity;
    let worldMinY = Infinity;
    let worldMaxX = -Infinity;
    let worldMaxY = -Infinity;
    for (const c of viewWorldCorners) {
      if (!c) continue;
      worldMinX = Math.min(worldMinX, c.x);
      worldMaxX = Math.max(worldMaxX, c.x);
      worldMinY = Math.min(worldMinY, c.y);
      worldMaxY = Math.max(worldMaxY, c.y);
    }
    if (!isFinite(worldMinX) || !isFinite(worldMaxX)) {
      worldMinX = cameraX - 50;
      worldMaxX = cameraX + 50;
    }
    if (!isFinite(worldMinY) || !isFinite(worldMaxY)) {
      worldMinY = cameraY - 50;
      worldMaxY = cameraY + 50;
    }
    let stepWorldX = (worldMaxX - worldMinX) / Math.max(1, coarseW - 1);
    let stepWorldY = (worldMaxY - worldMinY) / Math.max(1, coarseH - 1);
    const fallbackWorldStep = sampleStepPx / Math.max(zoom, 1e-6);
    if (!isFinite(stepWorldX) || Math.abs(stepWorldX) < 1e-6) stepWorldX = fallbackWorldStep;
    if (!isFinite(stepWorldY) || Math.abs(stepWorldY) < 1e-6) stepWorldY = fallbackWorldStep;
    const originWorldX = Math.floor(worldMinX / stepWorldX) * stepWorldX;
    const originWorldY = Math.floor(worldMinY / stepWorldY) * stepWorldY;
    while (originWorldX + stepWorldX * (coarseW - 1) < worldMaxX) coarseW++;
    while (originWorldY + stepWorldY * (coarseH - 1) < worldMaxY) coarseH++;

    const coarse = new Float32Array(coarseW * coarseH);
    const coarseRoadMask = new Uint8Array(coarseW * coarseH); // 0/1 mask indicating presence of road

    // Precompute sample positions anchored to world coordinates: each coarse cell corresponds to a
    // world-aligned tile so noise no longer shifts when the camera moves.
    for (let gy = 0; gy < coarseH; gy++) {
      const worldY = originWorldY + (gy + 0.5) * stepWorldY;
      for (let gx = 0; gx < coarseW; gx++) {
        const idx = gy * coarseW + gx;
        const worldX = originWorldX + (gx + 0.5) * stepWorldX;
        coarse[idx] = sampleWarpedNoise(this._noise, worldX * baseScale, worldY * baseScale, octaves, lacunarity, gain);
      }
    }
    // Build a rasterized low-resolution mask of roads once for this view (coarse grid). This is much faster
    // than querying the quadtree per sample. We draw all segments into an offscreen canvas sized to the
    // coarse grid, stroke with width proportional to segment width and then sample alpha to build mask.
    let maskOk = false;
    try {
      // cache key based on view
      const maskCache = (this as any)._maskCache as any | undefined;
      if (maskCache && maskCache.w === coarseW && maskCache.h === coarseH && maskCache.cameraX === cameraX && maskCache.cameraY === cameraY && maskCache.zoom === zoom && maskCache.originWorldX === originWorldX && maskCache.originWorldY === originWorldY && maskCache.stepWorldX === stepWorldX && maskCache.stepWorldY === stepWorldY) {
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

        // Helpers: project world point directly into coarse world grid coordinates
        const segs2 = MapStore.getSegments();
        for (const seg of segs2) {
          if (!seg || !seg.r) continue;
          const toCoarseWorld = (p: { x: number; y: number }) => ({
            x: (p.x - originWorldX) / stepWorldX,
            y: (p.y - originWorldY) / stepWorldY,
          });
          const aWorld = toCoarseWorld(seg.r.start);
          const bWorld = toCoarseWorld(seg.r.end);
          const strokePx = Math.max(1, (seg.width || 1) / Math.max(1e-6, Math.min(stepWorldX, stepWorldY)));
          mctx.lineWidth = strokePx;
          mctx.beginPath();
          mctx.moveTo(aWorld.x, aWorld.y);
          mctx.lineTo(bWorld.x, bWorld.y);
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
        (this as any)._maskCache = { w: coarseW, h: coarseH, cameraX, cameraY, zoom, originWorldX, originWorldY, stepWorldX, stepWorldY, data: new Uint8Array(coarseRoadMask) };
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
    // Pixelated rendering: draw one rect per coarse cell using nearest-neighbor in world-aligned tiles.
    // This avoids allocating a full ImageData buffer and keeps the pattern static relative to the map.
    try {
      this._ctx.clearRect(0, 0, w, h);
      this._ctx.save();
      const aNorm = (alpha / 255) || 0;
      this._ctx.fillStyle = `rgba(0,0,0,${aNorm})`;

      for (let gy = 0; gy < coarseH; gy++) {
        const cellWorldMinY = originWorldY + gy * stepWorldY;
        const cellWorldMaxY = cellWorldMinY + stepWorldY;
        for (let gx = 0; gx < coarseW; gx++) {
          const idx = gy * coarseW + gx;
          if (!coarseRoadMask[idx]) continue;
          const n = coarse[idx];
          if (n <= noiseThreshold) continue;
          const cellWorldMinX = originWorldX + gx * stepWorldX;
          const cellWorldMaxX = cellWorldMinX + stepWorldX;
          const corners = [
            worldToScreen(cellWorldMinX, cellWorldMinY),
            worldToScreen(cellWorldMaxX, cellWorldMinY),
            worldToScreen(cellWorldMinX, cellWorldMaxY),
            worldToScreen(cellWorldMaxX, cellWorldMaxY),
          ];
          let xMin = Infinity, xMax = -Infinity, yMin = Infinity, yMax = -Infinity;
          for (const c of corners) {
            xMin = Math.min(xMin, c.x);
            xMax = Math.max(xMax, c.x);
            yMin = Math.min(yMin, c.y);
            yMax = Math.max(yMax, c.y);
          }
          const x0 = Math.round(xMin);
          const y0 = Math.round(yMin);
          const wPx = Math.max(1, Math.round(xMax - xMin));
          const hPx = Math.max(1, Math.round(yMax - yMin));
          if (wPx <= 0 || hPx <= 0) continue;
          this._ctx.fillRect(x0, y0, wPx, hPx);
        }
      }

      this._ctx.restore();
    } catch (e) {
      try { this._ctx.clearRect(0, 0, w, h); } catch (e2) {}
    }

    if ((this as any)._showIntersectionOutline) {
      try {
        this._ctx.save();
        this._ctx.strokeStyle = '#ff0000';
        this._ctx.lineWidth = Math.max(1, 2 * (window.devicePixelRatio || 1));
        this._ctx.lineJoin = 'round';
        this._ctx.lineCap = 'round';

        for (let gy = 0; gy < coarseH; gy++) {
          const cellWorldMinY = originWorldY + gy * stepWorldY;
          const cellWorldMaxY = cellWorldMinY + stepWorldY;
          for (let gx = 0; gx < coarseW; gx++) {
            const idx = gy * coarseW + gx;
            if (!intersectionMask[idx]) continue;
            const cellWorldMinX = originWorldX + gx * stepWorldX;
            const cellWorldMaxX = cellWorldMinX + stepWorldX;
            const topLeft = worldToScreen(cellWorldMinX, cellWorldMinY);
            const topRight = worldToScreen(cellWorldMaxX, cellWorldMinY);
            const bottomLeft = worldToScreen(cellWorldMinX, cellWorldMaxY);
            const bottomRight = worldToScreen(cellWorldMaxX, cellWorldMaxY);

            const hasTop = gy > 0 && intersectionMask[(gy - 1) * coarseW + gx];
            const hasBottom = gy < coarseH - 1 && intersectionMask[(gy + 1) * coarseW + gx];
            const hasLeft = gx > 0 && intersectionMask[gy * coarseW + (gx - 1)];
            const hasRight = gx < coarseW - 1 && intersectionMask[gy * coarseW + (gx + 1)];

            if (!hasTop) {
              this._ctx.beginPath();
              this._ctx.moveTo(topLeft.x, topLeft.y);
              this._ctx.lineTo(topRight.x, topRight.y);
              this._ctx.stroke();
            }
            if (!hasBottom) {
              this._ctx.beginPath();
              this._ctx.moveTo(bottomLeft.x, bottomLeft.y);
              this._ctx.lineTo(bottomRight.x, bottomRight.y);
              this._ctx.stroke();
            }
            if (!hasLeft) {
              this._ctx.beginPath();
              this._ctx.moveTo(topLeft.x, topLeft.y);
              this._ctx.lineTo(bottomLeft.x, bottomLeft.y);
              this._ctx.stroke();
            }
            if (!hasRight) {
              this._ctx.beginPath();
              this._ctx.moveTo(topRight.x, topRight.y);
              this._ctx.lineTo(bottomRight.x, bottomRight.y);
              this._ctx.stroke();
            }
          }
        }
      } finally {
        this._ctx.restore();
      }
    }
  // Store a small coarse cache so subsequent redraws can reuse the intersection mask
  this._pixelCache = { w, h, cameraX, cameraY, zoom, bbox: [minPx, minPy, maxPx, maxPy], data: { type: 'coarse', coarseW, coarseH, originWorldX, originWorldY, stepWorldX, stepWorldY, intersectionMask } };
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
};

function intToRgb(intColor: number): [number, number, number] {
  return [(intColor >> 16) & 255, (intColor >> 8) & 255, intColor & 255];
}

export default NoiseZoning;
