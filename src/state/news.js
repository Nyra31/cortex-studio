// Novedades de cada versión para la ventana que aparece después de actualizar (y en Ayuda → Novedades…): un
// resumen para el usuario de lo más importante del CHANGELOG, traducido como el resto de la interfaz. Al publicar
// una versión, añadir su entrada arriba del todo (la fecha, como en el CHANGELOG). La versión de antes de actualizar
// la da el proceso principal (`api.previousVersion`, ver noteVersion en main.js).
import { tx } from '../i18n/index.js';

export const NEWS = [
  {
    version: '1.2.0',
    date: [2026, 10, 29],
    items: [
      [tx('Editar con el texto'), tx('Transcribe la voz (Herramientas → Transcribir para editar con el texto…) y edita el video en la pestaña «Texto»: borra una frase y se corta de todas las pistas.')],
      [tx('Quitar silencios y muletillas'), tx('Quita de una vez las pausas largas (Herramientas → Quitar silencios…) y los «eh», «em», «mmm» que haya escrito Whisper.')],
    ],
  },
  {
    version: '1.1.2',
    date: [2026, 10, 28],
    items: [
      [tx('Novedades al actualizar'), tx('Después de cada actualización aparece esta ventana con lo nuevo de la versión. Se puede volver a ver en Ayuda → Novedades.')],
      [tx('Más idiomas'), tx('La interfaz, también en francés, alemán, italiano y portugués de Brasil (Ayuda → Idioma). La primera vez se usa el idioma del sistema.')],
    ],
  },
  {
    version: '1.1.1',
    date: [2026, 10, 28],
    items: [
      [tx('macOS y Linux'), tx('Cortex Studio también para Mac (Apple Silicon e Intel) y Linux (AppImage). En Mac, los atajos van con Cmd.')],
      [tx('Fallos corregidos'), tx('Al invertir o estabilizar eventos agrupados, al guardar (un cierre a medias ya no puede dejar el proyecto roto) y varios más.')],
    ],
  },
  {
    version: '1.1.0',
    date: [2026, 10, 26],
    items: [
      [tx('Quitar las voces'), tx('Menú de un evento de audio → Quitar las voces (para doblar): la IA separa las voces de la música y los efectos en tu equipo, con dos modelos a elegir.')],
      [tx('Interfaz en inglés'), tx('Ayuda → Idioma. Cambiar el idioma reinicia la aplicación.')],
    ],
  },
];

const parts = (v) => v.split('.').map(Number);
const newer = (a, b) => {
  const pa = parts(a);
  const pb = parts(b);
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return (pa[i] || 0) > (pb[i] || 0);
  return false;
};

// Las versiones nuevas desde `from` hasta `to` (incluida). `from` = '0.0.0' si no se sabe (actualización desde una
// versión anterior a la 1.1.2): entonces solo la última, para no repetir lo que ya se vio.
export function newsSince(from, to) {
  const list = NEWS.filter((n) => !newer(n.version, to) && newer(n.version, from));
  return from === '0.0.0' ? list.slice(0, 1) : list;
}
