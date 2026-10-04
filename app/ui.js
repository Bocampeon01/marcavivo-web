// Piezas de pantalla que usan todas las pantallas de la web app: íconos, avisos y carteles con el
// estilo de la app de Android. Necesitan en la página `<div id="capa" hidden>` y `<div id="aviso" hidden>`.

import { color } from './marcador.js';

export const $ = (id) => document.getElementById(id);
/**
 * Va a otra pantalla conservando lo que venga en la dirección (por ejemplo ?destino=local en las
 * pruebas). `cambios` pone o saca parámetros: `{ t: 'id' }` lo pone, `{ t: null }` lo saca.
 */
export function ir(pagina, cambios = {}) {
  const p = new URLSearchParams(location.search);
  for (const [k, v] of Object.entries(cambios)) {
    if (v == null) p.delete(k);
    else p.set(k, v);
  }
  const consulta = p.toString();
  location.href = pagina + (consulta ? '?' + consulta : '');
}
export const escapar = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// Los íconos de Material que usa la app.
const TRAZOS = {
  play: 'M8 5v14l11-7z',
  pausa: 'M6 19h4V5H6v14zm8-14v14h4V5h-4z',
  stop: 'M6 6h12v12H6z',
  siguiente: 'M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z',
  camara: 'M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11l-4 4z',
  camaraNo: 'M21 6.5l-4 4V7c0-.55-.45-1-1-1H9.82L21 17.18V6.5zM3.27 2L2 3.27 4.73 6H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.21 0 .39-.08.54-.18L19.73 21 21 19.73 3.27 2z',
  mic: 'M12 14c1.66 0 2.99-1.34 2.99-3L15 5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm5.3-3c0 3-2.54 5.1-5.3 5.1S6.7 14 6.7 11H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c3.28-.48 6-3.3 6-6.72h-1.7z',
  micNo: 'M19 11h-1.7c0 .74-.16 1.43-.43 2.05l1.23 1.23c.56-.98.9-2.09.9-3.28zm-4.02.17c0-.06.02-.11.02-.17V5c0-1.66-1.34-3-3-3S9 3.34 9 5v.18l5.98 5.99zM4.27 3L3 4.27l6.01 6.01V11c0 1.66 1.33 3 2.99 3 .22 0 .44-.03.65-.08l1.66 1.66c-.71.33-1.5.52-2.31.52-2.76 0-5.3-2.1-5.3-5.1H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c.91-.13 1.77-.45 2.54-.9L19.73 21 21 19.73 4.27 3z',
  arriba: 'M4 12l1.41 1.41L11 7.83V20h2V7.83l5.58 5.59L20 12l-8-8-8 8z',
  abajo: 'M20 12l-1.41-1.41L13 16.17V4h-2v12.17l-5.58-5.59L4 12l8 8 8-8z',
  adelante: 'M12 4l-1.41 1.41L16.17 11H4v2h12.17l-5.58 5.59L12 20l8-8z',
  atras: 'M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z',
  cerrar: 'M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z',
  listo: 'M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z',
  reloj: 'M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67z',
  editar: 'M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a.996.996 0 0 0 0-1.41l-2.34-2.34a.996.996 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z',
  candado: 'M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2z',
  ayuda: 'M11 18h2v-2h-2v2zm1-16C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm0-14c-2.21 0-4 1.79-4 4h2c0-1.1.9-2 2-2s2 .9 2 2c0 2-3 1.75-3 5h2c0-2.25 3-2.5 3-5 0-2.21-1.79-4-4-4z',
  paleta: 'M12 3a9 9 0 0 0 0 18c.83 0 1.5-.67 1.5-1.5 0-.39-.15-.74-.39-1.01-.23-.26-.38-.61-.38-.99 0-.83.67-1.5 1.5-1.5H16c2.76 0 5-2.24 5-5 0-4.42-4.03-8-9-8zm-5.5 9c-.83 0-1.5-.67-1.5-1.5S5.67 9 6.5 9 8 9.67 8 10.5 7.33 12 6.5 12zm3-4C8.67 8 8 7.33 8 6.5S8.67 5 9.5 5s1.5.67 1.5 1.5S10.33 8 9.5 8zm5 0c-.83 0-1.5-.67-1.5-1.5S13.67 5 14.5 5s1.5.67 1.5 1.5S15.33 8 14.5 8zm3 4c-.83 0-1.5-.67-1.5-1.5S16.67 9 17.5 9s1.5.67 1.5 1.5-.67 1.5-1.5 1.5z',
  fotoMas: 'M19 7v2.99s-1.99.01-2 0V7h-3s.01-1.99 0-2h3V2h2v3h3v2h-3zm-3 4V8h-3V5H5c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2v-8h-3zM5 19l3-4 2 3 3-4 4 5H5z',
  fotos: 'M22 16V4c0-1.1-.9-2-2-2H8c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2zm-11-4l2.03 2.71L16 11l4 5H8l3-4zM2 6v14c0 1.1.9 2 2 2h14v-2H4V6H2z',
  varita: 'M7.5 5.6L10 7 8.6 4.5 10 2 7.5 3.4 5 2l1.4 2.5L5 7zm12 9.8L17 14l1.4 2.5L17 19l2.5-1.4L22 19l-1.4-2.5L22 14zM22 2l-2.5 1.4L17 2l1.4 2.5L17 7l2.5-1.4L22 7l-1.4-2.5zm-7.63 5.29a.996.996 0 0 0-1.41 0L1.29 18.96a.996.996 0 0 0 0 1.41l2.34 2.34c.39.39 1.02.39 1.41 0L16.7 11.05a.996.996 0 0 0 0-1.41l-2.33-2.35zm-1.03 5.49l-2.12-2.12 2.44-2.44 2.12 2.12-2.44 2.44z',
  borrar: 'M16 9v10H8V9h8m-1.5-6h-5l-1 1H5v2h14V4h-3.5l-1-1zM18 7H6v12c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7z',
  calendario: 'M17 12h-5v5h5v-5zM16 1v2H8V1H6v2H5c-1.11 0-1.99.9-1.99 2L3 19c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2h-1V1h-2zm3 18H5V8h14v11z',
  grabar: 'M4 12a8 8 0 1 0 16 0a8 8 0 1 0-16 0',
  mas: 'M16.59 8.59L12 13.17 7.41 8.59 6 10l6 6 6-6z',
  menos: 'M12 8l-6 6 1.41 1.41L12 10.83l4.59 4.58L18 14z',
  entrar: 'M11 7L9.6 8.4l2.6 2.6H2v2h10.2l-2.6 2.6L11 17l5-5-5-5zm9 12h-8v2h8c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2h-8v2h8v14z',
  actualizar: 'M17.65 6.35A7.958 7.958 0 0 0 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08A5.99 5.99 0 0 1 12 18c-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z',
  cuentas: 'M4 6H2v14c0 1.1.9 2 2 2h14v-2H4V6zm16-4H8c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-6 2c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3zm6 12H8v-1.5c0-1.99 4-3 6-3s6 1.01 6 3V16z',
  repetir: 'M12 5V1L7 6l5 5V7c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6H4c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8z',
  celular: 'M16 1H8C6.34 1 5 2.34 5 4v16c0 1.66 1.34 3 3 3h8c1.66 0 3-1.34 3-3V4c0-1.66-1.34-3-3-3zm-2 20h-4v-1h4v1zm3.25-3H6.75V4h10.5v14z',
  escudo: 'M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm0 10.99h7c-.53 4.12-3.28 7.79-7 8.94V12H5V6.3l7-3.11v8.8z',
};
export const icono = (n) => `<svg class="ic" viewBox="0 0 24 24"><path d="${TRAZOS[n]}"/></svg>`;

