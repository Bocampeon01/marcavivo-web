// Dibujo del marcador sobre el video: el tanteador arriba a la izquierda, las exclusiones, el
// banner, la pantalla de espera y el logo del sponsor. Es `lib/overlay/capa_marcador.dart` de la
// app de Android pasado a canvas, con las mismas medidas: todo se piensa para 1280x720 y se
// escala al tamaño real del video.
//
// - `dibujarCapa` y `dibujarCapaLogo` dibujan una vez (sirven para probar y comparar con la app).
// - `Marcador` mantiene las dos capas al día con el partido y las pega sobre cada cuadro: solo se
//   redibujan cuando cambia algo que se ve, y en cada cuadro se copian nada más que las zonas
//   ocupadas (pegar 1280x720 treinta veces por segundo es mucho para un celular de gama media).

export const ANCHO_BASE = 1280;
export const ALTO_BASE = 720;

const X0 = 24, Y0 = 20, ALTO = 46, LETRA = 26, MARGEN = 12, NOMBRE_MAX = 240;
// Nombre de la app, en una barrita arriba del tanteador (queda quemado en el video).
const MARCA_ALTO = 24;
const MARCADOR_Y = Y0 + MARCA_ALTO + 4;

const FONDO = 0xC0000000, FONDO_TANTOS = 0x30FFFFFF, BLANCO = 0xFFFFFFFF, AMARILLO = 0xFFFFC107, NEGRO = 0xFF111111;

// Contadores de exclusión: van pegados abajo del tanteador, uno al lado del otro.
const EXC_ALTO = 34, EXC_Y = MARCADOR_Y + ALTO + 6, EXC_SEPARACION = 6, EXC_LETRA = 20, EXC_COLOR_ANCHO = 6;

const LOGO_ANCHO = 180, LOGO_ALTO = 100;
const AZUL_BANNER = 0xE60D47A1;
// El banner no va de punta a punta: es un cartel centrado, del ancho del texto.
const BANNER_Y = ALTO_BASE - 96, BANNER_ALTO = 62, BANNER_ANCHO_MAX = ANCHO_BASE * 0.62;

/** Esquinas donde puede ir el logo del sponsor (arriba a la izquierda va el marcador). */
export const POSICIONES_LOGO = ['arribaDerecha', 'abajoIzquierda', 'abajoDerecha'];

/** La letra del marcador: la misma de la app (Roboto negrita). Se carga con `cargarLetra()`. */
export const LETRA_MARCADOR = '"Roboto MarcaVivo", Roboto, "Helvetica Neue", Arial, sans-serif';
// Medidas de Roboto: con esto el texto queda centrado a la misma altura que en la app.
const ASCENSO = 0.927734375, ALTO_LINEA = 1.171875;

/** Color ARGB de la app (0xAARRGGBB) a color de canvas. */
export function color(argb) {
  const a = ((argb >>> 24) & 0xFF) / 255;
  return `rgba(${(argb >>> 16) & 0xFF},${(argb >>> 8) & 0xFF},${argb & 0xFF},${+a.toFixed(4)})`;
}

/** Deja lista la letra del marcador. Si no se puede bajar, se usa la del sistema. */
export async function cargarLetra(base = '') {
  if (typeof document === 'undefined' || !document.fonts) return false;
  try {
    const f = new FontFace('Roboto MarcaVivo', `url(${base}roboto-bold.ttf)`, { weight: '700' });
    document.fonts.add(await f.load());
    return true;
  } catch (e) {
    return false;
  }
}

const mmss = (s) => String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');

function rectRedondo(c, x, y, w, h, r) {
  c.beginPath();
  if (c.roundRect) c.roundRect(x, y, w, h, r);
  else c.rect(x, y, w, h);
}

/** Un texto ya medido: `{ texto, ancho, alto, tamano, color }`. Si no entra en `maxAncho`, se corta con "…". */
function texto(c, t, tamano, colorArgb, maxAncho = Infinity) {
  c.font = `bold ${tamano}px ${LETRA_MARCADOR}`;
  let ancho = c.measureText(t).width;
  if (ancho > maxAncho) {
    let corto = t;
    while (corto.length > 1 && c.measureText(corto + '…').width > maxAncho) corto = corto.slice(0, -1);
    t = corto.trimEnd() + '…';
    ancho = c.measureText(t).width;
  }
  return { texto: t, ancho, alto: tamano * ALTO_LINEA, tamano, color: colorArgb };
}

