import Icon from './Icon.jsx';
import { tx } from '../i18n/index.js';

function ToolButton({ icon, title, onClick, disabled, active }) {
  return (
    <button className={`tool${active ? ' active' : ''}`} title={title} onClick={onClick} disabled={disabled}>
      <Icon name={icon} />
    </button>
  );
}

export default function Toolbar({
  onNew, onOpen, onSave, onImport, onYoutube, onProperties, onRender, canRender,
  onUndo, onRedo, canUndo, canRedo, onSplit, onDelete, hasSelection, snap, onToggleSnap, ripple, onToggleRipple,
}) {
  return (
    <div className="toolbar">
      <ToolButton icon="newFile" title={tx('Nuevo proyecto (Ctrl+N)')} onClick={onNew} />
      <ToolButton icon="open" title={tx('Abrir proyecto (Ctrl+O)')} onClick={onOpen} />
      <ToolButton icon="save" title={tx('Guardar (Ctrl+S)')} onClick={onSave} />
      <span className="tool-sep" />
      <ToolButton icon="importMedia" title={tx('Importar medios (Ctrl+I)')} onClick={onImport} />
      <ToolButton icon="webDownload" title={tx('Descargar de YouTube (Ctrl+Mayús+D)')} onClick={onYoutube} />
      <ToolButton icon="properties" title={tx('Propiedades del proyecto (Alt+Intro)')} onClick={onProperties} />
      <ToolButton icon="render" title={tx('Renderizar como… (Ctrl+M)')} onClick={onRender} disabled={!canRender} />
      <span className="tool-sep" />
      <ToolButton icon="undo" title={tx('Deshacer (Ctrl+Z)')} onClick={onUndo} disabled={!canUndo} />
      <ToolButton icon="redo" title={tx('Rehacer (Ctrl+Y)')} onClick={onRedo} disabled={!canRedo} />
      <span className="tool-sep" />
      <ToolButton icon="split" title={tx('Dividir en el cursor (S)')} onClick={onSplit} />
      <ToolButton icon="trash" title={tx('Eliminar eventos seleccionados (Supr)')} onClick={onDelete} disabled={!hasSelection} />
      <span className="tool-sep" />
      <ToolButton icon="magnet" title={tx('Ajuste a bordes y cursor (F8)')} onClick={onToggleSnap} active={snap} />
      <ToolButton
        icon="ripple"
        title={tx('Edición en cascada (Ctrl+L): al borrar, recortar, mover o pegar, lo que va detrás se desplaza{n}', { n: ripple ? tx(' (activada: {where})', { where: ripple === 'all' ? tx('en todas las pistas') : tx('en las pistas afectadas') }) : '' })}
        onClick={onToggleRipple}
        active={!!ripple}
      />
    </div>
  );
}
