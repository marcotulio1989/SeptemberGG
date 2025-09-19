import { Dispatcher } from './Dispatcher';
import { Payload, PayloadSources, MapAction } from './constants';

class AppDispatcher extends Dispatcher<Payload> {
    handleViewAction(action: MapAction) {
        this.dispatch({
            source: PayloadSources.VIEW_ACTION,
            action: action
        });
    }

    handleLogicAction(action: MapAction) {
        this.dispatch({
            source: PayloadSources.LOGIC_ACTION,
            action: action
        });
    }
}

export default new AppDispatcher();