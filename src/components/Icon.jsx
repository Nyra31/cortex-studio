// Iconos SVG propios (los símbolos Unicode de reproducción se ven como emoji en Windows).
const FILLED = { fill: 'currentColor', stroke: 'none' };

const PATHS = {
  play: <path d="M7 4.5v15l12-7.5z" {...FILLED} />,
  pause: <path d="M6.5 4.5h4v15h-4zM13.5 4.5h4v15h-4z" {...FILLED} />,
  stop: <path d="M6 6h12v12H6z" {...FILLED} />,
  start: <path d="M5 5h2.5v14H5zM19 5v14L8.5 12z" {...FILLED} />,
  end: <path d="M16.5 5H19v14h-2.5zM5 5v14l10.5-7z" {...FILLED} />,
  prevFrame: <path d="M15 6v12l-8-6zM17 6h2v12h-2z" {...FILLED} />,
  nextFrame: <path d="M9 6v12l8-6zM5 6h2v12H5z" {...FILLED} />,
  film: <path d="M3 5h18v14H3zM7 5v14M17 5v14M3 9h4M3 15h4M17 9h4M17 15h4" />,
  speaker: <path d="M4 9h4l5-4v14l-5-4H4zM16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12" />,
  music: <path d="M9 18V5l11-2v13M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0zM20 16a3 3 0 1 1-6 0 3 3 0 0 1 6 0z" />,
  close: <path d="M6 6l12 12M18 6L6 18" />,
  plus: <path d="M12 5v14M5 12h14" />,
  zoomIn: <path d="M10.5 4a6.5 6.5 0 1 1 0 13 6.5 6.5 0 0 1 0-13zM15.5 15.5L20 20M10.5 7.5v6M7.5 10.5h6" />,
  zoomOut: <path d="M10.5 4a6.5 6.5 0 1 1 0 13 6.5 6.5 0 0 1 0-13zM15.5 15.5L20 20M7.5 10.5h6" />,
  fit: <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5M8 12h8" />,
  magnet: <path d="M6 4v8a6 6 0 0 0 12 0V4h-4v8a2 2 0 0 1-4 0V4zM6 8h4M14 8h4" />,
  newFile: <path d="M6 3h8l4 4v14H6zM14 3v4h4M12 11v6M9 14h6" />,
  open: <path d="M3 6h6l2 2h10v11H3zM3 10h18" />,
  save: <path d="M5 4h11l3 3v13H5zM8 4v5h7V4M8 20v-6h8v6" />,
  properties: <path d="M4 7h10M18 7h2M4 17h4M12 17h8M14 4.5v5M8 14.5v5" />,
  render: <path d="M4 5h11v14H4zM15 9l5-3v12l-5-3M8 9.5v5l4-2.5z" />,
  importMedia: <path d="M12 3v11M7.5 9.5L12 14l4.5-4.5M4 15v5h16v-5" />,
  undo: <path d="M9 7L4 12l5 5M4 12h11a5 5 0 0 1 0 10h-3" />,
  redo: <path d="M15 7l5 5-5 5M20 12H9a5 5 0 0 0 0 10h3" />,
  split: <path d="M6 7a2.5 2.5 0 1 0 0-.01M6 17a2.5 2.5 0 1 0 0 .01M8 8l12 9M8 16L20 7" />,
  trash: <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6" />,
  mute: <path d="M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18zM5.6 5.6l12.8 12.8" />,
  solo: <path d="M12 4v10M12 18.5v.5" strokeWidth="3" />,
  landscape: <path d="M3 7h18v10H3z" />,
  portrait: <path d="M7 3h10v18H7z" />,
  loop: <path d="M17 3l3 3-3 3M20 6H8a4 4 0 0 0-4 4v1M7 21l-3-3 3-3M4 18h12a4 4 0 0 0 4-4v-1" />,
  ripple: <path d="M3 7h6v10H3zM12 7h4v10h-4zM19 12h3M20 10l2 2-2 2M10.5 12H8" />,
  crop: <path d="M7 3v14h14M3 7h14v14" />,
  text: <path d="M5 5h14M12 5v14M9 19h6" />,
  fullscreen: <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5M8 8h8v8H8z" />,
  camera: <path d="M4 8h3l2-3h6l2 3h3v11H4zM12 10.5a3 3 0 1 1 0 6 3 3 0 0 1 0-6z" />,
  record: <circle cx="12" cy="12" r="6.5" {...FILLED} />,
  keyboard: <path d="M3 6h18v12H3zM7 10h.01M11 10h.01M15 10h.01M7 14h10" />,
};

export default function Icon({ name, size = 16 }) {
  return (
    <svg
      className="icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {PATHS[name]}
    </svg>
  );
}
