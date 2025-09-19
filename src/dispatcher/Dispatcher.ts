// A TypeScript version of the classic Flux Dispatcher
// Based on the provided Dispatcher.js

type Callback = (payload: any) => void;

export class Dispatcher<TPayload> {
    private _callbacks: { [key: string]: Callback } = {};
    private _isDispatching = false;
    private _isPending: { [key: string]: boolean } = {};
    private _isHandled: { [key: string]: boolean } = {};
    private _pendingPayload: TPayload | null = null;
    private _lastID = 1;
    private readonly _prefix = 'ID_';

    register(callback: (payload: TPayload) => void): string {
        const id = this._prefix + this._lastID++;
        this._callbacks[id] = callback;
        return id;
    }

    unregister(id: string): void {
        if (!this._callbacks[id]) {
            throw new Error(`Dispatcher.unregister(...): \`${id}\` does not map to a registered callback.`);
        }
        delete this._callbacks[id];
    }

    waitFor(ids: string[]): void {
        if (!this._isDispatching) {
            throw new Error('Dispatcher.waitFor(...): Must be invoked while dispatching.');
        }
        for (const id of ids) {
            if (this._isPending[id]) {
                if (!this._isHandled[id]) {
                    throw new Error(`Dispatcher.waitFor(...): Circular dependency detected while waiting for \`${id}\`.`);
                }
                continue;
            }
            if (!this._callbacks[id]) {
                throw new Error(`Dispatcher.waitFor(...): \`${id}\` does not map to a registered callback.`);
            }
            this._invokeCallback(id);
        }
    }

    dispatch(payload: TPayload): void {
        if (this._isDispatching) {
            throw new Error('Dispatch.dispatch(...): Cannot dispatch in the middle of a dispatch.');
        }
        this._startDispatching(payload);
        try {
            for (const id in this._callbacks) {
                if (this._isPending[id]) {
                    continue;
                }
                this._invokeCallback(id);
            }
        } finally {
            this._stopDispatching();
        }
    }

    isDispatching(): boolean {
        return this._isDispatching;
    }

    private _invokeCallback(id: string): void {
        this._isPending[id] = true;
        this._callbacks[id](this._pendingPayload);
        this._isHandled[id] = true;
    }

    private _startDispatching(payload: TPayload): void {
        for (const id in this._callbacks) {
            this._isPending[id] = false;
            this._isHandled[id] = false;
        }
        this._pendingPayload = payload;
        this._isDispatching = true;
    }

    private _stopDispatching(): void {
        this._pendingPayload = null;
        this._isDispatching = false;
    }
}