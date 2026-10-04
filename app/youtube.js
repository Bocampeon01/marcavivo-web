// Acceso a la YouTube Data API v3 con la sesión de Google. Es `lib/youtube/youtube_api.dart` de la
// app de Android en la web: canal, transmisiones programadas, claves, y lo que hace falta para salir
// en vivo en una programada (crear y asignar la clave, cambiar el estado, capítulos del video).
// Crear y borrar programadas llega con las etapas siguientes.

import { cuenta, SesionVencida } from './cuenta.js';
import { descripcionConCapitulos } from './capitulos.js';

const BASE = 'https://www.googleapis.com/youtube/v3';
const TIEMPO_MAXIMO_MS = 20_000;
const INTENTOS = 3;
const PAUSA_REINTENTO_MS = 2000;

export class ErrorYouTube extends Error {
  constructor(status, motivo, mensaje) {
    super(mensaje);
    this.name = 'ErrorYouTube';
    this.status = status;
    /** El `reason` de YouTube: quotaExceeded, liveStreamingNotEnabled... */
    this.motivo = motivo;
  }
}

/** Transmisión de YouTube (liveBroadcast), con lo que la app necesita. */
export function transmisionDeJson(j) {
  const snippet = j.snippet || {}, status = j.status || {}, details = j.contentDetails || {};
  const thumbs = snippet.thumbnails || {};
  const chica = thumbs.medium || thumbs.default;
  const grande = thumbs.maxres || thumbs.standard || thumbs.high || thumbs.medium;
  const fecha = (t) => { const d = t ? new Date(t) : null; return d && !Number.isNaN(d.getTime()) ? d : null; };
  const b = {
    id: j.id,
    titulo: snippet.title || '(sin titulo)',
    descripcion: snippet.description || '',
    /** created | ready | testStarting | testing | liveStarting | live | complete | revoked */
    estado: status.lifeCycleStatus || '',
    /** public | unlisted | private */
    privacidad: status.privacyStatus || '',
    programadaPara: fecha(snippet.scheduledStartTime),
    /** Cuándo salió al aire de verdad. Si es null, nunca transmitió. */
    salioAlAireEl: fecha(snippet.actualStartTime),
    creada: fecha(snippet.publishedAt),
    claveId: details.boundStreamId || null,
    miniatura: chica ? chica.url : null,
    miniaturaGrande: grande ? grande.url : null,
    autoInicio: !!details.enableAutoStart,
    monitor: !!(details.monitorStream && details.monitorStream.enableMonitorStream),
  };
  b.enVivo = b.estado === 'live' || b.estado === 'liveStarting';
  b.salioAlAire = b.salioAlAireEl != null || ['complete', 'live', 'liveStarting', 'testing', 'testStarting'].includes(b.estado);
  /** Se puede borrar sin riesgo: quedó programada y nunca grabó nada. */
  b.sePuedeBorrar = !b.salioAlAire && ['created', 'ready'].includes(b.estado);
  return b;
}

/**
 * Si es una de las que crea YouTube sola al programar otra (`<canal> está en vivo`) y que nadie va
 * a usar. Se piden las cuatro condiciones juntas para no esconder ninguna de verdad: el nombre por
 * defecto, la hora pegada a la creación, que nunca haya salido al aire y que no esté transmitiendo.
 */
export function pareceAutomatica(b, canal, margenMs = 2 * 60_000) {
  if (!canal || !canal.trim()) return false;
  if (b.titulo.trim().toLowerCase() !== `${canal.trim()} está en vivo`.toLowerCase()) return false;
  if (b.salioAlAire) return false;
  if (!b.creada || !b.programadaPara) return false;
  return Math.abs(b.programadaPara - b.creada) <= margenMs;
}

/**
 * Separa las transmisiones en las que sirven hoy y las viejas (pasaron su horario hace más de 6
 * horas y nunca salieron al aire). La automática de YouTube no entra en ninguna de las dos.
 */
export function separarTransmisiones(lista, { ahora = Date.now(), margenMs = 6 * 3_600_000, canal = '' } = {}) {
  const corte = ahora - margenMs;
  const vigentes = [], viejas = [];
  for (const b of lista) {
    const enCurso = b.enVivo || b.estado === 'testing' || b.estado === 'testStarting';
    if (!enCurso && pareceAutomatica(b, canal)) continue;
    // En vivo o en prueba: siempre a la vista. Las que no tienen fecha son restos viejos.
    const vieja = !enCurso && (!b.programadaPara || b.programadaPara.getTime() < corte);
    (vieja ? viejas : vigentes).push(b);
  }
  return { vigentes, viejas };
}

