import React from 'react';
import NoiseZoning from '../overlays/NoiseZoning';

const OverlayToggle: React.FC = () => {
  const [enabled, setEnabled] = React.useState(NoiseZoning.enabled);

  const onToggle = () => {
    NoiseZoning.toggle();
    setEnabled(NoiseZoning.enabled);
  };
  const onReseed = () => {
    NoiseZoning.reseed();
  };

  return (
    <div style={{ position: 'absolute', top: 12, left: 12, zIndex: 20, display: 'flex', gap: 8 }}>
      <button onClick={onToggle}>{enabled ? 'Desativar Overlay Perlin' : 'Ativar Overlay Perlin'}</button>
      <button onClick={onReseed}>Reseed</button>
    </div>
  );
};

export default OverlayToggle;
