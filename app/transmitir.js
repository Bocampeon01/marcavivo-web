// Pantalla de transmisión: vista previa con el marcador, botón para salir en vivo y los controles
// del partido. Es stream_page.dart + match_controls.dart de la app de Android, en la web.

import { Partido, ConfigPartido } from './partido.js';
import { Marcador, cargarLetra, color } from './marcador.js';
import { servidor, VERSION } from './servidor.js';
import { Envio } from './envio.js';
import { Logos } from './logos.js';
import { cuenta, SesionVencida } from './cuenta.js';
import { youtube, describirError } from './youtube.js';
import { EnVivo, PREFIJO_CLAVE, ClaveAjena, ProgramadaDeCamara, ErrorDeEstado, TiempoAgotado, Cancelado, PasoFallido, estadoLegible, etiquetaDelAparato } from './envivo.js';
import { armarCapitulos, MINIMO_CAPITULOS } from './capitulos.js';
import { $, icono, escapar, avisar, cartel, cabecera, elegir, confirmar, explicar, pedirNumero, pedirPin, ir } from './ui.js';

const parametros = servidor.parametros;

// El servidor pide un PIN cuando se entra desde afuera de la PC del servidor.
servidor.pedirPin = pedirPin;

/** Con `?t=<id>` se transmite en esa programada de YouTube; sin eso, a la clave que tiene el servidor. */
const idProgramada = /^[A-Za-z0-9_-]{5,40}$/.test(parametros.get('t') || '') ? parametros.get('t') : '';
const automatico = !!idProgramada;

// ---- Registro -----------------------------------------------------------------------------------
// Lo que va pasando (toques, estados, pedidos a YouTube y qué contestó) se manda al servidor y queda
// en servidor/informes.log, para revisar una prueba sin depender de capturas. Nunca lleva claves.
const pendientes = [];
function anotar(texto) {
  pendientes.push(`${new Date().toLocaleTimeString('es-AR', { hour12: false })} ${texto}`);
  if (pendientes.length > 80) pendientes.shift();
}
let mandandoRegistro = false;
setInterval(async () => {
  // Hasta que el servidor no aceptó el PIN no se manda nada (queda esperando): pedidos repetidos
  // con un PIN viejo harían que el servidor frene a este celular por un minuto.
  if (mandandoRegistro || !pendientes.length || !servidor.entro) return;
  mandandoRegistro = true;
  const n = Math.min(10, pendientes.length);
  const r = await servidor.informar('REGISTRO | ' + pendientes.slice(0, n).join(' | '));
  if (r && r.ok) pendientes.splice(0, n);
  mandandoRegistro = false;
}, 3000);
youtube.alPedir = anotar;

// ---- Partido y marcador -------------------------------------------------------------------------
const CONFIG_POR_DEFECTO = {
  local: { nombre: 'All Boys', color1: 0xFFFFFFFF, color2: 0xFF111111 },
  visita: { nombre: 'Visitante', color1: 0xFF1565C0, color2: 0xFFD32F2F },
  minutos: 30,
  tiempos: 2,
};
/** Cada programada tiene su partido guardado; sin programada, el de siempre. */
const CLAVE = idProgramada || 'manual';
const partido = Partido.cargar(CLAVE) || new Partido(ConfigPartido.ultima() || CONFIG_POR_DEFECTO, { clave: CLAVE });

const lienzo = $('lienzo');
const W = 1280, H = 720;
// Sin transparencia y sin esperar al compositor: menos trabajo por cuadro en celulares de gama media.
const ctx = lienzo.getContext('2d', { alpha: false, desynchronized: true });
const marcador = new Marcador(partido, { ancho: W, alto: H });
const cam = $('cam');
let flujo = null;
let dibujos = 0, dibujoFps = 0;
setInterval(() => { dibujoFps = dibujos; dibujos = 0; }, 1000);

// El video llena el cuadro 16:9 sin deformarse: lo que sobra se recorta.
function dibujar() {
  const vw = cam.videoWidth, vh = cam.videoHeight;
  if (flujo && cam.readyState >= 2 && vw && vh) {
    const escala = Math.max(W / vw, H / vh);
    const sw = W / escala, sh = H / escala;
    ctx.drawImage(cam, (vw - sw) / 2, (vh - sh) / 2, sw, sh, 0, 0, W, H);
  } else {
    ctx.fillStyle = '#0B0E12';
    ctx.fillRect(0, 0, W, H);
  }
  marcador.pintar(ctx);
  dibujos++;
}
function bucle() {
  dibujar();
  if (cam.requestVideoFrameCallback) cam.requestVideoFrameCallback(bucle);
  else requestAnimationFrame(bucle);
}
// Sin cámara el lienzo igual se redibuja (se ve el marcador).
setInterval(() => { if (!flujo) dibujar(); }, 200);

// ---- Cámara, micrófono y zoom -------------------------------------------------------------------
let microfono = true;
async function abrirCamara() {
  $('sinCamara').hidden = false;
  $('sinCamara').innerHTML = '<span>Iniciando cámara…</span>';
  try {
    if (flujo) flujo.getTracks().forEach((t) => t.stop());
    flujo = null;
    const f = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 }, facingMode: { ideal: parametros.get('camara') === 'frontal' ? 'user' : 'environment' } },
      audio: { echoCancellation: true, noiseSuppression: true },
    });
    cam.srcObject = f;
    await cam.play();
    flujo = f;
    $('sinCamara').hidden = true;
    bucle();
    prepararZoom();
    await mantenerPantalla();
    const v = f.getVideoTracks()[0].getSettings();
    lineas.camara = `Cámara: ${v.width}x${v.height} a ${Math.round(v.frameRate || 0)} fps` + (f.getAudioTracks().length ? ' + micrófono' : ' (sin micrófono)');
  } catch (e) {
    const sinPermiso = e && (e.name === 'NotAllowedError' || e.name === 'SecurityError');
    $('sinCamara').innerHTML = `<span>${sinPermiso
      ? 'MarcaVivo necesita la cámara y el micrófono. Dales permiso en el navegador y tocá REINTENTAR.'
      : 'No se pudo abrir la cámara: ' + escapar(e.message || e)}</span><button class="lleno" id="bCamara">REINTENTAR</button>`;
    $('bCamara').onclick = abrirCamara;
    lineas.camara = 'Cámara: no se pudo abrir (' + (e.message || e) + ')';
  }
  pintar();
}

