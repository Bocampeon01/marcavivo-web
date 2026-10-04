// Pasos para salir en vivo en una transmisión programada, sin que quien transmite toque claves.
// Es `lib/youtube/go_live.dart` de la app de Android, en la web: mismas reglas y mismos nombres de
// clave, para que un celular con la app y otro con la web app se reconozcan entre sí.

import { ErrorYouTube, esClaveDeCamara } from './youtube.js';

/** Prefijo del título de las claves que crea MarcaVivo: así las reconoce para reusarlas. */
export const PREFIJO_CLAVE = 'Sport Video';

/** La transmisión la estaba haciendo otro aparato (su clave, con otra etiqueta) y está en curso. */
export class ClaveAjena extends Error {
  constructor() { super('Otro celular estaba transmitiendo.'); this.name = 'ClaveAjena'; }
}

/** La programada se creó con la app de YouTube del celular: su clave no acepta la señal de MarcaVivo. */
export class ProgramadaDeCamara extends Error {
  constructor() { super('Hecha con la app de YouTube del celular.'); this.name = 'ProgramadaDeCamara'; }
}

/** Algo que no se puede hacer por cómo está la transmisión. El mensaje ya es para quien transmite. */
export class ErrorDeEstado extends Error {
  constructor(mensaje) { super(mensaje); this.name = 'ErrorDeEstado'; }
}

/** YouTube no hizo a tiempo lo que se esperaba. El mensaje ya es para quien transmite. */
export class TiempoAgotado extends Error {
  constructor(mensaje) { super(mensaje); this.name = 'TiempoAgotado'; }
}

/** Se canceló mientras se esperaba. */
export class Cancelado extends Error {
  constructor() { super('Cancelado.'); this.name = 'Cancelado'; }
}

/** Falló el paso a "en vivo": dice en qué paso y en qué estado quedó en YouTube. */
export class PasoFallido extends Error {
  constructor(paso, estado, causa) {
    super(`Falló al ${paso} (estado: ${estado}): ${causa && causa.message}`);
    this.name = 'PasoFallido';
    /** Qué se estaba haciendo ('pasar a "en prueba"', ...). */
    this.paso = paso;
    /** Estado en el que quedó la transmisión (null si no se pudo leer). */
    this.estado = estado;
    this.causa = causa;
  }
}

/** Nombre del estado de YouTube para quien transmite. */
export function estadoLegible(estado) {
  switch (estado) {
    case 'created': return 'sin configurar';
    case 'ready': return 'lista';
    case 'testStarting': case 'testing': return 'en prueba';
    case 'liveStarting': return 'entrando en vivo';
    case 'live': return 'en vivo';
    case 'complete': return 'finalizada';
    case 'revoked': return 'dada de baja';
    case null: case undefined: case '': return 'desconocido';
    default: return estado;
  }
}

const K_ETIQUETA = 'device_tag';
/**
 * Código corto y aleatorio que identifica a este aparato. Va en el título de las claves que crea,
 * para distinguir la propia de la de otro celular que transmite en el mismo canal.
 */
export function etiquetaDelAparato() {
  let e = '';
  try { e = localStorage.getItem(K_ETIQUETA) || ''; } catch (err) { /* sin almacenamiento */ }
  if (/^[a-z0-9]{6}$/.test(e)) return e;
  const letras = 'abcdefghijkmnpqrstuvwxyz23456789';
  const azar = new Uint32Array(6);
  crypto.getRandomValues(azar);
  e = [...azar].map((n) => letras[n % letras.length]).join('');
  try { localStorage.setItem(K_ETIQUETA, e); } catch (err) { /* sin almacenamiento */ }
  return e;
}

const enCurso = (b) => ['testStarting', 'testing', 'liveStarting', 'live'].includes(b.estado);
/** La clave fija del canal ("Default stream key"), la que comparten todos. */
const esClaveDelCanal = (c) => c.esFija || c.titulo.trim().toLowerCase().startsWith('default stream key');

export class EnVivo {
  /**
   * @param api el acceso a YouTube (`youtube` de youtube.js, o uno simulado en las pruebas).
   * @param opciones `esperaInicioAutomaticoMs`: cuánto esperar a que una con inicio automático pase
   *   sola a "en vivo"; `pausaReintentoMs`: pausa antes de probar el otro camino cuando YouTube
   *   rechaza un cambio de estado; `pausaMs`: cada cuánto se le pregunta a YouTube mientras se espera.
   */
  constructor(api, { esperaInicioAutomaticoMs = 30_000, pausaReintentoMs = 5000, pausaMs = 3000 } = {}) {
    this.api = api;
    this.esperaInicioAutomaticoMs = esperaInicioAutomaticoMs;
    this.pausaReintentoMs = pausaReintentoMs;
    this.pausaMs = pausaMs;
  }

  _pausa(ms = this.pausaMs) {
    return new Promise((ok) => setTimeout(ok, ms));
  }