function pintarTexto(c, tp, x, y) {
  c.font = `bold ${tp.tamano}px ${LETRA_MARCADOR}`;
  c.textBaseline = 'alphabetic';
  c.textAlign = 'left';
  c.fillStyle = color(tp.color);
  c.fillText(tp.texto, x, y + tp.tamano * ASCENSO);
}

/** Dibuja `img` lo más grande que entre en el hueco, sin deformarla. */
function dibujarDentro(c, img, x, y, w, h) {
  const iw = img.naturalWidth || img.videoWidth || img.width, ih = img.naturalHeight || img.videoHeight || img.height;
  if (!iw || !ih) return;
  const escala = Math.min(w / iw, h / ih);
  const dw = iw * escala, dh = ih * escala;
  c.imageSmoothingQuality = 'medium';
  c.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
}

// ---- Piezas del tanteador ------------------------------------------------------------------

function piezaTexto(c, t, { tamano = LETRA, colorArgb = BLANCO, fondo = null, minAncho = 0, maxAncho = Infinity, margen = MARGEN } = {}) {
  const tp = texto(c, t, tamano, colorArgb, maxAncho);
  return { ancho: Math.max(minAncho, tp.ancho + 2 * margen), fondo, tp };
}
const piezaColores = (equipo) => ({ ancho: 30, equipo });
const piezaImagen = (imagen) => ({ ancho: 52, imagen });

function dibujarPieza(c, p, x, y) {
  if (p.fondo != null) {
    c.fillStyle = color(p.fondo);
    c.fillRect(x, y, p.ancho, ALTO);
  }
  if (p.imagen) {
    // Tarjetita blanca: la mayoría de los escudos son oscuros y el marcador también.
    c.fillStyle = color(BLANCO);
    rectRedondo(c, x + 5, y + 4, p.ancho - 10, ALTO - 8, 5);
    c.fill();
    dibujarDentro(c, p.imagen, x + 8, y + 7, p.ancho - 16, ALTO - 14);
    return;
  }
  if (p.tp) {
    pintarTexto(c, p.tp, x + (p.ancho - p.tp.ancho) / 2, y + (ALTO - p.tp.alto) / 2);
    return;
  }
  // Cuadradito de 2 colores (mitad de arriba y mitad de abajo) con borde blanco.
  const rx = x + 6, ry = y + 10, rw = 18, rh = 26;
  c.fillStyle = color(p.equipo.color1);
  c.fillRect(rx, ry, rw, rh / 2);
  c.fillStyle = color(p.equipo.color2);
  c.fillRect(rx, ry + rh / 2, rw, rh / 2);
  c.strokeStyle = color(0xCCFFFFFF);
  c.lineWidth = 1.5;
  c.strokeRect(rx, ry, rw, rh);
}

/** El nombre de la app, arriba del tanteador, sobre una pastilla oscura. */
function dibujarMarca(c) {
  const tp = texto(c, 'MarcaVivo', 17, BLANCO);
  const ancho = tp.ancho + 18;
  c.fillStyle = color(0xB3000000);
  rectRedondo(c, X0, Y0, ancho, MARCA_ALTO, 6);
  c.fill();
  pintarTexto(c, tp, X0 + 9, Y0 + (MARCA_ALTO - tp.alto) / 2);
  return { x: X0, y: Y0, w: ancho, h: MARCA_ALTO };
}

function dibujarTanteador(c, v, escudoLocal, escudoVisita) {
  // Primero se miden las piezas, después se dibuja el fondo y encima cada una.
  const final = { fondo: AMARILLO, colorArgb: NEGRO };
  const piezas = [
    ...(escudoLocal ? [piezaImagen(escudoLocal)] : []),
    piezaTexto(c, v.local.nombre.toUpperCase(), { maxAncho: NOMBRE_MAX }),
    piezaColores(v.local),
    piezaTexto(c, String(v.tantosLocal), { fondo: FONDO_TANTOS, minAncho: 48 }),
    piezaTexto(c, 'vs', { tamano: 18, colorArgb: 0xCCFFFFFF, margen: 6 }),
    piezaTexto(c, String(v.tantosVisita), { fondo: FONDO_TANTOS, minAncho: 48 }),
    piezaColores(v.visita),
    piezaTexto(c, v.visita.nombre.toUpperCase(), { maxAncho: NOMBRE_MAX }),
    ...(escudoVisita ? [piezaImagen(escudoVisita)] : []),
    ...(v.fase === 'juego'
      ? [piezaTexto(c, v.tiempo, { fondo: FONDO_TANTOS }), piezaTexto(c, v.reloj, { ...final, minAncho: 96 })]
      : [piezaTexto(c, v.fase === 'entretiempo' ? 'ENTRETIEMPO' : 'FINAL', final)]),
  ];
  const ancho = piezas.reduce((a, p) => a + p.ancho, 0);
  c.save();
  rectRedondo(c, X0, MARCADOR_Y, ancho, ALTO, 8);
  c.clip();
  c.fillStyle = color(FONDO);
  c.fillRect(X0, MARCADOR_Y, ancho, ALTO);
  let x = X0;
  for (const p of piezas) {
    dibujarPieza(c, p, x, MARCADOR_Y);
    x += p.ancho;
  }
  c.restore();
  return { x: X0, y: MARCADOR_Y, w: ancho, h: ALTO };
}

