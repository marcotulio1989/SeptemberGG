import React, { useRef, useState, useEffect } from 'react';
import * as PIXI from 'pixi.js';

type Props = {
    onLoad: (tex: PIXI.Texture, url: string) => void;
    onClear?: () => void;
    accept?: string;
};

const TextureLoader: React.FC<Props> = ({ onLoad, onClear, accept = 'image/*' }) => {
    const inputRef = useRef<HTMLInputElement | null>(null);
    const [previewUrl, setPreviewUrl] = useState<string | null>(null);

    useEffect(() => {
        return () => {
            if (previewUrl) {
                try { URL.revokeObjectURL(previewUrl); } catch (e) {}
            }
        };
    }, [previewUrl]);

    const handleFile = (file?: File) => {
        if (!file) return;
        const url = URL.createObjectURL(file);
        // Create an Image and wait for it to load so we can produce a fully valid PIXI.Texture
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => {
            try {
                const base = new PIXI.BaseTexture(img);
                const tex = new PIXI.Texture(base);
                onLoad(tex, url);
                setPreviewUrl(url);
            } catch (e) {
                // fallback: try PIXI.Texture.from
                try { const tex2 = PIXI.Texture.from(url); onLoad(tex2, url); setPreviewUrl(url); } catch (e2) {}
            }
        };
        img.onerror = () => {
            // fallback to objectURL-based texture
            try { const tex = PIXI.Texture.from(url); onLoad(tex, url); setPreviewUrl(url); } catch (e) {}
        };
        img.src = url;
    };

    const onChange: React.ChangeEventHandler<HTMLInputElement> = (e) => {
        const f = e.target.files && e.target.files[0];
        if (f) handleFile(f);
    };

    const clear = () => {
        if (previewUrl) {
            try { URL.revokeObjectURL(previewUrl); } catch (e) {}
            setPreviewUrl(null);
        }
        if (onClear) onClear();
        if (inputRef.current) inputRef.current.value = '';
    };

    return (
        <div style={{ display: 'inline-block', marginLeft: 8, verticalAlign: 'middle' }}>
            <input ref={inputRef} type="file" accept={accept} onChange={onChange} />
            {previewUrl && (
                <span style={{ marginLeft: 8, display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                    <img src={previewUrl} alt="preview" style={{ width: 48, height: 48, objectFit: 'cover', borderRadius: 4, border: '1px solid #333' }} />
                    <button onClick={clear}>Clear</button>
                </span>
            )}
        </div>
    );
};

export default TextureLoader;
