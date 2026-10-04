// Pantalla de transmisión: vista previa con el marcador, botón para salir en vivo y los controles
// del partido. Es stream_page.dart + match_controls.dart de la app de Android, en la web.

import { Partido, ConfigPartido } from './partido.js';
import { Marcador, cargarLetra, color } from './marcador.js';
import { servidor, VERSION } from './servidor.js';
import { Envio } from './envio.js';
import { Logos } from './logos.js';
import { $, icono, escapar, avisar, cartel, cabecera, elegir, confirmar, pedirNumero, pedirPin } from './ui.js';

const parametros = servidor.parametros;

// El servidor pide un PIN cuando se entra desde afuera de la PC del servidor.
servidor.pedirPin = pedirPin;

// ---- Partido y marcador -------------------------------------------------------------------------
const CONFIG_POR_DEFECTO = {
  local: { nombre: 'All Boys', color1: 0xFFFFFFFF, color2: 0xFF111111 },
  visita: { nombre: 'Visitante', color1: 0xFF1565C0, color2: 0xFFD32F2F },
  minutos: 30,
  tiempos: 2,
};
const CLAVE = 'manual';
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
/** 'detenido' | 'conectando' | 'enVivo' | 'finalizando' */
let estado = 'detenido';
let envio = null;
let medida = null;
let mensaje = '';
let desdeVivo = 0;
let saliendo = false;      // ya se le pidió al servidor que salga
let reconectando = false;
let intentando = false;    // hay una reconexión en marcha
let cortesSeguidos = 0;
let relanzos = 0;          // veces que hubo que pedirle de nuevo al servidor que salga

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

async function salirEnVivo() {
  if (!flujo) return avisar('Primero hay que abrir la cámara.');
  estado = 'conectando';
  saliendo = false; reconectando = false; cortesSeguidos = 0; relanzos = 0; medida = null;
  mensaje = 'Conectando con el servidor…';
  pintar();
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
  if (estado === 'detenido' || estado === 'finalizando') return;
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

async function pedirSalida() {
  saliendo = true;
  try {
    const s = await servidor.estado(true).catch(() => null);
    if (!s || !s.transmitiendo) await servidor.salir();
    if (estado !== 'conectando' && estado !== 'enVivo') return;
    if (estado === 'conectando') desdeVivo = Date.now();
    estado = 'enVivo';
    reconectando = false;
    mensaje = '';
  } catch (e) {
    if (estado === 'conectando' || estado === 'enVivo') detener('No se pudo salir en vivo: ' + e.message);
  }
  pintar();
}

/** Se cortó la conexión con el servidor: se vuelve a conectar sola, hasta 6 veces seguidas. */
async function reconectar() {
  if (intentando) return;
  cortesSeguidos++;
  if (cortesSeguidos > 6) return detener('Se cortó la conexión con el servidor y no se pudo recuperar. Revisá internet y volvé a salir.');
  intentando = true;
  reconectando = true;
  saliendo = false;
  mensaje = 'Se cortó la conexión con el servidor. Reconectando…';
  pintar();
  if (envio) envio.cerrar();
  await new Promise((ok) => setTimeout(ok, 2500));
  const sigue = () => estado === 'conectando' || estado === 'enVivo';
  try {
    if (sigue()) await nuevoEnvio();
  } catch (e) {
    setTimeout(() => { if (sigue()) reconectar(); }, 2000);
  } finally {
    intentando = false;
  }
}

function detener(texto = '') {
  if (envio) envio.cerrar();
  envio = null;
  medida = null;
  estado = 'detenido';
  saliendo = false; reconectando = false;
  mensaje = texto;
  if (texto) avisar(texto, 7000);
  pintar();
}

async function cortar() {
  if (!(await confirmar('Cortar', '¿Cortar la transmisión?', 'CORTAR', 'SEGUIR'))) return;
  if (estado !== 'enVivo') return;
  estado = 'finalizando';
  pintar();
  let error = '';
  try { await servidor.cortar(); } catch (e) { error = e.message; }
  detener(error ? 'No se pudo avisar al servidor que corte: ' + error : '');
  if (!error) avisar('Transmisión cortada.');
}

$('bPrincipal').onclick = () => {
  if (estado === 'detenido') salirEnVivo();
  else if (estado === 'conectando') detener('Cancelado.');
  else if (estado === 'enVivo') cortar();
};

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
        await servidor.salir();
      } else {
        detener(`El servidor dejó de transmitir${s.codigoSalida != null ? ` (código ${s.codigoSalida})` : ''}. Volvé a salir en vivo.`);
      }
    }
  } catch (e) {
    if (++fallosEstado >= 3) { servidor.perdido(); fallosEstado = 0; }
  }
}, 4000);
setInterval(() => {
  if (!envio) return;
  const texto = [lineas.version, lineas.camara, lineas.wake, `Estado: ${estado}${reconectando ? ' (reconectando)' : ''} · red ${red}`,
    medida && medida.texto ? medida.texto.replace('Cuadros: ', `Cuadros: dibujo ${dibujoFps} fps · `) : ''].filter(Boolean).join('\n');
  servidor.informar(texto, { oculta: vecesOculta });
}, 5000);

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
$('bDatos').onclick = () => { location.href = 'partido.html' + location.search; };
$('bInicio').onclick = () => { location.href = './' + location.search; };

// ---- Pintar la pantalla -------------------------------------------------------------------------
const ESTADOS = {
  detenido: ['Detenido', '#9E9E9E'],
  conectando: ['Conectando…', '#FFC107'],
  enVivo: ['EN VIVO', '#F44336'],
  finalizando: ['Cortando…', '#9E9E9E'],
};
function ponerTexto(el, t) { if (el.textContent !== t) el.textContent = t; }
function ponerHtml(el, h) { if (el._html !== h) { el.innerHTML = h; el._html = h; } }

function pintar() {
  const p = partido, c = p.config;

  // Estado y botón principal.
  let [texto, tono] = ESTADOS[estado];
  if (estado === 'enVivo' && reconectando) [texto, tono] = ['Reconectando…', '#FFC107'];
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
  const [etiqueta, ic, clase] = {
    detenido: ['SALIR EN VIVO', 'camara', ''],
    conectando: ['CANCELAR', 'cerrar', 'gris'],
    enVivo: ['CORTAR', 'stop', 'rojo'],
    finalizando: ['CORTANDO…', 'reloj', 'gris'],
  }[estado];
  ponerHtml(b, icono(ic) + `<span>${etiqueta}</span>`);
  b.className = 'negrita ' + clase;
  b.disabled = estado === 'finalizando' || (estado === 'detenido' && !flujo);
  $('bDatos').hidden = $('bInicio').hidden = estado !== 'detenido';

  let abajo = mensaje;
  if (estado === 'enVivo' && !reconectando) {
    const s = Math.floor((Date.now() - desdeVivo) / 1000);
    abajo = `Al aire hace ${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}` +
      (servidor.destino === 'local' ? ' · ensayo (no sale a YouTube)' : '') + (m && m.redMala ? '\nLa red está muy mala: la imagen puede salir trabada.' : '');
  } else if (estado === 'detenido' && !mensaje) {
    abajo = (servidor.destino === 'local' ? 'Ensayo: no sale a YouTube. ' : '') + lineas.version;
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
// Para las pruebas automáticas y para mirar desde la consola.
window.marcavivo = { get partido() { return partido; }, get estado() { return estado; }, get medida() { return medida; }, servidor };
