import { EventEmitter } from 'events';
import AppDispatcher from '../dispatcher/AppDispatcher';
import { ActionTypes, Payload } from '../dispatcher/constants';
import * as mapgen from '../game_modules/mapgen';
import { autoSetConcentric } from '../game_modules/auto_zoning';
import type Quadtree from '../lib/quadtree';

const CHANGE_EVENT = 'change';

let _segments: mapgen.Segment[] = [];
const _segmentsById: { [id: number]: mapgen.Segment } = {};
let _qTree: Quadtree | undefined = undefined;
let _heatmap: typeof mapgen.heatmap | undefined = undefined;
let _debugData: any | undefined = undefined;
let _targetZoom = 1.0 * window.devicePixelRatio;

class MapStore extends EventEmitter {
    get(id: number): mapgen.Segment | undefined {
        return _segmentsById[id];
    }

    getSegments(): mapgen.Segment[] {
        return _segments;
    }

    getQTree(): Quadtree | undefined {
        return _qTree;
    }

    getHeatmap(): typeof mapgen.heatmap | undefined {
        return _heatmap;
    }

    getDebugData(): any | undefined {
        return _debugData;
    }

    getTargetZoom(): number {
        return _targetZoom;
    }

    emitChange(): void {
        this.emit(CHANGE_EVENT);
    }

    addChangeListener(callback: () => void): void {
        this.on(CHANGE_EVENT, callback);
    }

    removeChangeListener(callback: () => void): void {
        this.removeListener(CHANGE_EVENT, callback);
    }
}

const store = new MapStore();

AppDispatcher.register((payload: Payload) => {
    const { action } = payload;

    switch (action.actionType) {
        case ActionTypes.MAP_GENERATE: {
            const { segments, qTree, heatmap, debugData } = mapgen.generate(action.seed);
            _segments = segments;
            _qTree = qTree;
            _heatmap = heatmap;
            _debugData = debugData;

            Object.keys(_segmentsById).forEach(key => delete _segmentsById[Number(key)]);
            for (const segment of segments) {
                if (segment.id !== undefined) {
                    _segmentsById[segment.id] = segment;
                }
            }
            store.emitChange();

            // Auto zonas desativado: não recalcular raios concêntricos nem regenerar.
            break;
        }
        case ActionTypes.MAP_FACTOR_TARGET_ZOOM:
            _targetZoom *= action.factor;
            // Note: The original store didn't emit a change here, which might be intentional
            // if the animation loop is polling this value. I'll keep that behavior.
            break;
    }

    return true;
});

export default store;