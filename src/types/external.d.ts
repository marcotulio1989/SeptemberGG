declare module 'noisejs' {
  export class Noise {
    constructor(seed?: number);
    simplex2(x: number, y: number): number;
    perlin2(x: number, y: number): number;
  }
}

declare module 'simple-quadtree' {
  export default function simpleQuadtree(
    x?: number,
    y?: number,
    width?: number,
    height?: number,
    maxObjects?: number,
    maxLevels?: number
  ): any;
}

declare module 'clipper-lib' {
  const ClipperLib: any;
  export default ClipperLib;
}