let relojAviso = 0;
/** Aviso corto abajo, como el SnackBar de la app. */
export function avisar(texto, ms = 4000) {
  $('aviso').textContent = texto;
  $('aviso').hidden = false;
  clearTimeout(relojAviso);
  relojAviso = setTimeout(() => { $('aviso').hidden = true; }, ms);
}

/**
 * Cartel con el estilo de la app. `armar(cartel, cerrar)` llena el contenido; `cerrar(valor)` lo
 * cierra. Devuelve una promesa con ese valor (undefined si se toca afuera).
 */
export function cartel({ clase = '', arriba = false, fijo = false }, armar) {
  return new Promise((ok) => {
    const capa = $('capa');
    const anterior = [...capa.children];
    anterior.forEach((n) => { n.hidden = true; });
    const div = document.createElement('div');
    div.className = 'cartel ' + clase;
    capa.classList.toggle('arriba', arriba);
    capa.hidden = false;
    const cerrar = (valor) => {
      div.remove();
      anterior.forEach((n) => { n.hidden = false; });
      capa.hidden = capa.children.length === 0;
      if (capa.hidden) capa.onclick = null;
      ok(valor);
    };
    capa.onclick = (e) => { if (e.target === capa && !fijo) cerrar(undefined); };
    armar(div, cerrar);
    capa.appendChild(div);
  });
}

export const cabecera = (ic, titulo) => `<header>${icono(ic)}<span>${escapar(titulo)}</span></header>`;

