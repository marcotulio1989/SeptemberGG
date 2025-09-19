/*
 * NoiseZoning Overlay
 * Warped-noise zoning overlay for city generator
 * API: attach(canvas), toggle(), reseed(), redraw()
 * Independent of roads/buildings
 */
import { ZoneName } from '../game_modules/mapgen';
import { config } from '../game_modules/config';
import Zoning from '../game_modules/zoning';
import { Noise } from 'noisejs';
import { sampleWarpedNoise } from '../lib/noiseField';


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
  _ensureSize: () => void;
  _pixelCache?: {
    w: number; h: number; cameraX: number; cameraY: number; zoom: number; data: Uint8ClampedArray;
  } | null;
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
    // Sync size with base canvas using ResizeObserver
  const resize = () => this._syncSizeAndRedraw();
    this._observer?.disconnect();
    this._observer = new ResizeObserver(resize);
    if (parent) this._observer.observe(parent);
    resize();
  },

  toggle() {
    this.enabled = !this.enabled;
    // Mostrar/ocultar canvas overlay
    if (this._overlayCanvas) {
      this._overlayCanvas.style.display = this.enabled ? 'block' : 'none';
    }
  // Só redesenha quando estiver habilitado
  if (this.enabled) this.redraw();
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
  // Garantir cobertura total antes de desenhar
  this._ensureSize();
  const w = this._overlayCanvas.width;
  const h = this._overlayCanvas.height;
    const imageData = this._ctx.createImageData(w, h);
    const zoneColors = config.render.zoneColors;
  // Escala do ruído em coordenadas de cena (ajuste conforme necessário)
  const { baseScale, octaves, lacunarity, gain, thresholds } = this._params;
    const cx = w / 2, cy = h / 2;
    const cameraX = this._view.cameraX, cameraY = this._view.cameraY, zoom = this._view.zoom || 1;
    // Cache de pixels: se view for igual, reutiliza
    const alpha = this.enabled ? Math.floor((config.render.zoneOverlayAlpha ?? 0.12) * 255) : 0;
    if (this._pixelCache && this._pixelCache.w === w && this._pixelCache.h === h &&
        this._pixelCache.cameraX === cameraX && this._pixelCache.cameraY === cameraY && this._pixelCache.zoom === zoom) {
      // Só atualiza alpha
      const data = this._pixelCache.data;
      for (let i = 3; i < data.length; i += 4) data[i] = alpha;
      imageData.data.set(data);
      this._ctx.putImageData(imageData, 0, 0);
      return;
    }
    const sampleStep = computeSampleStep(w, h, zoom);
    const coarseW = Math.max(2, Math.floor((w + sampleStep - 1) / sampleStep) + 1);
    const coarseH = Math.max(2, Math.floor((h + sampleStep - 1) / sampleStep) + 1);
    const coarse = new Float32Array(coarseW * coarseH);
    const stepOffset = sampleStep * 0.5;
    for (let gy = 0; gy < coarseH; gy++) {
      const sampleY = Math.min(h - 0.5, Math.max(0.5, gy * sampleStep + stepOffset));
      const Sy = cameraY + (sampleY - cy) / zoom;
      for (let gx = 0; gx < coarseW; gx++) {
        const sampleX = Math.min(w - 0.5, Math.max(0.5, gx * sampleStep + stepOffset));
        const Sx = cameraX + (sampleX - cx) / zoom;
        const idx = gy * coarseW + gx;
        coarse[idx] = sampleWarpedNoise(this._noise, Sx * baseScale, Sy * baseScale, octaves, lacunarity, gain);
      }
    }
    for (let y = 0; y < h; y++) {
      const py = Math.min(h - 0.5, Math.max(0.5, y + 0.5));
      let gyFloat = (py - stepOffset) / sampleStep;
      if (!isFinite(gyFloat)) gyFloat = 0;
      if (gyFloat < 0) gyFloat = 0;
      if (gyFloat > coarseH - 1) gyFloat = coarseH - 1;
      let gy0 = Math.floor(gyFloat);
      if (gy0 >= coarseH - 1) {
        gy0 = coarseH - 1;
      }
      let gy1 = Math.min(gy0 + 1, coarseH - 1);
      const ty = gy1 === gy0 ? 0 : gyFloat - gy0;
      const row0 = gy0 * coarseW;
      const row1 = gy1 * coarseW;
      for (let x = 0; x < w; x++) {
        const px = Math.min(w - 0.5, Math.max(0.5, x + 0.5));
        let gxFloat = (px - stepOffset) / sampleStep;
        if (!isFinite(gxFloat)) gxFloat = 0;
        if (gxFloat < 0) gxFloat = 0;
        if (gxFloat > coarseW - 1) gxFloat = coarseW - 1;
        let gx0 = Math.floor(gxFloat);
        if (gx0 >= coarseW - 1) {
          gx0 = coarseW - 1;
        }
        let gx1 = Math.min(gx0 + 1, coarseW - 1);
        const tx = gx1 === gx0 ? 0 : gxFloat - gx0;
        const v00 = coarse[row0 + gx0];
        const v10 = coarse[row0 + gx1];
        const v01 = coarse[row1 + gx0];
        const v11 = coarse[row1 + gx1];
        const n = bilerp(v00, v10, v01, v11, tx, ty);
        let zone: ZoneName = 'residential';
        if (n < thresholds.r1) zone = 'rural';
        else if (n < thresholds.r2) zone = 'residential';
        else if (n < thresholds.r3) zone = 'commercial';
        else if (n < thresholds.r4) zone = 'industrial';
        else zone = 'downtown';
        const colorInt = zoneColors[zone] || 0xcccccc;
        const rgb = intToRgb(colorInt);
        const idx = (y * w + x) * 4;
        imageData.data[idx] = rgb[0];
        imageData.data[idx + 1] = rgb[1];
        imageData.data[idx + 2] = rgb[2];
        imageData.data[idx + 3] = alpha;
      }
    }
    this._ctx.putImageData(imageData, 0, 0);
    // Armazenar no cache
    this._pixelCache = { w, h, cameraX, cameraY, zoom, data: new Uint8ClampedArray(imageData.data) };
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
      this._overlayCanvas.parentElement.removeChild(this._overlayCanvas);
    }
    this._overlayCanvas = null;
    this._ctx = null;
    this._noise = null;
    this.enabled = false;
  this._pixelCache = null;
  },
  setView(view: { cameraX: number; cameraY: number; zoom: number }) {
    this._view = view;
  },
  setEnabled(on: boolean) {
    this.enabled = !!on;
    if (this._overlayCanvas) this._overlayCanvas.style.display = this.enabled ? 'block' : 'none';
  if (this.enabled) this.redraw();
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
};


function intToRgb(intColor: number): [number, number, number] {
  return [(intColor >> 16) & 255, (intColor >> 8) & 255, intColor & 255];
}

export default NoiseZoning;
