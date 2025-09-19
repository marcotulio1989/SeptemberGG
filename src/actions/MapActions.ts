import AppDispatcher from '../dispatcher/AppDispatcher';
import { ActionTypes } from '../dispatcher/constants';

export const MapActions = {
    generate(seed: number | string) {
        AppDispatcher.handleLogicAction({
            actionType: ActionTypes.MAP_GENERATE,
            seed: seed
        });
    },

    factorTargetZoom(factor: number) {
        AppDispatcher.handleLogicAction({
            actionType: ActionTypes.MAP_FACTOR_TARGET_ZOOM,
            factor: factor
        });
    }
};