  /**
   * Clave que va a usar este aparato (`etiqueta`) para transmitir en `b`. Devuelve
   * `{ clave, creada, anterior }`: `creada` si la creó MarcaVivo recién y se la asignó; `anterior`
   * es la que tenía antes (null si no tenía), para devolvérsela si no se sale en vivo.
   *
   * - Si ya tiene una clave de este aparato, la reusa (por ejemplo al RETOMAR).
   * - Si trae su propia clave (las que se crean desde la app de YouTube del celular), se transmite
   *   directo a esa sin tocar la programada. Si esa clave no acepta señal de afuera, avisa sin tocar nada.
   * - Si usa la "Default stream key" compartida, no tiene clave, o tiene la de otro aparato que no
   *   llegó a transmitir, crea una propia y se la asigna: así varios pueden transmitir a la vez.
   * - Si otro aparato la está transmitiendo, tira `ClaveAjena`; con `tomarAjena` sigue con esa clave.
   */
  async prepararClave(b, etiqueta, { tomarAjena = false } = {}) {
    // Se relee: la de la lista puede tener minutos y otra clave asignada.
    b = await this.api.transmision(b.id);
    if (['complete', 'revoked'].includes(b.estado)) {
      throw new ErrorDeEstado('La transmisión ya está finalizada en YouTube: no se puede volver a salir en vivo en ella. Usá otra programada.');
    }
    const asignada = b.claveId;
    if (asignada) {
      const actual = await this.api.clave(asignada);
      if (actual && actual.titulo.startsWith(PREFIJO_CLAVE)) {
        if (actual.titulo.endsWith(`[${etiqueta}]`)) return { clave: actual, creada: false, anterior: null };
        if (enCurso(b)) {
          if (tomarAjena) return { clave: actual, creada: false, anterior: null };
          throw new ClaveAjena();
        }
      } else if (actual && !esClaveDelCanal(actual)) {
        // Su propia clave: se usa tal cual, sin tocar la programada.
        if (enCurso(b) && actual.senal === 'active') {
          throw new ErrorDeEstado('Esta transmisión ya está en vivo y alguien le está mandando señal (por ejemplo ' +
            'la app de YouTube, Studio u OBS). No se puede transmitir desde MarcaVivo.');
        }
        if (esClaveDeCamara(actual)) throw new ProgramadaDeCamara();
        return { clave: actual, creada: false, anterior: null };
      } else if (actual && enCurso(b)) {
        throw new ErrorDeEstado('Esta transmisión ya está en curso con otra clave (por ejemplo desde YouTube ' +
          'Studio u OBS). No se puede transmitir desde MarcaVivo.');
      }
    }
    const sufijo = ` [${etiqueta}]`;
    let titulo = `${PREFIJO_CLAVE} - ${b.titulo}`;
    if (titulo.length + sufijo.length > 120) titulo = titulo.slice(0, 120 - sufijo.length);
    const nueva = await this.api.crearClave(titulo + sufijo);
    try {
      await this.api.asignar(b.id, nueva.id);
    } catch (e) {
      await this._borrarClave(nueva.id);
      throw e;
    }
    return { clave: nueva, creada: true, anterior: asignada };
  }

  /**
   * No se llegó a salir en vivo (falló o se canceló): deja la transmisión con la clave que tenía
   * antes, para que se pueda usar desde YouTube o desde otro celular, y borra la que se creó. Si no
   * la había creado MarcaVivo, no toca nada.
   *
   * Devuelve false si no se pudo: YouTube solo deja cambiar la clave mientras está "lista".
   */
  async devolver(idTransmision, asignada) {
    if (!asignada.creada) return true;
    const b = await this.api.transmision(idTransmision);
    if (b.claveId === asignada.clave.id) {
      if (!['created', 'ready'].includes(b.estado)) return false;
      if (asignada.anterior) await this.api.asignar(idTransmision, asignada.anterior);
      else await this.api.desasignar(idTransmision);
    }
    // Si otro celular ya le asignó la suya, solo se borra la nuestra.
    await this._borrarClave(asignada.clave.id);
    return true;
  }

  async _borrarClave(id) {
    try {
      await this.api.borrarClave(id);
    } catch (e) {
      // Si no se puede borrar queda en Studio, sin consecuencias para la transmisión.
    }
  }

  /** Confirma que la transmisión sigue asignada a `idClave` (dos celulares pueden elegirla casi a la vez). */
  async verificarClave(idTransmision, idClave) {
    const b = await this.api.transmision(idTransmision);
    if (b.claveId !== idClave) throw new ErrorDeEstado('Otro celular tomó esta transmisión recién. No se sale en vivo desde este.');
  }

  /** Espera a que YouTube reciba la señal en la clave `idClave`. `cancelado()` true corta la espera. */
  async esperarSenal(idClave, { timeoutMs = 60_000, cancelado = () => false } = {}) {
    const fin = Date.now() + timeoutMs;
    while (Date.now() < fin) {
      if (cancelado()) throw new Cancelado();
      const c = await this.api.clave(idClave);
      if (c && c.senal === 'active') return;
      await this._pausa();
    }
    if (cancelado()) throw new Cancelado();
    throw new TiempoAgotado(`YouTube no recibió la señal en ${Math.round(timeoutMs / 1000)} s.`);
  }

