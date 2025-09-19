import React, { useState, useEffect } from 'react';
import * as PIXI from 'pixi.js';
import { config, roadWidthM, highwayWidthM } from '../game_modules/config';
import { MapActions } from '../actions/MapActions';
import GameCanvas from './GameCanvas';
import TextureLoader from './TextureLoader';
import TextureGallery from './TextureGallery';
import ToggleButton from './ToggleButton';
import MapStore from '../stores/MapStore';
import NoiseZoning from '../overlays/NoiseZoning';
// Controles avançados removidos: sem overlay/zonas aleatórias aqui

const App: React.FC = () => {
    const [segmentCountLimit, setSegmentCountLimit] = useState((config as any).mapGeneration.SEGMENT_COUNT_LIMIT);
    const [charSpeed, setCharSpeed] = useState((config as any).controls.characterSpeedMps);
    const [segLen, setSegLen] = useState((config as any).mapGeneration.DEFAULT_SEGMENT_LENGTH);
    const [heatmapVisible, setHeatmapVisible] = useState((config as any).mapGeneration.DRAW_HEATMAP);
    const [uiTick, setUiTick] = useState(0); // força re-render para atualizar HUD
    const [outlineMode, setOutlineMode] = useState((config as any).render.roadOutlineMode);
    // Fonte de cor das bordas dos quarteirões: 'base'|'gap'|'outline'|'custom'
    const [blockEdgeColorSource, setBlockEdgeColorSource] = useState<'base'|'gap'|'outline'|'custom'>(() => {
        const cur = (config as any).render.blockEdgeBandColor;
        if (cur === (config as any).render.baseRoadColor) return 'base';
        if (cur === (config as any).render.gapFillColor) return 'gap';
        if (cur === (config as any).render.roadOutlineColor) return 'outline';
        return 'custom';
    });
    const [blockEdgeCustomColor, setBlockEdgeCustomColor] = useState<string>(() => '#' + ((config as any).render.blockEdgeBandColor || 0x333333).toString(16).padStart(6,'0'));
    const [blockEdgeSecondColor, setBlockEdgeSecondColor] = useState<string>(() => '#' + (((config as any).render.blockEdgeBand2FaceColors && (config as any).render.blockEdgeBand2FaceColors.N) || (config as any).render.blockEdgeBandColor || 0x444444).toString(16).padStart(6,'0'));
    // Larguras (m) com override opcional
    const initialRoadW = (config as any).mapGeneration.ROAD_WIDTH_OVERRIDE_M ?? roadWidthM();
    const initialHwyW = (config as any).mapGeneration.HIGHWAY_WIDTH_OVERRIDE_M ?? highwayWidthM();
    const [roadW, setRoadW] = useState<number>(initialRoadW);
    const [hwyW, setHwyW] = useState<number>(initialHwyW);
    const forceRerender = () => setUiTick(t=>t+1);
    // raio fixo via config (sem UI)

    const onSegmentCountChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        const value = parseInt(event.target.value, 10);
    (config as any).mapGeneration.SEGMENT_COUNT_LIMIT = value;
        setSegmentCountLimit(value);
    };

    const regenerateMap = () => {
        const seed = new Date().getTime();
        // Sempre permitir geração manual quando usuário clica
        MapActions.generate(seed);
        setUiTick(t => t + 1);
    };

    // Garantir que nenhuma geração automática extra ocorra aqui.
    // Se quisermos oferecer geração automática a partir deste componente (além do GameCanvas),
    // poderíamos adicionar um useEffect com dependência vazia checando config.render.autoGenerateOnLoad.
    // Mantemos vazio para respeitar o flag e deixar apenas GameCanvas cuidar do autoGenerate.

    const factorTargetZoom = (factor: number) => {
        MapActions.factorTargetZoom(factor);
    };

    const onSpeedChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        const value = parseFloat(event.target.value);
    (config as any).controls.characterSpeedMps = value;
        setCharSpeed(value);
    };

    const onSegLenChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        const value = parseFloat(event.target.value);
    (config as any).mapGeneration.DEFAULT_SEGMENT_LENGTH = value;
    (config as any).mapGeneration.HIGHWAY_SEGMENT_LENGTH = Math.max(200, Math.round(value * 1.55));
        setSegLen(value);
    };

    // sem handler: raio fixo via config

    const onRoadWidthChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        const v = parseFloat(event.target.value);
        setRoadW(v);
        (config as any).mapGeneration.ROAD_WIDTH_OVERRIDE_M = (isFinite(v) && v > 0) ? v : null;
    };

    const onHighwayWidthChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        const v = parseFloat(event.target.value);
        setHwyW(v);
        (config as any).mapGeneration.HIGHWAY_WIDTH_OVERRIDE_M = (isFinite(v) && v > 0) ? v : null;
    };

    const resetWidthsToDefault = () => {
        (config as any).mapGeneration.ROAD_WIDTH_OVERRIDE_M = null;
        (config as any).mapGeneration.HIGHWAY_WIDTH_OVERRIDE_M = null;
        setRoadW(roadWidthM());
        setHwyW(highwayWidthM());
        setUiTick(t => t + 1);
    };
    // Ensure lane outlines visible by default when app mounts
    React.useEffect(() => {
        try { (config as any).render.showLaneOutlines = true; } catch (e) {}
        setUiTick(t => t + 1);
    }, []);

    // Load persisted marker defaults (width,length,gap) on mount
    React.useEffect(() => {
        try {
            const mw = localStorage.getItem('markerWidth');
            const ml = localStorage.getItem('markerLength');
            const mg = localStorage.getItem('markerGap');
            if (mw !== null) {
                const n = parseFloat(mw);
                if (isFinite(n) && n > 0) (config as any).render.laneMarkerWidthM = n;
            } else {
                // default desired by user
                (config as any).render.laneMarkerWidthM = 2;
                try { localStorage.setItem('markerWidth','2'); } catch(e) {}
            }
            if (ml !== null) {
                const n = parseFloat(ml);
                if (isFinite(n) && n > 0) (config as any).render.laneMarkerLengthM = n;
            } else {
                (config as any).render.laneMarkerLengthM = 7;
                try { localStorage.setItem('markerLength','7'); } catch(e) {}
            }
            if (mg !== null) {
                const n = parseFloat(mg);
                if (isFinite(n) && n >= 0) (config as any).render.laneMarkerGapM = n;
            } else {
                (config as any).render.laneMarkerGapM = 4;
                try { localStorage.setItem('markerGap','4'); } catch(e) {}
            }
        } catch (e) {}
        setUiTick(t=>t+1);
    }, []);
    
    

    // ...existing code...

    const safeLoadNumber = (key: string, fallback: number) => {
        try {
            const v = localStorage.getItem(key);
            if (v !== null) {
                const n = parseFloat(v);
                if (isFinite(n)) return n;
            }
        } catch (e) {}
        return fallback;
    };

    const safeLoadString = (key: string, fallback: string) => {
        try {
            const v = localStorage.getItem(key);
            if (v !== null) return v;
        } catch (e) {}
        return fallback;
    };

    const [interiorTexture, setInteriorTexture] = useState<PIXI.Texture | null>(null);
    const [controlsCollapsed, setControlsCollapsed] = useState<boolean>(false);
    const [edgeTexture, setEdgeTexture] = useState<PIXI.Texture | null>(null);
    const [gallery, setGallery] = useState<Array<{ id:number; name:string; url:string; texture:PIXI.Texture }>>([]);
    const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
    const [texScale, setTexScale] = useState<number>(() => safeLoadNumber('blockInteriorTextureScale', (config as any).render.blockInteriorTextureScale || 1.0));
    const [texAlpha, setTexAlpha] = useState<number>(() => safeLoadNumber('blockInteriorTextureAlpha', (config as any).render.blockInteriorTextureAlpha ?? 1.0));
    const [texTint, setTexTint] = useState<string>(() => safeLoadString('blockInteriorTextureTint', '#' + (((config as any).render.blockInteriorTextureTint ?? 0xFFFFFF)).toString(16).padStart(6,'0')));
    const [crossfadeEnabled, setCrossfadeEnabled] = useState<boolean>(true);
    const [crossfadeMs, setCrossfadeMs] = useState<number>(500);
    const [edgeScale, setEdgeScale] = useState<number>(() => safeLoadNumber('edgeScale', (config as any).render.edgeTextureScale || 1.0));
    const [edgeAlpha, setEdgeAlpha] = useState<number>(() => safeLoadNumber('edgeAlpha', (config as any).render.edgeTextureAlpha ?? 1.0));
    const [noiseOverlayVisible, setNoiseOverlayVisible] = useState<boolean>(() => !!((config as any).render?.showNoiseDelimitations));
    // controls for road lane overlay
    const [laneTexture, setLaneTexture] = useState<PIXI.Texture | null>(null);
    const [laneScale, setLaneScale] = useState<number>(() => safeLoadNumber('roadLaneScale', (config as any).render.roadLaneTextureScale || 1.0));
    const [laneAlpha, setLaneAlpha] = useState<number>(() => safeLoadNumber('roadLaneAlpha', (config as any).render.roadLaneTextureAlpha ?? 1.0));

    const handleTextureLoad = (tex: PIXI.Texture, url: string) => {
        // Destroy previous texture (if any) to avoid stale resources
        setInteriorTexture(prev => {
            if (prev && (prev as any).baseTexture && (prev as any).baseTexture.destroy) {
                try { (prev as any).baseTexture.destroy(); } catch (e) {}
            }
            return tex;
        });
        // Add to gallery
        setGallery(g => g.concat([{ id: Date.now(), name: url.split('/').pop() || 'img', url, texture: tex }]));
        // Enable use of interior texture in config so GameCanvas prefers it
        try { (config as any).render.blockInteriorUseTexture = true; } catch (e) {}
        // force a re-render of canvas/UI
        setUiTick(t => t + 1);
    };

    const toggleNoiseOverlay = () => {
        const next = !noiseOverlayVisible;
        try { (config as any).render.showNoiseDelimitations = next; } catch (e) {}
        try {
            if (typeof NoiseZoning.setEnabled === 'function') {
                NoiseZoning.setEnabled(next);
            } else if (typeof NoiseZoning.toggle === 'function' && NoiseZoning.enabled !== next) {
                NoiseZoning.toggle();
            }
            if (next && typeof NoiseZoning.redraw === 'function') {
                NoiseZoning.redraw();
            }
        } catch (e) {
            try { console.warn('[App] Failed to toggle Noise overlay', e); } catch (err) {}
        }
        setNoiseOverlayVisible(next);
        try {
            if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
                window.dispatchEvent(new CustomEvent('noise-overlay-toggle', { detail: { enabled: next } }));
            }
        } catch (e) {}
    };

    React.useEffect(() => {
        if (typeof window === 'undefined') return;
        const handler = (event: Event) => {
            const detail = (event as CustomEvent<{ enabled: boolean }>).detail;
            if (detail && typeof detail.enabled === 'boolean') {
                setNoiseOverlayVisible(detail.enabled);
            }
        };
        const listener: EventListener = handler as EventListener;
        window.addEventListener('noise-overlay-toggle', listener);
        return () => {
            window.removeEventListener('noise-overlay-toggle', listener);
        };
    }, []);

    const handleEdgeLoad = (tex: PIXI.Texture, url: string) => {
        setEdgeTexture(prev => {
            if (prev && (prev as any).baseTexture && (prev as any).baseTexture.destroy) {
                try { (prev as any).baseTexture.destroy(); } catch (e) {}
            }
            return tex;
        });
        try { if ((tex as any).baseTexture) { try { (tex as any).baseTexture.wrapMode = PIXI.WRAP_MODES.REPEAT; } catch (e) {} } } catch (e) {}
        try { (config as any).render.edgeUseTexture = true; } catch (e) {}
        // debug: confirm handler invocation and texture
        try { console.log('[App] handleEdgeLoad called, tex=', !!tex, 'url=', url); } catch(e) {}
        setUiTick(t => t + 1);
    };

    const handleLaneLoad = (tex: PIXI.Texture, url: string) => {
        setLaneTexture(prev => {
            if (prev && (prev as any).baseTexture && (prev as any).baseTexture.destroy) {
                try { (prev as any).baseTexture.destroy(); } catch (e) {}
            }
            return tex;
        });
        try { if ((tex as any).baseTexture) { try { (tex as any).baseTexture.wrapMode = PIXI.WRAP_MODES.REPEAT; } catch (e) {} } } catch (e) {}
        try { (config as any).render.roadLaneUseTexture = true; } catch (e) {}
        setUiTick(t => t + 1);
    };

    const handleLaneClear = () => {
        setLaneTexture(prev => {
            if (prev && (prev as any).baseTexture && (prev as any).baseTexture.destroy) {
                try { (prev as any).baseTexture.destroy(); } catch (e) {}
            }
            return null;
        });
        try { (config as any).render.roadLaneUseTexture = false; } catch (e) {}
        setUiTick(t => t + 1);
    };

    React.useEffect(() => {
        try { (config as any).render.edgeTextureScale = edgeScale; } catch (e) {}
        try { localStorage.setItem('edgeScale', String(edgeScale)); } catch (e) {}
    }, [edgeScale]);
    React.useEffect(() => {
        try { (config as any).render.edgeTextureAlpha = edgeAlpha; } catch (e) {}
        try { localStorage.setItem('edgeAlpha', String(edgeAlpha)); } catch (e) {}
    }, [edgeAlpha]);
    React.useEffect(() => {
        try { (config as any).render.roadLaneTextureScale = laneScale; } catch (e) {}
        try { localStorage.setItem('roadLaneScale', String(laneScale)); } catch (e) {}
    }, [laneScale]);
    React.useEffect(() => {
        try { (config as any).render.roadLaneTextureAlpha = laneAlpha; } catch (e) {}
        try { localStorage.setItem('roadLaneAlpha', String(laneAlpha)); } catch (e) {}
    }, [laneAlpha]);

    React.useEffect(() => {
        try { (config as any).render.blockInteriorTextureScale = texScale; } catch (e) {}
        try { localStorage.setItem('blockInteriorTextureScale', String(texScale)); } catch (e) {}
    }, [texScale]);
    React.useEffect(() => {
        try { (config as any).render.blockInteriorTextureAlpha = texAlpha; } catch (e) {}
        try { localStorage.setItem('blockInteriorTextureAlpha', String(texAlpha)); } catch (e) {}
    }, [texAlpha]);
    React.useEffect(() => {
        try { (config as any).render.blockInteriorTextureTint = parseInt(texTint.slice(1),16); } catch (e) {}
        try { localStorage.setItem('blockInteriorTextureTint', texTint); } catch (e) {}
    }, [texTint]);

    const handleEdgeClear = () => {
        setEdgeTexture(prev => {
            if (prev && (prev as any).baseTexture && (prev as any).baseTexture.destroy) {
                try { (prev as any).baseTexture.destroy(); } catch (e) {}
            }
            return null;
        });
        try { (config as any).render.edgeUseTexture = false; } catch (e) {}
        setUiTick(t => t + 1);
    };

    const handleTextureClear = () => {
        setInteriorTexture(prev => {
            if (prev && (prev as any).baseTexture && (prev as any).baseTexture.destroy) {
                try { (prev as any).baseTexture.destroy(); } catch (e) {}
            }
            return null;
        });
        try { (config as any).render.blockInteriorUseTexture = false; } catch (e) {}
        setUiTick(t => t + 1);
    };

    const handleGalleryAdd = (item: any) => {
        setGallery(g => g.concat([item]));
    };
    const handleGallerySelect = (idx: number | null) => {
        setSelectedIndex(idx);
        if (idx === null) {
            handleTextureClear();
        } else {
            const it = gallery[idx];
            if (it) {
                handleTextureLoad(it.texture, it.url);
            }
        }
    };
    const handleGalleryRemove = (idx: number) => {
        setGallery(g => {
            const copy = g.slice();
            const [rem] = copy.splice(idx, 1);
            try { if (rem && rem.texture && (rem.texture as any).baseTexture.destroy) (rem.texture as any).baseTexture.destroy(); } catch (e) {}
            return copy;
        });
        if (selectedIndex !== null && selectedIndex === idx) {
            handleGallerySelect(null);
        }
    };

    return (
        <div id="main-viewport-container">
            <GameCanvas interiorTexture={interiorTexture} interiorTextureScale={texScale} interiorTextureAlpha={texAlpha} interiorTextureTint={parseInt(texTint.slice(1),16)} crossfadeEnabled={crossfadeEnabled} crossfadeMs={crossfadeMs}
                edgeTexture={edgeTexture} edgeScale={edgeScale} edgeAlpha={edgeAlpha}
                roadLaneTexture={laneTexture} roadLaneScale={laneScale} roadLaneAlpha={laneAlpha}
            />
            <div id="control-bar" className={controlsCollapsed ? 'collapsed' : ''}>
                <button id="control-bar-toggle" onClick={() => setControlsCollapsed(c => !c)} style={{ marginRight: 8 }}>
                    {controlsCollapsed ? 'Expandir' : 'Colapsar'}
                </button>
                {/* Botões de preset removidos a pedido do usuário */}
                {/* Toggle de debug removido */}
                <ToggleButton
                    onText="Hide Population Heatmap"
                    offText="Show Population Heatmap"
                    action={() => {
                        config.mapGeneration.DRAW_HEATMAP = !config.mapGeneration.DRAW_HEATMAP;
                        setHeatmapVisible((v: boolean) => !v);
                        setUiTick(t => t + 1);
                    }}
                />
                <button onClick={toggleNoiseOverlay}>
                    {noiseOverlayVisible ? 'Ocultar Ruído Perlin' : 'Mostrar Ruído Perlin'}
                </button>
                <button onClick={() => factorTargetZoom(3 / 2)}>Zoom in</button>
                <button onClick={() => factorTargetZoom(2 / 3)}>Zoom out</button>
                {/* Toggle Iso removido */}
                <ToggleButton 
                    onText="Camera Follow: ON" 
                    offText="Camera Follow: OFF" 
                    action={() => { config.render.cameraFollow = !config.render.cameraFollow; }}
                />
                {/* Camada overlay de vias removida */}
                {/* Camada secundária de vias removida */}
                {/* Seletores de cor das camadas de estrada */}
                <span style={{ marginLeft: 12, fontWeight: 600 }}>Cores:</span>
                <label style={{ marginLeft: 6, fontSize: 12 }}>Base
                    <input type="color" style={{ marginLeft: 4 }} value={('#' + ((config as any).render.baseRoadColor ?? 0xA1AFA9).toString(16).padStart(6,'0'))}
                        onChange={(e) => { (config as any).render.baseRoadColor = parseInt(e.target.value.replace('#',''),16); forceRerender(); }} />
                </label>
                <label style={{ marginLeft: 6, fontSize: 12 }}>Sec.
                    <input type="color" style={{ marginLeft: 4 }} value={('#' + ((config as any).render.secondaryRoadColor ?? 0xE1F5FE).toString(16).padStart(6,'0'))}
                        onChange={(e) => { (config as any).render.secondaryRoadColor = parseInt(e.target.value.replace('#',''),16); forceRerender(); }} />
                </label>
                {/* Overlay color picker removed */}
                {/* Nova cor para a Camada 4 (Gap entre ruas e quarteirões) */}
                <label style={{ marginLeft: 6, fontSize: 12 }}>Gap
                    <input type="color" style={{ marginLeft: 4 }} value={('#' + ((config as any).render.gapFillColor ?? 0x616161).toString(16).padStart(6,'0'))}
                        onChange={(e) => { (config as any).render.gapFillColor = parseInt(e.target.value.replace('#',''),16); forceRerender(); }} />
                </label>
                <label style={{ marginLeft: 6, fontSize: 12 }}>Contorno
                    <input type="color" style={{ marginLeft: 4 }} defaultValue={('#' + ((config as any).render.roadOutlineColor ?? 0x333740).toString(16).padStart(6,'0'))}
                        onChange={(e) => { (config as any).render.roadOutlineColor = parseInt(e.target.value.replace('#',''),16); setUiTick(t=>t+1); }} />
                </label>
                {/* Auto Zonas (densidade) removido */}
                <ToggleButton 
                    onText="Hide Junction Markers" 
                    offText="Show Junction Markers" 
                    action={() => { config.render.showJunctionMarkers = !config.render.showJunctionMarkers; }}
                />
                <ToggleButton 
                    onText="Hide Road Outline" 
                    offText="Show Road Outline" 
                    action={() => { config.render.showRoadOuterOutline = !config.render.showRoadOuterOutline; }}
                />
                <ToggleButton
                    onText="Hide Lane Outlines"
                    offText="Show Lane Outlines"
                    action={() => { (config as any).render.showLaneOutlines = !(config as any).render.showLaneOutlines; setUiTick(t=>t+1); }}
                />
                {/* Controls for lane markers: width (m), length (m), gap (m), color */}
                            <div style={{ marginLeft: 8, display: 'inline-block', verticalAlign: 'middle' }}>
                                <label style={{ fontSize: 12, marginRight: 6 }}>Marcadores:</label>
                                {/* marker defaults persisted via localStorage keys: markerWidth, markerLength, markerGap */}
                                <label style={{ marginLeft: 6, fontSize: 12 }}>Larg (m)
                                    <input id="marker-width" type="number" step={0.1} min={0.05} value={(config as any).render.laneMarkerWidthM ?? 0.5}
                                        onChange={(e) => { const v = parseFloat(e.target.value); (config as any).render.laneMarkerWidthM = isFinite(v) && v > 0 ? v : 0.5; try { localStorage.setItem('markerWidth', String((config as any).render.laneMarkerWidthM)); } catch(e) {} setUiTick(t=>t+1); }} style={{ width: 70, marginLeft: 6 }} />
                                </label>
                                <label style={{ marginLeft: 6, fontSize: 12 }}>Comp (m)
                                    <input id="marker-length" type="number" step={0.1} min={0.05} value={(config as any).render.laneMarkerLengthM ?? 1.0}
                                        onChange={(e) => { const v = parseFloat(e.target.value); (config as any).render.laneMarkerLengthM = isFinite(v) && v > 0 ? v : 1.0; try { localStorage.setItem('markerLength', String((config as any).render.laneMarkerLengthM)); } catch(e) {} setUiTick(t=>t+1); }} style={{ width: 70, marginLeft: 6 }} />
                                </label>
                                <label style={{ marginLeft: 6, fontSize: 12 }}>Gap (m)
                                    <input id="marker-gap" type="number" step={0.1} min={0} value={(config as any).render.laneMarkerGapM ?? 4}
                                        onChange={(e) => { const v = parseFloat(e.target.value); (config as any).render.laneMarkerGapM = isFinite(v) && v >= 0 ? v : 0.5; try { localStorage.setItem('markerGap', String((config as any).render.laneMarkerGapM)); } catch(e) {} setUiTick(t=>t+1); }} style={{ width: 70, marginLeft: 6 }} />
                                </label>
                                <label style={{ marginLeft: 6, fontSize: 12 }}>Cor
                                    <input type="color" style={{ marginLeft: 6 }} value={('#' + ((config as any).render.laneMarkerColor ?? 0xFFFFFF).toString(16).padStart(6,'0'))}
                                        onChange={(e) => { (config as any).render.laneMarkerColor = parseInt(e.target.value.replace('#',''),16); setUiTick(t=>t+1); }} />
                                </label>
                            </div>
                {/* Botões de Fill/Outline e Losangos removidos conforme solicitação */}
                {/* ArcTo smoothing removed — intersection patch smoothing is used instead */}
                <ToggleButton
                    onText="Mostrar apenas contornos de quarteirões: ON"
                    offText="Mostrar apenas contornos de quarteirões: OFF"
                    action={() => {
                        (config as any).render.showOnlyBlockOutlines = !(config as any).render.showOnlyBlockOutlines;
                        setUiTick(t => t + 1);
                    }}
                />
                <ToggleButton 
                    onText="Mostrar apenas interiores de quarteirões: ON" 
                    offText="Mostrar apenas interiores de quarteirões: OFF" 
                    action={() => { 
                        (config as any).render.showOnlyBlockInteriors = !(config as any).render.showOnlyBlockInteriors; 
                        // Se ligar interiores, desligar o modo 'apenas contornos' para evitar conflito visual
                        if ((config as any).render.showOnlyBlockInteriors) {
                            (config as any).render.showOnlyBlockOutlines = false;
                            (config as any).render.showRoadFill = false;
                        }
                        setUiTick(t => t + 1);
                    }}
                />
                <label htmlFor="gap-m" style={{ marginLeft: 8 }}>Gap (m):</label>
                <input 
                    id="gap-m"
                    type="number"
                    min={0}
                    max={20}
                    step={0.5}
                    defaultValue={(config as any).render.blockInteriorGapM ?? 2.0}
                    onChange={(e) => {
                        const v = parseFloat(e.target.value);
                        (config as any).render.blockInteriorGapM = isFinite(v) && v >= 0 ? v : 2.0;
                        setUiTick(t => t + 1);
                    }}
                    style={{ width: 70 }}
                />
                <label htmlFor="outline-mode" style={{ marginLeft: 8 }}>Modo de contorno:</label>
                <select
                    id="outline-mode"
                    value={outlineMode}
                    onChange={(e) => {
                        const v = (e.target.value as 'segments' | 'hull');
                        (config as any).render.roadOutlineMode = v;
                        setOutlineMode(v);
                        // força um pequeno tick para atualizar HUDs que dependem de config
                        setUiTick(t => t + 1);
                    }}
                >
                    <option value="segments">Segmentos</option>
                    <option value="hull">Envelope</option>
                </select>
                <label htmlFor="char-speed" style={{ marginLeft: 8 }}>Velocidade (m/s): {charSpeed.toFixed(1)}</label>
                <input 
                    id="char-speed"
                    type="range" 
                    min="1" 
                    max="150" 
                    step="0.5" 
                    value={charSpeed}
                    onChange={onSpeedChange}
                    style={{ width: 180 }}
                />
                <label htmlFor="segment-limit">Segment limit:</label>
                <input 
                    id="segment-limit" 
                    onChange={onSegmentCountChange} 
                    type="number" 
                    min="1" 
                    max="5000" 
                    value={segmentCountLimit} 
                />
                <label htmlFor="seg-len" style={{ marginLeft: 8 }}>Comprimento do segmento (m): {segLen.toFixed(0)}</label>
                <input 
                    id="seg-len"
                    type="range"
                    min="80"
                    max="400"
                    step="10"
                    value={segLen}
                    onChange={onSegLenChange}
                    style={{ width: 200 }}
                />
                {/* Larguras das vias (aplicadas na próxima geração) */}
                <span style={{ marginLeft: 8, fontWeight: 600 }}>Larguras (m):</span>
                <label htmlFor="road-w" style={{ marginLeft: 6 }}>Rua:</label>
                <input
                    id="road-w"
                    type="number"
                    min={2}
                    max={200}
                    step={1}
                    value={roadW}
                    onChange={onRoadWidthChange}
                    style={{ width: 80 }}
                />
                <label htmlFor="hwy-w" style={{ marginLeft: 6 }}>Rodovia:</label>
                <input
                    id="hwy-w"
                    type="number"
                    min={2}
                    max={300}
                    step={1}
                    value={hwyW}
                    onChange={onHighwayWidthChange}
                    style={{ width: 80 }}
                />
                <button onClick={resetWidthsToDefault} title="Voltar a usar os valores padrão (derivados da escala)" style={{ marginLeft: 6 }}>Usar padrão</button>
                {/* Raio de curva fixo em config.render.outerCornerRadiusM */}
                {/* ================= Bandas Perimetrais de Quarteirão ================= */}
                <div style={{ display: 'inline-block', marginLeft: 12, padding: '4px 6px', border: '1px solid #444', borderRadius: 4 }}>
                    <label style={{ fontWeight: 600, fontSize: 12 }}>Bordas Quarteirão</label>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <label style={{ fontSize: 11 }}>
                            <input type="checkbox" checked={(config as any).render.blockEdgeBandsEnabled}
                                onChange={(e)=>{(config as any).render.blockEdgeBandsEnabled = e.target.checked; forceRerender();}} /> Ativar
                        </label>
                            <label style={{ fontSize: 11, display: 'flex', alignItems: 'center', gap: 6 }}>
                                Fonte da cor:
                                <select value={blockEdgeColorSource} onChange={(e) => {
                                    const v = e.target.value as 'base'|'gap'|'outline'|'custom';
                                    setBlockEdgeColorSource(v);
                                    if (v === 'base') {
                                        (config as any).render.blockEdgeBandColor = (config as any).render.baseRoadColor;
                                        forceRerender();
                                    } else if (v === 'gap') {
                                        (config as any).render.blockEdgeBandColor = (config as any).render.gapFillColor;
                                        forceRerender();
                                    } else if (v === 'outline') {
                                        (config as any).render.blockEdgeBandColor = (config as any).render.roadOutlineColor;
                                        forceRerender();
                                    } else {
                                        // custom: keep existing custom color value
                                        (config as any).render.blockEdgeBandColor = parseInt(blockEdgeCustomColor.slice(1),16);
                                        forceRerender();
                                    }
                                }}>
                                    <option value="base">Base (rua)</option>
                                    <option value="gap">Gap (entre ruas)</option>
                                    <option value="outline">Contorno (rua)</option>
                                    <option value="custom">Custom</option>
                                </select>
                                {/* mostrar picker apenas se custom */}
                                {blockEdgeColorSource === 'custom' && (
                                    <input type="color" style={{ marginLeft: 4 }} value={blockEdgeCustomColor}
                                        onChange={(e) => {
                                            setBlockEdgeCustomColor(e.target.value);
                                            (config as any).render.blockEdgeBandColor = parseInt(e.target.value.slice(1),16);
                                            forceRerender();
                                        }} />
                                )}
                            </label>
                        <label style={{ fontSize: 11 }}>
                            Espessura (cm):
                            <input type="number" min={1} max={200} step={1} style={{ width: 60, marginLeft: 4 }}
                                value={Math.round(((config as any).render.blockEdgeBandThicknessM || 0.10)*100)}
                                onChange={(e)=>{(config as any).render.blockEdgeBandThicknessM = (parseFloat(e.target.value)||10)/100; forceRerender();}} />
                        </label>
                        <label style={{ fontSize: 11, display: 'flex', alignItems: 'center', gap: 6 }}>
                            <input type="checkbox" checked={!!(config as any).render.blockEdgeBandOutlineEnabled}
                                onChange={(e) => { (config as any).render.blockEdgeBandOutlineEnabled = e.target.checked; forceRerender(); }} /> Mostrar contorno
                        </label>
                        <label style={{ fontSize: 11, display: 'flex', alignItems: 'center', gap: 6 }}>
                            Cor Segunda Banda:
                            <input type="color" value={blockEdgeSecondColor} onChange={(e) => {
                                setBlockEdgeSecondColor(e.target.value);
                                try {
                                    // set same color for all faces unless user wants per-face control later
                                    const col = parseInt(e.target.value.slice(1),16);
                                    (config as any).render.blockEdgeBand2FaceColors = { N: col, S: col, L: col, O: col };
                                } catch (err) {}
                                forceRerender();
                            }} />
                        </label>
                    </div>
                </div>
                {/* Painel 'Textura Quarteirão' - permitir carregar texturas personalizadas */}
                <div style={{ display: 'inline-block', marginLeft: 8 }}>
                    <label style={{ fontSize: 12, fontWeight: 600, marginRight: 6 }}>Textura Quarteirão</label>
                    <TextureLoader onLoad={handleTextureLoad} onClear={handleTextureClear} accept="image/*" />
                    <TextureGallery items={gallery as any} selectedIndex={selectedIndex} onAdd={handleGalleryAdd} onSelect={handleGallerySelect} onRemove={handleGalleryRemove} />
                    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, marginLeft: 8 }}>
                        <label style={{ fontSize: 12 }}>Scale</label>
                        <input type="number" step={0.01} min={0.001} value={texScale} onChange={(e)=>{ const v = parseFloat(e.target.value); const nv = isFinite(v) ? v : 1; setTexScale(nv); (config as any).render.blockInteriorTextureScale = nv; setUiTick(t=>t+1); }} style={{ width: 80 }} />
                        <label style={{ fontSize: 12 }}>Alpha</label>
                        <input type="number" step={0.05} min={0} max={1} value={texAlpha} onChange={(e)=>{ const v = parseFloat(e.target.value)||1; setTexAlpha(v); (config as any).render.blockInteriorTextureAlpha = v; setUiTick(t=>t+1); }} style={{ width: 80 }} />
                        <label style={{ fontSize: 12 }}>Tint</label>
                        <input type="color" value={texTint} onChange={(e)=>{ setTexTint(e.target.value); (config as any).render.blockInteriorTextureTint = parseInt(e.target.value.slice(1),16); setUiTick(t=>t+1); }} />
                        <label style={{ fontSize: 12, marginLeft: 8 }}>Crossfade</label>
                        <input type="checkbox" checked={crossfadeEnabled} onChange={(e)=>setCrossfadeEnabled(e.target.checked)} />
                        <label style={{ fontSize: 12 }}>Ms</label>
                        <input type="number" value={crossfadeMs} onChange={(e)=>setCrossfadeMs(parseInt(e.target.value)||500)} style={{ width: 80 }} />
                    </div>
                </div>
                {/* Painel para textura dos marcadores (será usada por cada retângulo de faixa) */}
                <div style={{ display: 'inline-block', marginLeft: 12 }}>
                    <label style={{ fontSize: 12, fontWeight: 600, marginRight: 6 }}>Textura Marcadores (Faixas)</label>
                    <TextureLoader onLoad={handleLaneLoad} onClear={handleLaneClear} accept="image/*" />
                    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, marginLeft: 8 }}>
                        <label style={{ fontSize: 12 }}>Scale (aplica ao sprite do marcador)</label>
                        <input type="number" step={0.01} min={0.001} value={laneScale} onChange={(e)=>{ const raw = e.target.value; const parsed = parseFloat(String(raw).replace(',','.')); const nv = isFinite(parsed) ? parsed : 1; setLaneScale(nv); (config as any).render.roadLaneTextureScale = nv; setUiTick(t=>t+1); }} style={{ width: 80 }} />
                        <label style={{ fontSize: 12 }}>Alpha</label>
                        <input type="number" step={0.05} min={0} max={1} value={laneAlpha} onChange={(e)=>{ const v = parseFloat(e.target.value); const nv = isFinite(v) ? v : 1; setLaneAlpha(nv); (config as any).render.roadLaneTextureAlpha = nv; setUiTick(t=>t+1); }} style={{ width: 80 }} />
                    </div>
                </div>
                {/* Painel para textura de concreto das bordas */}
                <div style={{ display: 'inline-block', marginLeft: 12 }}>
                    <label style={{ fontSize: 12, fontWeight: 600, marginRight: 6 }}>Textura Bordas (Concreto)</label>
                    <TextureLoader onLoad={handleEdgeLoad} onClear={handleEdgeClear} accept="image/*" />
                    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, marginLeft: 8 }}>
                        <label style={{ fontSize: 12 }}>Scale</label>
                        <input type="number" step={0.01} min={0.001} value={edgeScale} onChange={(e)=>{ const v = parseFloat(e.target.value); const nv = isFinite(v) ? v : 1; setEdgeScale(nv); (config as any).render.edgeTextureScale = nv; setUiTick(t=>t+1); }} style={{ width: 80 }} />
                        <label style={{ fontSize: 12 }}>Alpha</label>
                        <input type="number" step={0.05} min={0} max={1} value={edgeAlpha} onChange={(e)=>{ const v = parseFloat(e.target.value); const nv = isFinite(v) ? v : 1; setEdgeAlpha(nv); (config as any).render.edgeTextureAlpha = nv; setUiTick(t=>t+1); }} style={{ width: 80 }} />
                    </div>
                </div>
                
                <button onClick={regenerateMap} style={{ marginLeft: 8 }}>Regenerate</button>
                <a
                    href="/download/citygen.zip"
                    download
                        style={{
                        marginLeft: 8,
                        padding: '6px 10px',
                        background: '#1976d2',
                        color: '#ECEFF1',
                        borderRadius: 4,
                        textDecoration: 'none',
                        border: '1px solid #0d47a1'
                    }}
                >
                    Download .zip
                </a>
                {/* Controles de zonas/overlay removidos para simplificar a UI */}
            </div>
            {heatmapVisible && (
                <div style={{
                    position: 'fixed',
                    top: 8,
                    right: 8,
                    background: 'rgba(0,0,0,0.6)',
                    color: '#ECEFF1',
                    fontSize: 12,
                    padding: '6px 8px',
                    borderRadius: 4,
                    pointerEvents: 'none',
                    lineHeight: 1.25,
                }}>
                    {uiTick /* no-op: só para re-render */}
                    <div style={{ fontWeight: 700, marginBottom: 4 }}>Heatmap (bandas por R)</div>
                    {(() => {
                        const rUnit = (MapStore.getHeatmap() as any)?.rUnit as number | undefined;
                        const R = Math.max(0, Math.round((rUnit ?? 0)));
                        return (
                            <>
                                <div>R: {R > 0 ? `${R} m` : 'n/a'}</div>
                                <div>2R: {R > 0 ? `${2*R} m` : 'n/a'}</div>
                                <div>3R: {R > 0 ? `${3*R} m` : 'n/a'}</div>
                                <div>4R: {R > 0 ? `${4*R} m` : 'n/a'}</div>
                                <div style={{ marginTop: 4 }}>Bandas: 4 (centro, mais claro) → 0 (borda, mais escuro)</div>
                            </>
                        );
                    })()}
                    <div style={{ marginTop: 6, opacity: 0.85 }}>Thresholds (não usados neste modo):</div>
                    <div>t1: {(config as any).zoningModel.heatmapThresholds.t1.toFixed(2)}</div>
                    <div>t2: {(config as any).zoningModel.heatmapThresholds.t2.toFixed(2)}</div>
                    <div>t3: {(config as any).zoningModel.heatmapThresholds.t3.toFixed(2)}</div>
                    <div>t4: {(config as any).zoningModel.heatmapThresholds.t4.toFixed(2)}</div>
                </div>
            )}
        </div>
    );
};

export default App;