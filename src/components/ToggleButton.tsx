import React, { useState } from 'react';

interface ToggleButtonProps {
    onText: string;
    offText: string;
    action: () => void;
}

const ToggleButton: React.FC<ToggleButtonProps> = ({ onText, offText, action }) => {
    const [toggleState, setToggleState] = useState(false);

    const onButtonClick = () => {
        const newToggleState = !toggleState;
        setToggleState(newToggleState);
        action();
    };

    return (
        <button onClick={onButtonClick}>
            {toggleState ? onText : offText}
        </button>
    );
};

export default ToggleButton;