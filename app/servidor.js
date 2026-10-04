// Hablarle al servidor: dónde está, el PIN y las llamadas de control.
//
// La web app puede venir del mismo servidor (por el túnel o en la PC del servidor) o de GitHub
// Pages, que es la dirección fija. En ese caso el servidor está en otra dirección, que cambia cada
// vez que se prende: él la deja escrita en `servidor.json` del repo de las páginas y acá se lee.

/** Versión de la web app (se ve en pantalla y viaja en los informes al servidor). */
export const VERSION = '2026-10-03 i';

const parametros = new URLSearchParams(location.search);
const EN_PAGES = location.hostname.endsWith('github.io');
const DIRECCION_VALIDA = /^https:\/\/[a-z0-9-]+\.trycloudflare\.com$/;

/** Cada aparato transmite por su propia ruta: así el servidor atiende varios a la vez sin mezclarlos. */
function rutaDelAparato() {
  const pedida = parametros.get('ruta');
  if (/^[a-z0-9_-]{1,40}$/i.test(pedida || '')) return pedida;
  let r = '';
  try { r = localStorage.getItem('ruta') || ''; } catch (e) { /* sin almacenamiento */ }
  if (!/^c[a-z0-9]{6}$/.test(r)) {
    r = 'c' + Math.random().toString(36).slice(2, 8).padEnd(6, '0');
    try { localStorage.setItem('ruta', r); } catch (e) { /* sin almacenamiento */ }
  }
  return r;
}

function pinGuardado() {
  try { return sessionStorage.getItem('pin') || ''; } catch (e) { return ''; }
}

export const servidor = {
  /** '' = el servidor es el mismo que sirve esta página. */
  base: '',
  /** false mientras no se sabe dónde está el servidor (solo pasa en la dirección fija). */
  listo: !EN_PAGES,
  ruta: rutaDelAparato(),
  /** Para ensayar sin salir al aire: `?destino=local` (el video queda en el servidor). */
  destino: parametros.get('destino') === 'local' ? 'local' : '',
  parametros,
  _pin: '',
  /**
   * Lo pone la pantalla: `async (motivo) => pin`. Se llama cuando el servidor pide el PIN (o lo
   * rechazó: `motivo` dice por qué). Devolver '' cancela.
   */
  pedirPin: null,

  async buscar() {
    if (!EN_PAGES) return true;
    const leer = async (url, opciones) => {
      const r = await fetch(url, { cache: 'no-store', ...opciones });
      if (!r.ok) throw new Error(String(r.status));
      const u = (await r.json()).url;
      if (!DIRECCION_VALIDA.test(u || '')) throw new Error('dirección inválida');
      return u;
    };
    try {
      // Primero la copia del repo (al instante); si GitHub no contesta, la publicada (tarda 1 o 2 minutos).
      this.base = await leer('https://api.github.com/repos/Bocampeon01/marcavivo-web/contents/servidor.json',
        { headers: { Accept: 'application/vnd.github.raw+json' } })
        .catch(() => leer('../servidor.json?t=' + Date.now()));
      this.listo = true;
    } catch (e) {
      this.listo = false;
    }
    return this.listo;
  },

  /** El servidor dejó de contestar: puede haberse reiniciado con otra dirección. */
  perdido() {
    if (EN_PAGES) this.listo = false;
  },

  /** `fetch` al servidor, con el PIN. Si lo pide y `preguntar` es true, se le pide a quien usa la app. */
  async pedir(url, opciones = {}, preguntar = true) {
    let r;
    for (let intento = 0; intento < 4; intento++) {
      if (!this.listo && !(await this.buscar())) throw new Error('no se encontró el servidor');
      r = await fetch(this.base + url, {
        ...opciones,
        headers: { ...(opciones.headers || {}), 'X-Pin': pinGuardado() || this._pin },
      });
      if (r.status !== 401 || !preguntar || !this.pedirPin) return r;
      let motivo = '';
      try { motivo = (await r.clone().json()).error || ''; } catch (e) { /* no era JSON */ }
      const pin = String((await this.pedirPin(motivo === 'Falta el PIN.' ? '' : motivo)) || '').trim();
      if (!pin) return r;
      this._pin = pin;
      try { sessionStorage.setItem('pin', pin); } catch (e) { /* sin almacenamiento */ }
    }
    return r;
  },

  /** Llamada de control: devuelve el JSON, o tira un error con el mensaje del servidor. */
  async api(ruta, cuerpo, preguntar = true) {
    const r = await this.pedir(ruta, { method: cuerpo ? 'POST' : 'GET', body: cuerpo ? JSON.stringify(cuerpo) : undefined }, preguntar);
    let j = {};
    try { j = await r.json(); } catch (e) { /* respuesta sin JSON */ }
    if (!r.ok) {
      const error = new Error(j.error || String(r.status));
      error.status = r.status;
      throw error;
    }
    return j;
  },

  estado(preguntar = false) {
    return this.api('/api/estado?ruta=' + encodeURIComponent(this.ruta), undefined, preguntar);
  },
  salir(destino = this.destino) {
    return this.api('/api/salir', { ruta: this.ruta, destino });
  },
  cortar() {
    return this.api('/api/cortar', { ruta: this.ruta });
  },
  /** Lo que muestra esta pantalla queda guardado en el servidor (para revisar una prueba después). */
  informar(texto, extra = {}) {
    return this.pedir('/api/informe', {
      method: 'POST',
      body: JSON.stringify({ version: VERSION, ruta: this.ruta, texto: String(texto).slice(0, 2500), ...extra }),
    }, false).catch(() => {});
  },
};
