# Cambios

Los instaladores de cada versión están en las [releases de GitHub](https://github.com/Nyra31/cortex-studio/releases). Los proyectos guardados con versiones anteriores se siguen abriendo.

## 1.1.1 (28/10/2026)

- **macOS y Linux:** Cortex Studio también para Mac (Apple Silicon e Intel, `.dmg`) y Linux (`.AppImage`). En Mac los atajos van con Cmd y las versiones nuevas se avisan pero se descargan a mano (la aplicación no está firmada por Apple); los subtítulos automáticos usan whisper.cpp de Homebrew (`brew install whisper-cpp`).
- Los instaladores de los tres sistemas se compilan y se prueban en GitHub Actions.
- **Fallos corregidos:**
  - Invertir o estabilizar un evento agrupado con otro trozo distinto del mismo archivo estropeaba ese otro evento (pasaba a usar un archivo que no tenía su parte).
  - Quitar de *Medios del proyecto* el original de un evento invertido, estabilizado, sin ruido o sin voces dejaba su «deshacer» apuntando a un medio que ya no existe.
  - Con un apóstrofo en la carpeta temporal (un usuario de Windows como «O'Brien»), fallaban el render de textos animados e invertir.
  - Dos renders a la vez (la cola y los subtítulos automáticos) podían colarse juntos, y cancelar justo después de medir la sonoridad no paraba el render.
  - Guardar escribe primero en un archivo temporal: un cierre a medias ya no puede dejar el proyecto roto.
  - Si al cambiar de idioma con cambios sin guardar se cancelaba el diálogo de guardar, la aplicación se reiniciaba la siguiente vez que se cerraba.
  - Aviso del ecualizador de 10 bandas en las miniaturas de los efectos de audio.

## 1.1.0 (26/10/2026)

- **Quitar las voces** de un evento de audio para doblar encima (menú del evento → *Quitar las voces (para doblar)…*): separación con IA en el propio equipo, con dos modelos a elegir (*Rápido*: htdemucs; *El mejor*: Mel-Band RoFormer), con la tarjeta gráfica si es compatible; el evento usa la música y los efectos sin voces y las voces solas quedan en los medios del proyecto. Se puede cancelar y deshacer.
- **Interfaz en inglés** (*Ayuda → Idioma*): toda la aplicación, también los diálogos de Windows, los mensajes de error y los nombres de las carpetas y archivos que crea (Reversed, Recordings…). La primera vez se usa el idioma de Windows (español si Windows está en español; si no, inglés). Cambiar el idioma reinicia la aplicación (pregunta antes si hay cambios sin guardar). Los números usan el separador decimal del idioma y los subtítulos automáticos proponen el idioma de la interfaz.

## 1.0.0 (23/10/2026)

- **Descargar de YouTube** (Ctrl+Mayús+D): video en MP4, MKV, WebM o MOV o solo el audio en MP3, M4A, Opus, FLAC o WAV, con los metadatos, la portada, los capítulos y los subtítulos dentro del archivo; listas enteras; se importa al proyecto al terminar.
- **Comprimir videos** (Ctrl+Mayús+C): compresor por lotes al estilo de HandBrake con preajustes y preajustes propios; H.264, H.265, VP9 y AV1 con el procesador o la tarjeta gráfica; calidad constante, tasa de bits o tamaño de archivo objetivo (dos pasadas); resolución máxima, recorte automático de bandas negras, desentrelazado, reducción de ruido, HDR a SDR; pistas de audio, subtítulos y capítulos; muestra de 10 s con el tamaño estimado.
- **Subtítulos automáticos** con Whisper en el propio equipo (idioma automático o elegido, tres modelos, traducir al inglés).
- **Renderizar con la tarjeta gráfica** (NVIDIA, Intel o AMD) en MP4 H.264 y H.265: varias veces más rápido en 4K y H.265; si falla, se renderiza con el procesador.
- **Estabilizar** un video movido (dos niveles) y quitar la estabilización.
- **Invertir** un evento (reproducirlo hacia atrás) y quitar la inversión.
- **Reducir el ruido de fondo** de un evento de audio (dos niveles).
- **Pantalla de inicio** con los proyectos recientes (también en *Archivo → Proyectos recientes…*).
- **Registro de errores** (*Ayuda → Abrir la carpeta de registros*) y pantalla de error que deja recargar la interfaz en vez de quedarse en blanco.
- La reproducción con proyectos largos es mucho más fluida (la línea de tiempo ya no se redibuja entera en cada fotograma).

## 0.7.0 (22/10/2026)

- **Edición:** deslizar el contenido de un evento (Alt + arrastrar), sustituir el medio de un evento (Ctrl + soltar un medio encima), congelar el fotograma del cursor (Ctrl+Mayús+F) y detección de escenas (dividir en cada cambio de plano).
- **Pistas:** curvas en las envolventes, envolvente de opacidad en las pistas de video, modos de fusión de pista, transiciones en los fundidos hacia la pista de debajo y ducking automático (bajar la música cuando hay voz).
- **Vista previa:** proxies para los formatos que no se pueden reproducir directamente (ProRes, MPEG-2…), miniaturas a lo largo de los eventos de video, calidad de la vista previa y guías (zona segura, cuadrícula), y monitores de video (histograma, forma de onda, desfile RGB y vectorescopio).
- **Texto y subtítulos:** animaciones de entrada y salida de los textos, plantillas de títulos y subtítulos (lista, importar/exportar SRT, quemados en el render o como pista aparte).
- **Color:** corrector de tres vías, curvas y LUT `.cube`.
- **Render:** normalización de la sonoridad (LUFS), cola de render y un archivo por región.
- **Proyecto:** recopilar medios (copiar el proyecto y sus archivos a una carpeta); la selección de tiempo y el cursor se guardan en el proyecto.

## 0.6.0 (19/10/2026)

- Curvas de fundido.
- 50 fuentes incluidas y selector de fuentes.
- Vista previa a pantalla completa (en la otra pantalla si hay dos).
- Rampas de velocidad.
- Dividir en la selección de tiempo (S) y recortar hasta el cursor (Alt+[ / Alt+]).
- Exportar el fotograma del cursor.
- Medidores de volumen.
- Fotogramas clave en los efectos de video.
- **Actualizaciones automáticas** desde las releases de GitHub.
- Licencia GPL-3.0; el repositorio pasa a ser público.

## 0.5.0 (18/10/2026)

- Panorámica/recorte del evento con fotogramas clave.
- Pistas de video nuevas arriba y de audio abajo; reordenar pistas arrastrando.
- Edición en cascada (ripple).
- Marcadores y regiones con nombre.
- Envolventes de volumen y panorámica de pista.
- Guardado automático con recuperación y copia `.bak`.
- Más formatos y plantillas de render: H.265, WebM, ProRes, GIF, MP3, WAV, vertical, bandas negras y tasa de bits fija.
- Grabación de voz en off desde el micrófono.
- Arreglado: la ventana no aparecía al arrancar en algunos equipos.

## 0.4.0

- Efectos de video y de audio.
- Volumen de pista hasta +12 dB.
- Pregunta al cerrar con cambios sin guardar.
- Velocidad de los eventos (Ctrl + arrastrar un borde).
- Selección de tiempo con bucle y render de la selección.
- Medios de texto, colocados con el ratón en la vista previa.
- Arranque maximizado y pantalla completa (F11).
- Arreglado: tirones con los paneles de efectos abiertos.

## 0.3.0

- Transiciones con vista previa WebGL.
- Cortes sin pausas en la vista previa y sin fotogramas negros en el render.
- Cortar, copiar y pegar; agrupar; menú contextual.
- Cursor como en VEGAS: ajuste a bordes, fotogramas exactos, Ctrl+←/→, Re Pág/Av Pág.
- Selección por área.

## 0.2.0

- Volumen por evento.
- Fundidos de entrada y salida.

## 0.1.0

Primera versión con instalador: edición multipista, vista previa, render a MP4, interfaz al estilo de los editores clásicos y propiedades del proyecto.
