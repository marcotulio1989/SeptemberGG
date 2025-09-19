// Gera uma textura de grama procedural em canvas e converte para PIXI.Texture
import * as PIXI from 'pixi.js';

export function createGrassTexture(size = 512, seed = 1) {
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d')!;

    // Fundo verde claro
    ctx.fillStyle = '#cde86b'; // cor próxima ao anexo
    ctx.fillRect(0, 0, size, size);

    // Gerador pseudo-randômico simples (LCG)
    let s = seed >>> 0;
    function rand() {
        s = (1664525 * s + 1013904223) >>> 0;
        return s / 0x100000000;
    }

    // Traços de grama: linhas curtas em grupos
    ctx.strokeStyle = '#6b8a2b';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';

    const clusters = Math.floor(size * size / 1500);
    for (let c = 0; c < clusters; c++) {
        const cx = Math.floor(rand() * size);
        const cy = Math.floor(rand() * size);
        const n = 6 + Math.floor(rand() * 6);
        for (let i = 0; i < n; i++) {
            const ang = (rand() * 2 - 1) * Math.PI * 0.35;
            const len = 8 + rand() * 18;
            const jitterX = (rand() - 0.5) * 6;
            const jitterY = (rand() - 0.5) * 6;
            ctx.beginPath();
            ctx.moveTo(cx + jitterX, cy + jitterY);
            ctx.lineTo(cx + jitterX + Math.cos(ang) * len, cy + jitterY + Math.sin(ang) * len);
            ctx.stroke();
        }
    }

    // Suavizar com leve transparência e overlay de sombras sutis
    ctx.globalCompositeOperation = 'source-over';
    const texture = PIXI.Texture.from(canvas);
    texture.baseTexture.wrapMode = PIXI.WRAP_MODES.REPEAT;
    return texture;
}