function pintarMic() {
  $('bMic').innerHTML = icono(microfono ? 'mic' : 'micNo');
  $('bMic').classList.toggle('apagado', !microfono);
  $('bMic').title = microfono ? 'Silenciar el micrófono' : 'Prender el micrófono';
}
$('bMic').onclick = () => {
  const pista = flujo && flujo.getAudioTracks()[0];
  if (!pista) return avisar('Este celular no dio el micrófono.');
  microfono = !microfono;
  pista.enabled = microfono;
  pintarMic();
  avisar(microfono ? 'Micrófono prendido.' : 'Micrófono silenciado: la transmisión sigue, pero sin sonido.');
};

// Zoom de la cámara: solo si el lente lo permite (en iPhone no hay).
function prepararZoom() {
  const pista = flujo && flujo.getVideoTracks()[0];
  let c = null;
  try { c = pista && pista.getCapabilities ? pista.getCapabilities().zoom : null; } catch (e) { /* sin datos */ }
  if (!c || !(c.max > c.min)) { $('zoom').hidden = true; return; }
  const barra = $('zoomBarra');
  barra.min = c.min; barra.max = c.max; barra.step = c.step || 0.1;
  barra.value = pista.getSettings().zoom || c.min;
  $('zoomTxt').textContent = Number(barra.value).toFixed(1) + 'x';
  barra.oninput = () => {
    $('zoomTxt').textContent = Number(barra.value).toFixed(1) + 'x';
    pista.applyConstraints({ advanced: [{ zoom: Number(barra.value) }] }).catch(() => {});
  };
  $('zoom').hidden = false;
}

// ---- Pantalla encendida -------------------------------------------------------------------------
// El navegador suelta el pedido cada vez que la página deja de estar al frente: se vuelve a pedir.
const lineas = { version: 'Pantalla nueva · versión ' + VERSION };
let bloqueo = null, recuperada = 0, vecesOculta = 0;
async function mantenerPantalla() {
  if (!('wakeLock' in navigator)) { lineas.wake = 'Pantalla encendida: NO (este navegador no lo permite)'; return; }
  try {
    const b = await navigator.wakeLock.request('screen');
    bloqueo = b;
    lineas.wake = 'Pantalla encendida: sí' + (recuperada ? ` (recuperada ${recuperada} veces)` : '');
    b.addEventListener('release', () => {
      if (bloqueo === b) bloqueo = null;
      lineas.wake = 'Pantalla encendida: NO (el navegador la soltó)';
    });
  } catch (e) {
    lineas.wake = 'Pantalla encendida: NO (' + e.message + ')';
  }
}
document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState !== 'visible') { vecesOculta++; return; }
  if (flujo && !bloqueo) { recuperada++; await mantenerPantalla(); }
});

// ---- Red: wifi o datos móviles ------------------------------------------------------------------
// El iPhone no deja saber con qué red está: lo elige quien transmite. Cambia el tope de envío.
const TOPES = { wifi: 4000, datos: 2500 };
let red = 'wifi';
try { if (localStorage.getItem('red') === 'datos') red = 'datos'; } catch (e) { /* sin almacenamiento */ }
const topePedido = Number(parametros.get('tope'));
const topeKbps = () => (topePedido >= 500 && topePedido <= 6000 ? topePedido : TOPES[red]);
$('bRed').onclick = () => {
  if (estado !== 'detenido') return avisar('La red se elige antes de salir en vivo.');
  red = red === 'wifi' ? 'datos' : 'wifi';
  try { localStorage.setItem('red', red); } catch (e) { /* sin almacenamiento */ }
  pintar();
  avisar(red === 'wifi' ? 'Wifi: máxima calidad (4.000 kbps).' : 'Datos móviles: más estable con poca señal (2.500 kbps).');
};

// ---- Salir en vivo ------------------------------------------------------------------------------
// Dos modos. Con una programada de YouTube elegida en el inicio (automático): se le prepara la
// clave, el servidor manda el video a esa clave y se la pasa a "en vivo"; al terminar se finaliza.
// Sin programada (manual): el servidor manda el video a la clave que tiene cargada.

/**
 * 'detenido' | 'preparando' | 'conectando' | 'esperandoYouTube' | 'enVivo' | 'deteniendo' | 'finalizando'
 * ('preparando', 'esperandoYouTube' y 'deteniendo' solo pasan con una programada).
 */
let estado = 'detenido';
/** Estados en los que este celular le está mandando el video al servidor. */
const ENVIANDO = ['conectando', 'esperandoYouTube', 'enVivo'];
let envio = null;
let medida = null;
let mensaje = '';
let desdeVivo = 0;
let saliendo = false;      // ya se le pidió al servidor que salga
let reconectando = false;
let intentando = false;    // hay una reconexión en marcha
let cortesSeguidos = 0;
let relanzos = 0;          // veces que hubo que pedirle de nuevo al servidor que salga
let destinoActual;         // a dónde se le pide al servidor que salga (sin nada: la clave que tiene cargada)
let conexion = null;       // { ok, mal }: se cumple cuando el servidor empezó a mandar el video

const pausa = (ms) => new Promise((ok) => setTimeout(ok, ms));

function ponerEstado(nuevo, texto = '') {
  if (nuevo !== estado) anotar('estado: ' + nuevo);
  estado = nuevo;
  mensaje = texto;
  pintar();
}

function nuevoEnvio() {
  const pista = flujo ? flujo.getAudioTracks()[0] || null : null;
  envio = new Envio(lienzo, pista, {
    topeKbps: topeKbps(),
    sinDemora: parametros.get('sindemora') !== '0',
    forzarRelay: parametros.get('relay') === '1',
    alCambiar: alMedir,
  });
  return envio.conectar();
}

/** Modo manual: conecta con el servidor y, cuando sube la calidad, sale a la clave que tiene cargada. */
async function salirEnVivo() {
  if (!flujo) return avisar('Primero hay que abrir la cámara.');
  saliendo = false; reconectando = false; cortesSeguidos = 0; relanzos = 0; medida = null;
  ponerEstado('conectando', 'Conectando con el servidor…');
  try {
    await nuevoEnvio();
  } catch (e) {
    if (estado !== 'conectando') return;
    detener('No se pudo salir en vivo: ' + e.message);
  }
}

