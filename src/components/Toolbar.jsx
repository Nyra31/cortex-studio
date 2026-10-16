export default function Toolbar({
  title, dirty, onNew, onOpen, onSave, onSaveAs, onImport,
  onUndo, onRedo, canUndo, canRedo, onSplit, onDelete, hasSelection, onRender, canRender,
}) {
  return (
    <div className="toolbar">
      <div className="brand">Cortex Studio</div>
      <div className="group">
        <button onClick={onNew} title="Nuevo proyecto (Ctrl+N)">Nuevo</button>
        <button onClick={onOpen} title="Abrir proyecto (Ctrl+O)">Abrir…</button>
        <button onClick={onSave} title="Guardar (Ctrl+S)">Guardar</button>
        <button onClick={onSaveAs} title="Guardar como (Ctrl+Mayús+S)">Guardar como…</button>
      </div>
      <div className="group">
        <button onClick={onImport} title="Importar medios (Ctrl+I)">Importar medios…</button>
      </div>
      <div className="group">
        <button onClick={onUndo} disabled={!canUndo} title="Deshacer (Ctrl+Z)">Deshacer</button>
        <button onClick={onRedo} disabled={!canRedo} title="Rehacer (Ctrl+Y)">Rehacer</button>
      </div>
      <div className="group">
        <button onClick={onSplit} title="Dividir en el cursor (S)">Dividir</button>
        <button onClick={onDelete} disabled={!hasSelection} title="Eliminar eventos seleccionados (Supr)">Eliminar</button>
      </div>
      <div className="spacer" />
      <div className="project-title">
        {title}
        {dirty && <span className="dirty"> •</span>}
      </div>
      <button className="primary" onClick={onRender} disabled={!canRender} title="Renderizar a MP4 (Ctrl+M)">
        Renderizar como…
      </button>
    </div>
  );
}
