import simpleQuadtree from 'simple-quadtree';

export type Bounds = { x: number; y: number; width: number; height: number };

type NodeObj<T = any> = { x: number; y: number; w: number; h: number; o: T };

export default class Quadtree<T = any> {
  private qt: ReturnType<typeof simpleQuadtree>;

  constructor(bounds: Bounds, maxObjects = 10, maxLevels = 4) {
    this.qt = simpleQuadtree(bounds.x, bounds.y, bounds.width, bounds.height, maxObjects, maxLevels);
  }

  insert(obj: { x: number; y: number; width: number; height: number; o?: any } | T & { collider?: any }): void {
    // Accept either a bounds object or a domain object with collider.limits()
    let node: NodeObj;
    if ((obj as any).x !== undefined && (obj as any).width !== undefined) {
      const b = obj as { x: number; y: number; width: number; height: number; o?: any };
      node = { x: b.x, y: b.y, w: b.width, h: b.height, o: (b as any).o ?? obj } as NodeObj;
    } else if ((obj as any).collider?.limits) {
      const b = (obj as any).collider.limits();
      node = { x: b.x, y: b.y, w: b.width, h: b.height, o: obj } as NodeObj;
    } else {
      throw new Error('Invalid object passed to Quadtree.insert');
    }
    this.qt.put(node);
  }

  retrieve(bounds: Bounds): Array<{ o: T } & NodeObj> {
    const list = this.qt.get({ x: bounds.x, y: bounds.y, w: bounds.width, h: bounds.height });
    // Ensure returned objects have .o
    return list as Array<{ o: T } & NodeObj>;
  }

  clear(): void {
    this.qt.clear();
  }
}