/** Llega cada 2 segundos con lo que mide el envío, y cuando cambia la conexión. */
function alMedir(m) {
  medida = m;
  if (!ENVIANDO.includes(estado)) return;
  if (m.conexion === 'failed' || m.conexion === 'closed') return reconectar();
  if (m.conexion === 'connected') cortesSeguidos = 0;
  // Al salir por primera vez se espera a que suba la calidad; al reconectar, apenas hay conexión.
  if (!saliendo && m.conexion === 'connected' && (m.listo || (reconectando && m.kbps > 0))) pedirSalida();
  if (estado === 'conectando' && !saliendo) {
    mensaje = m.conexion === 'connected'
      ? `Subiendo la calidad: ${m.kbps} de ${envio.topeKbps} kbps. Sale sola al llegar.`
      : 'Conectando con el servidor…';
  }
  pintar();
}

/** Le pide al servidor que empiece a mandar el video a `destinoActual`. */
async function pedirSalida() {
  saliendo = true;
  try {
    let s = await servidor.estado(true).catch(() => null);
    // Si por esta ruta quedó saliendo otra cosa (otra programada, o la clave del servidor), se
    // corta y se sale de nuevo: el video no puede ir a parar a otra transmisión.
    if (s && s.transmitiendo && s.marca != null && s.marca !== CLAVE) {
      anotar(`el servidor estaba saliendo con "${s.marca}": se corta y se sale de nuevo`);
      await servidor.cortar();
      for (let i = 0; i < 12 && s && s.transmitiendo; i++) {
        await pausa(500);
        s = await servidor.estado(false).catch(() => null);
      }
    }
    if (!s || !s.transmitiendo) await servidor.salir(destinoActual, CLAVE);
    if (!ENVIANDO.includes(estado)) return;
    if (conexion) {
      // Con una programada todavía falta YouTube: sigue salirConProgramada.
      const c = conexion;
      conexion = null;
      c.ok();
    } else if (estado === 'conectando') {
      desdeVivo = Date.now();
      estado = 'enVivo';
    }
    reconectando = false;
    if (estado === 'enVivo') mensaje = '';
  } catch (e) {
    if (ENVIANDO.includes(estado)) fallaEnvio('No se pudo salir en vivo: ' + e.message);
  }
  pintar();
}

/** Se cortó la conexión con el servidor: se vuelve a conectar sola, hasta 6 veces seguidas. */
async function reconectar() {
  if (intentando) return;
  cortesSeguidos++;
  if (cortesSeguidos > 6) return fallaEnvio('Se cortó la conexión con el servidor y no se pudo recuperar. Revisá internet y volvé a salir.');
  intentando = true;
  reconectando = true;
  saliendo = false;
  mensaje = 'Se cortó la conexión con el servidor. Reconectando…';
  pintar();
  if (envio) envio.cerrar();
  await pausa(2500);
  const sigue = () => ENVIANDO.includes(estado);
  try {
    if (sigue()) await nuevoEnvio();
  } catch (e) {
    setTimeout(() => { if (sigue()) reconectar(); }, 2000);
  } finally {
    intentando = false;
  }
}

/** Falló el envío al servidor. Si todavía se estaba saliendo en una programada, frena ese intento. */
function fallaEnvio(texto) {
  if (automatico && (estado === 'conectando' || estado === 'esperandoYouTube')) frenar(texto);
  else detener(texto);
}

function detener(texto = '') {
  if (envio) envio.cerrar();
  envio = null;
  medida = null;
  saliendo = false; reconectando = false;
  ponerEstado('detenido', texto);
  if (texto) avisar(texto, 7000);
}

/** Deja de mandar el video: cierra el envío y le avisa al servidor que corte. */
async function pararSenal() {
  if (envio) envio.cerrar();
  envio = null;
  medida = null;
  saliendo = false; reconectando = false;
  try { await servidor.cortar(); } catch (e) { /* el servidor corta solo cuando deja de llegarle el video */ }
}

async function cortar() {
  if (!(await confirmar('Cortar', '¿Cortar la transmisión?', 'CORTAR', 'SEGUIR'))) return;
  if (estado !== 'enVivo') return;
  ponerEstado('finalizando');
  let error = '';
  try { await servidor.cortar(); } catch (e) { error = e.message; }
  detener(error ? 'No se pudo avisar al servidor que corte: ' + error : '');
  if (!error) avisar('Transmisión cortada.');
}

// ---- Con una programada de YouTube --------------------------------------------------------------
const enVivo = new EnVivo(youtube);
/** Código de este aparato: va en el título de las claves que crea, para reconocer la propia. */
const ETIQUETA = automatico ? etiquetaDelAparato() : '';
/** La transmisión elegida. Al abrir se sabe lo que se guardó al elegirla; después se relee de YouTube. */
let programada = { id: idProgramada, titulo: '', enVivo: false, ...(programadaGuardada() || {}) };
/** Está en vivo en YouTube, aunque este celular no esté mandando señal. */
let enVivoEnYouTube = !!programada.enVivo;
/** Falló la finalización (por ejemplo sin internet): el botón ofrece reintentarla. */
let finalizarPendiente = false;
/** Clave de YouTube que usa esta transmisión. */
let claveActual = null;
/** Por qué se frena el intento de salir en vivo: 'cancelado', o el error del envío. Vacío: sigue. */
let motivoCorte = '';
/** Ya se le pidió a YouTube el paso a "en vivo": desde acá no se puede cancelar. */
let pasando = false;
/** El celular bloqueó la ventana de Google: en el próximo toque se pide antes que nada. */
let renovarPrimero = false;

function programadaGuardada() {
  try {
    const p = JSON.parse(localStorage.getItem('programada') || 'null');
    return p && p.id === idProgramada ? { titulo: String(p.titulo || ''), enVivo: !!p.enVivo } : null;
  } catch (e) {
    return null;
  }
}

/** Relee la programada de YouTube: el título y, sobre todo, si ya está en vivo (para RETOMAR). */
async function leerProgramada() {
  if (!cuenta.activa) return pintar();
  try {
    programada = await youtube.transmision(idProgramada);
    enVivoEnYouTube = programada.enVivo;
    if (estado === 'detenido' && ['complete', 'revoked'].includes(programada.estado)) {
      mensaje = 'Esta transmisión ya está finalizada en YouTube: no se puede volver a salir en vivo en ella.';
    }
  } catch (e) {
    if (estado === 'detenido') mensaje = textoFallo(e);
  }
  pintar();
}

/**
 * Antes de un paso largo se mira que a la sesión de Google le quede tiempo; si no, se abre la
 * ventana de Google para renovarla (suele cerrarse sola). Devuelve false si no se pudo.
 */
