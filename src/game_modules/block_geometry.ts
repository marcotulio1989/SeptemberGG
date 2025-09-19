import { Point } from '../generic_modules/math';
import * as math from '../generic_modules/math';

export interface Block {
    center: Point;
    width: number;
    height: number;
    corners: Point[];
    curveRadius: number;
}

export interface Polygon {
    vertices: Point[];
}

export interface CurvedCorner {
    center: Point;
    radius: number;
    startAngle: number;
    endAngle: number;
}

/**
 * Gera um polígono retangular básico para um quarteirão (sem curvas)
 */
export function generateBasicBlockPolygon(block: Block): Polygon {
    const halfWidth = block.width / 2;
    const halfHeight = block.height / 2;
    
    return {
        vertices: [
            { x: block.center.x - halfWidth, y: block.center.y - halfHeight }, // Top-left
            { x: block.center.x + halfWidth, y: block.center.y - halfHeight }, // Top-right
            { x: block.center.x + halfWidth, y: block.center.y + halfHeight }, // Bottom-right
            { x: block.center.x - halfWidth, y: block.center.y + halfHeight }  // Bottom-left
        ]
    };
}

/**
 * Gera um polígono com cantos curvos para um quarteirão
 */
export function generateCurvedBlockPolygon(block: Block): Polygon {
    const halfWidth = block.width / 2;
    const halfHeight = block.height / 2;
    const radius = Math.min(block.curveRadius, Math.min(halfWidth, halfHeight) * 0.4);
    
    const vertices: Point[] = [];
    
    // Definir os cantos internos (onde começam as curvas)
    const corners = [
        { x: block.center.x - halfWidth + radius, y: block.center.y - halfHeight + radius }, // Top-left inner
        { x: block.center.x + halfWidth - radius, y: block.center.y - halfHeight + radius }, // Top-right inner
        { x: block.center.x + halfWidth - radius, y: block.center.y + halfHeight - radius }, // Bottom-right inner
        { x: block.center.x - halfWidth + radius, y: block.center.y + halfHeight - radius }  // Bottom-left inner
    ];
    
    const segments = 8; // Número de segmentos por curva (para suavidade)
    
    // Para cada canto, gerar a curva
    for (let i = 0; i < 4; i++) {
        const currentCorner = corners[i];
        const nextCorner = corners[(i + 1) % 4];
        
        // Adicionar pontos antes da curva
        switch (i) {
            case 0: // Top-left
                vertices.push({ x: block.center.x - halfWidth, y: currentCorner.y });
                break;
            case 1: // Top-right
                vertices.push({ x: currentCorner.x, y: block.center.y - halfHeight });
                break;
            case 2: // Bottom-right
                vertices.push({ x: block.center.x + halfWidth, y: currentCorner.y });
                break;
            case 3: // Bottom-left
                vertices.push({ x: currentCorner.x, y: block.center.y + halfHeight });
                break;
        }
        
        // Gerar a curva
        const startAngle = i * Math.PI / 2 + Math.PI;
        const endAngle = startAngle + Math.PI / 2;
        
        for (let j = 0; j <= segments; j++) {
            const angle = startAngle + (endAngle - startAngle) * (j / segments);
            const x = currentCorner.x + radius * Math.cos(angle);
            const y = currentCorner.y + radius * Math.sin(angle);
            vertices.push({ x, y });
        }
    }
    
    return { vertices };
}

/**
 * Subtrai um polígono de outro, retornando a área de diferença
 * Implementação simplificada para polígonos convexos
 */
export function subtractPolygons(original: Polygon, curved: Polygon): Polygon[] {
    // Para uma implementação simplificada, vamos retornar as áreas dos cantos
    // que representam a diferença entre o retângulo original e o polígono curvo
    
    const cornerPolygons: Polygon[] = [];
    
    // Esta é uma aproximação - em um caso real, usaríamos uma biblioteca como Clipper.js
    // Por agora, vamos criar polígonos que representam as áreas dos cantos removidos
    
    if (original.vertices.length >= 4 && curved.vertices.length > 4) {
        // Assumindo que o polígono original é um retângulo e o curvo tem cantos arredondados
        const originalRect = original.vertices;
        
        // Criar pequenos polígonos nos cantos para representar a área removida
        const cornerSize = 20; // Tamanho aproximado dos cantos
        
        // Canto superior esquerdo
        cornerPolygons.push({
            vertices: [
                originalRect[0],
                { x: originalRect[0].x + cornerSize, y: originalRect[0].y },
                { x: originalRect[0].x + cornerSize, y: originalRect[0].y + cornerSize },
                { x: originalRect[0].x, y: originalRect[0].y + cornerSize }
            ]
        });
        
        // Canto superior direito
        cornerPolygons.push({
            vertices: [
                { x: originalRect[1].x - cornerSize, y: originalRect[1].y },
                originalRect[1],
                { x: originalRect[1].x, y: originalRect[1].y + cornerSize },
                { x: originalRect[1].x - cornerSize, y: originalRect[1].y + cornerSize }
            ]
        });
        
        // Canto inferior direito
        cornerPolygons.push({
            vertices: [
                { x: originalRect[2].x - cornerSize, y: originalRect[2].y - cornerSize },
                { x: originalRect[2].x, y: originalRect[2].y - cornerSize },
                originalRect[2],
                { x: originalRect[2].x - cornerSize, y: originalRect[2].y }
            ]
        });
        
        // Canto inferior esquerdo
        cornerPolygons.push({
            vertices: [
                { x: originalRect[3].x, y: originalRect[3].y - cornerSize },
                { x: originalRect[3].x + cornerSize, y: originalRect[3].y - cornerSize },
                { x: originalRect[3].x + cornerSize, y: originalRect[3].y },
                originalRect[3]
            ]
        });
    }
    
    return cornerPolygons;
}

/**
 * Verifica se um ponto está dentro de um polígono
 */
export function pointInPolygon(point: Point, polygon: Polygon): boolean {
    let inside = false;
    const vertices = polygon.vertices;
    
    for (let i = 0, j = vertices.length - 1; i < vertices.length; j = i++) {
        if (((vertices[i].y > point.y) !== (vertices[j].y > point.y)) &&
            (point.x < (vertices[j].x - vertices[i].x) * (point.y - vertices[i].y) / (vertices[j].y - vertices[i].y) + vertices[i].x)) {
            inside = !inside;
        }
    }
    
    return inside;
}

/**
 * Calcula a área de um polígono usando a fórmula do shoelace
 */
export function polygonArea(polygon: Polygon): number {
    let area = 0;
    const vertices = polygon.vertices;
    
    for (let i = 0; i < vertices.length; i++) {
        const j = (i + 1) % vertices.length;
        area += vertices[i].x * vertices[j].y;
        area -= vertices[j].x * vertices[i].y;
    }
    
    return Math.abs(area) / 2;
}