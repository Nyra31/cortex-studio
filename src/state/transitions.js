// Catálogo de transiciones, agrupado como en la ventana de transiciones de VEGAS.
// Cada preajuste es una transición de xfade de FFmpeg (id); la vista previa la imita con un shader (ver preview/compositor.js).

import { tx } from '../i18n/index.js';
export const DEFAULT_TRANSITION = 'fade';
export const TRANSITION_MIME = 'application/x-cortex-transition';

export const TRANSITION_GROUPS = [
  {
    name: tx('Disolución'),
    items: [
      ['fade', tx('Disolución cruzada')],
      ['fadeblack', tx('Fundido a negro')],
      ['fadewhite', tx('Destello (fundido a blanco)')],
      ['dissolve', tx('Disolución aleatoria')],
    ],
  },
  {
    name: tx('Barrido lineal'),
    items: [
      ['wipeleft', tx('De derecha a izquierda')],
      ['wiperight', tx('De izquierda a derecha')],
      ['wipeup', tx('De abajo a arriba')],
      ['wipedown', tx('De arriba a abajo')],
      ['smoothleft', tx('Suave, hacia la izquierda')],
      ['smoothright', tx('Suave, hacia la derecha')],
      ['smoothup', tx('Suave, hacia arriba')],
      ['smoothdown', tx('Suave, hacia abajo')],
    ],
  },
  {
    name: tx('Barrido diagonal'),
    items: [
      ['diagtl', tx('Suave, hacia arriba a la izquierda')],
      ['diagtr', tx('Suave, hacia arriba a la derecha')],
      ['diagbl', tx('Suave, hacia abajo a la izquierda')],
      ['diagbr', tx('Suave, hacia abajo a la derecha')],
      ['wipetl', tx('Caja, hacia arriba a la izquierda')],
      ['wipetr', tx('Caja, hacia arriba a la derecha')],
      ['wipebl', tx('Caja, hacia abajo a la izquierda')],
      ['wipebr', tx('Caja, hacia abajo a la derecha')],
    ],
  },
  {
    name: tx('Barrido de reloj'),
    items: [['radial', tx('Reloj')]],
  },
  {
    name: tx('Iris'),
    items: [
      ['circleopen', tx('Círculo, abrir')],
      ['circleclose', tx('Círculo, cerrar')],
      ['circlecrop', tx('Círculo por negro')],
      ['rectcrop', tx('Rectángulo por negro')],
    ],
  },
  {
    name: tx('Puerta de granero'),
    items: [
      ['vertopen', tx('Vertical, abrir')],
      ['vertclose', tx('Vertical, cerrar')],
      ['horzopen', tx('Horizontal, abrir')],
      ['horzclose', tx('Horizontal, cerrar')],
    ],
  },
  {
    name: tx('Empujar'),
    items: [
      ['slideleft', tx('Hacia la izquierda')],
      ['slideright', tx('Hacia la derecha')],
      ['slideup', tx('Hacia arriba')],
      ['slidedown', tx('Hacia abajo')],
    ],
  },
  {
    name: tx('Deslizar'),
    items: [
      ['coverleft', tx('Entra por la derecha')],
      ['coverright', tx('Entra por la izquierda')],
      ['coverup', tx('Entra por abajo')],
      ['coverdown', tx('Entra por arriba')],
      ['revealleft', tx('Sale por la izquierda')],
      ['revealright', tx('Sale por la derecha')],
      ['revealup', tx('Sale por arriba')],
      ['revealdown', tx('Sale por abajo')],
    ],
  },
  {
    name: tx('Persianas venecianas'),
    items: [
      ['hlslice', tx('Horizontales, hacia la izquierda')],
      ['hrslice', tx('Horizontales, hacia la derecha')],
      ['vuslice', tx('Verticales, hacia arriba')],
      ['vdslice', tx('Verticales, hacia abajo')],
    ],
  },
  {
    name: tx('Comprimir|transición'),
    items: [
      ['squeezeh', tx('Horizontal')],
      ['squeezev', tx('Vertical')],
    ],
  },
  {
    name: tx('Zoom'),
    items: [['zoomin', tx('Acercar')]],
  },
  {
    name: tx('Pixelado'),
    items: [['pixelize', tx('Pixelar')]],
  },
];

// id → { id, name, group, index } (index = código del tipo en el shader de la vista previa)
export const TRANSITIONS = new Map();
for (const group of TRANSITION_GROUPS) {
  for (const [id, name] of group.items) TRANSITIONS.set(id, { id, name, group: group.name, index: TRANSITIONS.size });
}

export const transitionInfo = (id) => TRANSITIONS.get(id) || TRANSITIONS.get(DEFAULT_TRANSITION);
export const transitionLabel = (id) => {
  const t = transitionInfo(id);
  return t.group === t.name || t.id === DEFAULT_TRANSITION ? t.name : `${t.group}: ${t.name}`;
};