async function asegurarSesion(minutos) {
  try {
    await cuenta.asegurar(minutos);
    renovarPrimero = false;
    return true;
  } catch (e) {
    renovarPrimero = !!e && e.tipo === 'popup_failed_to_open';
    anotar('no se pudo renovar la sesión de Google: ' + ((e && (e.tipo || e.message)) || e));
    avisar(renovarPrimero ? 'El celular no dejó abrir la ventana de Google. Tocá el botón de nuevo.' : describirError(e), 7000);
    pintar();
    return false;
  }
}

/** Qué salió mal, en castellano; si fue el cambio de estado en YouTube, en qué paso y cómo quedó. */
function textoFallo(e) {
  if (e instanceof PasoFallido) return `No se pudo ${e.paso}: ${textoFallo(e.causa)}\nEstado en YouTube: ${estadoLegible(e.estado)}.`;
  if (e instanceof ErrorDeEstado || e instanceof TiempoAgotado) return e.message;
  if (e instanceof SesionVencida) return 'La sesión de Google venció. Tocá el botón de nuevo para renovarla.';
  return describirError(e);
}

/** Frena el intento de salir en vivo: lo canceló quien transmite, o falló el envío al servidor. */
function frenar(motivo) {
  if (!motivoCorte) motivoCorte = motivo;
  if (conexion) {
    const c = conexion;
    conexion = null;
    c.mal(new Cancelado());
  }
  // Si YouTube ya está pasando a "en vivo" hay que esperar a que termine.
  if (!pasando && estado !== 'detenido') ponerEstado('deteniendo', motivo === 'cancelado' ? 'Cancelando…' : motivo);
}

/** Conecta con el servidor y espera a que empiece a mandarle el video a YouTube. */
function conectarConServidor() {
  saliendo = false; reconectando = false; cortesSeguidos = 0; relanzos = 0; medida = null;
  return new Promise((ok, mal) => {
    conexion = { ok, mal };
    nuevoEnvio().catch((e) => frenar('No se pudo conectar con el servidor: ' + e.message));
  });
}

async function salirConProgramada() {
  if (!flujo) return avisar('Primero hay que abrir la cámara.');
  const retomar = enVivoEnYouTube;
  const titulo = programada.titulo || 'la programada elegida';
  const seguir = await confirmar(
    retomar ? 'Retomar la transmisión' : 'Salir en vivo',
    retomar
      ? `"${titulo}" ya está en vivo en YouTube. Se vuelve a mandar la señal desde este celular.`
      : `Vas a salir EN VIVO en YouTube en:\n\n"${titulo}"` + (servidor.destino === 'local' ? '\n\n(Ensayo: el video no sale a YouTube.)' : ''),
    retomar ? 'RETOMAR' : 'SALIR EN VIVO', 'CANCELAR', { ic: retomar ? 'repetir' : 'camara' });
  if (!seguir || estado !== 'detenido') return;
  if (!(await asegurarSesion(10))) return;
  anotar(`toca ${retomar ? 'RETOMAR' : 'SALIR EN VIVO'} en "${titulo}" (${idProgramada})`);

  motivoCorte = '';
  finalizarPendiente = false;
  pasando = false;
  const frenado = () => !!motivoCorte;
  // Clave que se le asignó a la programada: si no se llega a salir en vivo, se le devuelve la que
  // tenía, para que se pueda usar desde YouTube (ver EnVivo.devolver).
  let asignada = null, salio = false, error = null;
  try {
    ponerEstado('preparando');
    try {
      asignada = await enVivo.prepararClave(programada, ETIQUETA);
    } catch (e) {
      if (e instanceof ProgramadaDeCamara) {
        // Hecha con la app de YouTube del celular: no sirve para MarcaVivo. No se toca nada.
        ponerEstado('detenido');
        await explicar('Hecha con el celular',
          'Esta programada se creó con la app de YouTube del celular y no sirve para MarcaVivo. No se tocó nada.\n\n' +
          'Se puede convertir desde la app de Android (queda igual, con un link nuevo), o crear una nueva con PROGRAMAR.', 'ENTENDIDO', { ic: 'celular' });
        return;
      }
      if (!(e instanceof ClaveAjena)) throw e;
      const tomar = await confirmar('Otro celular estaba transmitiendo',
        'Este partido lo estaba transmitiendo otro celular. Seguí desde este SOLO si el otro ya no transmite (se apagó, se quedó ' +
        'sin batería o se cortó). Si los dos mandan señal a la vez, la transmisión se va a ver mal.', 'SEGUIR DESDE ESTE', 'CANCELAR');
      if (!tomar) return ponerEstado('detenido');
      asignada = await enVivo.prepararClave(programada, ETIQUETA, { tomarAjena: true });
    }
    claveActual = asignada.clave;
    if (frenado()) throw new Cancelado();

    destinoActual = claveActual.urlDesdeServidor;
    ponerEstado('conectando', 'Conectando con el servidor…');
    await conectarConServidor();
    if (frenado()) throw new Cancelado();

    ponerEstado('esperandoYouTube', 'El servidor ya manda el video. Esperando que YouTube lo reciba…');
    await enVivo.esperarSenal(claveActual.id, { cancelado: frenado });
    if (frenado()) throw new Cancelado();
    pasando = true;
    mensaje = 'YouTube ya recibe el video. Pasando a en vivo…';
    pintar();
    await enVivo.verificarClave(idProgramada, claveActual.id);
    await enVivo.salirEnVivo(idProgramada);
    salio = true;
  } catch (e) {
    error = e;
  }
  pasando = false;

  if (salio) {
    enVivoEnYouTube = true;
    if (motivoCorte) {
      // Quedó en vivo en YouTube, pero en el medio se perdió el envío: se retoma con RETOMAR.
      await pararSenal();
      ponerEstado('detenido');
      await explicar('Se cortó el envío', motivoCorte + '\n\nLa transmisión quedó en vivo en YouTube: tocá RETOMAR.', 'ENTENDIDO', { ic: 'camaraNo' });
      return;
    }
    desdeVivo = Date.now();
    ponerEstado('enVivo');
    avisar(retomar ? 'Transmisión retomada.' : 'En vivo en YouTube.');
    return;
  }

  // No se salió (falló o se canceló): se corta el video y la programada vuelve a como estaba.
  if (!(error instanceof Cancelado)) anotar('no se pudo salir en vivo: ' + ((error && error.message) || error));
  if (estado !== 'deteniendo') ponerEstado('deteniendo', 'Un momento…');
  await pararSenal();
  const quedo = retomar ? '' : await devolverProgramada(asignada);
  if (motivoCorte === 'cancelado') {
    ponerEstado('detenido');
    avisar('Cancelado.' + (retomar ? '' : ' La transmisión sigue programada en YouTube.'));
    return;
  }
  // Un cartel, no un aviso que se va solo: hay que alcanzar a leerlo.
  ponerEstado('detenido');
  await explicar('No se pudo salir en vivo', (motivoCorte || textoFallo(error)) + quedo, 'ENTENDIDO', { ic: 'camaraNo' });
}

