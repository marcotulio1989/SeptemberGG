import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './components/App';
import './styles.css'; // We'll create this file for styles

const container = document.getElementById('root');
if (container) {
    const root = createRoot(container);
    root.render(
        <React.StrictMode>
            <App />
        </React.StrictMode>
    );
}