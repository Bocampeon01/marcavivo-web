// Biblioteca compartida del club (Firebase): los escudos de los clubes y las fotos de fondo por
// categoría que cargan la app de Android y la página `programar.html`. Acá se lee para elegir el
// escudo de cada equipo sin tener que buscar la foto en el celular.
//
// - `biblioteca/indice/<tipo>/<clave>` = nombre (para listar sin bajar las imágenes).
// - `biblioteca/<tipo>/<clave>/img` = imagen en base64.
//
// Se entra con una sesión anónima, igual que la app. Se usa la interfaz web de Firebase (sin su
// librería): la sesión se guarda en el aparato para no crear una nueva cada vez.

const CLAVE_API = 'AIzaSyBzvM1xcINIEK13awX72hHvwqwytlCgjyA'; // no es secreta: identifica el proyecto
const BASE = 'https://marcavivo-ce14c-default-rtdb.europe-west1.firebasedatabase.app';
const K_SESION = 'biblioteca_sesion';

/** Nombre del club propio: su escudo va siempre. */
export const CLUB_PROPIO = 'All Boys';

/** Clave para Firebase: sin acentos, en minúscula y lo demás con "_" (igual que la app y la página). */
export function clave(nombre) {
  return String(nombre || '').trim().toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

/**
 * El nombre cargado en `lista` que corresponde a `texto`: igual, uno contiene al otro, o el que más
 * palabras comparte ("C Gral Belgrano" encuentra "Circulo Gral Belgrano"). Vacío si no hay ninguno.
 */
export function buscar(texto, lista) {
  const k = clave(texto);
  if (!k) return '';
  const nombres = [...lista];
  for (const n of nombres) if (clave(n) === k) return n;
  for (const n of nombres) {
    const c = clave(n);
    if (c && (c.includes(k) || k.includes(c))) return n;
  }
  const palabras = new Set(k.split('_').filter((p) => p.length > 2));
  let mejor = '', puntos = 0;
  for (const n of nombres) {
    const comunes = clave(n).split('_').filter((p) => palabras.has(p)).length;
    if (comunes > puntos) { mejor = n; puntos = comunes; }
  }
  return mejor;
}

// ---- Sesión anónima -----------------------------------------------------------------------------
let sesion = null; // { token, vence, renovar }
async function pedirJson(url, cuerpo) {
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((j.error && j.error.message) || String(r.status));
  return j;
}
async function token() {
  if (!sesion) {
    try { sesion = JSON.parse(localStorage.getItem(K_SESION) || 'null'); } catch (e) { sesion = null; }
  }
  if (sesion && sesion.token && sesion.vence > Date.now() + 60_000) return sesion.token;
  if (sesion && sesion.renovar) {
    try {
      const j = await pedirJson(`https://securetoken.googleapis.com/v1/token?key=${CLAVE_API}`,
        { grant_type: 'refresh_token', refresh_token: sesion.renovar });
      sesion = { token: j.id_token, renovar: j.refresh_token, vence: Date.now() + Number(j.expires_in) * 1000 };
    } catch (e) {
      sesion = null; // la sesión guardada ya no sirve: se pide una nueva
    }
  }
  if (!sesion) {
    const j = await pedirJson(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${CLAVE_API}`, { returnSecureToken: true });
    sesion = { token: j.idToken, renovar: j.refreshToken, vence: Date.now() + Number(j.expiresIn) * 1000 };
  }
  try { localStorage.setItem(K_SESION, JSON.stringify(sesion)); } catch (e) { /* sin almacenamiento */ }
  return sesion.token;
}

async function leer(camino) {
  const r = await fetch(`${BASE}/${camino}.json?auth=${encodeURIComponent(await token())}`);
  if (!r.ok) throw new Error(r.status === 401 || r.status === 403 ? 'la biblioteca no dejó entrar' : `la biblioteca contestó ${r.status}`);
  return r.json();
}

const cache = new Map(); // tipo/clave -> Blob | null

export const biblioteca = {
  /** Nombres cargados de `tipo` ('clubes' o 'fondos'), ordenados. */
  async indice(tipo) {
    const v = await leer(`biblioteca/indice/${tipo}`);
    return Object.values(v || {}).filter((n) => typeof n === 'string').sort((a, b) => a.localeCompare(b, 'es'));
  },

  /** La imagen de `nombre` (Blob), o null si no está cargada. */
  async imagen(tipo, nombre) {
    const k = clave(nombre);
    if (!k) return null;
    const id = `${tipo}/${k}`;
    if (cache.has(id)) return cache.get(id);
    const b64 = await leer(`biblioteca/${id}/img`);
    let blob = null;
    if (typeof b64 === 'string' && b64) {
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      // Los escudos son PNG y los fondos JPEG; el navegador lo reconoce por el contenido.
      blob = new Blob([bytes], { type: bytes[0] === 0x89 ? 'image/png' : 'image/jpeg' });
    }
    cache.set(id, blob);
    return blob;
  },
};
