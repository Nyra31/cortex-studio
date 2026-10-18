// Fuentes para los textos. Las incluidas (public/fonts, de Google Fonts, con sus licencias en LICENCIAS.txt)
// se ven igual en cualquier equipo; además se pueden usar las instaladas en el equipo. La lista y los archivos
// se generan con un script que descarga cada familia (regular, negrita y cursivas si existen, solo latín).
import FONT_LIST from './font-list.json';

export const BUNDLED_FONTS = FONT_LIST; // [{ family, category, faces: [{ style, weight, file, range }] }]
export const isBundledFont = (family) => FONT_LIST.some((f) => f.family === family);

// Se registran y cargan todas al arrancar (unos 2,5 MB del disco): el lienzo de los textos dibuja con la
// fuente de reserva si la suya aún no está cargada, y el render usa ese mismo dibujo.
let ready = null;
export function loadBundledFonts() {
  if (!ready) {
    ready = Promise.all(FONT_LIST.flatMap(({ family, faces }) => faces.map((f) => {
      const face = new FontFace(family, `url(./fonts/${f.file})`, {
        style: f.style,
        weight: String(f.weight),
        ...(f.range ? { unicodeRange: f.range } : {}),
      });
      document.fonts.add(face);
      return face.load().catch(() => null);
    })));
  }
  return ready;
}

// Familias instaladas en el equipo (Local Font Access de Chromium). null si no se pueden leer.
let installed = null;
export function installedFonts() {
  if (!installed) {
    installed = (async () => {
      try {
        const list = await window.queryLocalFonts();
        const families = [...new Set(list.map((f) => f.family))].filter((f) => !isBundledFont(f));
        return families.sort((a, b) => a.localeCompare(b, 'es'));
      } catch {
        installed = null; // se puede volver a intentar
        return null;
      }
    })();
  }
  return installed;
}
