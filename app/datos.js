// "Datos del partido" y "Logos de sponsors": lo que se completa antes de transmitir. Es
// match_setup_page.dart + logos_page.dart de la app de Android, en la web.

import { Partido, ConfigPartido } from './partido.js';
import { Logos } from './logos.js';
import { biblioteca, buscar, CLUB_PROPIO } from './biblioteca.js';
import { equiposDeTitulo, nombreEnTitulo, nombreParaMarcador } from './titulo.js';
import { color } from './marcador.js';
import { $, icono, escapar, avisar, cartel, cabecera, elegir, confirmar, pedirNumero, elegirFotos, ir } from './ui.js';

/** Colores de camiseta para el cuadradito del marcador (los mismos 18 de la app). */
export const COLORES_CAMISETA = [
  ['Blanco', 0xFFFFFFFF], ['Gris', 0xFF9E9E9E], ['Negro', 0xFF111111],
  ['Rojo', 0xFFD32F2F], ['Bordo', 0xFF7B1E2B], ['Rosa', 0xFFEC407A], ['Fucsia', 0xFFC2185B],
  ['Naranja', 0xFFF57C00], ['Amarillo', 0xFFFDD835], ['Dorado', 0xFFC9A227], ['Marrón', 0xFF6D4C41],
  ['Verde claro', 0xFF7CB342], ['Verde', 0xFF2E7D32], ['Turquesa', 0xFF00ACC1], ['Celeste', 0xFF64B5F6],
  ['Azul', 0xFF1565C0], ['Azul marino', 0xFF0D2A5C], ['Violeta', 0xFF6A1B9A],
];
const MINUTOS_COMUNES = [20, 25, 30];
/** Con `?t=<id>` son los datos del partido de esa programada de YouTube; sin eso, el de siempre. */
const idProgramada = new URLSearchParams(location.search).get('t') || '';
const CLAVE = /^[A-Za-z0-9_-]{5,40}$/.test(idProgramada) ? idProgramada : 'manual';
const conProgramada = CLAVE !== 'manual';

// ---- Estado de la pantalla: primero lo del último partido ---------------------------------------
// Si esta programada ya tiene su partido guardado (se volvió a los datos en medio del partido), se
// parte de esos datos.
const yaEmpezado = conProgramada ? Partido.cargar(CLAVE) : null;
if (yaEmpezado) yaEmpezado.cerrar();
const ultima = (yaEmpezado && yaEmpezado.config) || ConfigPartido.ultima();
const datos = {
  local: { nombre: ultima?.local?.nombre ?? '', color1: ultima?.local?.color1 ?? 0xFFFFFFFF, color2: ultima?.local?.color2 ?? 0xFF111111 },
  visita: { nombre: ultima?.visita?.nombre ?? '', color1: ultima?.visita?.color1 ?? 0xFF1565C0, color2: ultima?.visita?.color2 ?? 0xFFD32F2F },
  minutos: ultima?.minutos ?? 30,
  tiempos: ultima?.tiempos ?? 2,
};
let logos = null;
const direcciones = new Map(); // imagen guardada -> dirección para mostrarla

function direccionDe(blob) {
  if (!blob) return '';
  if (!direcciones.has(blob)) direcciones.set(blob, URL.createObjectURL(blob));
  return direcciones.get(blob);
}

function chips(grupo, opciones, elegido, alTocar) {
  grupo.querySelectorAll('.chip').forEach((c) => c.remove());
  for (const [texto, valor, marcado] of opciones) {
    const b = document.createElement('button');
    b.className = 'chip' + ((marcado ?? valor === elegido) ? ' elegido' : '');
    b.textContent = texto;
    b.onclick = () => alTocar(valor);
    grupo.appendChild(b);
  }
}

