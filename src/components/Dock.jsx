// Ventana acoplada con las pestañas en la parte inferior.
// Con una sola vista basta `title`; con varias, `tabs` ([{ id, title }]), `active` y `onTab`.
export default function Dock({ title, tabs, active, onTab, className = '', children }) {
  const list = tabs || [{ id: null, title }];
  return (
    <div className={`dock ${className}`}>
      <div className="dock-body">{children}</div>
      <div className="dock-tabs">
        {list.map((tab) => (
          <div
            key={tab.title}
            className={`dock-tab${!tabs || tab.id === active ? ' active' : ''}${tabs ? ' clickable' : ''}`}
            onClick={tabs ? () => onTab(tab.id) : undefined}
          >
            {tab.title}
          </div>
        ))}
      </div>
    </div>
  );
}
