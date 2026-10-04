// Logos de sponsors y escudos de los dos equipos, guardados en el celular (como `lib/logos/logos.dart`
// de la app de Android).
//
// - Los logos los carga quien transmite, de las fotos del celular. Se guardan achicados, quedan para
//   todos los partidos y rotan en una esquina del video.
// - Los escudos son dos (local y visitante) y van en el marcador. El del local queda de un partido
//   para el otro; el del visitante se cambia antes de cada partido.
//
// Las imágenes van a la base del navegador (IndexedDB); la lista, los segundos y la esquina, a
// localStorage. Si el navegador no deja guardar (modo privado), quedan en memoria mientras dure la página.

/** Lado máximo con el que se guarda cada imagen: alcanza para la pantalla de espera y no pesa. */
export const LADO_MAXIMO = 1024;
export const ESCUDO_LOCAL = 'escudo_local';
export const ESCUDO_VISITA = 'escudo_visita';

const K_LISTA = 'logos_lista', K_SEGUNDOS = 'logos_segundos', K_POSICION = 'logos_posicion';
const POSICIONES = ['arribaDerecha', 'abajoIzquierda', 'abajoDerecha'];

// ---- Base del navegador (con memoria de respaldo) ----------------------------------------------
const memoria = new Map();
let base = null;
function abrirBase() {
  if (base) return base;
  base = new Promise((ok) => {
    try {
      const pedido = indexedDB.open('marcavivo', 1);
      pedido.onupgradeneeded = () => pedido.result.createObjectStore('imagenes');
      pedido.onsuccess = () => ok(pedido.result);
      pedido.onerror = () => ok(null);
      pedido.onblocked = () => ok(null);
    } catch (e) {
      ok(null);
    }
  });
  return base;
}
async function operar(modo, hacer) {
  const db = await abrirBase();
  if (!db) return undefined;
  return new Promise((ok) => {
    try {
      const t = db.transaction('imagenes', modo);
      const pedido = hacer(t.objectStore('imagenes'));
      t.oncomplete = () => ok(pedido ? pedido.result : undefined);
      t.onerror = t.onabort = () => ok(undefined);
    } catch (e) {
      ok(undefined);
    }
  });
}
async function leer(clave) {
  if (memoria.has(clave)) return memoria.get(clave);
  const b = await operar('readonly', (s) => s.get(clave));
  return b || null;
}
async function escribir(clave, blob) {
  memoria.set(clave, blob);
  await operar('readwrite', (s) => s.put(blob, clave));
}
async function sacar(clave) {
  memoria.set(clave, null);
  await operar('readwrite', (s) => s.delete(clave));
}

const preferencia = (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } };
const guardarPreferencia = (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* sin almacenamiento */ } };

/** Imagen lista para dibujar a partir de un archivo o un blob (null si no es una imagen). */
export function imagenDe(blob) {
  return new Promise((ok) => {
    if (!blob) return ok(null);
    const url = URL.createObjectURL(blob);
    const i = new Image();
    i.onload = () => ok(i);
    i.onerror = () => { URL.revokeObjectURL(url); ok(null); };
    i.src = url;
  });
}

/** PNG de la imagen, achicada a `LADO_MAXIMO` si es más grande (conserva la transparencia). */
export async function achicar(blob) {
  const img = await imagenDe(blob);
  if (!img) throw new Error('no es una imagen que se pueda leer');
  const lado = Math.max(img.naturalWidth, img.naturalHeight);
  const escala = lado > LADO_MAXIMO ? LADO_MAXIMO / lado : 1;
  const lienzo = document.createElement('canvas');
  lienzo.width = Math.max(1, Math.round(img.naturalWidth * escala));
  lienzo.height = Math.max(1, Math.round(img.naturalHeight * escala));
  const c = lienzo.getContext('2d');
  c.imageSmoothingQuality = 'high';
  c.drawImage(img, 0, 0, lienzo.width, lienzo.height);
  URL.revokeObjectURL(img.src);
  return new Promise((ok, mal) => lienzo.toBlob((b) => (b ? ok(b) : mal(new Error('no se pudo guardar la imagen'))), 'image/png'));
}

