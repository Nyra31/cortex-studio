import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import { loadBundledFonts } from './state/fonts.js';
import './styles.css';

// Las fuentes incluidas se cargan antes de dibujar nada (los textos se dibujan en un lienzo y el render usa
// ese dibujo). Si tardan demasiado, se arranca igual.
Promise.race([loadBundledFonts(), new Promise((resolve) => setTimeout(resolve, 3000))]).then(() => {
  createRoot(document.getElementById('root')).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
});