/** Clave de transmisión de YouTube (liveStream): a dónde se manda el video. */
export function claveDeJson(j) {
  const snippet = j.snippet || {}, cdn = j.cdn || {}, ing = cdn.ingestionInfo || {}, status = j.status || {};
  return {
    id: j.id,
    titulo: snippet.title || '',
    direccion: ing.ingestionAddress || '',
    nombre: ing.streamName || '',
    /** created | ready | active | inactive | error */
    senal: status.streamStatus || '',
    direccionSegura: ing.rtmpsIngestionAddress || '',
    /** La clave que YouTube crea sola con el canal ("Transmitir ahora"): no se borra. */
    esFija: !!snippet.isDefaultStream,
    tipo: cdn.ingestionType || '',
    /** A dónde se manda el video: la entrada cifrada (RTMPS) si YouTube la ofrece. */
    get url() {
      return `${this.direccionSegura || this.direccion}/${this.nombre}`;
    },
    /**
     * A dónde manda el video el servidor de la web app: la entrada común (RTMP), que es por donde
     * viene saliendo en todas las pruebas. La cifrada hace falta en el celular (con datos móviles
     * el puerto del RTMP común a veces no pasa), no en una PC con internet fijo.
     */
    get urlDesdeServidor() {
      return `${this.direccion || this.direccionSegura}/${this.nombre}`;
    },
  };
}

/** Clave de la cámara de la app de YouTube del celular: no tiene entrada para otros programas. */
export function esClaveDeCamara(c) {
  const delCanal = c.esFija || c.titulo.trim().toLowerCase().startsWith('default stream key');
  return !delCanal && (c.tipo === 'webrtc' || !c.direccion || !c.nombre);
}

function conTiempo(promesa, ms) {
  return new Promise((ok, mal) => {
    const t = setTimeout(() => mal(Object.assign(new Error('YouTube tardó demasiado en contestar'), { name: 'TimeoutError' })), ms);
    promesa.then((v) => { clearTimeout(t); ok(v); }, (e) => { clearTimeout(t); mal(e); });
  });
}

/** Para el registro: qué se pidió y qué contestó YouTube. Nunca lleva claves ni la llave de la sesión. */
function anotar(metodo, camino, consulta, resultado) {
  if (!youtube.alPedir) return;
  const datos = Object.entries(consulta).filter(([k]) => k !== 'part' && k !== 'maxResults').map(([k, v]) => `${k}=${v}`).join(' ');
  try { youtube.alPedir(`YT ${metodo} ${camino} ${datos} -> ${resultado}`); } catch (e) { /* el registro no puede romper nada */ }
}

async function enviar(metodo, camino, consulta, cuerpo) {
  const url = `${BASE}/${camino}?${new URLSearchParams(consulta)}`;
  const pedir = (token) => conTiempo(fetch(url, {
    method: metodo,
    headers: { Authorization: `Bearer ${token}`, ...(cuerpo ? { 'Content-Type': 'application/json' } : {}) },
    body: cuerpo ? JSON.stringify(cuerpo) : undefined,
  }), TIEMPO_MAXIMO_MS);
  // Con internet malo un pedido se puede cortar. Los que solo leen se reintentan; los que cambian
  // algo no: YouTube pudo haberlo hecho y reintentar lo haría dos veces.
  const conReintentos = async (token) => {
    for (let intento = 1; ; intento++) {
      try {
        return await pedir(token);
      } catch (e) {
        if (metodo !== 'GET' || intento >= INTENTOS) throw e;
        await new Promise((ok) => setTimeout(ok, PAUSA_REINTENTO_MS * intento));
      }
    }
  };
  let r;
  try {
    r = await conReintentos(cuenta.token());
  } catch (e) {
    anotar(metodo, camino, consulta, 'falló: ' + ((e && e.message) || e));
    throw e;
  }
  if (r.status === 401) {
    // Llave vencida o revocada: en la web no se puede pedir otra sin un toque de quien usa la app.
    anotar(metodo, camino, consulta, '401 (sesión vencida)');
    cuenta.descartar();
    throw new SesionVencida();
  }
  const texto = await r.text();
  if (!r.ok) {
    let motivo = '', mensaje = texto;
    try {
      const e = JSON.parse(texto).error;
      motivo = (e.errors && e.errors[0] && e.errors[0].reason) || '';
      mensaje = e.message || texto;
    } catch (e) { /* respuesta que no es JSON */ }
    anotar(metodo, camino, consulta, `${r.status} ${motivo}: ${String(mensaje).slice(0, 200)}`);
    throw new ErrorYouTube(r.status, motivo, mensaje);
  }
  anotar(metodo, camino, consulta, String(r.status));
  return texto ? JSON.parse(texto) : {};
}

