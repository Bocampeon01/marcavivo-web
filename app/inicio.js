// Pantalla de inicio: sesión de Google y transmisiones programadas del canal. Es home_page.dart de
// la app de Android, en la web. En esta etapa solo LEE de YouTube.

import { cuenta, SesionVencida } from './cuenta.js';
import { youtube, separarTransmisiones, describirError } from './youtube.js';
import { VERSION } from './servidor.js';
import { $, icono, escapar, avisar } from './ui.js';

// Se conserva lo que venga en la dirección (por ejemplo ?destino=local en las pruebas).
const ir = (pagina) => { location.href = pagina + location.search; };

let canal = cuenta.canal;
let transmisiones = null;      // null = todavía no se cargaron
let deCelular = new Set();     // las hechas con la app de YouTube del celular
let cargando = false;
let error = '';
let verViejas = false;

function mostrar(vista) {
  $('cargando').hidden = vista !== 'cargando';
  $('entrada').hidden = vista !== 'entrada';
  $('principal').hidden = vista !== 'principal';
}

// ---- Sesión -------------------------------------------------------------------------------------
function pedirEntrada(mensaje = '') {
  $('errorEntrada').textContent = mensaje;
  $('errorEntrada').hidden = !mensaje;
  mostrar('entrada');
}

async function iniciarSesion({ elegir = false } = {}) {
  $('errorEntrada').hidden = true;
  $('bEntrar').disabled = true;
  try {
    await cuenta.iniciar({ elegir });
    if (elegir) { canal = ''; transmisiones = null; }
    mostrar('principal');
    await cargar();
  } catch (e) {
    pedirEntrada(describirError(e));
  }
  $('bEntrar').disabled = false;
}

async function cargar() {
  if (cargando) return;
  cargando = true;
  error = '';
  pintar();
  try {
    canal = (await youtube.canal()) || '';
    cuenta.recordarCanal(canal);
    const lista = await youtube.programadas();
    deCelular = await youtube.hechasConElCelular(lista);
    transmisiones = lista;
  } catch (e) {
    if (e instanceof SesionVencida) {
      cargando = false;
      return pedirEntrada(describirError(e));
    }
    error = describirError(e);
  }
  cargando = false;
  pintar();
}

// ---- Lista --------------------------------------------------------------------------------------
const DIAS = ['dom', 'lun', 'mar', 'mie', 'jue', 'vie', 'sab'];
const dos = (n) => String(n).padStart(2, '0');
const fecha = (d) => (d ? `${DIAS[d.getDay()]} ${dos(d.getDate())}/${dos(d.getMonth() + 1)} ${dos(d.getHours())}:${dos(d.getMinutes())}` : 'sin fecha');
const PRIVACIDAD = { public: 'Publica', unlisted: 'Oculta', private: 'Privada' };
function estadoDe(b) {
  if (['live', 'liveStarting'].includes(b.estado)) return 'EN VIVO';
  if (['testing', 'testStarting'].includes(b.estado)) return 'EN PRUEBA';
  if (['ready', 'created'].includes(b.estado)) return 'PROGRAMADA';
  return b.estado.toUpperCase();
}

const tarjeta = (clase, ic, titulo, texto, accion) =>
  `<button class="tarjeta ${clase}" data-accion="${accion}">${icono(ic)}<span><b class="negrita">${titulo}</b><small>${texto}</small></span></button>`;

function item(b, vieja) {
  const celular = deCelular.has(b.id);
  return `<button class="tarjeta item${vieja ? ' vieja' : ''}" data-id="${escapar(b.id)}">` +
    (b.miniatura ? `<img src="${escapar(b.miniatura)}" alt="" loading="lazy">` : '<span class="sinFoto"></span>') +
    `<span class="datos"><span class="titulo negrita">${escapar(b.titulo)}</span>` +
    `<span class="linea"><span class="etiqueta${b.enVivo ? ' vivo' : celular ? ' celular' : ''}">${celular ? 'APP DE YOUTUBE' : estadoDe(b)}</span>` +
    `<span>${fecha(b.programadaPara)} · ${PRIVACIDAD[b.privacidad] || escapar(b.privacidad)}</span></span>` +
    (celular ? '<span class="celu">Se transmite con la app de YouTube. Tocala para pasarla a MarcaVivo</span>' : '') +
    '</span></button>';
}

