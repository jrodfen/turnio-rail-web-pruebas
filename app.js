(async function () {
  const status = document.getElementById('status');
  const loginForm = document.getElementById('login-form');
  const api = String(window.TURNIO_EXTERNAL_API || '').replace(/\/$/, '');
  const clientStorageKey = 'turnio_external_client_id';
  const sessionStorageKey = 'turnio_external_session_token';

  function obtenerClientId() {
    let clientId = localStorage.getItem(clientStorageKey) || '';
    if (!/^[A-Za-z0-9_-]{24,128}$/.test(clientId)) {
      const bytes = new Uint8Array(32);
      crypto.getRandomValues(bytes);
      clientId = Array.from(bytes, function (byte) { return byte.toString(16).padStart(2, '0'); }).join('');
      localStorage.setItem(clientStorageKey, clientId);
    }
    return clientId;
  }

  if (!api) {
    status.textContent = 'Puente seguro pendiente de activar.';
    return;
  }

  try {
    const response = await fetch(api + '/api/health', { cache: 'no-store' });
    const data = await response.json();
    if (!response.ok || !data.ok || !data.configured) throw new Error('not-ready');
    status.className = 'status ready';
    status.textContent = 'Conexión de pruebas preparada. Introduce tu correo autorizado y el PIN temporal.';
    loginForm.hidden = false;
  } catch (error) {
    status.className = 'status error';
    status.textContent = 'No se ha podido conectar con el entorno externo de pruebas.';
  }

  async function call(action, extra) {
    const response = await fetch(api + '/api/turnio', {
      method: 'POST', credentials: 'omit', cache: 'no-store',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(Object.assign({
        accion: action,
        clientId: obtenerClientId(),
        sessionToken: localStorage.getItem(sessionStorageKey) || ''
      }, extra || {}))
    });
    const data = await response.json();
    if (!response.ok || data.ok === false || data.exito === false) throw new Error(data.error || 'No se pudo completar la operación.');
    return data;
  }

  loginForm.addEventListener('submit', async function (event) {
    event.preventDefault();
    const email = document.getElementById('email').value.trim();
    const pin = document.getElementById('pin').value;
    try {
      const data = await call('iniciar_pruebas', { email: email, pin: pin });
      if (!data.token) throw new Error('No se ha podido conservar la sesión de acceso.');
      localStorage.setItem(sessionStorageKey, data.token);
      loginForm.hidden = true;
      status.className = 'status ready';
      status.textContent = 'Sesión de pruebas iniciada para ' + data.persona.nombre + '.';
    } catch (error) {
      status.className = 'status error';
      status.textContent = error.message;
    }
  });
}());