export class Logos {
  constructor(nombres, segundos, posicion) {
    this._nombres = nombres;
    /** Cada cuántos segundos cambia el logo en pantalla. */
    this.segundos = segundos;
    /** En qué esquina se muestran: 'arribaDerecha' | 'abajoIzquierda' | 'abajoDerecha'. */
    this.posicion = posicion;
  }

  static async cargar() {
    let guardados = [];
    try { guardados = JSON.parse(preferencia(K_LISTA) || '[]'); } catch (e) { /* lista rota: se arma de nuevo */ }
    // Manda lo que hay en la base: se respeta el orden guardado y se suma lo que aparezca ahí.
    const enBase = ((await operar('readonly', (s) => s.getAllKeys())) || [])
      .filter((k) => typeof k === 'string' && k.startsWith('logo_')).sort();
    const nombres = enBase.length
      ? [...guardados.filter((n) => enBase.includes(n)), ...enBase.filter((n) => !guardados.includes(n))]
      : guardados.filter((n) => memoria.get(n));
    const segundos = Math.min(120, Math.max(3, Number(preferencia(K_SEGUNDOS)) || 10));
    const posicion = POSICIONES.includes(preferencia(K_POSICION)) ? preferencia(K_POSICION) : 'arribaDerecha';
    return new Logos(nombres, segundos, posicion);
  }

  get nombres() { return [...this._nombres]; }
  get hayLogos() { return this._nombres.length > 0; }
  _guardarLista() { guardarPreferencia(K_LISTA, JSON.stringify(this._nombres)); }

  /** El logo guardado con ese nombre (Blob) o null. */
  logo(nombre) { return leer(nombre); }

  /** Agrega las imágenes elegidas, achicadas. Devuelve cuántas no se pudieron leer. */
  async agregar(archivos) {
    let fallas = 0;
    for (const archivo of archivos) {
      try {
        const png = await achicar(archivo);
        const nombre = `logo_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
        await escribir(nombre, png);
        this._nombres.push(nombre);
      } catch (e) {
        fallas++;
      }
    }
    this._guardarLista();
    return fallas;
  }

  async quitar(nombre) {
    this._nombres = this._nombres.filter((n) => n !== nombre);
    await sacar(nombre);
    this._guardarLista();
  }

  cambiarPosicion(p) {
    if (!POSICIONES.includes(p)) return;
    this.posicion = p;
    guardarPreferencia(K_POSICION, p);
  }

  cambiarSegundos(s) {
    this.segundos = Math.min(120, Math.max(3, s));
    guardarPreferencia(K_SEGUNDOS, String(this.segundos));
  }

  /** Escudo del equipo local o del visitante (Blob), o null si no se cargó. */
  escudo({ local }) { return leer(local ? ESCUDO_LOCAL : ESCUDO_VISITA); }

  /** Pone el escudo desde una foto o una imagen ya bajada (por ejemplo, de la biblioteca del club). */
  async ponerEscudo(blob, { local }) {
    await escribir(local ? ESCUDO_LOCAL : ESCUDO_VISITA, await achicar(blob));
  }

  quitarEscudo({ local }) { return sacar(local ? ESCUDO_LOCAL : ESCUDO_VISITA); }

  /** Todo listo para el marcador: `{ imagenes, segundos, posicion, escudoLocal, escudoVisita }`. */
  async paraMarcador() {
    const imagenes = (await Promise.all(this._nombres.map(async (n) => imagenDe(await leer(n))))).filter(Boolean);
    return {
      imagenes,
      segundos: this.segundos,
      posicion: this.posicion,
      escudoLocal: await imagenDe(await this.escudo({ local: true })),
      escudoVisita: await imagenDe(await this.escudo({ local: false })),
    };
  }
}
