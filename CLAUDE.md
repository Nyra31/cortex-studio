# Cortex Studio

Editor de video de escritorio (Electron 44 + React 18 + Vite 5 + FFmpeg). Toda la interfaz, los comentarios, los mensajes de commit y la documentación están en **español**.

Repositorio: https://github.com/Nyra31/cortex-studio (rama `main`, etiqueta `v0.1.0` = primera versión con instalador).

Releases: cada versión publicada tiene etiqueta `vX.Y.Z` y una release en GitHub con `Cortex-Studio-Setup-X.Y.Z.exe` adjunto. Pasos: subir `version` en `package.json`, `npm run dist`, commit, etiqueta, push y crear la release subiendo el `.exe` (con `gh` si está instalado; si no, con la API de GitHub usando el token de `git credential fill`).

## Comandos

```bash
npm start        # vite build + electron .
npm run dev      # Vite en 127.0.0.1:5173 + Electron con recarga
npm run dist     # instalador NSIS en release/Cortex-Studio-Setup-<versión>.exe
npm run icon     # regenera build/icon.png (scripts/make-icon.js)
```

No hay tests ni linter. Para comprobar un cambio: `npm run build` (debe compilar sin errores) y probar la app con `npm start`.
Si Electron se comporta como Node, la variable `ELECTRON_RUN_AS_NODE` está definida en la terminal: hay que quitarla.

## Arquitectura

- `electron/main.js`: ventana, diálogos, IPC (`ipcMain.handle`) y protocolo `media://` (sirve a la vista previa **solo** los archivos importados, con soporte de rangos y CORS, necesario para que WebGL lea los fotogramas).
- `electron/ffmpeg.js`: análisis (ffprobe), miniaturas, formas de onda (`peaks`) y renderizado a MP4 con `filter_complex`. Las rutas de ffmpeg/ffprobe se ajustan para `app.asar.unpacked` al empaquetar.
- `electron/preload.js`: única puerta entre interfaz y sistema (`window.api`). Cualquier función nueva del proceso principal se añade aquí y en `main.js`.
- `src/state/project.js`: modelo de datos y operaciones de edición como **funciones puras** que devuelven un proyecto nuevo (inmutable). El esquema está documentado al principio del archivo.
- `src/state/useHistory.js`: deshacer/rehacer. `set(updater, false)` actualiza sin crear paso (se usa durante los arrastres; al soltar se registra un solo paso).
- `src/App.jsx`: estado global, reproducción, atajos de teclado, abrir/guardar, portapapeles (interno, no el del sistema) y el contenido del menú contextual (`openContextMenu`; la línea de tiempo solo avisa de dónde se hizo clic derecho).
- `src/state/transitions.js`: catálogo de transiciones agrupado como en VEGAS. Cada preajuste es un `transition=` de `xfade` de FFmpeg.
- `src/preview/compositor.js`: compositor WebGL2 de la vista previa. Las transiciones son traducciones a GLSL de `vf_xfade.c` (P va de 1 = solo A a 0 = solo B; `mixx(a,b,m) = a·m + b·(1−m)`), para que la vista previa coincida con el render. Para añadir una transición: entrada en `transitions.js` + fragmento en `GLSL` del compositor.
- `src/components/`: MenuBar, Toolbar, Dock (con pestañas), MediaPool, TransitionsPanel, Preview (un `<video>` oculto por evento cercano al cursor; el compositor toma sus fotogramas), Timeline, Transport, Waveform y diálogos (Project, Render, Shortcuts).
- `src/styles.css`: un único archivo de estilos, tema oscuro estilo editor clásico.

## Convenciones del modelo

