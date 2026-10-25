// Idioma de la interfaz: el que ha decidido el proceso principal al arrancar (ver electron/i18n/index.js, donde se
// explica cómo se escriben los textos). Es fijo durante la sesión: cambiarlo reinicia la aplicación, así que los
// textos de las listas que se crean al cargar los módulos (efectos, formatos…) ya salen en el idioma bueno.
import en from '../../electron/i18n/en.json';

export const LANGUAGES = [
  { id: 'es', name: 'Español' },
  { id: 'en', name: 'English' },
];
export const lang = window.api?.lang === 'en' ? 'en' : 'es';
const dict = lang === 'en' ? en : null;
// Para Intl y toLocaleString (separador decimal, fechas).
export const locale = lang === 'en' ? 'en-US' : 'es-ES';

export function tx(text, vars) {
  let s = (dict && dict[text]) || text.replace(/\|.*$/s, '');
  if (vars) s = s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
  return s;
}

// Número con el separador decimal del idioma (coma en español, punto en inglés).
export const point = (value) => (lang === 'es' ? String(value).replace('.', ',') : String(value));
export const decimal = (value, digits) => point(value.toFixed(digits));
