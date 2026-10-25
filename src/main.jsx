import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import ErrorBoundary from './components/ErrorBoundary.jsx';
import { loadBundledFonts } from './state/fonts.js';
import { lang } from './i18n/index.js';
import './styles.css';

document.documentElement.lang = lang;

// Errores sueltos de la página (fuera de React o en promesas): al registro (ver electron/log.js).
window.addEventListener('error', (e) => window.api?.logError('ventana', e.error?.stack || `${e.message} (${e.filename}:${e.lineno})`));
window.addEventListener('unhandledrejection', (e) => window.api?.logError('promesa', e.reason?.stack || e.reason));

// Las fuentes incluidas se cargan antes de dibujar nada (los textos se dibujan en un lienzo y el render usa
// ese dibujo). Si tardan demasiado, se arranca igual.
Promise.race([loadBundledFonts(), new Promise((resolve) => setTimeout(resolve, 3000))]).then(() => {
  createRoot(document.getElementById('root')).render(
    <StrictMode>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </StrictMode>,
  );
});