- Tiempos en **segundos** (float). `MIN_EVENT` = duración mínima de un evento.
- Pistas ordenadas de arriba a abajo: las de video siempre encima de las de audio (`addTrack` lo respeta).
- Un video con sonido = dos eventos con el mismo `groupId`; se mueven, recortan y dividen juntos.
- Volumen de pista en dB (`MIN_VOLUME_DB` = silencio, máximo 0 dB). Silencio/solo se resuelven con `isTrackActive`.
- Cada evento tiene `volume` (dB, solo afecta al audio), `fadeIn`, `fadeOut` (segundos) y `transition` (id de la transición de entrada; `null` = disolución cruzada). En video el fundido es de transparencia (`fade ... alpha=1` en FFmpeg; opacidad de capas en el compositor).
- Solapamientos: si un evento empieza dentro de otro de su pista y termina después, es una transición. `resolveTimeline(project)` calcula los solapamientos (`incoming`/`outgoing`), las transiciones de video y los **fundidos efectivos** (`fades`): en audio el solapamiento es un fundido cruzado; en video la transición anula los fundidos de esos bordes. Usar siempre esos fundidos (render, vista previa y línea de tiempo), no los guardados.
- Render de una transición: entradas aparte con el final de A y el principio de B, `xfade` entre ellas y `overlay` encima del evento B, dentro del orden de su pista.
- Render de video sobre la **rejilla de fotogramas**: cada fragmento ocupa los fotogramas cuyo instante cae en [inicio, fin) (`frameSpan`), se desplaza por fotogramas enteros y se superpone solo en ellos. No volver a desplazar por segundos: el redondeo dejaba un fotograma negro en los cortes.
- Vista previa sin pausas en los cortes: eventos seguidos que continúan el mismo archivo comparten reproductor (`playerKeys` en `Preview.jsx`), y los reproductores de video y audio de los eventos que empiezan en los próximos 2 s se cargan por adelantado.
- Archivo `.cortex` = JSON de `serializeProject` (`format: 'cortex-studio'`, `version`). Miniaturas y formas de onda no se guardan; se regeneran al abrir. Si cambia el formato, `loadProject` debe seguir abriendo los archivos antiguos (rellenar campos por defecto).
- IDs con `uid(prefijo)`: `t` pistas, `e` eventos, `g` grupos.

## Preferencias del usuario

- Responder siempre en español; commits en español, en frases cortas en infinitivo o nominales (p. ej. «Instalador de Windows con electron-builder»).
- El usuario trabaja desde varios dispositivos: lo importante para continuar debe quedar en este archivo y en el repo (la memoria local de Claude no se comparte entre equipos).
- `gh` (GitHub CLI) puede no estar instalado; git funciona con Git Credential Manager.

## Para empezar en otro equipo

```bash
git clone https://github.com/Nyra31/cortex-studio.git
cd cortex-studio
npm install      # descarga Electron, FFmpeg y ffprobe
npm start
```

`dist/` y `release/` no están en el repo: se regeneran con `npm run build` / `npm run dist` (el instalador solo se puede generar en Windows).

## Estado (17/10/2026, v0.2.0)

v0.1.0 terminada: edición multipista, vista previa, renderizado a MP4, interfaz estilo editor clásico, propiedades del proyecto e instalador de Windows.
v0.2.0: volumen por evento y fundidos de entrada/salida (formato `.cortex` versión 2; los de versión 1 se siguen abriendo).
Después (sin publicar todavía): transiciones (fase 1 de 3), con vista previa WebGL y formato `.cortex` versión 3.

## Pendiente (siguientes pasos naturales)

El usuario pidió «transiciones y efectos de sonido y video, los mismos que tiene VEGAS integrados». Plan acordado en tres fases:
1. Transiciones: **hecha**.
2. Efectos de video por evento (cadena con parámetros): brillo y contraste, corrección de color, tono/saturación/luminosidad, blanco y negro, sepia, invertir, desenfoque gaussiano, enfoque, pixelado, espejo, viñeta, brillo difuso, croma. Vista previa con shaders en el compositor y render con filtros de FFmpeg.
3. Efectos de audio: ecualizador, compresor, reverberación, eco/retardo, chorus, flanger, cambio de tono, puerta de ruido, normalizar, distorsión. Vista previa con Web Audio y render con FFmpeg; incluir aquí la amplificación por encima de 0 dB.

Otros: títulos, curvas de fundido, transiciones sobre un fundido hacia la pista de debajo (sin solapamiento). La amplificación por encima de 0 dB necesita Web Audio en la vista previa, porque `HTMLMediaElement.volume` no pasa de 1. La vista previa usa el reproductor de Chromium, así que algunos códecs (HEVC, ProRes, AVI antiguos) se renderizan pero no se ven en la vista previa.

## Al terminar una función

Actualizar el README (lista de funciones, atajos, limitaciones) y la tabla de atajos de `ShortcutsDialog.jsx` si se añaden teclas.
