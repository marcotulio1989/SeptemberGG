import * as _ from 'lodash';

export function defaultFor<T>(arg: T | undefined, val: T, deep = false): T {
    const argCopy = deep ? _.cloneDeep(arg) : arg;
    const valCopy = deep ? _.cloneDeep(val) : val;
    return typeof arg !== 'undefined' ? argCopy as T : valCopy;
}

export function joinArrayGeneric<T>(array: T[], joinElement: T): T[] {
    const copy = array.slice(0);
    for (let i = 1; i < copy.length * 2 - 1; i += 2) {
        copy.splice(i, 0, joinElement);
    }
    return copy;
}

export function addArrayPushListener<T>(array: T[], callback: () => void): void {
    const originalPush = array.push;
    array.push = function(...items: T[]): number {
        const result = originalPush.apply(this, items);
        items.forEach(callback);
        return result;
    };
}

export function minDegreeDifference(d1: number, d2: number): number {
    const diff = Math.abs(d1 - d2) % 180;
    return Math.min(diff, Math.abs(diff - 180));
}

export function extendedMin<T>(collection: _.List<T> | null | undefined, selector?: (obj: T) => number): [T | undefined, number] {
    if (!selector) {
        selector = (obj: T) => obj as any as number;
    }

    let minObj: T | undefined = undefined;
    let minObj_i = -1;
    _.each(collection, (obj, i) => {
        if (minObj === undefined || selector!(obj) < selector!(minObj)) {
            minObj = obj;
            minObj_i = i as number;
        }
    });
    return [minObj, minObj_i];
}

export function extendedMax<T>(collection: _.List<T> | null | undefined, selector?: (obj: T) => number): [T | undefined, number] {
    if (!selector) {
        selector = (obj: T) => obj as any as number;
    }

    let maxObj: T | undefined = undefined;
    let maxObj_i = -1;
    _.each(collection, (obj, i) => {
        if (maxObj === undefined || selector!(obj) > selector!(maxObj)) {
            maxObj = obj;
            maxObj_i = i as number;
        }
    });
    return [maxObj, maxObj_i];
}

export class PriorityQueue<T> {
    private list: { item: T; priority: number }[] = [];

    put(item: T, priority: number): void {
        const newPair = { item, priority };

        const index = _.findIndex(this.list, (pair) => pair.priority > newPair.priority);
        if (index === -1) {
            this.list.push(newPair);
        } else {
            this.list.splice(index, 0, newPair);
        }
    }

    get(): T | undefined {
        const pair = this.list.shift();
        return pair?.item;
    }

    length(): number {
        return this.list.length;
    }
}