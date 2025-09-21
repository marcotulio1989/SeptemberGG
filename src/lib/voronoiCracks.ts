// Voronoi-based crack generation similar to the HTML example
// This implements the algorithm from the provided HTML code

export interface VoronoiCrackParams {
    width: number;
    height: number;
    seedCount: number;
    epsilon: number;
    strokePx: number;
    seed: number;
    isometric: boolean;
    color: [number, number, number, number]; // RGBA
}

export interface VoronoiCrackResult {
    buffer: Uint8Array;
    width: number;
    height: number;
}

// Simple PRNG based on the HTML example
function createPRNG(seed: number): () => number {
    let s = (seed >>> 0) || 123456789;
    return () => {
        s = (s * 1664525 + 1013904223) >>> 0;
        return s / 4294967296;
    };
}

export function generateVoronoiCracks(params: VoronoiCrackParams): VoronoiCrackResult | null {
    const { width, height, seedCount, epsilon, strokePx, seed, isometric, color } = params;
    
    if (width <= 0 || height <= 0 || seedCount < 2) return null;
    
    const rng = createPRNG(seed);
    
    // Generate seeds
    const seeds = new Float32Array(seedCount * 2);
    const seedsWorld = isometric ? new Float32Array(seedCount * 2) : null;
    
    if (!isometric) {
        // 2D mode: generate seeds directly in screen space
        for (let i = 0; i < seedCount; i++) {
            seeds[2 * i] = rng() * width;
            seeds[2 * i + 1] = rng() * height;
        }
    } else {
        // Isometric mode: generate seeds in world space [0,1]x[0,1] and project to screen
        const cx = width * 0.5;
        const angle = 30 * Math.PI / 180;
        const y_scale_ratio = Math.tan(angle);
        const scaleX = width * 0.5;
        const scaleY = scaleX * y_scale_ratio;
        const totalIsoHeight = 2 * scaleY;
        const top_margin = (height - totalIsoHeight) * 0.5;
        
        for (let i = 0; i < seedCount; i++) {
            const wx = rng();
            const wy = rng();
            
            if (seedsWorld) {
                seedsWorld[2 * i] = wx;
                seedsWorld[2 * i + 1] = wy;
            }
            
            // Project to screen space for grid optimization
            const sx = cx + (wx - wy) * scaleX;
            const sy = top_margin + (wx + wy) * scaleY;
            seeds[2 * i] = sx;
            seeds[2 * i + 1] = sy;
        }
    }
    
    // Build spatial grid for optimization
    const gridSize = Math.max(8, Math.round(Math.sqrt(seedCount)));
    const cellSizeX = width / gridSize;
    const cellSizeY = height / gridSize;
    const grid: number[][] = new Array(gridSize * gridSize);
    for (let i = 0; i < grid.length; i++) grid[i] = [];
    
    // Populate grid with seed indices (using screen coordinates)
    for (let i = 0; i < seedCount; i++) {
        const gx = Math.min(gridSize - 1, Math.floor(seeds[2 * i] / cellSizeX));
        const gy = Math.min(gridSize - 1, Math.floor(seeds[2 * i + 1] / cellSizeY));
        if (gx >= 0 && gx < gridSize && gy >= 0 && gy < gridSize) {
            grid[gy * gridSize + gx].push(i);
        }
    }
    
    // Function to get candidate seeds for a point
    const getCandidates = (x: number, y: number): number[] => {
        const gx = Math.min(gridSize - 1, Math.floor(x / cellSizeX));
        const gy = Math.min(gridSize - 1, Math.floor(y / cellSizeY));
        let candidates: number[] = [];
        
        for (let r = 1; r <= 2; r++) {
            candidates.length = 0;
            for (let j = gy - r; j <= gy + r; j++) {
                if (j < 0 || j >= gridSize) continue;
                for (let i = gx - r; i <= gx + r; i++) {
                    if (i < 0 || i >= gridSize) continue;
                    const arr = grid[j * gridSize + i];
                    if (arr && arr.length) candidates.push(...arr);
                }
            }
            if (candidates.length || r === 2) return candidates;
        }
        return candidates;
    };
    
    // Create output buffer
    const buffer = new Uint8Array(width * height * 4);
    
    if (!isometric) {
        // Standard 2D rendering
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const candidates = getCandidates(x, y);
                let best1 = Infinity;
                let best2 = Infinity;
                
                const seedSource = candidates.length ? candidates : Array.from({ length: seedCount }, (_, i) => i);
                
                for (const i of seedSource) {
                    const dx = x - seeds[2 * i];
                    const dy = y - seeds[2 * i + 1];
                    const dist2 = dx * dx + dy * dy;
                    if (dist2 < best1) {
                        best2 = best1;
                        best1 = dist2;
                    } else if (dist2 < best2) {
                        best2 = dist2;
                    }
                }
                
                const delta = Math.sqrt(best2) - Math.sqrt(best1);
                const p = (y * width + x) * 4;
                if (delta < epsilon) {
                    buffer[p] = color[0];
                    buffer[p + 1] = color[1];
                    buffer[p + 2] = color[2];
                    buffer[p + 3] = 255;
                } else {
                    buffer[p + 3] = 0;
                }
            }
        }
    } else {
        // Isometric rendering (30 degrees)
        const angle = 30 * Math.PI / 180;
        const y_scale_ratio = Math.tan(angle);
        const scaleX = width * 0.5;
        const scaleY = scaleX * y_scale_ratio;
        const totalIsoHeight = 2 * scaleY;
        const top_margin = (height - totalIsoHeight) * 0.5;
        const cx = width * 0.5;
        
        const scaled_eps = epsilon * Math.sqrt(2) / width;
        
        for (let sy = 0; sy < height; sy++) {
            for (let sx = 0; sx < width; sx++) {
                const p = (sy * width + sx) * 4;
                
                // Deproject screen point to world coordinates
                const sx_prime = sx - cx;
                const sy_prime = sy - top_margin;
                
                if (scaleY === 0) {
                    buffer[p + 3] = 0;
                    continue;
                }
                
                const wx = sx_prime / (2 * scaleX) + sy_prime / (2 * scaleY);
                const wy = sy_prime / (2 * scaleY) - sx_prime / (2 * scaleX);
                
                // Check if point is outside diamond bounds
                if (wx < 0 || wx > 1 || wy < 0 || wy > 1) {
                    buffer[p + 3] = 0;
                    continue;
                }
                
                const candidates = getCandidates(sx, sy);
                let best1 = Infinity;
                let best2 = Infinity;
                
                const seedSource = candidates.length ? candidates : Array.from({ length: seedCount }, (_, i) => i);
                
                for (const i of seedSource) {
                    // Distance calculation in world space
                    const dx = wx - (seedsWorld ? seedsWorld[2 * i] : 0);
                    const dy = wy - (seedsWorld ? seedsWorld[2 * i + 1] : 0);
                    const dist2 = dx * dx + dy * dy;
                    if (dist2 < best1) {
                        best2 = best1;
                        best1 = dist2;
                    } else if (dist2 < best2) {
                        best2 = dist2;
                    }
                }
                
                const delta = Math.sqrt(best2) - Math.sqrt(best1);
                if (delta < scaled_eps) {
                    buffer[p] = color[0];
                    buffer[p + 1] = color[1];
                    buffer[p + 2] = color[2];
                    buffer[p + 3] = 255;
                } else {
                    buffer[p + 3] = 0;
                }
            }
        }
    }
    
    return {
        buffer,
        width,
        height
    };
}