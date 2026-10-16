# Cortex Studio

Editor de video de escritorio (Electron 44 + React 18 + Vite 5 + FFmpeg). Toda la interfaz, los comentarios, los mensajes de commit y la documentación están en **español**.

Repositorio: https://github.com/Nyra31/cortex-studio (rama `main`, etiqueta `v0.1.0` = primera versión con instalador).

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

- `electron/main.js`: ventana, diálogos, IPC (`ipcMain.handle`) y protocolo `media://` (sirve a la vista previa **solo** los archivos importados, con soporte de rangos).
- `electron/ffmpeg.js`: análisis (ffprobe), miniaturas, formas de onda (`peaks`) y renderizado a MP4 con `filter_complex`. Las rutas de ffmpeg/ffprobe se ajustan para `app.asar.unpacked` al empaquetar.
- `electron/preload.js`: única puerta entre interfaz y sistema (`window.api`). Cualquier función nueva del proceso principal se añade aquí y en `main.js`.
- `src/state/project.js`: modelo de datos y operaciones de edición como **funciones puras** que devuelven un proyecto nuevo (inmutable). El esquema está documentado al principio del archivo.
- `src/state/useHistory.js`: deshacer/rehacer. `set(updater, false)` actualiza sin crear paso (se usa durante los arrastres; al soltar se registra un solo paso).
- `src/App.jsx`: estado global, reproducción, atajos de teclado, abrir/guardar.
- `src/components/`: MenuBar, Toolbar, Dock, MediaPool, Preview, Timeline, Transport, Waveform y diálogos (Project, Render, Shortcuts).
- `src/styles.css`: un único archivo de estilos, tema oscuro estilo editor clásico.

## Convenciones del modelo

- Tiempos en **segundos** (float). `MIN_EVENT` = duración mínima de un evento.
- Pistas ordenadas de arriba a abajo: las de video siempre encima de las de audio (`addTrack` lo respeta).
- Un video con sonido = dos eventos con el mismo `groupId`; se mueven, recortan y dividen juntos.
- Volumen de pista en dB (`MIN_VOLUME_DB` = silencio, máximo 0 dB). Silencio/solo se resuelven con `isTrackActive`.
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

## Estado (16/10/2026)

v0.1.0 terminada: edición multipista, vista previa, renderizado a MP4, interfaz estilo editor clásico, propiedades del proyecto e instalador de Windows. No hay trabajo a medias. El siguiente paso está por decidir entre los puntos de la lista de abajo.

## Pendiente (siguientes pasos naturales)

Transiciones, efectos, títulos, volumen por evento, amplificación por encima de 0 dB. La vista previa usa el reproductor de Chromium, así que algunos códecs (HEVC, ProRes, AVI antiguos) se renderizan pero no se ven en la vista previa.

## Al terminar una función

Actualizar el README (lista de funciones, atajos, limitaciones) y la tabla de atajos de `ShortcutsDialog.jsx` si se añaden teclas.
