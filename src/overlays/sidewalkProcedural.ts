import * as PIXI from 'pixi.js';

// Gera uma textura de calçada independente (pavers/retângulos) em canvas e retorna PIXI.Texture
// Não reutiliza nenhum gerador existente. Sem dependência externa.
export function createSidewalkTexture(options?: {
  size?: number;           // tamanho alvo em px (ajustado para múltiplos do período)
  groutPx?: number;        // espessura do rejunte em px
  tilePx?: number;         // tamanho base do ladrilho (lado) em px
  jitterPx?: number;       // jitter por ladrilho (pequeno, periódico)
  groutJitterPx?: number;  // variação (±px) do rejunte por ladrilho
  groutColor?: string;     // cor do rejunte
  tileColor?: string;      // cor base dos ladrilhos
  seed?: number;           // semente opcional
}) {
  const targetSize = options?.size ?? 512;
  const grout = Math.max(1, Math.floor(options?.groutPx ?? 2));
  const baseTile = Math.max(8, Math.floor(options?.tilePx ?? 28));
  const jitter = Math.max(0, Math.floor(options?.jitterPx ?? 2));
  const groutColor = options?.groutColor ?? '#8d8d8d';
  const tileColor = options?.tileColor ?? '#cfcfcf';
  const seed = (options?.seed ?? 1337) >>> 0;

  // Período do padrão (running bond tem período de 2 linhas)
  const periodX = baseTile + grout;          // largura fundamental
  const periodY = 2 * (baseTile + grout);    // duas linhas para repetição do deslocamento
  // Escolher dimensões múltiplas do período para evitar costuras
  const nx = Math.max(4, Math.round(targetSize / periodX));
  const ny = Math.max(2, Math.round(targetSize / periodY));
  const width = nx * periodX;
  const height = ny * periodY;

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;

  // Fundo = rejunte
  ctx.fillStyle = groutColor;
  ctx.fillRect(0, 0, width, height);

  // Hash determinístico simples
  const hash2 = (a: number, b: number) => {
    let h = (seed ^ a ^ (b * 0x9e3779b1)) >>> 0;
    h = Math.imul(h ^ (h >>> 16), 2246822519) >>> 0;
    h = Math.imul(h ^ (h >>> 13), 3266489917) >>> 0;
    h ^= h >>> 16;
    return h >>> 0;
  };
  const rand01 = (h: number) => (h >>> 0) / 0x100000000;

  // Colunas e linhas inteiras que cobrem a área
  const cols = Math.ceil(width / periodX);
  const rows = Math.ceil(height / (baseTile + grout));

  // Desenhar com overdraw (-1..cols/rows) para garantir continuidade nas bordas
  for (let r = -1; r <= rows; r++) {
    const rowY = r * (baseTile + grout);
    const evenRow = (r & 1) === 0;
    const offset = evenRow ? 0 : Math.floor(periodX / 2);
    for (let c = -1; c <= cols; c++) {
  const cellX = c * periodX + offset;
      const cellY = rowY;
      const cellW = periodX;
      const cellH = (baseTile + grout);
      // jitter periódico determinístico (wrap em colunas do tile)
      const jr = ((r % 2) + 2) % 2;
      const nxCols = Math.max(1, Math.floor(width / periodX));
      const cWrapped = ((c % nxCols) + nxCols) % nxCols;
      const h = hash2(jr, cWrapped);
  // variar rejunte por ladrilho, mantendo mínimo de 1px (usa options se fornecido)
  const groutJitBase = options?.groutJitterPx ?? 1;
  const groutJit = Math.max(0, Math.floor(Math.min(3, groutJitBase)));
  const groutVarX = Math.floor((rand01(h ^ 0x1234ABCD) - 0.5) * 2 * groutJit);
  const groutVarY = Math.floor((rand01(h ^ 0xBCDDA123) - 0.5) * 2 * groutJit);
  const groutX = Math.max(1, grout + groutVarX);
  const groutY = Math.max(1, grout + groutVarY);
      // tamanho do ladrilho: mantenha sempre uma margem de grout visível
  const maxInnerW = Math.max(2, cellW - 2 * groutX);
  const maxInnerH = Math.max(2, cellH - 2 * groutY);
      const sizeRandX = Math.floor(rand01(h ^ 0x55AA55AA) * Math.min(jitter, Math.floor(maxInnerW * 0.15)));
      const sizeRandY = Math.floor(rand01(h ^ 0xAA55AA55) * Math.min(jitter, Math.floor(maxInnerH * 0.15)));
      const w = Math.max(2, Math.min(baseTile - 1, maxInnerW - sizeRandX));
      const hgt = Math.max(2, Math.min(baseTile - 1, maxInnerH - sizeRandY));
      // espaço disponível para deslocar mantendo grout nas bordas
      const slackX = Math.max(0, maxInnerW - w);
      const slackY = Math.max(0, maxInnerH - hgt);
      const maxShiftX = Math.floor(slackX / 2);
      const maxShiftY = Math.floor(slackY / 2);
      const jx = Math.floor((rand01(h ^ 0xA5A5A5A5) - 0.5) * 2 * Math.min(jitter, maxShiftX));
      const jy = Math.floor((rand01(h ^ 0xC3C3C3C3) - 0.5) * 2 * Math.min(jitter, maxShiftY));
      // posição final, centralizada dentro da célula com jitter e margem de grout
  const x0 = Math.floor(cellX + groutX + (slackX / 2) + jx);
  const y0 = Math.floor(cellY + groutY + (slackY / 2) + jy);
      // paver
      ctx.fillStyle = tileColor;
      ctx.fillRect(x0, y0, w, hgt);
      // micro texturização sutil
      ctx.fillStyle = 'rgba(255,255,255,0.035)';
      const dots = Math.max(6, Math.floor((w * hgt) / 90));
      for (let i = 0; i < dots; i++) {
        const dh = hash2(h, i);
        const dx = x0 + Math.floor(rand01(dh ^ 0x11111111) * w);
        const dy = y0 + Math.floor(rand01(dh ^ 0x22222222) * hgt);
        ctx.fillRect(dx, dy, 1, 1);
      }
    }
  }

  const texture = PIXI.Texture.from(canvas);
  try { texture.baseTexture.wrapMode = PIXI.WRAP_MODES.REPEAT; } catch {}
  try { texture.baseTexture.scaleMode = PIXI.SCALE_MODES.LINEAR; } catch {}
  try { (texture.baseTexture as any).mipmap = PIXI.MIPMAP_MODES.OFF; } catch {}
  return texture;
}
