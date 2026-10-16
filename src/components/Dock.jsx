// Ventana acoplada con la pestaña en la parte inferior.
export default function Dock({ title, className = '', children }) {
  return (
    <div className={`dock ${className}`}>
      <div className="dock-body">{children}</div>
      <div className="dock-tabs">
        <div className="dock-tab active">{title}</div>
      </div>
    </div>
  );
}
