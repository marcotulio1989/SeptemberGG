import * as util from './utility';
import HashMap from 'hashmap'; // Assuming 'hashmap' package is used.
import { Segment } from '../game_modules/mapgen'; // This will be created later

export class PathLocation {
    constructor(public o: any, public fraction: number) {}
}

function cost(current: any, next: any, start: PathLocation, end: PathLocation): number {
    let currentFraction: number | undefined = undefined;
    let nextFraction: number | undefined = undefined;
    if (start.o === end.o) {
        const fraction = Math.abs(start.fraction - end.fraction);
        return fraction * (current as Segment).cost();
    } else {
        if (current === start.o) {
            currentFraction = start.fraction;
        }
        if (next === end.o) {
            nextFraction = end.fraction;
        }
        return (current as Segment).costTo(next, currentFraction) + (next as Segment).costTo(current, nextFraction);
    }
}

export function findPath(start: PathLocation, end: PathLocation): any[] {
    const frontier = new util.PriorityQueue<any>();
    frontier.put(start.o, 0);

    const came_from = new HashMap<any, any>();
    came_from.set(start.o, null);

    const cost_so_far = new HashMap<any, number>();
    cost_so_far.set(start.o, 0);

    while (frontier.length() > 0) {
        const current = frontier.get();

        if (current === end.o) {
            break;
        }

        for (const next of (current as Segment).neighbours()) {
            const new_cost = (cost_so_far.get(current) || 0) + cost(current, next, start, end);
            if (!cost_so_far.has(next) || new_cost < (cost_so_far.get(next) || Infinity)) {
                cost_so_far.set(next, new_cost);
                const priority = new_cost; // + heuristic(goal, next)
                frontier.put(next, priority);
                came_from.set(next, current);
            }
        }
    }

    console.log(`path cost: ${cost_so_far.get(end.o)}`);
    
    // reconstruct path
    let current = end.o;
    const path = [current];
    while (current !== start.o) {
        current = came_from.get(current);
        path.unshift(current);
    }

    return path;
}