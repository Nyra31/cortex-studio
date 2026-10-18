import Icon from './Icon.jsx';

function ToolButton({ icon, title, onClick, disabled, active }) {
  return (
    <button className={`tool${active ? ' active' : ''}`} title={title} onClick={onClick} disabled={disabled}>
      <Icon name={icon} />
    </button>
  );
}

export default function Toolbar({
  onNew, onOpen, onSave, onImport, onProperties, onRender, canRender,
  onUndo, onRedo, canUndo, canRedo, onSplit, onDelete, hasSelection, snap, onToggleSnap, ripple, onToggleRipple,
}) {
  return (
    <div className="toolbar">
      <ToolButton icon="newFile" title="Nuevo proyecto (Ctrl+N)" onClick={onNew} />
      <ToolButton icon="open" title="Abrir proyecto (Ctrl+O)" onClick={onOpen} />
      <ToolButton icon="save" title="Guardar (Ctrl+S)" onClick={onSave} />
      <span className="tool-sep" />
      <ToolButton icon="importMedia" title="Importar medios (Ctrl+I)" onClick={onImport} />
      <ToolButton icon="properties" title="Propiedades del proyecto (Alt+Intro)" onClick={onProperties} />
      <ToolButton icon="render" title="Renderizar como… (Ctrl+M)" onClick={onRender} disabled={!canRender} />
      <span className="tool-sep" />
      <ToolButton icon="undo" title="Deshacer (Ctrl+Z)" onClick={onUndo} disabled={!canUndo} />
      <ToolButton icon="redo" title="Rehacer (Ctrl+Y)" onClick={onRedo} disabled={!canRedo} />
      <span className="tool-sep" />
      <ToolButton icon="split" title="Dividir en el cursor (S)" onClick={onSplit} />
      <ToolButton icon="trash" title="Eliminar eventos seleccionados (Supr)" onClick={onDelete} disabled={!hasSelection} />
      <span className="tool-sep" />
      <ToolButton icon="magnet" title="Ajuste a bordes y cursor (F8)" onClick={onToggleSnap} active={snap} />
      <ToolButton
        icon="ripple"
        title={`Edición en cascada (Ctrl+L): al borrar, recortar, mover o pegar, lo que va detrás se desplaza${
          ripple ? ` (activada: ${ripple === 'all' ? 'en todas las pistas' : 'en las pistas afectadas'})` : ''}`}
        onClick={onToggleRipple}
        active={!!ripple}
      />
    </div>
  );
}
