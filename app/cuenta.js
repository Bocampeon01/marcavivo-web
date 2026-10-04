// Sesión de Google con permiso de YouTube, para la web app.
//
// Se usa el mismo cliente y el mismo permiso que la página `programar.html`. El navegador recibe
// una llave que dura una hora (Google no le da llaves más largas a una página web sin servidor):
// se guarda en el aparato para no pedirla en cada pantalla y, cuando vence, hay que tocar de nuevo
// INICIAR SESION (casi siempre sin volver a escribir la contraseña).
//
// La ventana de Google solo se abre desde una dirección autorizada en Google Cloud: hoy,
// https://bocampeon01.github.io (la dirección fija de la web app).

/** No es secreto: identifica a la app ante Google. */
export const CLIENTE = '500924512787-5lbgk6c3ig7g75ibm7fbqsea5n3c7l2i.apps.googleusercontent.com';
export const PERMISO = 'https://www.googleapis.com/auth/youtube';
const K_SESION = 'youtube_sesion';
/** Se da por vencida un rato antes, para que no se corte en medio de un pedido. */
const MARGEN_MS = 2 * 60_000;

export class SesionVencida extends Error {
  constructor() {
    super('La sesión de Google venció.');
    this.name = 'SesionVencida';
  }
}

let sesion = null; // { token, vence, canal }
function leer() {
  if (sesion) return sesion;
  try { sesion = JSON.parse(localStorage.getItem(K_SESION) || 'null'); } catch (e) { sesion = null; }
  return sesion;
}
function guardar(s) {
  sesion = s;
  try {
    if (s) localStorage.setItem(K_SESION, JSON.stringify(s));
    else localStorage.removeItem(K_SESION);
  } catch (e) { /* sin almacenamiento: queda en memoria */ }
}

let cargandoGoogle = null;
/** Carga la librería de Google que abre la ventana de inicio de sesión. */
function cargarGoogle() {
  if (window.google && window.google.accounts && window.google.accounts.oauth2) return Promise.resolve();
  cargandoGoogle = cargandoGoogle || new Promise((ok, mal) => {
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.onload = () => ok();
    s.onerror = () => { cargandoGoogle = null; mal(new Error('No se pudo cargar el inicio de sesión de Google. Revisá internet.')); };
    document.head.appendChild(s);
  });
  return cargandoGoogle;
}

export const cuenta = {
  /** Si hay una sesión que todavía sirve. */
  get activa() {
    const s = leer();
    return !!(s && s.token && s.vence - MARGEN_MS > Date.now());
  },

  /** Si hubo una sesión en este aparato (aunque ya esté vencida). */
  get huboSesion() {
    return !!leer();
  },

  /** Nombre del canal recordado de la última vez (para mostrarlo mientras carga). */
  get canal() {
    const s = leer();
    return s ? s.canal || '' : '';
  },
  recordarCanal(nombre) {
    const s = leer();
    if (s) guardar({ ...s, canal: nombre || '' });
  },

  /** Minutos que le quedan a la sesión. */
  get minutosRestantes() {
    const s = leer();
    return s ? Math.max(0, Math.floor((s.vence - Date.now()) / 60_000)) : 0;
  },

  /** La llave para los pedidos a YouTube. Si venció, tira `SesionVencida`. */
  token() {
    if (!this.activa) throw new SesionVencida();
    return leer().token;
  },

  /** YouTube rechazó la llave (revocada o vencida antes de tiempo). */
  descartar() {
    const s = leer();
    if (s) guardar({ ...s, token: '', vence: 0 });
  },

  /**
   * Abre la ventana de Google. Tiene que llamarse desde un toque (si no, el navegador la bloquea).
   * `elegir` muestra el selector de cuentas aunque ya haya una (CAMBIAR CUENTA).
   */
  async iniciar({ elegir = false } = {}) {
    await cargarGoogle();
    const r = await new Promise((ok, mal) => {
      const cliente = google.accounts.oauth2.initTokenClient({
        client_id: CLIENTE,
        scope: PERMISO,
        prompt: elegir ? 'select_account' : '',
        callback: ok,
        error_callback: (e) => mal(Object.assign(new Error((e && e.message) || 'no se abrió la ventana de Google'), { tipo: e && e.type })),
      });
      cliente.requestAccessToken();
    });
    if (r.error) throw Object.assign(new Error(r.error_description || r.error), { tipo: r.error });
    if (!String(r.scope || '').includes(PERMISO)) {
      throw Object.assign(new Error('falta el permiso de YouTube'), { tipo: 'sin_permiso' });
    }
    guardar({ token: r.access_token, vence: Date.now() + Number(r.expires_in || 3600) * 1000, canal: elegir ? '' : this.canal });
  },

  /** Cierra la sesión en este aparato (y le avisa a Google que la llave ya no vale). */
  async cerrar() {
    const s = leer();
    guardar(null);
    try {
      if (s && s.token && window.google && google.accounts) google.accounts.oauth2.revoke(s.token, () => {});
    } catch (e) { /* no importa: igual venció en este aparato */ }
  },
};
