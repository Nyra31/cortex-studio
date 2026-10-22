# Cortex Studio

Editor de video de escritorio con línea de tiempo multipista, al estilo de los editores clásicos como VEGAS. Hecho con Electron, React y FFmpeg.

## Descarga

Descarga `Cortex-Studio-Setup-<versión>.exe` de la [última release](https://github.com/Nyra31/cortex-studio/releases/latest) (Windows). Se instala sin permisos de administrador y después se actualiza sola.

El instalador no está firmado, así que la primera vez Windows SmartScreen puede mostrar «Windows protegió su PC»: pulsa *Más información → Ejecutar de todas formas*.

## Funciones

- **Edición:** multipista con eventos de video, audio, imagen y texto; recortar, dividir, deslizar y sustituir; ajuste magnético; edición en cascada; marcadores y regiones; velocidad y rampas de velocidad.
- **Video:** transiciones, efectos con fotogramas clave, panorámica/recorte animado, modos de fusión, envolventes de opacidad y corrección de color (ruedas, curvas, LUT `.cube`).
- **Audio:** efectos, envolventes de volumen y panorámica, ducking automático, medidores y grabación de voz en off.
- **Texto:** títulos con 50 fuentes incluidas, animaciones, plantillas y subtítulos (SRT).
- **Vista previa:** en tiempo real con WebGL, igual que el render; proxies, monitores de video y pantalla completa.
- **Render:** MP4 (H.264/H.265), WebM, ProRes, GIF, MP3 y WAV, con plantillas para YouTube y formatos verticales, normalización de sonoridad y cola de render.

El [manual](docs/MANUAL.md) explica cada función, todos los atajos de teclado (también en la aplicación con F1) y las limitaciones conocidas. Los cambios de cada versión están en el [CHANGELOG](CHANGELOG.md).

## Desarrollo

Requiere Node.js 22 o superior. FFmpeg se instala con las dependencias.

```bash
npm install      # solo la primera vez
npm start        # compila la interfaz y abre la aplicación
npm run dev      # modo desarrollo: recarga la interfaz al guardar cambios
npm run dist     # instalador de Windows en release/
```

Para publicar una versión, la release de GitHub debe llevar el instalador, su `.blockmap` y `latest.yml` (los tres en `release/`); sin `latest.yml` las actualizaciones automáticas no ven la versión.

Si la aplicación no se abre al lanzar `electron .` a mano, quita la variable `ELECTRON_RUN_AS_NODE` (la definen, por ejemplo, las terminales de VS Code). `npm start` y `npm run dev` ya la quitan.

## Licencia

Software libre con licencia [GPL-3.0](LICENSE). Incluye FFmpeg (GPL) y 50 fuentes de Google Fonts con sus propias licencias libres (`public/fonts/LICENCIAS.txt`).
