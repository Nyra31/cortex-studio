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
- **Pistas:** silencio, solo, volumen (pistas de audio, de -∞ a +12 dB) y cambio de nombre con doble clic.
- **Edición:** arrastrar para mover (también a otra pista), recortar por los bordes, dividir en el cursor y eliminar. Incluye ajuste magnético a bordes y al cursor, y deshacer/rehacer.
- **Cursor como en VEGAS:** al hacer clic o arrastrar en la regla, en una pista o en un evento, el cursor se coloca ahí; con el ajuste activado (F8) se pega al principio o al final de los eventos cercanos y, si no, cae siempre en un fotograma exacto. Mayús mientras se arrastra desactiva el ajuste (también al mover eventos). El triángulo de arriba se arrastra sin saltar al puntero, para ajustes finos. Con el teclado: fotograma a fotograma (← →), de corte en corte (Ctrl+← →) y por marcas de la regla (Re Pág / Av Pág). Si el cursor sale de la vista, la línea de tiempo se desplaza para enseñarlo.
- **Selección por área:** arrastrando desde una zona vacía de las pistas se dibuja un rectángulo que selecciona los eventos que toca (con su grupo, para que el audio no se separe de su video). Con Ctrl se añaden a la selección. Un clic simple en una zona vacía quita la selección y coloca el cursor.
- **Cortar, copiar y pegar** eventos (Ctrl+X, Ctrl+C, Ctrl+V). Se pega en el cursor, en las mismas pistas, y el cursor salta al final de lo pegado para poder pegar varias veces seguidas. **Agrupar** (G) y **quitar del grupo** (U) para que varios eventos se muevan juntos o separar el audio de su video.
- **Menú contextual** con clic derecho: en un evento (cortar, copiar, pegar, eliminar, dividir, agrupar, quitar fundidos, volumen a 0 dB, volver a disolución cruzada, abrir la ubicación del archivo) y en una zona vacía de una pista (pegar ahí, seleccionar todo, insertar pistas).
- **Fundidos de entrada y salida:** se arrastran desde los cuadraditos de las esquinas superiores del evento. En audio bajan el volumen; en video hacen aparecer o desaparecer el evento sobre lo que haya debajo (otra pista o negro). Al dividir, cada parte conserva su fundido.
- **Volumen por evento:** en los eventos de audio, arrastrar en vertical la línea superior (de -∞ a 0 dB). El valor aparece en el título del evento y la forma de onda se escala. Se suma al volumen de la pista.
- **Transiciones** al estilo de VEGAS: al solapar el final de un evento con el principio de otro en la misma pista se crea una disolución cruzada (en audio, un fundido cruzado). La duración es la del solapamiento. En la pestaña *Transiciones* (Alt+7) hay 49 preajustes en 12 categorías (disolución, barridos lineal, diagonal y de reloj, iris, puerta de granero, empujar, deslizar, persianas venecianas, comprimir, zoom y pixelado), con miniaturas animadas al pasar el ratón. Se aplican arrastrándolas sobre el solapamiento; doble clic en él vuelve a la disolución cruzada.
- **Efectos de video por evento** al estilo de VEGAS: en la pestaña *Efectos de video* (Alt+8) hay 13 efectos en 4 categorías (color: brillo y contraste, corrección de color, tono/saturación/luminosidad, blanco y negro, sepia, invertir; desenfoque y nitidez: desenfoque gaussiano, enfocar, brillo difuso; estilizar: pixelar, viñeta, espejo; composición: croma). Se añaden arrastrándolos sobre un evento de video. El botón **fx** de cada evento (verde si tiene efectos) abre su ventana de efectos: la cadena en el orden en que se aplican (se pueden activar, desactivar, reordenar y quitar) y los controles del efecto elegido, con la vista previa al momento. El croma deja transparente el color elegido y se ve la pista de debajo.
- **Efectos de audio por evento**, igual que los de video: en la pestaña *Efectos de audio* hay 13 efectos (ecualización: ecualizador gráfico de 10 bandas, filtros paso bajo y paso alto; dinámica: compresor, puerta de ruido, normalizar, amplificar; retardo y modulación: eco, chorus, flanger, cambio de tono, distorsión; ambiente: reverberación). Se arrastran sobre un evento de audio o se añaden desde su botón **fx**, y se oyen al momento en la vista previa.
- **Vista previa** dibujada con WebGL, sincronizada con la línea de tiempo y con la proporción del proyecto. Muestra las transiciones, los fundidos y las pistas superpuestas igual que el renderizado.
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
| Ctrl+X / Ctrl+C / Ctrl+V | Cortar / copiar / pegar eventos (se pega en el cursor) |
| G / U | Agrupar los eventos seleccionados / quitarlos del grupo |
| Clic derecho | Menú contextual del evento o de la pista |
| Ctrl+Z / Ctrl+Y | Deshacer / rehacer |
| Ctrl + rueda, ↑ / ↓ | Zoom de la línea de tiempo |
| ← / → (o Alt+← / →) | Fotograma anterior / siguiente |
| Ctrl+← / Ctrl+→ | Punto de edición anterior / siguiente (principio o final de un evento) |
| Re Pág / Av Pág | Marca anterior / siguiente de la regla |
| Inicio / Fin (o Ctrl+Inicio / Ctrl+Fin) | Ir al principio / al final |
| Mayús mientras se arrastra | Sin ajuste (cursor y eventos) |
| Ctrl+clic | Añadir o quitar eventos de la selección |
| Arrastrar en una zona vacía (Ctrl: añadir) | Seleccionar eventos con un rectángulo |
| Doble clic en un tirador de fundido | Quitar el fundido |
| Doble clic en la línea de volumen del evento | Volver a 0 dB |
| F8 | Activar o desactivar el ajuste |
| Ctrl+Q / Ctrl+Mayús+Q | Insertar pista de audio / de video |
| Ctrl+N / Ctrl+O / Ctrl+S | Nuevo / abrir / guardar |
| Ctrl+I | Importar medios |
| Ctrl+M | Renderizar |
| Alt+Intro | Propiedades del proyecto |
| Alt+4 / Alt+7 / Alt+8 | Ventana de medios del proyecto / de transiciones / de efectos de video |
| Doble clic en un solapamiento | Volver a disolución cruzada |
| F1 | Lista de atajos |
| F12 | Herramientas de desarrollo |

