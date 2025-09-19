export const ActionTypes = {
    MAP_GENERATE: 'MAP_GENERATE',
    MAP_FACTOR_TARGET_ZOOM: 'MAP_FACTOR_TARGET_ZOOM',
} as const;

export const PayloadSources = {
    SERVER_ACTION: 'SERVER_ACTION',
    VIEW_ACTION: 'VIEW_ACTION',
    LOGIC_ACTION: 'LOGIC_ACTION',
} as const;

// Type definitions for payload actions
type ValueOf<T> = T[keyof T];

export type ActionType = ValueOf<typeof ActionTypes>;
export type PayloadSource = ValueOf<typeof PayloadSources>;

export interface GenerateMapAction {
    actionType: typeof ActionTypes.MAP_GENERATE;
    seed: number | string;
}

export interface FactorTargetZoomAction {
    actionType: typeof ActionTypes.MAP_FACTOR_TARGET_ZOOM;
    factor: number;
}

export type MapAction = GenerateMapAction | FactorTargetZoomAction;

export interface Payload {
    source: PayloadSource;
    action: MapAction;
}