/** Los contadores de 2 y 4 minutos, con el color del equipo del jugador excluido. */
function dibujarExclusiones(c, v) {
  if (!v.exclusiones.length) return null;
  let x = X0;
  for (const e of v.exclusiones) {
    const equipo = e.local ? v.local : v.visita;
    const tp = texto(c, `${e.minutos === 4 ? "4'" : "2'"}  ${mmss(e.segundos)}`, EXC_LETRA, BLANCO);
    const ancho = EXC_COLOR_ANCHO + 10 + tp.ancho + 10;
    c.save();
    rectRedondo(c, x, EXC_Y, ancho, EXC_ALTO, 6);
    c.clip();
    c.fillStyle = color(FONDO);
    c.fillRect(x, EXC_Y, ancho, EXC_ALTO);
    // Barrita con los dos colores de la camiseta, para saber de qué equipo es.
    c.fillStyle = color(equipo.color1);
    c.fillRect(x, EXC_Y, EXC_COLOR_ANCHO, EXC_ALTO / 2);
    c.fillStyle = color(equipo.color2);
    c.fillRect(x, EXC_Y + EXC_ALTO / 2, EXC_COLOR_ANCHO, EXC_ALTO / 2);
    pintarTexto(c, tp, x + EXC_COLOR_ANCHO + 10, EXC_Y + (EXC_ALTO - tp.alto) / 2);
    c.restore();
    x += ancho + EXC_SEPARACION;
  }
  return { x: X0, y: EXC_Y, w: x - EXC_SEPARACION - X0, h: EXC_ALTO };
}

/** Dónde queda el cartel del banner (para que el logo no se le encime). */
function rectBanner(c, t) {
  const tp = texto(c, t, 30, BLANCO, BANNER_ANCHO_MAX - 48);
  const ancho = tp.ancho + 48;
  return { x: (ANCHO_BASE - ancho) / 2, y: BANNER_Y, w: ancho, h: BANNER_ALTO, tp };
}

/** Cartel centrado abajo con un texto que escribe el operador en el momento. */
function dibujarBanner(c, t) {
  const r = rectBanner(c, t);
  c.fillStyle = color(AZUL_BANNER);
  rectRedondo(c, r.x, r.y, r.w, r.h, 10);
  c.fill();
  pintarTexto(c, r.tp, r.x + r.w / 2 - r.tp.ancho / 2, r.y + r.h / 2 - r.tp.alto / 2);
  return r;
}

/**
 * Pantalla de espera (antes del partido y en el entretiempo): la cámara se sigue viendo por
 * detrás, apenas oscurecida, y encima va el logo grande (en la capa del logo) con la cuenta
 * regresiva abajo.
 */
function dibujarFondoEspera(c, v) {
  const w = ANCHO_BASE, h = ALTO_BASE;
  c.fillStyle = color(0x8C000000);
  c.fillRect(0, 0, w, h);
  const fy = h - 118, fh = 84;
  c.fillStyle = color(0xCC000000);
  c.fillRect(0, fy, w, fh);
  const tTexto = texto(c, v.textoEspera, 30, 0xE6FFFFFF);
  const tReloj = texto(c, v.relojEspera, 44, AMARILLO);
  const ancho = tTexto.ancho + (v.relojEspera ? 20 + tReloj.ancho : 0);
  let x = (w - ancho) / 2;
  const cy = fy + fh / 2;
  pintarTexto(c, tTexto, x, cy - tTexto.alto / 2);
  if (v.relojEspera) {
    x += tTexto.ancho + 20;
    pintarTexto(c, tReloj, x, cy - tReloj.alto / 2);
  }
}

