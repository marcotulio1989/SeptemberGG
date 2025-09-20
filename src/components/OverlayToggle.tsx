import React from 'react';
import NoiseZoning from '../overlays/NoiseZoning';

const OverlayToggle: React.FC = () => {
  const [enabled, setEnabled] = React.useState(NoiseZoning.enabled);
  const [threshold, setThreshold] = React.useState<number>(NoiseZoning.getNoiseThreshold ? NoiseZoning.getNoiseThreshold() : 0.5);
  const [crackedOn, setCrackedOn] = React.useState<boolean>(
    NoiseZoning.getCrackedRoadOutlineEnabled
      ? NoiseZoning.getCrackedRoadOutlineEnabled()
      : NoiseZoning.getIntersectionOutlineEnabled
        ? NoiseZoning.getIntersectionOutlineEnabled()
        : false
  );

  const onToggle = () => {
    NoiseZoning.toggle();
    setEnabled(NoiseZoning.enabled);
  };
  const onReseed = () => {
    NoiseZoning.reseed();
  };

  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ enabled?: boolean }>).detail;
      if (detail && typeof detail.enabled === 'boolean') {
        setEnabled(detail.enabled);
      }
    };
    const outlineHandler = (event: Event) => {
      const detail = (event as CustomEvent<{ outline?: boolean }>).detail;
      if (detail && typeof detail.outline === 'boolean') {
        setCrackedOn(detail.outline);
      }
    };
    window.addEventListener('noise-overlay-change', handler as EventListener);
    window.addEventListener('noise-overlay-outline-change', outlineHandler as EventListener);
    return () => {
      window.removeEventListener('noise-overlay-change', handler as EventListener);
      window.removeEventListener('noise-overlay-outline-change', outlineHandler as EventListener);
    };
  }, []);

  const onThresholdChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = Number(e.target.value);
    setThreshold(v);
    if (NoiseZoning.setNoiseThreshold) NoiseZoning.setNoiseThreshold(v);
  };

  const onToggleCracked = () => {
    const next = !crackedOn;
    setCrackedOn(next);
    if (NoiseZoning.setCrackedRoadOutlineEnabled) {
      NoiseZoning.setCrackedRoadOutlineEnabled(next);
    } else if (NoiseZoning.setIntersectionOutlineEnabled) {
      NoiseZoning.setIntersectionOutlineEnabled(next);
    }
  };

  return (
    <div style={{ position: 'absolute', top: 12, left: 12, zIndex: 20, display: 'flex', gap: 8 }}>
      <button onClick={onToggle}>{enabled ? 'Desativar Overlay Perlin' : 'Ativar Overlay Perlin'}</button>
      <button onClick={onReseed}>Reseed</button>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <label style={{ fontSize: 12 }}>Threshold</label>
        <input type="range" min={0} max={1} step={0.01} value={threshold} onChange={onThresholdChange} />
        <div style={{ width: 36, textAlign: 'right', fontSize: 12 }}>{threshold.toFixed(2)}</div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center' }}>
        <button onClick={onToggleCracked}>{crackedOn ? 'Esconder Ruas Rachadas' : 'Mostrar Ruas Rachadas'}</button>
      </div>
    </div>
  );
};

export default OverlayToggle;