export const youtube = {
  /** Lo pone la pantalla, si quiere dejar registro: `(texto) => {}` con cada pedido y su resultado. */
  alPedir: null,

  /** Nombre del canal de la cuenta con la que se inició sesión (null si la cuenta no tiene canal). */
  async canal() {
    const j = await enviar('GET', 'channels', { part: 'snippet', mine: 'true' });
    const c = (j.items || [])[0];
    return c ? c.snippet.title : null;
  },

  /** Transmisiones en curso y programadas del canal: primero las en vivo, después por fecha. */
  async programadas() {
    const lista = [];
    for (const estado of ['active', 'upcoming']) {
      const j = await enviar('GET', 'liveBroadcasts', { part: 'snippet,contentDetails,status', broadcastStatus: estado, maxResults: '50' });
      lista.push(...(j.items || []).map(transmisionDeJson));
    }
    lista.sort((a, b) => {
      if (a.enVivo !== b.enVivo) return a.enVivo ? -1 : 1;
      if (!a.programadaPara || !b.programadaPara) return 0;
      return a.programadaPara - b.programadaPara;
    });
    return lista;
  },

  async clavesPorId(ids) {
    const resultado = [];
    for (let i = 0; i < ids.length; i += 50) {
      const j = await enviar('GET', 'liveStreams', { part: 'snippet,cdn,status', id: ids.slice(i, i + 50).join(','), maxResults: '50' });
      resultado.push(...(j.items || []).map(claveDeJson));
    }
    return resultado;
  },

  /** Una transmisión, como está ahora en YouTube. */
  async transmision(id) {
    const j = await enviar('GET', 'liveBroadcasts', { part: 'snippet,contentDetails,status', id });
    const item = (j.items || [])[0];
    if (!item) throw new ErrorYouTube(404, 'notFound', 'La transmisión ya no existe.');
    const b = transmisionDeJson(item);
    if (this.alPedir) this.alPedir(`   "${b.titulo}" estado=${b.estado} clave=${b.claveId} monitor=${b.monitor} autoInicio=${b.autoInicio} privacidad=${b.privacidad}`);
    return b;
  },

  /** Una clave de transmisión, o null si ya no existe. */
  async clave(id) {
    const j = await enviar('GET', 'liveStreams', { part: 'snippet,cdn,status', id });
    const item = (j.items || [])[0];
    if (!item) return null;
    const c = claveDeJson(item);
    // Al registro va cómo es la clave, nunca la clave.
    if (this.alPedir) this.alPedir(`   clave "${c.titulo}" señal=${c.senal} tipo=${c.tipo} entrada=${c.direccion ? 'sí' : 'no'} segura=${c.direccionSegura ? 'sí' : 'no'} nombre=${c.nombre ? 'sí' : 'no'}`);
    return c;
  },

  /** Crea una clave nueva, de un solo uso, con resolución y cuadros por segundo detectados por YouTube. */
  async crearClave(titulo) {
    const j = await enviar('POST', 'liveStreams', { part: 'snippet,cdn,contentDetails,status' }, {
      snippet: { title: titulo },
      cdn: { ingestionType: 'rtmp', resolution: 'variable', frameRate: 'variable' },
      contentDetails: { isReusable: false },
    });
    return claveDeJson(j);
  },

  borrarClave(id) {
    return enviar('DELETE', 'liveStreams', { id });
  },

  /** Asigna la clave `idClave` a la transmisión `idTransmision`. */
  asignar(idTransmision, idClave) {
    return enviar('POST', 'liveBroadcasts/bind', { id: idTransmision, part: 'id,contentDetails', streamId: idClave });
  },

  /** Le saca la clave a la transmisión (queda sin ninguna, como recién creada). */
  desasignar(idTransmision) {
    return enviar('POST', 'liveBroadcasts/bind', { id: idTransmision, part: 'id,contentDetails' });
  },

  /** Cambia el estado de la transmisión: testing | live | complete. */
  pasarA(idTransmision, estado) {
    return enviar('POST', 'liveBroadcasts/transition', { broadcastStatus: estado, id: idTransmision, part: 'status' });
  },

  /**
   * Pone los `capitulos` al final de la descripción del video `idVideo` (YouTube los muestra como
   * capítulos). Lo que ya decía la descripción se respeta.
   */
  async ponerCapitulos(idVideo, capitulos) {
    const j = await enviar('GET', 'videos', { part: 'snippet', id: idVideo });
    const item = (j.items || [])[0];
    if (!item) throw new ErrorYouTube(404, 'notFound', 'El video ya no existe.');
    const snippet = item.snippet || {};
    // Al cambiar el snippet YouTube pide título y categoría, y borra lo que no se manda (etiquetas,
    // idioma): se reenvía todo lo que tenía.
    const nuevo = { description: descripcionConCapitulos(snippet.description || '', capitulos) };
    for (const k of ['title', 'categoryId', 'tags', 'defaultLanguage', 'defaultAudioLanguage']) {
      if (snippet[k] != null) nuevo[k] = snippet[k];
    }
    await enviar('PUT', 'videos', { part: 'snippet' }, { id: idVideo, snippet: nuevo });
  },

  /**
   * Ids de las programadas hechas con la app de YouTube del celular (traen la clave de su cámara y
   * no sirven para MarcaVivo). Si no se puede averiguar, devuelve vacío: la lista se muestra igual.
   */
  async hechasConElCelular(lista) {
    const porClave = new Map();
    for (const b of lista) {
      if (!b.enVivo && b.claveId && ['created', 'ready'].includes(b.estado)) porClave.set(b.claveId, b.id);
    }
    if (!porClave.size) return new Set();
    try {
      const claves = await this.clavesPorId([...porClave.keys()]);
      return new Set(claves.filter((c) => esClaveDeCamara(c) && porClave.has(c.id)).map((c) => porClave.get(c.id)));
    } catch (e) {
      if (e instanceof SesionVencida) throw e;
      return new Set();
    }
  },
};

