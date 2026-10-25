import { useEffect } from 'react';
import { tx } from '../i18n/index.js';

const SHORTCUTS = [
  [tx('Espacio'), tx('Reproducir / detener (vuelve a donde empezó)')],
  [tx('Intro'), tx('Reproducir / pausar')],
  ['← / →', tx('Fotograma anterior / siguiente')],
  [tx('Ctrl+← / Ctrl+→'), tx('Punto de edición anterior / siguiente')],
  [tx('Re Pág / Av Pág'), tx('Marca anterior / siguiente de la regla')],
  [tx('Inicio / Fin'), tx('Ir al principio / al final')],
  [tx('Mayús al arrastrar'), tx('Sin ajuste (cursor y eventos)')],
  [tx('Arrastrar el triángulo'), tx('Ajuste fino del cursor')],
  ['S', tx('Dividir en el cursor (con selección de tiempo, en sus dos extremos)')],
  [tx('Alt+[ / Alt+]'), tx('Recortar el principio / el final del evento hasta el cursor')],
  [tx('Ctrl+Mayús+E'), tx('Exportar el fotograma como imagen PNG')],
  [tx('Ctrl+Mayús+F'), tx('Congelar fotograma en el cursor')],
  [tx('Ctrl+Mayús+D'), tx('Descargar de YouTube')],
  [tx('Ctrl+Mayús+C'), tx('Comprimir videos')],
  [tx('Supr'), tx('Eliminar eventos seleccionados')],
  [tx('Ctrl+L'), tx('Edición en cascada (cerrar huecos, desplazar lo de detrás)')],
  [tx('Ctrl+Supr'), tx('Eliminar el tramo de la selección de tiempo y cerrar el hueco')],
  [tx('Ctrl+A'), tx('Seleccionar todos los eventos')],
  [tx('Ctrl+X / Ctrl+C / Ctrl+V'), tx('Cortar / copiar / pegar eventos (en el cursor)')],
  ['G / U', tx('Agrupar / quitar del grupo')],
  [tx('Clic derecho'), tx('Menú contextual del evento o de la pista')],
  [tx('Ctrl+clic'), tx('Añadir o quitar eventos de la selección')],
  [tx('Ctrl + arrastrar un borde'), tx('Cambiar la velocidad del evento (25 % a 400 %)')],
  [tx('Alt + arrastrar un evento'), tx('Deslizar su contenido (slip)')],
  [tx('Ctrl + soltar un medio sobre un evento'), tx('Sustituir su medio')],
  [tx('Arrastrar en la barra de arriba de la regla'), tx('Selección de tiempo (clic: quitarla)')],
  [tx('Doble clic en un evento'), tx('Selección de tiempo del evento')],
  [tx('Esc'), tx('Quitar la selección de tiempo')],
  ['Q', tx('Reproducción en bucle de la selección de tiempo')],
  ['M / R', tx('Insertar marcador / región (de la selección de tiempo)')],
  [tx('Clic derecho en la cabecera de una pista'), tx('Envolventes (volumen y panorámica; opacidad en video) y modo de fusión')],
  [tx('Doble clic en una envolvente'), tx('Añadir un punto (clic derecho en él: eliminarlo o elegir la curva del tramo)')],
  ['1 … 9', tx('Ir al marcador con ese número')],
  [tx('Doble clic en un marcador o región'), tx('Cambiarle el nombre')],
  [tx('Arrastrar un texto en la vista previa'), tx('Moverlo (esquinas: tamaño; doble clic: editarlo)')],
  [tx('Arrastrar en la vista previa (panorámica)'), tx('Mover la imagen (esquinas: zoom; círculo: girar)')],
  [tx('Arrastrar en zona vacía'), tx('Seleccionar eventos con un rectángulo (Ctrl: añadir)')],
  [tx('Ctrl+Z / Ctrl+Y'), tx('Deshacer / rehacer')],
  ['↑ / ↓, Ctrl+rueda', tx('Acercar / alejar la línea de tiempo')],
  ['F8', tx('Activar o desactivar el ajuste')],
  [tx('Ctrl+Q / Ctrl+Mayús+Q'), tx('Insertar pista de audio (abajo) / de video (arriba)')],
  [tx('Arrastrar la cabecera de una pista'), tx('Cambiarla de orden')],
  [tx('Ctrl+N / Ctrl+O / Ctrl+S'), tx('Nuevo / abrir / guardar')],
  [tx('Ctrl+I'), tx('Importar medios')],
  [tx('Ctrl+M'), tx('Renderizar como…')],
  [tx('Ctrl+R'), tx('Grabar voz en off en la pista armada / terminar')],
  [tx('Alt+Intro'), tx('Propiedades del proyecto')],
  ['F11', tx('Pantalla completa')],
  [tx('Alt+Mayús+4 / doble clic en la vista previa'), tx('Vista previa a pantalla completa (en la otra pantalla si hay dos)')],
  [tx('Alt+4 / Alt+7 / Alt+8'), tx('Ventana de medios / de transiciones / de efectos de video')],
  [tx('Ctrl+Alt+2'), tx('Monitores de video')],
  [tx('Doble clic en un solapamiento'), tx('Volver a disolución cruzada')],
  [tx('Doble clic en una pista'), tx('Cambiar el nombre de la pista')],
  [tx('Doble clic en el volumen'), tx('Volver a 0 dB')],
  [tx('Arrastrar esquina superior'), tx('Fundido de entrada / salida del evento')],
  [tx('Doble clic en la esquina'), tx('Quitar el fundido')],
  [tx('Arrastrar línea de volumen'), tx('Volumen del evento de audio (doble clic: 0 dB)')],
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
        <div className="modal-title">{tx('Atajos de teclado')}</div>
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
          <button className="primary" onClick={onClose}>{tx('Cerrar')}</button>
        </div>
      </div>
    </div>
  );
}