## Estructura

```
electron/main.js        Ventana, diálogos, protocolo media:// para la vista previa
electron/ffmpeg.js      Análisis de medios, miniaturas, formas de onda y renderizado con FFmpeg
electron/preload.js     API segura expuesta a la interfaz (window.api)
src/App.jsx             Estado global, reproducción, atajos y proyecto
src/state/project.js    Modelo de datos y operaciones de edición
src/state/transitions.js  Catálogo de transiciones (preajustes de xfade de FFmpeg)
src/state/effects.js      Catálogo de efectos de video (parámetros y filtro de FFmpeg de cada uno)
src/preview/compositor.js Compositor WebGL de la vista previa (capas, fundidos, transiciones y efectos)
src/preview/effects-gl.js Efectos en la vista previa (shaders con las mismas fórmulas que FFmpeg)
src/state/audio-effects.js Catálogo de efectos de audio (parámetros y filtro de FFmpeg)
src/preview/audio-engine.js Audio de la vista previa con Web Audio (efectos y volumen por reproductor)
src/preview/audio-fx.js   Efectos de audio en Web Audio (y procesadores propios en un AudioWorklet)
src/components/         Menús, línea de tiempo, vista previa, medios, transiciones, transporte y diálogos
```

## Limitaciones conocidas

- La vista previa usa el reproductor de Chromium. Algunos códecs (por ejemplo, ciertos HEVC/H.265, ProRes o archivos AVI antiguos) se importan y se renderizan bien, pero puede que no se vean en la vista previa.
- Todavía no hay títulos. Es el siguiente paso natural.
- Los efectos se aplican al evento entero (sin fotogramas clave para animar sus valores).
- Las colas del eco y la reverberación se cortan al final del evento.
- Las transiciones necesitan dos eventos solapados en la misma pista; no se pueden aplicar a un fundido hacia la pista de debajo (los fundidos de video son solo de transparencia).
- Si dos eventos de video del mismo archivo coinciden en el mismo instante, la vista previa abre el archivo dos veces; con archivos muy pesados puede ir más lenta.
- El volumen de evento va de -∞ a 0 dB, como en VEGAS; para subirlo más, el volumen de pista (hasta +12 dB) o los efectos Amplificar y Normalizar.
- Los fundidos son lineales (no se puede elegir la curva).

## Solución de problemas

Si al ejecutar `npm start` aparece `Cannot find module 'electron'` o Electron se comporta como Node, revisa que la variable de entorno `ELECTRON_RUN_AS_NODE` no esté definida en tu terminal.