/** Mensaje en castellano, para quien usa la app, de un error de la sesión o de YouTube. */
export function describirError(e) {
  if (e instanceof SesionVencida) return 'La sesión de Google venció. Tocá INICIAR SESION para seguir.';
  if (e instanceof ErrorYouTube) {
    switch (e.motivo) {
      case 'accessNotConfigured':
        return 'La API de YouTube no está habilitada en el proyecto de Google Cloud.';
      case 'liveStreamingNotEnabled':
        return 'Este canal no tiene habilitada la transmisión en vivo.';
      case 'insufficientPermissions':
      case 'forbidden':
        return 'Falta el permiso de YouTube. Tocá CAMBIAR CUENTA y aceptá los permisos.';
      case 'quotaExceeded':
        return 'Se agotó la cuota diaria de la API de YouTube. Se renueva a medianoche (hora del Pacífico).';
      case 'notFound':
      case 'liveBroadcastNotFound':
        return 'La transmisión ya no existe en YouTube. Actualizá la lista.';
      case 'invalidTransition':
        return `YouTube no permite ese cambio de estado ahora (${e.message}).`;
      default:
        return 'YouTube respondió un error: ' + e.message;
    }
  }
  // Errores de la ventana de Google.
  if (e && e.tipo === 'popup_closed') return 'Se cerró la ventana de Google antes de terminar.';
  if (e && e.tipo === 'popup_failed_to_open') return 'El navegador no dejó abrir la ventana de Google. Permití las ventanas emergentes para esta página y probá de nuevo.';
  if (e && e.tipo === 'access_denied') return 'No se aceptó el permiso de YouTube: sin ese permiso MarcaVivo no puede ver las programadas.';
  if (e && e.tipo === 'sin_permiso') return 'Falta tildar el permiso de YouTube en la ventana de Google. Tocá INICIAR SESION y aceptalo.';
  // Internet malo o sin conexión.
  if (e && (e.name === 'TimeoutError' || e.name === 'TypeError')) {
    return (typeof navigator !== 'undefined' && navigator.onLine === false)
      ? 'Sin internet. Revisá el wifi o los datos del celular y tocá REINTENTAR.'
      : 'Conexión mala con YouTube: se cortó o está muy lenta. Revisá el wifi o los datos del celular y tocá REINTENTAR.';
  }
  return 'Error: ' + ((e && e.message) || e);
}