/** Deja la programada con la clave que tenía antes y dice cómo quedó, para sumarlo al mensaje de error. */
async function devolverProgramada(asignada) {
  if (!asignada) return '';
  if (!asignada.creada) {
    // Se transmitió a la clave propia de la programada: no se le cambió nada.
    return asignada.clave.titulo.startsWith(PREFIJO_CLAVE) ? '' : '\nLa programada no se modificó: se puede usar desde la app de YouTube.';
  }
  try {
    if (await enVivo.devolver(idProgramada, asignada)) {
      if (claveActual && claveActual.id === asignada.clave.id) claveActual = null;
      return '\nLa programada quedó como estaba: se puede usar desde YouTube.';
    }
    return '\nLa programada ya pasó a "en prueba" con la clave de este celular: tocá SALIR EN VIVO para reintentar desde acá.';
  } catch (e) {
    return '\nNo se pudo dejar la programada como estaba: ' + textoFallo(e);
  }
}

/** La clave que hay que borrar al finalizar: solo las que creó MarcaVivo. */
async function claveParaBorrar() {
  let c = claveActual;
  if (!c) {
    // La página se recargó en medio de la transmisión: se mira cuál tiene asignada, y solo cuenta
    // si es la de este aparato.
    const b = await youtube.transmision(idProgramada);
    c = b.claveId ? await youtube.clave(b.claveId) : null;
    if (c && !c.titulo.endsWith(`[${ETIQUETA}]`)) c = null;
  }
  return c && c.titulo.startsWith(PREFIJO_CLAVE) ? c.id : null;
}

async function finalizar({ preguntar = true } = {}) {
  if (preguntar && !(await confirmar('Finalizar la transmisión',
    'Se corta la transmisión y queda FINALIZADA en YouTube. No se puede volver a salir en vivo en esta misma programada.',
    'FINALIZAR', 'CANCELAR', { ic: 'stop', peligro: true }))) return;
  if (estado !== 'enVivo' && estado !== 'detenido') return;
  // Un partido dura más que la sesión de Google: casi siempre hay que renovarla acá.
  if (!(await asegurarSesion(3))) return;
  anotar('toca FINALIZAR');
  ponerEstado('finalizando');
  let error = '';
  try {
    await enVivo.finalizar(idProgramada, { idClave: await claveParaBorrar() });
  } catch (e) {
    error = textoFallo(e);
  }
  await pararSenal();
  if (error) {
    // El video ya se cortó; la transmisión puede seguir abierta en YouTube.
    finalizarPendiente = true;
    ponerEstado('detenido', 'La transmisión puede seguir abierta en YouTube: tocá REINTENTAR FINALIZAR.');
    await explicar('No se pudo finalizar', `No se pudo finalizar en YouTube: ${error}\n\nEl video ya se cortó. Tocá REINTENTAR FINALIZAR.`, 'ENTENDIDO', { ic: 'stop' });
    return;
  }
  enVivoEnYouTube = false;
  finalizarPendiente = false;
  claveActual = null;
  const capitulos = await marcarCapitulos();
  ponerEstado('detenido');
  await explicar('Transmisión finalizada', 'La transmisión quedó finalizada en YouTube.' + (capitulos ? '\n\n' + capitulos : ''),
    'VOLVER AL INICIO', { ic: 'listo', fijo: true });
  // Partido terminado: que no se ofrezca retomarlo.
  partido.cerrar();
  Partido.borrar(CLAVE);
  ir('./', { t: null });
}

/**
 * Pone los momentos del partido (inicio de cada tiempo, entretiempo, goles y final) como capítulos
 * del video en YouTube. Devuelve qué pasó, para avisarle a quien transmite, o '' si no había nada
 * que marcar. Si falla, la transmisión ya está finalizada igual.
 */
async function marcarCapitulos() {
  const marcas = partido.marcas;
  if (!marcas.length) return '';
  try {
    const b = await youtube.transmision(idProgramada);
    if (!b.salioAlAireEl) return ''; // nunca salió al aire: no hay video
    const capitulos = armarCapitulos(marcas, b.salioAlAireEl.getTime());
    anotar(capitulos.length ? 'capítulos: ' + capitulos.join(' | ') : `capítulos: menos de ${MINIMO_CAPITULOS}, no se ponen`);
    if (!capitulos.length) return '';
    await youtube.ponerCapitulos(idProgramada, capitulos);
    return 'Goles y tiempos marcados en el video.';
  } catch (e) {
    anotar('no se pudieron poner los capítulos: ' + ((e && e.message) || e));
    return 'No se pudieron marcar los goles en el video: ' + textoFallo(e);
  }
}

$('bPrincipal').onclick = async () => {
  if (!automatico) {
    if (estado === 'detenido') salirEnVivo();
    else if (estado === 'conectando') detener('Cancelado.');
    else if (estado === 'enVivo') cortar();
    return;
  }
  if (estado === 'detenido') {
    // Si la vez anterior el celular bloqueó la ventana de Google, se pide en este mismo toque,
    // antes de preguntar nada.
    if (renovarPrimero && !(await asegurarSesion(10))) return;
    if (finalizarPendiente) finalizar({ preguntar: false });
    else salirConProgramada();
  } else if (estado === 'enVivo') {
    finalizar();
  } else if (['preparando', 'conectando', 'esperandoYouTube'].includes(estado) && !pasando) {
    anotar('toca CANCELAR');
    frenar('cancelado');
  }
};
// Está en vivo en YouTube pero este celular no manda video (se recargó la página, o el partido
// terminó y nadie lo finalizó): se puede finalizar sin retomar.
$('bFinalizar').onclick = () => { if (automatico && estado === 'detenido') finalizar(); };

