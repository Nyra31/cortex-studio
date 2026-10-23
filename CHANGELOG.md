# Cambios

Los instaladores de cada versión están en las [releases de GitHub](https://github.com/Nyra31/cortex-studio/releases). Los proyectos guardados con versiones anteriores se siguen abriendo.

## Sin publicar

- **Subtítulos automáticos** con Whisper en el propio equipo (idioma automático o elegido, tres modelos, traducir al inglés).
- **Reducir el ruido de fondo** de un evento de audio (dos niveles).
- **Estabilizar** un video movido (dos niveles) y quitar la estabilización.
- **Invertir** un evento (reproducirlo hacia atrás) y quitar la inversión.
- **Pantalla de inicio** con los proyectos recientes (también en *Archivo → Proyectos recientes…*).
- **Renderizar con la tarjeta gráfica** (NVIDIA, Intel o AMD) en MP4 H.264 y H.265: varias veces más rápido en 4K y H.265; si falla, se renderiza con el procesador.
- **Comprimir videos** (Ctrl+Mayús+C): compresor por lotes al estilo de HandBrake con preajustes y preajustes propios; H.264, H.265, VP9 y AV1 con el procesador o la tarjeta gráfica; calidad constante, tasa de bits o tamaño de archivo objetivo (dos pasadas); resolución máxima, recorte automático de bandas negras, desentrelazado, reducción de ruido, HDR a SDR; pistas de audio, subtítulos y capítulos; muestra de 10 s con el tamaño estimado.
- **Descargar de YouTube** (Ctrl+Mayús+D): video en MP4, MKV, WebM o MOV o solo el audio en MP3, M4A, Opus, FLAC o WAV, con los metadatos, la portada, los capítulos y los subtítulos dentro del archivo; listas enteras; se importa al proyecto al terminar.

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