/**
 * Capa del marcador, en medidas de 1280x720 (el que llama escala antes): el fondo de la pantalla
 * de espera o el banner, y encima la marca, el tanteador y las exclusiones. Devuelve las zonas
 * que quedaron ocupadas, para copiar solo eso sobre cada cuadro.
 */
export function dibujarCapa(c, v, { escudoLocal = null, escudoVisita = null } = {}) {
  const zonas = [];
  const espera = v.espera !== 'ninguna';
  if (espera) dibujarFondoEspera(c, v);
  else if (v.banner) zonas.push(dibujarBanner(c, v.banner));
  const marca = dibujarMarca(c);
  const tanteador = dibujarTanteador(c, v, escudoLocal, escudoVisita);
  const exclusiones = dibujarExclusiones(c, v);
  // La pantalla de espera oscurece todo el cuadro.
  if (espera) return [{ x: 0, y: 0, w: ANCHO_BASE, h: ALTO_BASE }];
  // Marca, tanteador y exclusiones van juntos arriba a la izquierda: una sola zona.
  const ancho = Math.max(marca.w, tanteador.w, exclusiones ? exclusiones.w : 0);
  const abajo = exclusiones ? exclusiones.y + exclusiones.h : tanteador.y + tanteador.h;
  zonas.push({ x: X0, y: Y0, w: ancho, h: abajo - Y0 });
  return zonas;
}

/**
 * Capa del logo del sponsor: chico en la esquina elegida mientras se juega (sobre una tarjeta
 * blanca, así los logos con fondo blanco o transparente quedan parejos), grande en el centro en
 * la pantalla de espera. Si un banner largo llega hasta el logo, el logo sube.
 */
export function dibujarCapaLogo(c, v, logo, posicion = 'arribaDerecha') {
  if (v.espera !== 'ninguna') {
    const w = ANCHO_BASE * 0.5, h = ALTO_BASE * 0.44;
    const x = ANCHO_BASE / 2 - w / 2, y = ALTO_BASE * 0.46 - h / 2;
    c.fillStyle = color(BLANCO);
    rectRedondo(c, x, y, w, h, 16);
    c.fill();
    dibujarDentro(c, logo, x + 24, y + 24, w - 48, h - 48);
    return [{ x, y, w, h }];
  }
  const derecha = ANCHO_BASE - X0 - LOGO_ANCHO, abajo = ALTO_BASE - X0 - LOGO_ALTO;
  let x = derecha, y = Y0;
  if (posicion === 'abajoIzquierda') { x = X0; y = abajo; }
  if (posicion === 'abajoDerecha') { x = derecha; y = abajo; }
  if (v.banner) {
    const b = rectBanner(c, v.banner);
    const seTocan = x < b.x + b.w + 12 && x + LOGO_ANCHO > b.x - 12 && y < b.y + b.h + 12 && y + LOGO_ALTO > b.y - 12;
    if (seTocan) y = BANNER_Y - 12 - LOGO_ALTO;
  }
  c.fillStyle = color(0xF2FFFFFF);
  rectRedondo(c, x, y, LOGO_ANCHO, LOGO_ALTO, 8);
  c.fill();
  dibujarDentro(c, logo, x + 10, y + 10, LOGO_ANCHO - 20, LOGO_ALTO - 20);
  return [{ x, y, w: LOGO_ANCHO, h: LOGO_ALTO }];
}

// ---- Las dos capas al día con el partido -----------------------------------------------------

const MEDIO_FUNDIDO_MS = 500;

/**
 * Mantiene las capas del marcador y del logo al día con el `partido` y las pega sobre cada cuadro.
 *
 * `logos`: `{ imagenes: [img...], segundos, posicion, escudoLocal, escudoVisita }` (todo opcional).
 * Los logos rotan cada `segundos`, con un desvanecido al cambiar de sponsor.
 */
export class Marcador {
  constructor(partido, { ancho = ANCHO_BASE, alto = ALTO_BASE, logos = {}, ahora = () => performance.now() } = {}) {
    this.partido = partido;
    this.logos = { imagenes: [], segundos: 10, posicion: 'arribaDerecha', escudoLocal: null, escudoVisita: null, ...logos };
    this._ahora = ahora;
    this._indice = 0;
    this._cambioLogo = ahora();
    this._capa = this._lienzo();
    this._logo = this._lienzo();
    this._firmaCapa = null;
    this._firmaLogo = null;
    this._zonasCapa = [];
    this._zonasLogo = [];
    // Desvanecido: de `_alfaDesde` a `_alfaHasta` empezando en `_fundidoEn`.
    this._fundido = null;
    this._pendiente = null;
    this.redimensionar(ancho, alto);
  }