// Mientras está al aire se mira que el servidor siga transmitiendo, y se le manda lo que muestra
// esta pantalla (queda en servidor/informes.log para revisar una prueba después).
let fallosEstado = 0;
setInterval(async () => {
  if (estado !== 'enVivo' || reconectando || !saliendo) return;
  try {
    const s = await servidor.estado(false);
    fallosEstado = 0;
    if (!s.transmitiendo && estado === 'enVivo' && !reconectando) {
      // El ffmpeg del servidor terminó (por ejemplo, después de un corte): se le pide que salga de
      // nuevo. Si pasa varias veces seguidas, algo anda mal de verdad y se frena.
      if (envio && envio.conectado && ++relanzos <= 3) {
        await servidor.salir(destinoActual, CLAVE);
      } else {
        detener(`El servidor dejó de transmitir${s.codigoSalida != null ? ` (código ${s.codigoSalida})` : ''}. ` +
          (automatico ? 'Tocá RETOMAR.' : 'Volvé a salir en vivo.'));
      }
    }
  } catch (e) {
    if (++fallosEstado >= 3) { servidor.perdido(); fallosEstado = 0; }
  }
}, 4000);
setInterval(() => {
  if (!envio) return;
  const texto = [lineas.version, lineas.camara, lineas.wake,
    `Estado: ${estado}${reconectando ? ' (reconectando)' : ''} · red ${red}${automatico ? ` · programada ${idProgramada}` : ''}`,
    medida && medida.texto ? medida.texto.replace('Cuadros: ', `Cuadros: dibujo ${dibujoFps} fps · `) : ''].filter(Boolean).join('\n');
  servidor.informar(texto, { oculta: vecesOculta });
}, 5000);

// Si se cierra o se recarga la página en plena transmisión, el navegador pregunta antes.
window.addEventListener('beforeunload', (e) => {
  if (estado === 'detenido') return;
  e.preventDefault();
  e.returnValue = '';
});

// ---- Controles del partido ----------------------------------------------------------------------
const mmssCorto = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

document.querySelectorAll('.equipo').forEach((div) => {
  const local = div.dataset.local === '1';
  div.querySelector('.menos').onclick = () => partido.sumar({ local, delta: -1 });
  div.querySelector('.mas').onclick = () => partido.sumar({ local, delta: 1 });
});
$('bSentido').onclick = () => partido.cambiarSentido();
document.querySelectorAll('.filaAjustes button').forEach((b) => { b.onclick = () => partido.ajustar(Number(b.dataset.seg)); });

$('bAccion').onclick = () => {
  const p = partido;
  if (p.fase === 'juego' && p.espera === 'previa') p.ocultarEspera();
  else if (p.fase === 'juego') p.iniciarOPausar();
  else if (p.fase === 'entretiempo') p.siguienteTiempo();
};

// Menú chico al tocar PANTALLA: se elige cuánto dura la cuenta regresiva y recién ahí se pone.
$('bPantalla').onclick = async () => {
  if (partido.espera !== 'ninguna') return partido.ocultarEspera();
  let minutos = await elegir('Cuenta regresiva', 'reloj', [
    { texto: '1 minuto', valor: 1, icono: 'reloj' },
    { texto: '5 minutos', valor: 5, icono: 'reloj' },
    { texto: '15 minutos', valor: 15, icono: 'reloj' },
    { texto: 'Otro...', valor: 'otro', icono: 'editar' },
    { texto: 'Nada (sin cuenta)', valor: 0, icono: 'camaraNo', clase: 'tenue linea' },
  ]);
  if (minutos === undefined) return;
  if (minutos === 'otro') {
    const t = await pedirNumero({ titulo: 'Minutos', ic: 'reloj', valor: '10', ayuda: 'De 1 a 99' });
    minutos = Number(t);
    if (!Number.isInteger(minutos) || minutos < 1 || minutos > 99) return;
  }
  partido.mostrarEspera({ minutos: minutos === 0 ? null : minutos });
};

// Texto libre que sale en una franja abajo del video. Anclado arriba: el teclado queda abajo.
$('bBanner').onclick = async () => {
  const texto = await cartel({ clase: 'banner', arriba: true }, (div, cerrar) => {
    div.innerHTML = `<input class="campo" maxlength="90" placeholder="Gol de Juan Perez" autocapitalize="sentences" enterkeyhint="done">` +
      `<button class="ok" title="Poner">${icono('listo')}</button><button class="borde" title="Cancelar">${icono('cerrar')}</button>`;
    const campo = div.querySelector('input');
    campo.value = partido.banner;
    campo.onkeydown = (e) => { if (e.key === 'Enter') cerrar(campo.value); };
    div.querySelector('.ok').onclick = () => cerrar(campo.value);
    div.querySelector('.borde').onclick = () => cerrar(undefined);
    setTimeout(() => campo.focus(), 50);
  });
  if (texto === undefined) return;
  if (texto.trim()) partido.mostrarBanner(texto);
  else partido.quitarBanner();
};

// Ajustes del reloj: ponerlo exacto como el tablero de la cancha, o corregir de a poco.
$('bAjustar').onclick = () => {
  let dejarDeOir = () => {};
  cartel({ clase: 'ancho' }, (div, cerrar) => {
    const s = partido.segundosReloj;
    div.innerHTML = cabecera('reloj', 'Reloj') + `<div class="cuerpo">
      <div class="relojGrande negrita" id="rgTexto"></div>
      <div class="ponerReloj"><span style="color:var(--suave)">Poner en</span>
        <input class="campo" id="rgMin" inputmode="numeric" maxlength="2" value="${Math.floor(s / 60)}"><span style="font-size:20px">:</span>
        <input class="campo" id="rgSeg" inputmode="numeric" maxlength="2" value="${String(s % 60).padStart(2, '0')}">
        <button class="lleno" id="rgPoner">PONER</button></div>
      <hr><div style="font-size:12px;color:rgba(255,255,255,.6);text-align:center;margin-bottom:8px">O corregir de a poco:</div>
      <div class="deAPoco">${[['-1 min', -60], ['-10 s', -10], ['-1 s', -1], ['+1 s', 1], ['+10 s', 10], ['+1 min', 60]]
        .map(([t, n]) => `<button class="borde" data-seg="${n}">${t}</button>`).join('')}</div></div>
      <div class="acciones">${partido.fase === 'juego' ? '<button class="texto" id="rgTerminar">TERMINAR ESTE TIEMPO</button>' : ''}<button class="lleno" id="rgListo">LISTO</button></div>`;
    const texto = () => { div.querySelector('#rgTexto').textContent = partido.fase === 'juego' ? `${partido.tiempo}T  ${partido.reloj}` : 'Tiempo terminado'; };
    texto();
    dejarDeOir = partido.escuchar(texto);
    div.querySelectorAll('.deAPoco button').forEach((b) => { b.onclick = () => partido.ajustar(Number(b.dataset.seg)); });
    div.querySelector('#rgPoner').onclick = () => {
      const minutos = parseInt(div.querySelector('#rgMin').value.trim(), 10), segundos = parseInt(div.querySelector('#rgSeg').value.trim(), 10);
      if (Number.isNaN(minutos) || Number.isNaN(segundos) || segundos > 59) return avisar('Poné los minutos y los segundos (los segundos, hasta 59).');
      partido.ponerReloj({ minutos, segundos });
      cerrar();
    };
    const terminar = div.querySelector('#rgTerminar');
    if (terminar) terminar.onclick = () => { partido.terminarTiempo(); cerrar(); };
    div.querySelector('#rgListo').onclick = () => cerrar();
  }).then(() => dejarDeOir());
};

