import { Noise } from 'noisejs';

type ViewState = { cameraX: number; cameraY: number; zoom: number };

type PerlinOverlayAPI = {
  attach: (canvas: HTMLCanvasElement) => void;
  detach?: () => void;
  toggle?: () => void;
  setEnabled?: (enabled: boolean) => void;
  setView?: (view: ViewState) => void;
  redraw?: () => void;
  enabled: boolean;
};

type InternalState = PerlinOverlayAPI & {
  _baseCanvas: HTMLCanvasElement | null;
  _overlayCanvas: HTMLCanvasElement | null;
  _ctx: CanvasRenderingContext2D | null;
  _noise: Noise | null;
  _observer: ResizeObserver | null;
  _view: ViewState;
  _seed: number;
  _ensureSize: () => void;
};

const computeSampleStep = (width: number, height: number, zoom: number) => {
  const diag = Math.sqrt(Math.max(1, width * height));
  const base = diag / 720;
  const zoomAdjust = zoom > 0 ? Math.pow(Math.max(zoom, 0.1), 0.35) : 1;
  const raw = base / zoomAdjust;
  const step = Math.round(raw);
  return Math.max(4, Math.min(48, step || 4));
};

const PERLIN_SCALE = 1 / 650; // world meters -> noise frequency
const ALPHA = 0.28;

const PerlinNoiseOverlay: InternalState = {
  enabled: false,
  _baseCanvas: null,
  _overlayCanvas: null,
  _ctx: null,
  _noise: null,
  _observer: null,
  _view: { cameraX: 0, cameraY: 0, zoom: 1 },
  _seed: Math.floor(Math.random() * 10000),

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
    if (this._ctx) {
      try { this._ctx.imageSmoothingEnabled = false; } catch { /* ignore */ }
    }
  },

  attach(canvas: HTMLCanvasElement) {
    this._baseCanvas = canvas;
    const overlay = document.createElement('canvas');
    overlay.style.position = 'absolute';
    overlay.style.left = '0';
    overlay.style.top = '0';
    overlay.style.pointerEvents = 'none';
    overlay.style.zIndex = '6';
    overlay.style.opacity = '1';
    overlay.style.imageRendering = 'pixelated';

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
    if (!this._noise) this._noise = new Noise(this._seed);

    const resize = () => {
      this._ensureSize();
      if (this.enabled && typeof this.redraw === 'function') {
        this.redraw();
      }
    };
    this._observer?.disconnect();
    this._observer = new ResizeObserver(resize);
    if (parent) this._observer.observe(parent);
    resize();

    overlay.style.display = this.enabled ? 'block' : 'none';
    if (this.enabled && typeof this.redraw === 'function') {
      this.redraw();
    }
  },

  redraw() {
    if (!this.enabled) return;
    if (!this._overlayCanvas || !this._ctx) return;
    if (!this._noise) this._noise = new Noise(this._seed);

    this._ensureSize();
    const ctx = this._ctx;
    const canvas = this._overlayCanvas;
    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    const zoom = this._view.zoom || 1;
    const cx = w / 2;
    const cy = h / 2;
    const step = computeSampleStep(w, h, zoom);

    for (let y = 0; y < h; y += step) {
      const sampleY = Math.min(h - 0.5, Math.max(0.5, y + step * 0.5));
      const worldY = this._view.cameraY + (sampleY - cy) / zoom;
      for (let x = 0; x < w; x += step) {
        const sampleX = Math.min(w - 0.5, Math.max(0.5, x + step * 0.5));
        const worldX = this._view.cameraX + (sampleX - cx) / zoom;
        const v = this._noise.perlin2(worldX * PERLIN_SCALE, worldY * PERLIN_SCALE);
        const normalized = Math.max(0, Math.min(1, (v + 1) * 0.5));
        const gray = Math.round(normalized * 255);
        ctx.fillStyle = `rgba(${gray},${gray},${gray},${ALPHA})`;
        ctx.fillRect(x, y, step + 1, step + 1);
      }
    }
  },

  setEnabled(on: boolean) {
    this.enabled = !!on;
    if (this._overlayCanvas) {
      this._overlayCanvas.style.display = this.enabled ? 'block' : 'none';
    }
    if (this.enabled && typeof this.redraw === 'function') {
      this.redraw();
    }
  },

  toggle() {
    this.setEnabled?.(!this.enabled);
  },

  setView(view: ViewState) {
    this._view = view;
  },

  detach() {
    try { this._observer?.disconnect(); } catch { /* ignore */ }
    this._observer = null;
    if (this._overlayCanvas && this._overlayCanvas.parentElement) {
      this._overlayCanvas.parentElement.removeChild(this._overlayCanvas);
    }
    this._overlayCanvas = null;
    this._ctx = null;
    this._baseCanvas = null;
  },
};

export default PerlinNoiseOverlay;