function pintar() {
  $('canal').textContent = canal || '…';
  $('vence').textContent = cuenta.activa ? `Sesión: quedan ${cuenta.minutosRestantes} min` : 'Sesión vencida';
  $('bActualizar').disabled = $('bCambiar').disabled = cargando;
  const lista = $('lista');
  if (cargando && transmisiones == null) {
    lista.innerHTML = '<div class="vacio">Cargando las transmisiones…</div>';
    return;
  }
  if (error) {
    lista.innerHTML = `<div id="errorLista"><div class="error">${escapar(error)}</div><button class="borde" data-accion="actualizar">REINTENTAR</button></div>`;
    return;
  }
  const tarjetas =
    tarjeta('verde falta', 'camara', 'EN VIVO YA', 'Crea la transmisión al toque y sale en vivo. Sin programar nada. (Todavía no está en la web.)', 'enVivoYa') +
    tarjeta('azul', 'calendario', 'PROGRAMAR', 'Crea la transmisión de un partido para más tarde, con su link.', 'programar') +
    tarjeta('gris falta', 'grabar', 'GRABAR', 'Con el marcador y todo, pero sin salir en vivo. (Todavía no está en la web.)', 'grabar');
  const todas = transmisiones || [];
  if (!todas.length) {
    lista.innerHTML = tarjetas + '<div class="vacio">No hay transmisiones programadas.<br>Crealas con PROGRAMAR.</div>';
    return;
  }
  // Las que ya pasaron hace rato van aparte: si no, tapan las de hoy.
  const { vigentes, viejas } = separarTransmisiones(todas, { canal });
  lista.innerHTML =
    (!vigentes.length && !verViejas ? '<div class="vacio">No hay transmisiones programadas para hoy.<br>Crealas con PROGRAMAR y aparecen acá.</div>' : '') +
    tarjetas + vigentes.map((b) => item(b, false)).join('') +
    (viejas.length ? `<button id="cabeceraViejas" data-accion="viejas">${icono(verViejas ? 'menos' : 'mas')}<span>Viejas (${viejas.length})</span></button>` : '') +
    (verViejas ? viejas.map((b) => item(b, true)).join('') : '');
}

$('lista').onclick = (e) => {
  const boton = e.target.closest('button');
  if (!boton) return;
  const accion = boton.dataset.accion;
  if (accion === 'actualizar') return cargar();
  if (accion === 'viejas') { verViejas = !verViejas; return pintar(); }
  if (accion === 'programar') return window.open('../programar.html', '_blank', 'noopener');
  if (accion === 'enVivoYa') return avisar('EN VIVO YA todavía no está en la web app: llega más adelante. Por ahora: PROGRAMAR, o "Transmitir con la clave del servidor".', 6000);
  if (accion === 'grabar') return avisar('Grabar todavía no está en la web app: llega más adelante.');
  const b = (transmisiones || []).find((t) => t.id === boton.dataset.id);
  if (!b) return;
  if (deCelular.has(b.id)) {
    return avisar('Esta programada es de la app de YouTube del celular: MarcaVivo no puede usarla tal cual. Convertirla desde la web app llega más adelante; por ahora se convierte desde la app de Android.', 8000);
  }
  avisar(`Salir en vivo en "${b.titulo}" llega en la etapa siguiente. Por ahora se transmite con "Transmitir con la clave del servidor".`, 7000);
};

// ---- Botones ------------------------------------------------------------------------------------
$('version').textContent = VERSION;
$('bEntrar').innerHTML = icono('entrar') + '<span>INICIAR SESION CON GOOGLE</span>';
$('bEntrar').onclick = () => iniciarSesion();
$('bActualizar').innerHTML = icono('actualizar') + '<span>ACTUALIZAR</span>';
$('bActualizar').onclick = cargar;
$('bCambiar').innerHTML = icono('cuentas') + '<span>CAMBIAR CUENTA</span>';
$('bCambiar').onclick = async () => {
  await cuenta.cerrar();
  await iniciarSesion({ elegir: true });
};
$('bManual').onclick = $('bManualEntrada').onclick = () => ir('partido.html');
$('bPruebaEntrada').onclick = () => ir('prueba.html');

// ---- Arranque -----------------------------------------------------------------------------------
if (cuenta.activa) {
  mostrar('principal');
  cargar();
} else {
  pedirEntrada(cuenta.huboSesion ? 'La sesión de Google venció. Tocá INICIAR SESION para seguir.' : '');
}
// El contador de la sesión y la lista se refrescan solos al volver a la pantalla.
setInterval(() => { if (!$('principal').hidden) $('vence').textContent = cuenta.activa ? `Sesión: quedan ${cuenta.minutosRestantes} min` : 'Sesión vencida'; }, 30_000);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && !$('principal').hidden && cuenta.activa) cargar();
});
// Para las pruebas automáticas.
window.marcavivoInicio = { get transmisiones() { return transmisiones; }, get canal() { return canal; }, get error() { return error; }, cuenta };