/** Lista de opciones: `[{ texto, valor, icono, muestra (color ARGB), imagen (dirección), clase }]`. */
export function elegir(titulo, ic, opciones, nota = '') {
  return cartel({}, (div, cerrar) => {
    div.innerHTML = cabecera(ic, titulo) + '<div class="cuerpo lista">' +
      (nota ? `<div class="nota">${escapar(nota)}</div>` : '') +
      opciones.map((o, i) => `<button class="opcion ${o.clase || ''}" data-i="${i}">` +
        (o.imagen ? `<img class="muestra" src="${escapar(o.imagen)}" alt="">`
          : o.muestra != null ? `<span class="muestra" style="background:${color(o.muestra)}"></span>` : o.icono ? icono(o.icono) : '') +
        `<span>${escapar(o.texto)}</span></button>`).join('') + '</div>';
    div.querySelectorAll('.opcion').forEach((b) => { b.onclick = () => cerrar(opciones[+b.dataset.i].valor); });
  });
}

/** Pregunta de sí o no. `peligro` pinta de rojo el botón de confirmar. */
export function confirmar(titulo, texto, si = 'SÍ', no = 'NO', { ic = 'ayuda', peligro = false } = {}) {
  return cartel({}, (div, cerrar) => {
    div.innerHTML = cabecera(ic, titulo) + `<div class="cuerpo" style="white-space:pre-line">${escapar(texto)}</div>` +
      `<div class="acciones"><button class="texto" data-v="0">${escapar(no)}</button><button class="${peligro ? 'rojo' : 'lleno'}" data-v="1">${escapar(si)}</button></div>`;
    div.querySelectorAll('button').forEach((b) => { b.onclick = () => cerrar(b.dataset.v === '1'); });
  });
}

/** Cartel con un solo botón, para algo que hay que leer. `fijo`: no se cierra tocando afuera. */
export function explicar(titulo, texto, boton = 'ENTENDIDO', { ic = 'ayuda', fijo = false } = {}) {
  return cartel({ fijo }, (div, cerrar) => {
    div.innerHTML = cabecera(ic, titulo) + `<div class="cuerpo" style="white-space:pre-line">${escapar(texto)}</div>` +
      `<div class="acciones"><button class="lleno">${escapar(boton)}</button></div>`;
    div.querySelector('.acciones button').onclick = () => cerrar(true);
  });
}

/** Un número (minutos, PIN). Devuelve el texto escrito o undefined. */
export function pedirNumero({ titulo, ic, valor = '', ayuda = '', boton = 'PONER', largo = 2, fijo = false }) {
  return cartel({ arriba: true, fijo }, (div, cerrar) => {
    div.innerHTML = cabecera(ic, titulo) +
      `<form class="cuerpo"><input class="campo" inputmode="numeric" autocomplete="off" maxlength="${largo}" size="${largo + 2}" value="${escapar(valor)}">` +
      `<div style="font-size:12px;color:var(--suave);margin-top:6px">${escapar(ayuda)}</div></form>` +
      `<div class="acciones">${fijo ? '' : '<button class="texto" data-v="0">CANCELAR</button>'}<button class="lleno" data-v="1">${escapar(boton)}</button></div>`;
    const campo = div.querySelector('input');
    const aceptar = () => { if (campo.value.trim()) cerrar(campo.value.trim()); };
    div.querySelector('form').onsubmit = (e) => { e.preventDefault(); aceptar(); };
    div.querySelectorAll('.acciones button').forEach((b) => { b.onclick = () => (b.dataset.v === '1' ? aceptar() : cerrar(undefined)); });
    setTimeout(() => { campo.focus(); campo.select(); }, 50);
  });
}

/** Cartel del PIN del servidor: se le pasa a `servidor.pedirPin`. */
let pidiendoPin = null;
export function pedirPin(motivo) {
  pidiendoPin = pidiendoPin || pedirNumero({
    titulo: 'PIN para entrar', ic: 'candado', boton: 'ENTRAR', largo: 12,
    ayuda: motivo || 'Es el PIN del servidor (lo tiene quien lo prendió).',
  }).finally(() => { pidiendoPin = null; });
  return pidiendoPin;
}

/** Abre el selector de fotos del celular. Devuelve los archivos elegidos (vacío si se canceló). */
export function elegirFotos({ varias = false } = {}) {
  return new Promise((ok) => {
    const entrada = document.createElement('input');
    entrada.type = 'file';
    entrada.accept = 'image/*';
    entrada.multiple = varias;
    entrada.style.display = 'none';
    document.body.appendChild(entrada);
    let listo = false;
    const fin = (archivos) => { if (listo) return; listo = true; entrada.remove(); ok(archivos); };
    entrada.onchange = () => fin([...entrada.files]);
    // Si se cancela, algunos navegadores avisan y otros no: al volver el foco se da por cancelado.
    entrada.addEventListener('cancel', () => fin([]));
    window.addEventListener('focus', () => setTimeout(() => fin([...entrada.files]), 1500), { once: true });
    entrada.click();
  });
}
