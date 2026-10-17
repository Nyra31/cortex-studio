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

## Crear el instalador de Windows

```bash
npm run dist
```

Genera `release/Cortex-Studio-Setup-<versión>.exe`, que instala la aplicación para el usuario actual (sin permisos de administrador) y crea accesos directos en el escritorio y en el menú Inicio. En `release/win-unpacked/` queda también la aplicación lista para ejecutar sin instalar.

El instalador no está firmado digitalmente, así que la primera vez Windows SmartScreen puede mostrar «Windows protegió su PC»: pulsa *Más información → Ejecutar de todas formas*.

El icono se genera con `npm run icon` (script en `scripts/make-icon.js`).

## Funciones

- **Interfaz al estilo de los editores clásicos:** barra de menús, barra de iconos, ventanas acopladas, contador de tiempo grande, pistas de colores y transporte bajo la línea de tiempo.
- **Proyecto nuevo:** al empezar se elige la orientación (horizontal o vertical), la resolución (de SD a 4K, o personalizada) y la velocidad de fotogramas (23,976 a 60 fps). Se puede cambiar en cualquier momento en *Archivo → Propiedades del proyecto* (Alt+Intro).
- **Medios del proyecto:** importa videos, audios e imágenes con *Importar medios* o arrastrándolos desde el Explorador. Muestra una miniatura, la duración y la resolución de cada archivo.
- **Línea de tiempo multipista:** pistas de video arriba y de audio abajo. Un video con sonido se coloca como dos eventos agrupados (video y audio) que se mueven y recortan juntos.
- **Pistas:** silencio, solo, volumen (pistas de audio) y cambio de nombre con doble clic.
- **Edición:** arrastrar para mover (también a otra pista), recortar por los bordes, dividir en el cursor y eliminar. Incluye ajuste magnético a bordes y al cursor, y deshacer/rehacer.
- **Fundidos de entrada y salida:** se arrastran desde los cuadraditos de las esquinas superiores del evento. En audio bajan el volumen; en video hacen aparecer o desaparecer el evento sobre lo que haya debajo (otra pista o negro). Al dividir, cada parte conserva su fundido.
- **Volumen por evento:** en los eventos de audio, arrastrar en vertical la línea superior (de -∞ a 0 dB). El valor aparece en el título del evento y la forma de onda se escala. Se suma al volumen de la pista.
- **Vista previa** sincronizada con la línea de tiempo y con la proporción del proyecto. Si varias pistas de video coinciden, se ve la de más arriba (y la de debajo mientras la de arriba se funde).
- **Forma de onda** en los eventos de audio y **miniaturas** en los de video.
- **Proyectos** guardados como archivos `.cortex` (JSON con las rutas de los medios y los ajustes).
- **Renderizado** a MP4 (H.264 + AAC) con la resolución y velocidad del proyecto, al 100 %, 75 % o 50 % del tamaño.

## Atajos de teclado

| Tecla | Acción |
|---|---|
| Espacio | Reproducir / detener (vuelve a donde empezó) |
| Intro | Reproducir / pausar |
| S | Dividir en el cursor (los eventos seleccionados o, si no hay selección, todos) |
| Supr | Eliminar los eventos seleccionados |
| Ctrl+A | Seleccionar todos los eventos |
| Ctrl+Z / Ctrl+Y | Deshacer / rehacer |
| Ctrl + rueda, ↑ / ↓ | Zoom de la línea de tiempo |
| ← / → | Fotograma anterior / siguiente |
| Inicio / Fin | Ir al principio / al final |
| Ctrl+clic | Añadir o quitar eventos de la selección |
| Doble clic en un tirador de fundido | Quitar el fundido |
| Doble clic en la línea de volumen del evento | Volver a 0 dB |
| F8 | Activar o desactivar el ajuste |
| Ctrl+Q / Ctrl+Mayús+Q | Insertar pista de audio / de video |
| Ctrl+N / Ctrl+O / Ctrl+S | Nuevo / abrir / guardar |
| Ctrl+I | Importar medios |
| Ctrl+M | Renderizar |
| Alt+Intro | Propiedades del proyecto |
| F1 | Lista de atajos |
| F12 | Herramientas de desarrollo |

## Estructura

```
electron/main.js        Ventana, diálogos, protocolo media:// para la vista previa
electron/ffmpeg.js      Análisis de medios, miniaturas, formas de onda y renderizado con FFmpeg
electron/preload.js     API segura expuesta a la interfaz (window.api)
src/App.jsx             Estado global, reproducción, atajos y proyecto
src/state/project.js    Modelo de datos y operaciones de edición
src/components/         Menús, línea de tiempo, vista previa, medios, transporte y diálogos
```

## Limitaciones conocidas

- La vista previa usa el reproductor de Chromium. Algunos códecs (por ejemplo, ciertos HEVC/H.265, ProRes o archivos AVI antiguos) se importan y se renderizan bien, pero puede que no se vean en la vista previa.
- Todavía no hay transiciones, efectos ni títulos. Son los siguientes pasos naturales.
- El volumen de pista y el de evento van de -∞ a 0 dB (no amplifican).
- Los fundidos son lineales (no se puede elegir la curva).

## Solución de problemas

Si al ejecutar `npm start` aparece `Cannot find module 'electron'` o Electron se comporta como Node, revisa que la variable de entorno `ELECTRON_RUN_AS_NODE` no esté definida en tu terminal.
