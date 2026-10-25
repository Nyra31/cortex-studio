# Cortex Studio

Editor de video de escritorio con línea de tiempo multipista, al estilo de los editores clásicos como VEGAS. Hecho con Electron, React y FFmpeg.

## Descarga

Descarga `Cortex-Studio-Setup-<versión>.exe` de la [última release](https://github.com/Nyra31/cortex-studio/releases/latest) (Windows). Se instala sin permisos de administrador y después se actualiza sola.

El instalador no está firmado, así que la primera vez Windows SmartScreen puede mostrar «Windows protegió su PC»: pulsa *Más información → Ejecutar de todas formas*. A partir de la versión 1.1 se firmará con SignPath ([Code signing policy](#code-signing-policy)).

## Funciones

- **Edición:** multipista con eventos de video, audio, imagen y texto; recortar, dividir, deslizar y sustituir; ajuste magnético; edición en cascada; marcadores y regiones; velocidad y rampas de velocidad.
- **Descargas:** videos de YouTube (y de muchos otros sitios) a MP4, MKV, WebM, MOV o solo audio, con metadatos, portada, capítulos y subtítulos.
- **Compresor:** por lotes, al estilo de HandBrake: H.264, H.265, VP9 y AV1 (también con la tarjeta gráfica), calidad constante o tamaño objetivo, recorte de bandas negras, filtros y preajustes.
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

## Code signing policy

*Política de firma de código* (en español más abajo).

Free code signing provided by [SignPath.io](https://about.signpath.io), certificate by [SignPath Foundation](https://signpath.org).

The Windows installer is built from this repository by GitHub Actions ([`instalador.yml`](.github/workflows/instalador.yml)) and signed with SignPath. Releases before 1.1 are not signed.

Team roles:

- Committers and reviewers: [Nyra31](https://github.com/Nyra31)
- Approvers: [Nyra31](https://github.com/Nyra31)

**Privacy policy:** This program will not transfer any information to other networked systems unless specifically requested by the user or the person installing or operating it. The only connections it makes are:

- checking for and downloading updates from this repository's [GitHub releases](https://github.com/Nyra31/cortex-studio/releases) ([GitHub Privacy Statement](https://docs.github.com/site-policy/privacy-policies/github-general-privacy-statement));
- when the user asks for it: downloading videos with [yt-dlp](https://github.com/yt-dlp/yt-dlp) from the site the user enters (for YouTube, the [Google Privacy Policy](https://policies.google.com/privacy) applies), and downloading or updating yt-dlp from GitHub;
- when the user asks for automatic subtitles: downloading [whisper.cpp](https://github.com/ggml-org/whisper.cpp) from GitHub and its models from [Hugging Face](https://huggingface.co) ([Hugging Face Privacy Policy](https://huggingface.co/privacy)). Transcription runs on the user's computer.

Projects, media files and error logs stay on the user's computer.

### Política de firma de código

Firma de código gratuita de [SignPath.io](https://about.signpath.io), certificado de [SignPath Foundation](https://signpath.org). El instalador de Windows se compila en GitHub Actions a partir de este repositorio y se firma con SignPath; las versiones anteriores a la 1.1 no están firmadas.

- Autores (committers) y revisores (reviewers): [Nyra31](https://github.com/Nyra31).
- Aprobación de las firmas (approvers): [Nyra31](https://github.com/Nyra31).

**Privacidad:** Cortex Studio no envía información a ningún sistema en red salvo cuando el usuario lo pide. Solo se conecta para buscar y descargar actualizaciones en las releases de este repositorio (GitHub) y, cuando el usuario lo pide, para descargar videos con yt-dlp del sitio que indique, descargar o actualizar yt-dlp (GitHub) y descargar whisper.cpp (GitHub) y sus modelos (Hugging Face) para los subtítulos automáticos, que se generan en el propio equipo. Los proyectos, los medios y los registros de errores se quedan en el equipo. Se aplican las políticas de privacidad de GitHub, Google (YouTube) y Hugging Face enlazadas arriba.

## Licencia

Software libre con licencia [GPL-3.0](LICENSE). Incluye FFmpeg (GPL) y 50 fuentes de Google Fonts con sus propias licencias libres (`public/fonts/LICENCIAS.txt`).
