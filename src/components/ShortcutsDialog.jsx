import { useEffect } from 'react';

const SHORTCUTS = [
  ['Espacio', 'Reproducir / detener (vuelve a donde empezó)'],
  ['Intro', 'Reproducir / pausar'],
  ['← / →', 'Fotograma anterior / siguiente'],
  ['Ctrl+← / Ctrl+→', 'Punto de edición anterior / siguiente'],
  ['Re Pág / Av Pág', 'Marca anterior / siguiente de la regla'],
  ['Inicio / Fin', 'Ir al principio / al final'],
  ['Mayús al arrastrar', 'Sin ajuste (cursor y eventos)'],
  ['Arrastrar el triángulo', 'Ajuste fino del cursor'],
  ['S', 'Dividir en el cursor'],
  ['Supr', 'Eliminar eventos seleccionados'],
  ['Ctrl+A', 'Seleccionar todos los eventos'],
  ['Ctrl+X / Ctrl+C / Ctrl+V', 'Cortar / copiar / pegar eventos (en el cursor)'],
  ['G / U', 'Agrupar / quitar del grupo'],
  ['Clic derecho', 'Menú contextual del evento o de la pista'],
  ['Ctrl+clic', 'Añadir o quitar eventos de la selección'],
  ['Ctrl + arrastrar un borde', 'Cambiar la velocidad del evento (25 % a 400 %)'],
  ['Arrastrar en la barra de arriba de la regla', 'Selección de tiempo (clic: quitarla)'],
  ['Doble clic en un evento', 'Selección de tiempo del evento'],
  ['Esc', 'Quitar la selección de tiempo'],
  ['Q', 'Reproducción en bucle de la selección de tiempo'],
  ['Arrastrar un texto en la vista previa', 'Moverlo (esquinas: tamaño; doble clic: editarlo)'],
  ['Arrastrar en zona vacía', 'Seleccionar eventos con un rectángulo (Ctrl: añadir)'],
  ['Ctrl+Z / Ctrl+Y', 'Deshacer / rehacer'],
  ['↑ / ↓, Ctrl+rueda', 'Acercar / alejar la línea de tiempo'],
  ['F8', 'Activar o desactivar el ajuste'],
  ['Ctrl+Q / Ctrl+Mayús+Q', 'Insertar pista de audio / de video'],
  ['Ctrl+N / Ctrl+O / Ctrl+S', 'Nuevo / abrir / guardar'],
  ['Ctrl+I', 'Importar medios'],
  ['Ctrl+M', 'Renderizar como…'],
  ['Alt+Intro', 'Propiedades del proyecto'],
  ['F11', 'Pantalla completa'],
  ['Alt+4 / Alt+7 / Alt+8', 'Ventana de medios / de transiciones / de efectos de video'],
  ['Doble clic en un solapamiento', 'Volver a disolución cruzada'],
  ['Doble clic en una pista', 'Cambiar el nombre de la pista'],
  ['Doble clic en el volumen', 'Volver a 0 dB'],
  ['Arrastrar esquina superior', 'Fundido de entrada / salida del evento'],
  ['Doble clic en la esquina', 'Quitar el fundido'],
  ['Arrastrar línea de volumen', 'Volumen del evento de audio (doble clic: 0 dB)'],
];

export default function ShortcutsDialog({ onClose }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal shortcuts-dialog">
        <div className="modal-title">Atajos de teclado</div>
        <div className="modal-content">
          <table>
            <tbody>
              {SHORTCUTS.map(([keys, action]) => (
                <tr key={keys}>
                  <td><kbd>{keys}</kbd></td>
                  <td>{action}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="modal-actions">
          <button className="primary" onClick={onClose}>Cerrar</button>
        </div>
      </div>
    </div>
  );
}
