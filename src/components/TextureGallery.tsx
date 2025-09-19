import React, { useRef, useState } from 'react';
import * as PIXI from 'pixi.js';

type Item = { id: number; name: string; url: string; texture: PIXI.Texture };

type Props = {
    items: Item[];
    selectedIndex: number | null;
    onAdd: (item: Item) => void;
    onSelect: (index: number | null) => void;
    onRemove: (index: number) => void;
};

let nextId = 1;

const TextureGallery: React.FC<Props> = ({ items, selectedIndex, onAdd, onSelect, onRemove }) => {
    const inputRef = useRef<HTMLInputElement | null>(null);

    const handleFiles = (files?: FileList | null) => {
        if (!files) return;
        for (let i = 0; i < files.length; i++) {
            const f = files[i];
            const url = URL.createObjectURL(f);
            const img = new Image();
            img.crossOrigin = 'anonymous';
            img.onload = () => {
                try {
                    const base = new PIXI.BaseTexture(img);
                    base.wrapMode = PIXI.WRAP_MODES.REPEAT;
                    const tex = new PIXI.Texture(base);
                    const item: Item = { id: nextId++, name: f.name, url, texture: tex };
                    onAdd(item);
                } catch (e) {
                    try { const tex2 = PIXI.Texture.from(url); const item: Item = { id: nextId++, name: f.name, url, texture: tex2 }; onAdd(item); } catch (e2) {}
                }
            };
            img.onerror = () => {
                try { const tex2 = PIXI.Texture.from(url); const item: Item = { id: nextId++, name: f.name, url, texture: tex2 }; onAdd(item); } catch (e) {}
            };
            img.src = url;
        }
        if (inputRef.current) inputRef.current.value = '';
    };

    return (
        <div style={{ display: 'inline-block', marginLeft: 8, verticalAlign: 'middle' }}>
            <input ref={inputRef} type="file" accept="image/*" multiple onChange={(e) => handleFiles(e.target.files)} />
            <div style={{ display: 'flex', gap: 8, marginTop: 8, alignItems: 'center' }}>
                {items.map((it, idx) => (
                    <div key={it.id} style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center' }}>
                        <img src={it.url} alt={it.name} style={{ width: 48, height: 48, objectFit: 'cover', border: idx === selectedIndex ? '2px solid #1976d2' : '1px solid #333', borderRadius: 4 }}
                            onClick={() => onSelect(idx)} />
                        <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
                            <button onClick={() => onSelect(idx)} style={{ fontSize: 11 }}>Use</button>
                            <button onClick={() => onRemove(idx)} style={{ fontSize: 11 }}>Del</button>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
};

export default TextureGallery;
