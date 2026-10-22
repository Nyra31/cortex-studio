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

### Actualizaciones automáticas

Desde la versión 0.6.0, la aplicación instalada busca versiones nuevas en las [releases de GitHub](https://github.com/Nyra31/cortex-studio/releases) unos segundos después de arrancar. Si hay una, la descarga en segundo plano (el progreso se ve en la barra de estado) y avisa: *Reiniciar y actualizar* la instala al momento y vuelve a abrir la aplicación (si hay cambios sin guardar, antes pregunta si guardarlos); *Al cerrar* la instala al salir. También se puede buscar a mano en *Ayuda → Buscar actualizaciones…*. Desde la 0.5.0 o anteriores hay que instalar la 0.6.0 a mano una vez.

Para publicar una versión, la release debe llevar el instalador, su `.blockmap` y `latest.yml` (los tres los genera `npm run dist` en `release/`).

## Funciones

- **Interfaz al estilo de los editores clásicos:** barra de menús, barra de iconos, ventanas acopladas, contador de tiempo grande, pistas de colores y transporte bajo la línea de tiempo.
- **Proyecto nuevo:** al empezar se elige la orientación (horizontal o vertical), la resolución (de SD a 4K, o personalizada) y la velocidad de fotogramas (23,976 a 60 fps). Se puede cambiar en cualquier momento en *Archivo → Propiedades del proyecto* (Alt+Intro).
- **Medios del proyecto:** importa videos, audios e imágenes con *Importar medios* o arrastrándolos desde el Explorador. Muestra una miniatura, la duración y la resolución de cada archivo.
- **Línea de tiempo multipista:** pistas de video arriba y de audio abajo. Un video con sonido se coloca como dos eventos agrupados (video y audio) que se mueven y recortan juntos.
- **Pistas:** silencio, solo, volumen y panorámica (pistas de audio; volumen de -∞ a +12 dB) y cambio de nombre con doble clic. Como en VEGAS, una pista de video nueva aparece arriba del todo y una de audio abajo del todo; se añaden desde el menú *Insertar*, con Ctrl+Mayús+Q / Ctrl+Q o con los botones de la zona vacía de abajo, y se cambian de orden arrastrando su cabecera.
- **Edición:** arrastrar para mover (también a otra pista), recortar por los bordes, dividir en el cursor y eliminar. Incluye ajuste magnético a bordes y al cursor, y deshacer/rehacer.
- **Edición en cascada** (ripple, como «Auto Ripple» de VEGAS; Ctrl+L o el botón de la barra de herramientas): al borrar o cortar eventos se cierra el hueco, al alargar o acortar el final de un evento o al moverlo, lo que va detrás se desplaza con él, y al pegar se inserta apartando lo de detrás. En *Edición* se elige si afecta solo a las pistas que se editan o a todas. Con una selección de tiempo, *Edición → Eliminar el tramo seleccionado y cerrar el hueco* (Ctrl+Supr) quita ese tramo de todas las pistas y adelanta lo de detrás, ideal para quitar trozos de una grabación larga.
- **Velocidad de los eventos** como en VEGAS: con Ctrl pulsado, arrastrar un borde del evento lo estira o lo encoge sin cambiar el trozo de video que usa, así que se reproduce más lento o más rápido (del 25 % al 400 %). El audio cambia de velocidad sin cambiar el tono. La velocidad aparece en el título del evento junto a una línea en zigzag; *Velocidad normal (100 %)* en el menú contextual la quita.
- **Panorámica/recorte del evento** como en VEGAS (botón con el icono de recorte de cada evento de video o su menú contextual): posición, zoom, rotación y recorte de los bordes, con **fotogramas clave** para animarlo (efecto Ken Burns, zooms, imagen sobre imagen que se mueve, textos que entran deslizándose…). En la vista previa, con la ventana abierta, la imagen se arrastra para moverla, las esquinas cambian el zoom y el círculo de arriba la gira (Mayús: de 15 en 15°). Con varios fotogramas clave, cambiar un valor donde no hay ninguno crea uno nuevo; cada tramo puede ser suave (acelera y frena) o uniforme. Los fotogramas clave se ven como rombos en el evento y siguen a la imagen al recortarlo, dividirlo o cambiar su velocidad. *Llenar el cuadro* quita las bandas negras (por ejemplo, un video vertical en un proyecto horizontal). Lo que queda fuera de la imagen es transparente: se ve la pista de debajo.
- **Selección de tiempo** como en VEGAS: arrastrando en la barra de arriba de la regla se marca un tramo (línea azul con su duración, triángulos amarillos en los extremos y fondo azul en las pistas). La línea se arrastra para moverla y los triángulos, para cambiar el principio y el final; se ajusta a los bordes de los eventos y a fotogramas exactos (Mayús: sin ajuste). Doble clic en un evento selecciona su tramo; un clic en la barra o Esc la quitan. Con una selección, la reproducción empieza en ella y se para al final; con la **reproducción en bucle** (Q o el botón del transporte) vuelve a empezar.
- **Envolventes de pista** como en VEGAS: clic derecho en la cabecera de la pista → *Envolvente de volumen* (línea azul) o *de panorámica* (línea roja) en las de audio, y *Envolvente de opacidad* (línea azul, de 0 % abajo a 100 % arriba) en las de video, para capas que aparecen y desaparecen. Doble clic en la línea añade un punto con el valor que tiene ahí; los puntos se arrastran (el valor y el momento aparecen en la barra de estado; Mayús: sin ajuste) y con el clic derecho se eliminan, se ponen a 0 dB / en el centro / al 100 % o se elige la **curva** del tramo que sale de ellos: lineal, rápido, lento, suave, brusco o mantener (escalón). Sirven, por ejemplo, para bajar la música mientras alguien habla. Se ven y se oyen igual en la vista previa que en el render y la cascada en todas las pistas desplaza sus puntos.
- **Modos de fusión** de las pistas de video (el selector *Fusión* de la cabecera, o su clic derecho): normal, multiplicar, trama, superponer, luz fuerte, oscurecer, aclarar, sumar, restar y diferencia, para mezclar una capa con las de debajo (por ejemplo, un texto o una textura en *multiplicar* o *trama*). Se combinan con la opacidad, los fundidos y las transiciones.
- **Marcadores y regiones con nombre** como en VEGAS: **M** pone un marcador (naranja) en el cursor y **R** convierte la selección de tiempo en una región (verde), en la franja de la regla de debajo de la selección. Se arrastran, se les pone nombre con doble clic y se borran o se renombran con el clic derecho; un clic lleva el cursor a ellos y las teclas **1–9** van al marcador con ese número. El cursor, los eventos y Ctrl+←/→ se ajustan a ellos, la cascada en todas las pistas los desplaza y se guardan en el proyecto. Las regiones se pueden renderizar por separado.
- **Renderizar la selección o todo el proyecto:** en *Renderizar como…* se elige qué renderizar (todo, la selección de tiempo o una región con nombre); si hay una selección de tiempo, se ofrece por defecto. El resultado es exactamente ese trozo del render completo. La selección de tiempo y la posición del cursor se guardan con el proyecto y se recuperan al abrirlo.
- **Medios de texto** como «Títulos y texto» de VEGAS (*Insertar → Medio de texto*, el botón **T** de *Medios del proyecto* o el menú contextual de una pista): se crea un texto de 5 s en el cursor, encima del video, y se abre su ventana con el texto (varias líneas), la fuente (50 fuentes incluidas de Google Fonts, por categorías: sin serifa, titulares, con serifa, manuscritas y retro; además de todas las instaladas en el equipo, con buscador y cada nombre escrito con su fuente), negrita, cursiva, color, alineación, tamaño, interlineado, espaciado, contorno, sombra y fondo. Los cambios se ven al momento. En la vista previa (en pausa) el texto se coloca con el ratón: un clic lo selecciona, se arrastra para moverlo (se pega al centro del cuadro; Mayús: sin ajuste), las esquinas de su recuadro cambian el tamaño y el doble clic abre su ventana. El botón **T** del evento también la abre. Los textos tienen fondo transparente, admiten fundidos, transiciones y efectos de video, y se guardan dentro del proyecto. Al copiar y pegar un texto, la copia es independiente.
- **Ventana:** la aplicación se abre maximizada; *Ver → Pantalla completa* (F11) la pone a pantalla completa, sin la barra de tareas.
- **Rampas de velocidad** (como la envolvente de velocidad de VEGAS): clic derecho en un evento → *Rampa de velocidad (envolvente)*. Aparece una línea verde al 100 % con un punto en cada extremo; los puntos se arrastran (de 10 % a 400 %, se pegan al 100 %; Mayús: sin ajuste), doble clic en la línea añade uno y el clic derecho en un punto lo elimina o lo pone a 100 %. Entre puntos la velocidad cambia de forma gradual. Se aplica también al sonido del video (con el mismo tono) y se combina con la velocidad fija de Ctrl + arrastrar un borde. *Velocidad normal (100 %)* la quita.
- **Vista previa a pantalla completa** (como la vista previa externa de VEGAS): Alt+Mayús+4, doble clic en la imagen o el botón de la barra de la vista previa. Con dos pantallas, la imagen se ve a pantalla completa en la otra y en esta se sigue editando; con una, la vista previa ocupa toda la pantalla. Los atajos (reproducir, fotograma a fotograma…) siguen funcionando. Se sale con la misma tecla, con Esc o con doble clic.
- **Aviso al cerrar:** si hay cambios sin guardar, al cerrar la ventana se pregunta si guardarlos (Guardar / No guardar / Cancelar).
- **Cursor como en VEGAS:** al hacer clic o arrastrar en la regla, en una pista o en un evento, el cursor se coloca ahí; con el ajuste activado (F8) se pega al principio o al final de los eventos cercanos y, si no, cae siempre en un fotograma exacto. Mayús mientras se arrastra desactiva el ajuste (también al mover eventos). El triángulo de arriba se arrastra sin saltar al puntero, para ajustes finos. Con el teclado: fotograma a fotograma (← →), de corte en corte (Ctrl+← →) y por marcas de la regla (Re Pág / Av Pág). Si el cursor sale de la vista, la línea de tiempo se desplaza para enseñarlo.
- **Selección por área:** arrastrando desde una zona vacía de las pistas se dibuja un rectángulo que selecciona los eventos que toca (con su grupo, para que el audio no se separe de su video). Con Ctrl se añaden a la selección. Un clic simple en una zona vacía quita la selección y coloca el cursor.
- **Cortar, copiar y pegar** eventos (Ctrl+X, Ctrl+C, Ctrl+V). Se pega en el cursor, en las mismas pistas, y el cursor salta al final de lo pegado para poder pegar varias veces seguidas. **Agrupar** (G) y **quitar del grupo** (U) para que varios eventos se muevan juntos o separar el audio de su video.
- **Dividir y recortar como en VEGAS:** con una selección de tiempo, S divide en sus dos extremos (para aislar un tramo); Alt+[ y Alt+] recortan el principio o el final del evento seleccionado (y su grupo) hasta el cursor.
- **Miniaturas a lo largo de los eventos de video**, como en VEGAS: cada trozo del evento muestra el fotograma del medio que hay ahí (siguen al recorte, la velocidad y las rampas). Se calculan en segundo plano al importar (la primera vez tarda un poco en los videos largos) y se guardan para las siguientes.
- **Deslizar el contenido** (slip): Alt + arrastrar un evento cambia el trozo del medio que se ve sin moverlo ni cambiar su duración (a la derecha se ve lo de antes).
- **Sustituir el medio de un evento:** con Ctrl, suelta un medio de *Medios del proyecto* sobre un evento; cambia el archivo y se conservan la posición, la duración, los efectos y los fundidos (también en su grupo: el sonido cambia si el medio nuevo lo tiene).
- **Congelar fotograma** (*Edición → Congelar fotograma en el cursor*, Ctrl+Mayús+F o el clic derecho en el evento): el fotograma del cursor pasa a ser una imagen fija de 2 s insertada ahí (lo que sigue en esas pistas se aparta), con los efectos y la panorámica de ese instante. La imagen se guarda como PNG en la carpeta `Fotogramas` junto al proyecto.
- **Fotogramas clave en los efectos de video** (como en VEGAS): en la ventana de efectos del evento, cada efecto tiene una tira de fotogramas clave como la de la panorámica. Lleva el cursor a un momento del evento y pulsa *+ Fotograma clave*: desde ese momento los controles muestran los valores en el cursor y, al cambiarlos donde no hay fotograma clave, se crea uno. Entre fotogramas clave los valores cambian de forma gradual (por ejemplo, un desenfoque que entra poco a poco o un blanco y negro que se va convirtiendo en color). Los rombos se arrastran para cambiarlos de momento y aparecen también sobre el evento en la línea de tiempo. Se ve igual en la vista previa que en el render.
- **Medidores de volumen:** cada pista de audio tiene un medidor estéreo en su cabecera (después del volumen y la panorámica de la pista) y el pie de la línea de tiempo muestra el del **máster**, con el pico retenido en dB y un testigo rojo de saturación (se apaga con un clic). Escala de −60 a 0 dBFS: verde, amarillo desde −9 dB y rojo desde −1 dB; lo que pasa de 0 dB satura en el render.
- **Exportar el fotograma** del cursor como imagen PNG al tamaño del proyecto (*Archivo → Exportar el fotograma como imagen…*, Ctrl+Mayús+E o el botón de la cámara de la vista previa). Se renderiza igual que el video, con efectos, textos y transiciones.
- **Menú contextual** con clic derecho: en un evento (cortar, copiar, pegar, eliminar, dividir, agrupar, velocidad normal, quitar fundidos, editar texto, panorámica/recorte, seleccionar el tramo del evento, volumen a 0 dB, volver a disolución cruzada, abrir la ubicación del archivo) y en una zona vacía de una pista (pegar ahí, seleccionar todo, insertar pistas).
- **Fundidos de entrada y salida:** se arrastran desde los cuadraditos de las esquinas superiores del evento. En audio bajan el volumen; en video hacen aparecer o desaparecer el evento sobre lo que haya debajo (otra pista o negro). Al dividir, cada parte conserva su fundido. Con clic derecho sobre un fundido se elige su **curva**, como en VEGAS: lineal, rápido (el cambio ocurre sobre todo al principio), lento (al final), suave (lento-rápido-lento) o brusco (rápido-lento-rápido). La curva se dibuja en el evento y se aplica también al resto del grupo; en un fundido cruzado de audio, a los dos eventos.
- **Volumen por evento:** en los eventos de audio, arrastrar en vertical la línea superior (de -∞ a 0 dB). El valor aparece en el título del evento y la forma de onda se escala. Se suma al volumen de la pista.
- **Transiciones** al estilo de VEGAS: al solapar el final de un evento con el principio de otro en la misma pista se crea una disolución cruzada (en audio, un fundido cruzado). La duración es la del solapamiento. En la pestaña *Transiciones* (Alt+7) hay 49 preajustes en 12 categorías (disolución, barridos lineal, diagonal y de reloj, iris, puerta de granero, empujar, deslizar, persianas venecianas, comprimir, zoom y pixelado), con miniaturas animadas al pasar el ratón. Se aplican arrastrándolas sobre el solapamiento; doble clic en él vuelve a la disolución cruzada. Soltada sobre el principio o el final de un evento de video sin solapamiento (o sobre su fundido), la transición se aplica a ese **fundido hacia la pista de debajo**: el evento entra o sale con un barrido, un iris, etc., descubriendo lo que hay debajo (si no tenía fundido, se crea uno de 1 s; su duración se cambia arrastrando la esquina). Se quita con el clic derecho sobre el fundido.
- **Efectos de video por evento** al estilo de VEGAS: en la pestaña *Efectos de video* (Alt+8) hay 13 efectos en 4 categorías (color: brillo y contraste, corrección de color, tono/saturación/luminosidad, blanco y negro, sepia, invertir; desenfoque y nitidez: desenfoque gaussiano, enfocar, brillo difuso; estilizar: pixelar, viñeta, espejo; composición: croma). Se añaden arrastrándolos sobre un evento de video. El botón **fx** de cada evento (verde si tiene efectos) abre su ventana de efectos: la cadena en el orden en que se aplican (se pueden activar, desactivar, reordenar y quitar) y los controles del efecto elegido, con la vista previa al momento. El croma deja transparente el color elegido y se ve la pista de debajo.
- **Efectos de audio por evento**, igual que los de video: en la pestaña *Efectos de audio* hay 13 efectos (ecualización: ecualizador gráfico de 10 bandas, filtros paso bajo y paso alto; dinámica: compresor, puerta de ruido, normalizar, amplificar; retardo y modulación: eco, chorus, flanger, cambio de tono, distorsión; ambiente: reverberación). Se arrastran sobre un evento de audio o se añaden desde su botón **fx**, y se oyen al momento en la vista previa.
- **Proxies para la vista previa:** los archivos que el reproductor de la vista previa no puede abrir (ProRes, DNxHD, MPEG-2, AVI, MPEG-TS, WMV, sonido AC-3 o PCM dentro de un video, algunos HEVC…) se convierten solos, en segundo plano, en una copia ligera (H.264 de 720 líneas como mucho) que usa solo la vista previa; el render usa siempre el original. En *Medios del proyecto* se ve el progreso y la marca *Proxy*; con el clic derecho en un medio se puede crear un proxy a mano (por ejemplo, para videos 4K que van lentos) o quitarlo. Se guardan aparte y se reutilizan al volver a abrir el proyecto.
- **Calidad de la vista previa** (selector de su barra, como en VEGAS): *Borrador* (¼ de resolución) y *Vista previa* (½) van más ligeras en equipos modestos o con efectos pesados; *Buena* usa la resolución de la pantalla y *Óptima*, la del proyecto. No afecta al render. Al lado, **guías**: zona segura (90 % para la acción y 80 % para los títulos, con el centro marcado) y tercios. Las dos opciones se recuerdan.
- **Vista previa** dibujada con WebGL, sincronizada con la línea de tiempo y con la proporción del proyecto. Muestra las transiciones, los fundidos y las pistas superpuestas igual que el renderizado.
- **Forma de onda** en los eventos de audio y **miniaturas** en los de video.
- **Proyectos** guardados como archivos `.cortex` (JSON con las rutas de los medios y los ajustes).
- **Guardado automático y copias de seguridad:** cada minuto, si hay cambios sin guardar, se guarda una copia de recuperación (en la carpeta de datos de la aplicación, sin tocar el archivo del proyecto). Si la aplicación se cierra de golpe, al volver a abrirla ofrece recuperar esa copia. Al guardar encima de un proyecto, la versión anterior queda como `Proyecto.cortex.bak`, como en VEGAS.
- **Grabar voz en off** desde el micrófono, como en VEGAS: el botón de grabar (círculo rojo) de cada pista de audio la arma; luego el botón de grabar del transporte (o Ctrl+R) reproduce el proyecto desde el cursor y graba a la vez. Se termina con Espacio, Intro, Ctrl+R o el mismo botón; con una selección de tiempo, graba solo ese tramo y se para sola al final. Sin pista armada se crea una pista «Voz en off». Mientras se graba se ve un medidor de nivel y el tramo en rojo en la pista; al terminar, la grabación queda como un evento más (y en *Medios del proyecto*). Si la pista armada ya tiene algo en ese tramo, se graba en una pista nueva debajo. Los archivos son WAV (mono, 16 bits) en la carpeta `Grabaciones` junto al proyecto (o en `Documentos\Cortex Studio\Grabaciones` si aún no se ha guardado). En *Herramientas → Opciones de grabación…* (o clic derecho en el botón de grabar) se elige el micrófono, se prueba su nivel y se puede activar la cancelación de eco y la reducción de ruido.
- **Renderizado** con plantillas como en VEGAS (proyecto, YouTube 1080p y 4K, vertical 1080 × 1920 para TikTok/Reels/Shorts, cuadrado para Instagram, archivo pequeño H.265, web 720p, ProRes, GIF y solo audio) o con ajustes propios: formato (MP4 H.264 o H.265, WebM VP9, MOV ProRes 422 HQ, GIF animado, MP3 o WAV), tamaño (del proyecto escalado, tamaños habituales o personalizado; si la proporción es otra, el proyecto va con bandas negras), velocidad de fotogramas, calidad constante o tasa de bits fija y calidad del audio. Muestra el tamaño aproximado del archivo y recuerda los últimos ajustes.

## Atajos de teclado

| Tecla | Acción |
|---|---|
| Espacio | Reproducir / detener (vuelve a donde empezó) |
| Intro | Reproducir / pausar |
| S | Dividir en el cursor (los eventos seleccionados o, si no hay selección, todos); con selección de tiempo, en sus dos extremos |
| Alt+[ / Alt+] | Recortar el principio / el final del evento seleccionado hasta el cursor |
| Ctrl+Mayús+E | Exportar el fotograma del cursor como imagen PNG |
| Ctrl+Mayús+F | Congelar fotograma en el cursor |
| Supr | Eliminar los eventos seleccionados (en cascada, cierra el hueco) |
| Ctrl+L | Activar o desactivar la edición en cascada |
| Ctrl+R | Grabar voz en off en la pista armada / terminar la grabación |
| Alt+Mayús+4 | Vista previa a pantalla completa (en la otra pantalla si hay dos) |
| Ctrl+Supr | Eliminar el tramo de la selección de tiempo en todas las pistas y cerrar el hueco |
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
| Ctrl + arrastrar un borde del evento | Cambiar la velocidad del evento (25 % a 400 %) |
| Alt + arrastrar un evento | Deslizar su contenido (slip) |
| Ctrl + soltar un medio sobre un evento | Sustituir el medio del evento |
| Arrastrar en la barra de arriba de la regla | Selección de tiempo (un clic la quita) |
| Doble clic en un evento | Selección de tiempo del evento |
| Esc | Quitar la selección de tiempo |
| Q | Reproducción en bucle de la selección de tiempo |
| M / R | Insertar un marcador en el cursor / una región con la selección de tiempo |
| Clic derecho en la cabecera de una pista | Envolventes (volumen y panorámica; opacidad en video), modo de fusión, eliminar la pista |
| Doble clic en una envolvente | Añadir un punto (arrastrarlo: moverlo; clic derecho: eliminarlo o elegir la curva del tramo) |
| 1 … 9 | Ir al marcador con ese número |
| Doble clic en un marcador o una región | Cambiarle el nombre (la región, además, se selecciona) |
| Arrastrar un texto en la vista previa | Moverlo (esquinas: tamaño; doble clic: editarlo) |
| Arrastrar en la vista previa con la ventana de panorámica abierta | Mover la imagen (esquinas: zoom; círculo: girar) |
| Arrastrar en una zona vacía (Ctrl: añadir) | Seleccionar eventos con un rectángulo |
| Doble clic en un tirador de fundido | Quitar el fundido |
| Doble clic en la línea de volumen del evento | Volver a 0 dB |
| F8 | Activar o desactivar el ajuste |
| Ctrl+Q / Ctrl+Mayús+Q | Insertar pista de audio (abajo del todo) / de video (arriba del todo) |
| Arrastrar la cabecera de una pista | Cambiarla de orden |
| Ctrl+N / Ctrl+O / Ctrl+S | Nuevo / abrir / guardar |
| Ctrl+I | Importar medios |
| Ctrl+M | Renderizar |
| Alt+Intro | Propiedades del proyecto |
| F11 | Pantalla completa |
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
src/state/envelopes.js    Envolventes de pista (volumen, panorámica y opacidad, con curvas; vista previa y expresiones de FFmpeg)
src/state/pan.js          Panorámica/recorte con fotogramas clave (interpolación y expresiones de FFmpeg)
src/state/text.js         Medios de texto (parámetros y dibujo con canvas, el mismo en vista previa y render)
src/state/fonts.js        Fuentes incluidas (public/fonts, de Google Fonts) e instaladas en el equipo
src/state/effects.js      Catálogo de efectos de video (parámetros y filtro de FFmpeg de cada uno)
src/preview/compositor.js Compositor WebGL de la vista previa (capas, fundidos, transiciones y efectos)
src/preview/effects-gl.js Efectos en la vista previa (shaders con las mismas fórmulas que FFmpeg)
src/state/audio-effects.js Catálogo de efectos de audio (parámetros y filtro de FFmpeg)
src/preview/audio-engine.js Audio de la vista previa con Web Audio (efectos y volumen por reproductor)
src/preview/audio-fx.js   Efectos de audio en Web Audio (y procesadores propios en un AudioWorklet)
src/preview/recorder.js   Grabación de voz en off desde el micrófono (AudioWorklet → WAV)
src/components/         Menús, línea de tiempo, vista previa, medios, transiciones, transporte y diálogos
```

## Limitaciones conocidas

- Los proxies ocupan disco (en la carpeta de datos de la aplicación, `proxies`); *Herramientas → Borrar los proxies de la vista previa…* los borra y se vuelven a crear cuando hacen falta. Mientras se crea uno, ese medio no se ve en la vista previa.
- No se pueden animar *Enfocar*, *Viñeta*, el umbral del *Brillo difuso* ni los efectos de audio (sus valores valen para todo el evento). El recorte de la panorámica tampoco se anima.
- Con panorámica, las bandas negras de una imagen que no llena el cuadro pasan a ser transparentes (sin ella son negras).
- Las colas del eco y la reverberación se cortan al final del evento.
- Si dos eventos de video del mismo archivo coinciden en el mismo instante, la vista previa abre el archivo dos veces; con archivos muy pesados puede ir más lenta.
- El volumen de evento va de -∞ a 0 dB, como en VEGAS; para subirlo más, el volumen de pista (hasta +12 dB) o los efectos Amplificar y Normalizar.
- Las envolventes son de la pista: no se mueven con los eventos salvo con la cascada en todas las pistas.
- Las mezclas parciales (opacidad, fundidos) de colores muy saturados, fuera de lo que se puede mostrar en RGB, pueden verse algo distintas en la vista previa y en el render (el render mezcla en YUV).
- Si un texto usa una fuente instalada en el equipo y el proyecto se abre en otro que no la tiene, se ve con otra fuente; las 50 incluidas se ven igual en todos. Las fuentes que no tienen negrita o cursiva propias las imitan.
- Los textos no tienen animaciones propias (para que aparezcan o desaparezcan, fundidos o transiciones). Una transición entre dos textos se dibuja opaca, sobre negro (como todas las transiciones).
- En cascada, recortar el principio de un evento no desplaza lo de detrás (sí el final, mover, borrar y pegar).
- Al grabar voz en off conviene usar auriculares: con altavoces, el micrófono recoge también el sonido del proyecto (la cancelación de eco de las opciones lo reduce, pero cambia el timbre). Se graba en mono y desde un solo micrófono a la vez. El retardo del micrófono y los altavoces se compensa con lo que informa el sistema; si se nota desplazada, se puede mover el evento.
- El audio siempre conserva el tono al cambiar la velocidad. Con rampas, el render puede diferir de la vista previa en un fotograma como mucho (y el sonido en unos 20 ms).

## Licencia

Cortex Studio es software libre con licencia [GPL-3.0](LICENSE). Incluye FFmpeg (GPL) y 50 fuentes de Google Fonts con sus propias licencias libres (`public/fonts/LICENCIAS.txt`).

## Solución de problemas

`npm start` y `npm run dev` lanzan Electron con `scripts/electron.js`, que quita la variable `ELECTRON_RUN_AS_NODE` (la definen, por ejemplo, las terminales de VS Code; con ella Electron arranca como Node y la aplicación no se abre). Si lanzas `electron .` a mano y no se abre, quita esa variable.
