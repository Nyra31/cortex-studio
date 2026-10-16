# Cortex Studio

Editor de video de escritorio con línea de tiempo multipista, hecho con Electron, React y FFmpeg.

## Requisitos

- Node.js 22 o superior (probado con Node 26.12 y Electron 44)
- Windows, macOS o Linux. FFmpeg se instala automáticamente con `npm install`.

## Uso

```bash
npm install      # solo la primera vez
npm start        # compila la interfaz y abre la aplicación
npm run dev      # modo desarrollo: recarga la interfaz al guardar cambios
```

## Funciones

- **Medios del proyecto:** importa videos, audios e imágenes con el botón *Importar…* o arrastrándolos desde el Explorador. Muestra una miniatura, la duración y la resolución de cada archivo.
- **Línea de tiempo multipista:** pistas de video arriba y de audio abajo. Un video con sonido se coloca como dos eventos agrupados (video y audio) que se mueven y recortan juntos.
- **Edición:** arrastrar para mover (también a otra pista), recortar por los bordes, dividir en el cursor y eliminar. Incluye ajuste magnético a bordes y al cursor, y deshacer/rehacer.
- **Vista previa** sincronizada con la línea de tiempo. Si varias pistas de video coinciden, se ve la de más arriba.
- **Forma de onda** en los eventos de audio y **miniaturas** en los de video.
- **Proyectos** guardados como archivos `.cortex` (JSON con las rutas de los medios).
- **Renderizado** a MP4 (H.264 + AAC) en 4K, 1080p, 720p, vertical o cuadrado, a 24–60 fps, con barra de progreso.

## Atajos de teclado

| Tecla | Acción |
|---|---|
| Espacio | Reproducir / pausar |
| S | Dividir en el cursor (los eventos seleccionados o, si no hay selección, todos) |
| Supr | Eliminar los eventos seleccionados |
| Ctrl+Z / Ctrl+Y | Deshacer / rehacer |
| Ctrl + rueda, ↑ / ↓ | Zoom de la línea de tiempo |
| ← / → | Retroceder / avanzar un fotograma |
| Inicio / Fin | Ir al principio / al final |
| Ctrl+clic | Añadir o quitar eventos de la selección |
| Ctrl+N / Ctrl+O / Ctrl+S | Nuevo / abrir / guardar |
| Ctrl+I | Importar medios |
| Ctrl+M | Renderizar |
| F12 | Herramientas de desarrollo |

## Estructura

```
electron/main.js        Ventana, diálogos, protocolo media:// para la vista previa
electron/ffmpeg.js      Análisis de medios, miniaturas, formas de onda y renderizado con FFmpeg
electron/preload.js     API segura expuesta a la interfaz (window.api)
src/App.jsx             Estado global, reproducción, atajos y proyecto
src/state/project.js    Modelo de datos y operaciones de edición
src/components/         Línea de tiempo, vista previa, medios, transporte, diálogo de render
```

## Limitaciones conocidas

- La vista previa usa el reproductor de Chromium. Algunos códecs (por ejemplo, ciertos HEVC/H.265, ProRes o archivos AVI antiguos) se importan y se renderizan bien, pero puede que no se vean en la vista previa.
- Todavía no hay transiciones, efectos, títulos ni control de volumen por evento. Son los siguientes pasos naturales.

## Solución de problemas

Si al ejecutar `npm start` aparece `Cannot find module 'electron'` o Electron se comporta como Node, revisa que la variable de entorno `ELECTRON_RUN_AS_NODE` no esté definida en tu terminal.
