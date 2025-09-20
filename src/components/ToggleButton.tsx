import React, { useEffect, useState } from 'react';

interface ToggleButtonProps {
    onText: string;
    offText: string;
    action: (nextState: boolean) => void;
    initialState?: boolean;
    forcedState?: boolean;
}

const ToggleButton: React.FC<ToggleButtonProps> = ({ onText, offText, action, initialState = false, forcedState }) => {
    const [toggleState, setToggleState] = useState(initialState);

    useEffect(() => {
        if (typeof forcedState === 'boolean') {
            setToggleState(forcedState);
        }
    }, [forcedState]);

    const effectiveState = typeof forcedState === 'boolean' ? forcedState : toggleState;

    const onButtonClick = () => {
        const newToggleState = !effectiveState;
        setToggleState(newToggleState);
        action(newToggleState);
    };

    return (
        <button onClick={onButtonClick}>
            {effectiveState ? onText : offText}
        </button>
    );
};

export default ToggleButton;