// Exclusiones: tres casillas de 2' y una de 4'. Vacía: se toca y se elige el club. Ocupada: se
// toca para ver cuál es y sacarla, o se mantiene apretada para sacarla directo.
const CASILLAS = [2, 2, 2, 4];
$('filaExc').innerHTML = CASILLAS.map((m, i) => `<button class="casilla" data-i="${i}"></button>`).join('');
function exclusionDeCasilla(i) {
  const minutos = CASILLAS[i];
  const deEsas = partido.exclusiones.filter((e) => e.minutos === minutos);
  const orden = CASILLAS.slice(0, i).filter((m) => m === minutos).length;
  return { minutos, ex: deEsas[orden] || null };
}
document.querySelectorAll('.casilla').forEach((b) => {
  const i = Number(b.dataset.i);
  let apretado = 0, largo = false;
  b.onpointerdown = () => {
    largo = false;
    clearTimeout(apretado);
    apretado = setTimeout(() => {
      const { minutos, ex } = exclusionDeCasilla(i);
      if (!ex) return;
      largo = true;
      partido.sacarExclusion({ local: ex.local, minutos });
      if (navigator.vibrate) navigator.vibrate(30);
    }, 600);
  };
  b.onpointerup = b.onpointerleave = b.onpointercancel = () => clearTimeout(apretado);
  b.onclick = async () => {
    if (largo) return;
    const { minutos, ex } = exclusionDeCasilla(i);
    const c = partido.config;
    if (ex) {
      const sacar = await elegir(`Exclusión de ${minutos} min`, 'reloj', [{ texto: 'SACAR', valor: true, icono: 'cerrar', clase: 'rojo linea' }],
        `Corre para ${(ex.local ? c.local : c.visita).nombre.toUpperCase()}  ·  ${mmssCorto(ex.segundos)}`);
      if (sacar) partido.sacarExclusion({ local: ex.local, minutos });
    } else {
      const local = await elegir(`Exclusión de ${minutos} min`, 'reloj', [
        { texto: c.local.nombre.toUpperCase(), valor: true, muestra: c.local.color1 },
        { texto: c.visita.nombre.toUpperCase(), valor: false, muestra: c.visita.color1 },
      ]);
      if (local !== undefined) partido.excluir({ local, minutos });
    }
  };
});

// Equipos, colores, escudos, sponsors y partido nuevo: en la pantalla de datos del partido.
$('bDatos').onclick = () => ir('partido.html');
$('bInicio').onclick = () => ir('./', { t: null });

// ---- Pintar la pantalla -------------------------------------------------------------------------
const ESTADOS = {
  detenido: ['Detenido', '#9E9E9E'],
  preparando: ['Preparando la clave…', '#FF9800'],
  conectando: ['Conectando…', '#FFC107'],
  esperandoYouTube: ['Esperando a YouTube…', '#FF9800'],
  enVivo: ['EN VIVO', '#F44336'],
  deteniendo: ['Un momento…', '#9E9E9E'],
  finalizando: [automatico ? 'Finalizando…' : 'Cortando…', '#FF9800'],
};
function ponerTexto(el, t) { if (el.textContent !== t) el.textContent = t; }
function ponerHtml(el, h) { if (el._html !== h) { el.innerHTML = h; el._html = h; } }

