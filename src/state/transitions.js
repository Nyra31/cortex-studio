// Catálogo de transiciones, agrupado como en la ventana de transiciones de VEGAS.
// Cada preajuste es una transición de xfade de FFmpeg (id); la vista previa la imita con un shader (ver preview/compositor.js).

export const DEFAULT_TRANSITION = 'fade';
export const TRANSITION_MIME = 'application/x-cortex-transition';

export const TRANSITION_GROUPS = [
  {
    name: 'Disolución',
    items: [
      ['fade', 'Disolución cruzada'],
      ['fadeblack', 'Fundido a negro'],
      ['fadewhite', 'Destello (fundido a blanco)'],
      ['dissolve', 'Disolución aleatoria'],
    ],
  },
  {
    name: 'Barrido lineal',
    items: [
      ['wipeleft', 'De derecha a izquierda'],
      ['wiperight', 'De izquierda a derecha'],
      ['wipeup', 'De abajo a arriba'],
      ['wipedown', 'De arriba a abajo'],
      ['smoothleft', 'Suave, hacia la izquierda'],
      ['smoothright', 'Suave, hacia la derecha'],
      ['smoothup', 'Suave, hacia arriba'],
      ['smoothdown', 'Suave, hacia abajo'],
    ],
  },
  {
    name: 'Barrido diagonal',
    items: [
      ['diagtl', 'Suave, hacia arriba a la izquierda'],
      ['diagtr', 'Suave, hacia arriba a la derecha'],
      ['diagbl', 'Suave, hacia abajo a la izquierda'],
      ['diagbr', 'Suave, hacia abajo a la derecha'],
      ['wipetl', 'Caja, hacia arriba a la izquierda'],
      ['wipetr', 'Caja, hacia arriba a la derecha'],
      ['wipebl', 'Caja, hacia abajo a la izquierda'],
      ['wipebr', 'Caja, hacia abajo a la derecha'],
    ],
  },
  {
    name: 'Barrido de reloj',
    items: [['radial', 'Reloj']],
  },
  {
    name: 'Iris',
    items: [
      ['circleopen', 'Círculo, abrir'],
      ['circleclose', 'Círculo, cerrar'],
      ['circlecrop', 'Círculo por negro'],
      ['rectcrop', 'Rectángulo por negro'],
    ],
  },
  {
    name: 'Puerta de granero',
    items: [
      ['vertopen', 'Vertical, abrir'],
      ['vertclose', 'Vertical, cerrar'],
      ['horzopen', 'Horizontal, abrir'],
      ['horzclose', 'Horizontal, cerrar'],
    ],
  },
  {
    name: 'Empujar',
    items: [
      ['slideleft', 'Hacia la izquierda'],
      ['slideright', 'Hacia la derecha'],
      ['slideup', 'Hacia arriba'],
      ['slidedown', 'Hacia abajo'],
    ],
  },
  {
    name: 'Deslizar',
    items: [
      ['coverleft', 'Entra por la derecha'],
      ['coverright', 'Entra por la izquierda'],
      ['coverup', 'Entra por abajo'],
      ['coverdown', 'Entra por arriba'],
      ['revealleft', 'Sale por la izquierda'],
      ['revealright', 'Sale por la derecha'],
      ['revealup', 'Sale por arriba'],
      ['revealdown', 'Sale por abajo'],
    ],
  },
  {
    name: 'Persianas venecianas',
    items: [
      ['hlslice', 'Horizontales, hacia la izquierda'],
      ['hrslice', 'Horizontales, hacia la derecha'],
      ['vuslice', 'Verticales, hacia arriba'],
      ['vdslice', 'Verticales, hacia abajo'],
    ],
  },
  {
    name: 'Comprimir',
    items: [
      ['squeezeh', 'Horizontal'],
      ['squeezev', 'Vertical'],
    ],
  },
  {
    name: 'Zoom',
    items: [['zoomin', 'Acercar']],
  },
  {
    name: 'Pixelado',
    items: [['pixelize', 'Pixelar']],
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
