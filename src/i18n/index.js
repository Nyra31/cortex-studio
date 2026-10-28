// Idioma de la interfaz: el que ha decidido el proceso principal al arrancar (ver electron/i18n/index.js, donde se
// explica cómo se escriben los textos). Es fijo durante la sesión: cambiarlo reinicia la aplicación, así que los
// textos de las listas que se crean al cargar los módulos (efectos, formatos…) ya salen en el idioma bueno.
import en from '../../electron/i18n/en.json';
import fr from '../../electron/i18n/fr.json';
import de from '../../electron/i18n/de.json';
import it from '../../electron/i18n/it.json';
import pt from '../../electron/i18n/pt.json';

// Nombre de cada idioma en ese idioma (así sale en Ayuda → Idioma) y su configuración regional para Intl.
export const LANGUAGES = [
  { id: 'es', name: 'Español', locale: 'es-ES' },
  { id: 'en', name: 'English', locale: 'en-US', dict: en },
  { id: 'fr', name: 'Français', locale: 'fr-FR', dict: fr },
  { id: 'de', name: 'Deutsch', locale: 'de-DE', dict: de },
  { id: 'it', name: 'Italiano', locale: 'it-IT', dict: it },
  { id: 'pt', name: 'Português (Brasil)', locale: 'pt-BR', dict: pt },
];
const current = LANGUAGES.find((l) => l.id === window.api?.lang) || LANGUAGES[0];
export const lang = current.id;
const dict = current.dict || null;
// Para Intl y toLocaleString (separador decimal, fechas).
export const locale = current.locale;

// En macOS los atajos van con Cmd (la interfaz acepta las dos teclas, ver `mod`): se cambia en todos los textos.
export const isMac = window.api?.platform === 'darwin';
export const mod = (e) => e.ctrlKey || e.metaKey;

export function tx(text, vars) {
  let s = (dict && dict[text]) || text.replace(/\|.*$/s, '');
  if (vars) s = s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
  return isMac ? s.replace(/\b(Ctrl|Strg)\b/g, 'Cmd') : s; // Strg: la tecla Ctrl en alemán
}

// Número con el separador decimal del idioma (coma en español, punto en inglés).
const DECIMAL = (1.5).toLocaleString(locale).charAt(1);
export const point = (value) => String(value).replace('.', DECIMAL);
export const decimal = (value, digits) => point(value.toFixed(digits));
