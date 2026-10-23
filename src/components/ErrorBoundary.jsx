import { Component } from 'react';

// Si la interfaz falla al dibujarse, en vez de quedarse en blanco enseña qué ha pasado y deja recargarla. El error
// se apunta en el registro (Ayuda → Abrir la carpeta de registros). Al recargar, si había cambios sin guardar, se
// ofrece la copia de recuperación del guardado automático (se escribe cada minuto).
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    window.api?.logError('react', `${error?.stack || error}\n${info?.componentStack || ''}`);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="crash-screen">
        <div className="crash-box">
          <h1>Algo ha fallado en Cortex Studio</h1>
          <p>
            La interfaz ha dado un error y no puede seguir. Recárgala: si había cambios sin guardar, al volver se ofrecerá
            la copia de recuperación (se guarda sola cada minuto).
          </p>
          <pre>{String(this.state.error?.message || this.state.error)}</pre>
          <p className="note">
            El error se ha apuntado en el registro. Si se repite, la carpeta de registros ayuda a encontrar la causa.
          </p>
          <div className="crash-actions">
            <button onClick={() => window.api?.openLogs()}>Abrir la carpeta de registros</button>
            <button className="primary" onClick={() => window.location.reload()}>Recargar la interfaz</button>
          </div>
        </div>
      </div>
    );
  }
}