// ---- Datos del partido --------------------------------------------------------------------------
function pintar() {
  for (const div of document.querySelectorAll('.equipo')) {
    const e = div.dataset.local === '1' ? datos.local : datos.visita;
    div.querySelectorAll('.muestraColor').forEach((b) => { b.style.background = color(e['color' + b.dataset.color]); });
  }
  chips($('gMinutos'), [
    ...MINUTOS_COMUNES.map((m) => [String(m), m]),
    [MINUTOS_COMUNES.includes(datos.minutos) ? 'Otro' : `${datos.minutos} (otro)`, 'otro', !MINUTOS_COMUNES.includes(datos.minutos)],
  ], datos.minutos, async (m) => {
    if (m === 'otro') {
      const t = Number(await pedirNumero({ titulo: 'Minutos por tiempo', ic: 'reloj', valor: String(datos.minutos), ayuda: 'De 1 a 99', boton: 'OK' }));
      if (!Number.isInteger(t) || t < 1 || t > 99) return;
      m = t;
    }
    datos.minutos = m;
    pintar();
  });
  chips($('gTiempos'), [2, 3, 4].map((t) => [String(t), t]), datos.tiempos, (t) => { datos.tiempos = t; pintar(); });
  $('bLogos').innerHTML = icono('fotos') + `<span>LOGOS (${logos ? logos.nombres.length : 0})</span>`;
  $('bLogos').disabled = !logos;
}

async function pintarEscudos() {
  for (const div of document.querySelectorAll('.equipo')) {
    const local = div.dataset.local === '1';
    const blob = logos ? await logos.escudo({ local }) : null;
    const b = div.querySelector('.escudo');
    b.classList.toggle('puesto', !!blob);
    b.innerHTML = blob ? `<img src="${direccionDe(blob)}" alt="Escudo">` : icono('fotoMas');
    b.disabled = !logos;
    div.querySelector('.quitar').hidden = !blob;
  }
}

async function elegirColor(actual) {
  return cartel({ clase: 'paletaCartel' }, (div, cerrar) => {
    div.innerHTML = cabecera('paleta', 'Color') + '<div class="cuerpo"><div class="paleta">' +
      COLORES_CAMISETA.map(([nombre, c]) => `<button data-c="${c}" class="${c === actual ? 'actual' : ''}"><i style="background:${color(c)}"></i>${escapar(nombre)}</button>`).join('') +
      '</div></div>';
    div.querySelectorAll('.paleta button').forEach((b) => { b.onclick = () => cerrar(Number(b.dataset.c)); });
  });
}

/** El escudo sale de una foto del celular o de la biblioteca compartida del club. */
async function elegirEscudo(local) {
  const de = await elegir('Escudo', 'escudo', [
    { texto: 'De la biblioteca del club', valor: 'biblioteca', icono: 'escudo' },
    { texto: 'Una foto de este celular', valor: 'foto', icono: 'fotoMas' },
  ]);
  if (!de) return;
  try {
    let blob = null;
    if (de === 'foto') {
      [blob] = await elegirFotos();
    } else {
      avisar('Buscando los escudos del club…', 8000);
      const clubes = await biblioteca.indice('clubes');
      $('aviso').hidden = true;
      if (!clubes.length) return avisar('La biblioteca del club todavía no tiene escudos cargados.');
      // Arriba de todo, el que se parece al nombre escrito.
      const escrito = (local ? datos.local : datos.visita).nombre;
      const sugerido = buscar(escrito || (local ? CLUB_PROPIO : ''), clubes);
      const orden = sugerido ? [sugerido, ...clubes.filter((n) => n !== sugerido)] : clubes;
      const nombre = await elegir('Escudo de la biblioteca', 'escudo', orden.map((n) => ({ texto: n, valor: n, icono: 'escudo' })));
      if (!nombre) return;
      blob = await biblioteca.imagen('clubes', nombre);
      if (!blob) return avisar('Ese escudo no se pudo bajar de la biblioteca.');
    }
    if (!blob) return;
    await logos.ponerEscudo(blob, { local });
    await pintarEscudos();
  } catch (e) {
    avisar('No se pudo poner el escudo: ' + (e.message || e));
  }
}

/**
 * Nombres sacados del título de la programada y escudos de la biblioteca del club. Solo la primera
 * vez que se abre esa programada: después manda lo que se haya corregido a mano.
 */