  _lienzo() {
    return typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(1, 1) : document.createElement('canvas');
  }

  /** Tamaño real del video (1280x720, 960x540...). */
  redimensionar(ancho, alto) {
    this.ancho = ancho;
    this.alto = alto;
    for (const l of [this._capa, this._logo]) { l.width = ancho; l.height = alto; }
    this._firmaCapa = this._firmaLogo = null;
  }

  /** Cambia logos, esquina, segundos o escudos (se redibuja en el próximo cuadro). */
  ponerLogos(logos) {
    this.logos = { ...this.logos, ...logos };
    this._indice = 0;
    this._cambioLogo = this._ahora();
    this._firmaCapa = this._firmaLogo = null;
    this._fundido = null;
  }

  _logoActual() {
    const l = this.logos.imagenes;
    return l.length ? l[this._indice % l.length] : null;
  }

  _redibujar(lienzo, dibujo) {
    const c = lienzo.getContext('2d');
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, lienzo.width, lienzo.height);
    const k = this.ancho / ANCHO_BASE;
    c.setTransform(k, 0, 0, k, 0, 0);
    // Las zonas vienen en medidas de 1280x720: se pasan a píxeles del video, con un borde de más.
    return dibujo(c).map((z) => {
      const x = Math.max(0, Math.floor(z.x * k) - 1), y = Math.max(0, Math.floor(z.y * k) - 1);
      return { x, y, w: Math.min(this.ancho - x, Math.ceil(z.w * k) + 2), h: Math.min(this.alto - y, Math.ceil(z.h * k) + 2) };
    });
  }

  _actualizar() {
    const ahora = this._ahora();
    const v = this.partido.vista;
    const { imagenes, segundos, posicion, escudoLocal, escudoVisita } = this.logos;

    // Rotación de sponsors.
    if (imagenes.length > 1 && !this._fundido && ahora - this._cambioLogo >= segundos * 1000) {
      this._cambioLogo = ahora;
      this._fundido = { desde: 1, hasta: 0, en: ahora, despues: () => { this._indice = (this._indice + 1) % imagenes.length; } };
    }

    // Los escudos y las exclusiones entran en la firma: si cambian, hay que redibujar.
    const firmaCapa = [v.firma, !!escudoLocal, !!escudoVisita,
      v.exclusiones.map((e) => `${e.local ? 'L' : 'V'}${e.minutos}:${e.segundos}`).join(',')].join('|');
    if (firmaCapa !== this._firmaCapa) {
      this._firmaCapa = firmaCapa;
      this._zonasCapa = this._redibujar(this._capa, (c) => dibujarCapa(c, v, { escudoLocal, escudoVisita }));
    }

    const logo = this._logoActual();
    const firmaLogo = [this._indice, !logo, v.espera === 'ninguna', posicion, v.banner].join('|');
    if (firmaLogo !== this._firmaLogo) {
      this._firmaLogo = firmaLogo;
      this._zonasLogo = logo ? this._redibujar(this._logo, (c) => dibujarCapaLogo(c, v, logo, posicion)) : [];
    }
  }

  _alfaLogo() {
    const f = this._fundido;
    if (!f) return 1;
    const t = (this._ahora() - f.en) / MEDIO_FUNDIDO_MS;
    if (t < 1) return f.desde + (f.hasta - f.desde) * t;
    // Terminó de irse: cambia el logo y vuelve a aparecer.
    if (f.despues) {
      f.despues();
      this._fundido = { desde: 0, hasta: 1, en: this._ahora(), despues: null };
      this._firmaLogo = null;
      this._actualizar();
      return 0;
    }
    this._fundido = null;
    return 1;
  }

  /** Pega el marcador y el logo sobre el cuadro ya dibujado en `ctx` (del tamaño del video). */
  pintar(ctx) {
    this._actualizar();
    for (const z of this._zonasCapa) ctx.drawImage(this._capa, z.x, z.y, z.w, z.h, z.x, z.y, z.w, z.h);
    if (this._zonasLogo.length) {
      const alfa = this._alfaLogo();
      if (alfa > 0) {
        ctx.globalAlpha = alfa;
        for (const z of this._zonasLogo) ctx.drawImage(this._logo, z.x, z.y, z.w, z.h, z.x, z.y, z.w, z.h);
        ctx.globalAlpha = 1;
      }
    }
  }
}