  /**
   * Pone la transmisión "en vivo", según el estado real en que la tiene YouTube.
   *
   * El camino se elige por lo que declara la transmisión (con monitor hay que pasar antes por "en
   * prueba"; con inicio automático alcanza con esperar), pero no todas cumplen lo que declaran: si
   * YouTube rechaza el cambio, se relee el estado y se prueba el otro camino. Si igual falla, tira
   * `PasoFallido` con el paso y el estado en que quedó.
   */
  async salirEnVivo(id) {
    let paso = 'leer la transmisión';
    const alPaso = (p) => { paso = p; };
    try {
      let b = await this.api.transmision(id);
      if (b.enVivo) {
        paso = 'esperar que YouTube la ponga en vivo';
        await this._esperarEstado(id, ['live']);
        return;
      }
      if (['complete', 'revoked'].includes(b.estado)) {
        throw new ErrorDeEstado('La transmisión ya está finalizada en YouTube: no se puede volver a salir en vivo en ella. Usá otra programada.');
      }
      if (b.autoInicio) {
        paso = 'esperar el inicio automático';
        try {
          await this._esperarEstado(id, ['live'], this.esperaInicioAutomaticoMs);
          return;
        } catch (e) {
          if (!(e instanceof TiempoAgotado)) throw e;
          // No arrancó sola: se pasa a mano.
          b = await this.api.transmision(id);
          if (b.estado === 'live') return;
        }
      }
      if (b.estado === 'testStarting') {
        paso = 'esperar que YouTube la ponga en prueba';
        await this._esperarEstado(id, ['testing']);
        b = await this.api.transmision(id);
      }
      const porPrueba = b.monitor || b.estado === 'testing';
      try {
        await this._camino(id, porPrueba, alPaso);
      } catch (e) {
        if (!(e instanceof ErrorYouTube) || e.motivo !== 'invalidTransition') throw e;
        await this._pausa(this.pausaReintentoMs);
        const ahora = await this.api.transmision(id);
        if (ahora.enVivo) {
          paso = 'esperar que YouTube la ponga en vivo';
          await this._esperarEstado(id, ['live']);
          return;
        }
        // Si ya quedó en prueba, solo falta pasar a vivo; si no, se prueba el otro camino.
        await this._camino(id, ahora.estado === 'testing' || !porPrueba, alPaso);
      }
    } catch (e) {
      if (e instanceof ErrorDeEstado) throw e;
      let estado = null;
      try { estado = (await this.api.transmision(id)).estado; } catch (e2) { /* no se pudo leer */ }
      throw new PasoFallido(paso, estado, e);
    }
  }

  /** Pasa a "en vivo", antes por "en prueba" si `porPrueba` y todavía no lo está. */
  async _camino(id, porPrueba, alPaso) {
    if (porPrueba && (await this.api.transmision(id)).estado !== 'testing') {
      alPaso('pasar a "en prueba"');
      await this._transicion(id, 'testing');
      await this._esperarEstado(id, ['testing']);
    }
    alPaso('pasar a "en vivo"');
    await this._transicion(id, 'live');
    await this._esperarEstado(id, ['live']);
  }

  /**
   * Termina la transmisión en YouTube: queda "finalizada" en Studio, y se borra la clave `idClave`
   * que creó MarcaVivo para que no se acumulen. Si nunca salió al aire (sigue programada), la deja
   * como está, con su clave, para usarla después.
   */
  async finalizar(id, { idClave = null } = {}) {
    const b = await this.api.transmision(id);
    if (['created', 'ready'].includes(b.estado)) return;
    if (!['complete', 'revoked'].includes(b.estado)) await this._transicion(id, 'complete');
    if (idClave) await this._borrarClave(idClave);
  }

  async _transicion(id, estado) {
    for (let intento = 0; ; intento++) {
      try {
        await this.api.pasarA(id, estado);
        return;
      } catch (e) {
        if (!(e instanceof ErrorYouTube)) throw e;
        if (e.motivo === 'redundantTransition') return;
        // Recién llegada la señal, YouTube a veces todavía la ve inactiva por unos segundos.
        if (e.motivo === 'errorStreamInactive' && intento < 10) {
          await this._pausa();
          continue;
        }
        throw e;
      }
    }
  }

  async _esperarEstado(id, estados, timeoutMs = 90_000) {
    const fin = Date.now() + timeoutMs;
    // Mira al menos una vez, aunque el tiempo sea cero.
    for (;;) {
      const b = await this.api.transmision(id);
      if (estados.includes(b.estado)) return;
      if (Date.now() >= fin) break;
      await this._pausa();
    }
    throw new TiempoAgotado(`YouTube no pasó la transmisión a "${estados.map(estadoLegible).join('/')}" a tiempo.`);
  }
}