async function cargarDeProgramada() {
  if (!conProgramada || yaEmpezado) return;
  let titulo = '';
  try {
    const p = JSON.parse(localStorage.getItem('programada') || 'null');
    if (p && p.id === CLAVE) titulo = String(p.titulo || '');
  } catch (e) { /* sin almacenamiento */ }
  $('tituloProgramada').textContent = titulo;
  $('tituloProgramada').hidden = !titulo;
  const equipos = equiposDeTitulo(titulo);
  if (!equipos) return;
  // Si All Boys cambió de lado respecto del partido anterior, sus colores van con él.
  const esPropio = (n) => nombreEnTitulo(n) === CLUB_PROPIO;
  const antesLocal = esPropio(datos.local.nombre), ahoraLocal = esPropio(equipos.local);
  const antesVisita = esPropio(datos.visita.nombre), ahoraVisita = esPropio(equipos.visitante);
  if ((antesLocal && ahoraVisita) || (antesVisita && ahoraLocal)) {
    for (const c of ['color1', 'color2']) [datos.local[c], datos.visita[c]] = [datos.visita[c], datos.local[c]];
  }
  datos.local.nombre = nombreParaMarcador(equipos.local);
  datos.visita.nombre = nombreParaMarcador(equipos.visitante);
  for (const div of document.querySelectorAll('.equipo')) {
    div.querySelector('input').value = (div.dataset.local === '1' ? datos.local : datos.visita).nombre;
  }
  pintar();
  if (!logos) return;
  let puestos = 0;
  try {
    const clubes = await biblioteca.indice('clubes');
    const delLocal = buscar(equipos.local, clubes);
    const delVisitante = buscar(equipos.visitante, clubes.filter((n) => n !== delLocal));
    for (const [nombre, local] of [[delLocal, true], [delVisitante, false]]) {
      const blob = nombre ? await biblioteca.imagen('clubes', nombre) : null;
      if (!blob) {
        // Club sin escudo cargado: ese lado queda vacío, no con el del partido anterior.
        await logos.quitarEscudo({ local });
        continue;
      }
      await logos.ponerEscudo(blob, { local });
      puestos++;
    }
  } catch (e) {
    avisar('No se pudieron traer los escudos de la biblioteca del club: ' + (e.message || e));
  }
  await pintarEscudos();
  if (puestos) avisar(puestos === 2 ? 'Equipos y escudos puestos desde la programada.' : 'Equipos puestos desde la programada. Falta un escudo en la biblioteca del club.');
}

for (const div of document.querySelectorAll('.equipo')) {
  const local = div.dataset.local === '1';
  const equipo = local ? datos.local : datos.visita;
  const campo = div.querySelector('input');
  campo.value = equipo.nombre;
  campo.oninput = () => { equipo.nombre = campo.value; $('error').hidden = true; };
  div.querySelectorAll('.muestraColor').forEach((b) => {
    b.onclick = async () => {
      const elegido = await elegirColor(equipo['color' + b.dataset.color]);
      if (elegido !== undefined) { equipo['color' + b.dataset.color] = elegido; pintar(); }
    };
  });
  div.querySelector('.escudo').onclick = () => elegirEscudo(local);
  div.querySelector('.quitar').innerHTML = icono('cerrar');
  div.querySelector('.quitar').onclick = async () => { await logos.quitarEscudo({ local }); await pintarEscudos(); };
}