function pintar() {
  const p = partido, c = p.config;

  // Estado y botón principal.
  let [texto, tono] = ESTADOS[estado];
  if (estado === 'enVivo' && reconectando) [texto, tono] = ['Reconectando…', '#FFC107'];
  const sinSenal = automatico && estado === 'detenido' && enVivoEnYouTube;
  if (sinSenal) [texto, tono] = ['En vivo en YouTube, sin señal de este celular', '#FFC107'];
  ponerTexto($('estadoTxt'), texto);
  $('estadoTxt').style.color = tono;
  $('punto').style.background = tono;
  const m = medida;
  ponerTexto($('detalle'), envio && m && m.ancho
    ? `${m.ancho}x${m.alto} · ${m.fps} fps · ${m.kbps} kbps${m.rtt != null ? ` · ${m.rtt} ms` : ''}${m.redMala ? ' · RED MALA' : ''}`
    : '');
  ponerTexto($('bRed'), topePedido ? `${topeKbps()} kbps` : red === 'wifi' ? 'WIFI' : 'DATOS');
  $('bRed').disabled = estado !== 'detenido';

  const b = $('bPrincipal');
  let [etiqueta, ic, clase] = {
    detenido: ['SALIR EN VIVO', 'camara', ''],
    preparando: ['CANCELAR', 'cerrar', 'gris'],
    conectando: ['CANCELAR', 'cerrar', 'gris'],
    esperandoYouTube: ['CANCELAR', 'cerrar', 'gris'],
    enVivo: automatico ? ['FINALIZAR', 'stop', 'rojo'] : ['CORTAR', 'stop', 'rojo'],
    deteniendo: ['UN MOMENTO…', 'reloj', 'gris'],
    finalizando: [automatico ? 'FINALIZANDO…' : 'CORTANDO…', 'reloj', 'gris'],
  }[estado];
  if (automatico && estado === 'detenido' && finalizarPendiente) [etiqueta, ic, clase] = ['REINTENTAR FINALIZAR', 'stop', 'rojo'];
  else if (sinSenal) [etiqueta, ic, clase] = ['RETOMAR', 'repetir', ''];
  ponerHtml(b, icono(ic) + `<span>${etiqueta}</span>`);
  b.className = 'negrita ' + clase;
  // Reintentar la finalización no necesita la cámara; salir en vivo sí.
  b.disabled = estado === 'finalizando' || estado === 'deteniendo' || pasando ||
    (estado === 'detenido' && !flujo && !(automatico && finalizarPendiente));
  $('bInicio').hidden = estado !== 'detenido';
  // En vivo en YouTube y sin señal de este celular: en vez de los datos del partido (cambiarlos
  // empieza un partido nuevo) se ofrece finalizar.
  $('bDatos').hidden = estado !== 'detenido' || sinSenal || (automatico && finalizarPendiente);
  $('bFinalizar').hidden = !sinSenal || finalizarPendiente;

  const ensayo = servidor.destino === 'local';
  let abajo = mensaje;
  if (estado === 'enVivo' && !reconectando) {
    const s = Math.floor((Date.now() - desdeVivo) / 1000);
    abajo = `Al aire hace ${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}` +
      (ensayo ? ' · ensayo (no sale a YouTube)' : '') + (automatico && programada.titulo ? ' · ' + programada.titulo : '') +
      (m && m.redMala ? '\nLa red está muy mala: la imagen puede salir trabada.' : '');
  } else if (estado === 'detenido' && !mensaje) {
    abajo = (ensayo ? 'Ensayo: no sale a YouTube. ' : '') + (automatico
      ? (programada.titulo || 'Programada ' + idProgramada) + (cuenta.activa ? '' : '\nLa sesión de Google venció: se renueva al tocar el botón.')
      : lineas.version);
  }
  ponerTexto($('mensaje'), abajo);

  // Equipos y tantos.
  document.querySelectorAll('.equipo').forEach((div) => {
    const local = div.dataset.local === '1';
    const e = local ? c.local : c.visita;
    const [arriba, abajoC] = div.querySelectorAll('.colores i');
    arriba.style.background = color(e.color1);
    abajoC.style.background = color(e.color2);
    ponerTexto(div.querySelector('.nombre'), e.nombre.toUpperCase());
    ponerTexto(div.querySelector('.tantos'), String(local ? p.tantosLocal : p.tantosVisita));
  });

  // Tiempos (se pueden elegir a mano, pero no con el reloj corriendo) y reloj.
  ponerHtml($('tiempos'), Array.from({ length: c.tiempos }, (_, i) => i + 1)
    .map((t) => `<button class="pastilla negrita${p.tiempo === t && p.fase !== 'fin' ? ' actual' : ''}" data-t="${t}"${p.corriendo ? ' disabled' : ''}>${t}T</button>`).join(''));
  const r = $('reloj');
  ponerTexto(r, p.fase === 'juego' ? p.reloj : p.fase === 'entretiempo' ? 'ENTRETIEMPO' : 'FINAL');
  r.classList.toggle('ambar', p.fase !== 'juego' || p.corriendo);
  r.classList.toggle('largo', p.fase !== 'juego');
  ponerHtml($('bSentido'), icono(p.ascendente ? 'arriba' : 'abajo'));
  $('bSentido').title = p.ascendente ? 'Cuenta para arriba. Tocá para que cuente para abajo' : 'Cuenta para abajo. Tocá para que cuente para arriba';

  // Botón de acción: empezar, pausar, seguir, pasar al tiempo siguiente.
  const a = $('bAccion');
  a.hidden = p.fase === 'fin';
  a.disabled = false;
  if (p.fase === 'juego' && p.espera === 'previa') ponerHtml(a, icono('camara') + '<span>EMPEZAR PARTIDO</span>');
  else if (p.fase === 'juego') {
    a.disabled = p.segundosRestantes === 0;
    ponerHtml(a, icono(p.corriendo ? 'pausa' : 'play') + `<span>${p.corriendo ? 'PAUSA' : p.segundosRestantes === c.minutos * 60 ? 'INICIAR' : 'SEGUIR'}</span>`);
  } else if (p.fase === 'entretiempo') ponerHtml(a, icono('siguiente') + `<span>EMPEZAR ${p.tiempo + 1}T</span>`);
  ponerHtml($('bAjustar'), icono('reloj'));

  // Pantalla de espera y banner.
  ponerTexto($('bPantalla'), p.espera === 'ninguna' ? 'PANTALLA' : 'CAMARA');
  // Con el reloj corriendo no: la pantalla tapa el partido.
  $('bPantalla').disabled = p.espera === 'ninguna' && !p.puedePonerPantalla;
  ponerTexto($('bBanner'), p.banner ? 'BANNER PUESTO' : 'BANNER');

  // Exclusiones.
  document.querySelectorAll('.casilla').forEach((boton) => {
    const { minutos, ex } = exclusionDeCasilla(Number(boton.dataset.i));
    boton.classList.toggle('ocupada', !!ex);
    ponerHtml(boton, ex
      ? `<i style="background:${color((ex.local ? c.local : c.visita).color1)}"></i><span>${mmssCorto(ex.segundos)}</span>`
      : `${minutos}'`);
  });
}
$('tiempos').onclick = (e) => {
  const b = e.target.closest('.pastilla');
  if (b && !b.disabled) partido.irATiempo(Number(b.dataset.t));
};

// ---- Arranque -----------------------------------------------------------------------------------
partido.escuchar(pintar);
setInterval(() => { if (estado === 'enVivo') pintar(); }, 1000);
pintarMic();
pintar();
dibujar();
cargarLetra().then(() => { marcador.redimensionar(W, H); });
// Escudos y logos de sponsors guardados en este celular.
Logos.cargar().then((l) => l.paraMarcador()).then((l) => marcador.ponerLogos(l)).catch(() => {});
abrirCamara();
if (automatico) {
  // La ventana de Google tiene que poder abrirse en el mismo toque del botón: se deja lista.
  cuenta.preparar();
  anotar(`abre la programada "${programada.titulo}" (${idProgramada}) · aparato ${ETIQUETA}`);
  leerProgramada();
}
// Para las pruebas automáticas y para mirar desde la consola.
window.marcavivo = {
  get partido() { return partido; }, get estado() { return estado; }, get medida() { return medida; }, servidor,
  get programada() { return programada; }, get enVivoEnYouTube() { return enVivoEnYouTube; }, get mensaje() { return mensaje; },
  get registro() { return [...pendientes]; },
};