$('bVolver').innerHTML = icono('atras');
// Recién elegida la programada (todavía sin partido) se vuelve al inicio; si no, a la transmisión.
$('bVolver').onclick = () => (conProgramada && !yaEmpezado ? ir('./', { t: null }) : ir('transmitir.html'));
$('bContinuar').innerHTML = icono('adelante') + '<span>CONTINUAR</span>';
$('bContinuar').onclick = async () => {
  const local = datos.local.nombre.trim(), visita = datos.visita.nombre.trim();
  if (!local || !visita) {
    $('error').textContent = 'Escribí el nombre de los dos equipos.';
    $('error').hidden = false;
    return;
  }
  // Si quedó un partido empezado, se avisa antes de pisarlo.
  const anterior = Partido.cargar(CLAVE);
  if (anterior) {
    const empezado = anterior.tantosLocal + anterior.tantosVisita > 0 || anterior.marcas.length > 0 || anterior.tiempo > 1 || anterior.fase !== 'juego';
    anterior.cerrar();
    if (empezado && !(await confirmar('Partido nuevo',
      `Hay un partido empezado (${anterior.config.local.nombre} ${anterior.tantosLocal} - ${anterior.tantosVisita} ${anterior.config.visita.nombre}). ` +
      '¿Empezar uno nuevo? Se borran los goles, el reloj y las marcas del anterior.', 'EMPEZAR', 'NO'))) return;
  }
  const config = {
    local: { ...datos.local, nombre: local },
    visita: { ...datos.visita, nombre: visita },
    minutos: datos.minutos,
    tiempos: datos.tiempos,
  };
  ConfigPartido.guardarComoUltima(config);
  Partido.borrar(CLAVE);
  // Partido nuevo: tantos en 0, primer tiempo, reloj completo y parado.
  const nuevo = new Partido(config, { clave: CLAVE });
  nuevo.guardar();
  nuevo.cerrar();
  ir('transmitir.html');
};
$('bPreparar').innerHTML = icono('varita');
$('bPreparar').onclick = () => window.open('https://bocampeon01.github.io/marcavivo-web/preparar.html', '_blank', 'noopener');

// ---- Logos de sponsors --------------------------------------------------------------------------
function mostrar(pantalla) {
  $('pDatos').hidden = pantalla !== 'datos';
  $('pLogos').hidden = pantalla !== 'logos';
}

async function pintarLogos() {
  chips($('gSegundos'), [5, 10, 15, 30].map((s) => [`${s} s`, s]), logos.segundos, (s) => { logos.cambiarSegundos(s); pintarLogos(); });
  chips($('gEsquina'), [['Arriba der.', 'arribaDerecha'], ['Abajo izq.', 'abajoIzquierda'], ['Abajo der.', 'abajoDerecha']],
    logos.posicion, (p) => { logos.cambiarPosicion(p); pintarLogos(); });
  const rejilla = $('rejilla');
  rejilla.innerHTML = '';
  for (const nombre of logos.nombres) {
    const blob = await logos.logo(nombre);
    if (!blob) continue;
    const div = document.createElement('div');
    div.className = 'logo';
    div.innerHTML = `<img src="${direccionDe(blob)}" alt="Logo"><button title="Quitar">${icono('cerrar')}</button>`;
    div.querySelector('button').onclick = async () => {
      if (!(await confirmar('Quitar el logo', 'Se saca de la lista y no vuelve a salir en las transmisiones.', 'QUITAR', 'CANCELAR', { ic: 'borrar', peligro: true }))) return;
      await logos.quitar(nombre);
      pintarLogos();
    };
    rejilla.appendChild(div);
  }
  $('sinLogos').hidden = logos.hayLogos;
}

$('bLogos').onclick = async () => { await pintarLogos(); mostrar('logos'); };
$('bVolverLogos').innerHTML = icono('atras');
$('bVolverLogos').onclick = () => { pintar(); mostrar('datos'); };
$('bAgregar').innerHTML = icono('fotoMas') + '<span>AGREGAR</span>';
$('bAgregar').onclick = async () => {
  const archivos = await elegirFotos({ varias: true });
  if (!archivos.length) return;
  $('bAgregar').disabled = true;
  try {
    const fallas = await logos.agregar(archivos);
    if (fallas) avisar(fallas === 1 ? 'Una imagen no se pudo leer.' : `${fallas} imágenes no se pudieron leer.`);
  } catch (e) {
    avisar('No se pudieron agregar los logos: ' + (e.message || e));
  }
  $('bAgregar').disabled = false;
  pintarLogos();
};

// ---- Arranque -----------------------------------------------------------------------------------
pintar();
Logos.cargar().then(async (l) => {
  logos = l;
  pintar();
  await pintarEscudos();
}).catch(() => {}).then(cargarDeProgramada);
// Para las pruebas automáticas.
window.marcavivoDatos = { datos, get logos() { return logos; } };
