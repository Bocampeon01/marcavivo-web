// Lógica del partido: tantos, reloj, tiempos, exclusiones, pantalla de espera, banner y marcas
// para los capítulos del video. Es el mismo comportamiento que `lib/match/partido.dart` de la app
// de Android, pasado a JavaScript casi línea por línea: si cambia allá, cambia acá.
//
// No toca la página: se puede probar con `node --test` (ver pruebas/partido.test.mjs).

/** Minutos y segundos como "08:42". */
export const mmss = (s) => String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');

const MIN = 60_000;
const TOPE_RELOJ_MS = 99 * MIN + 59_000;

/** Cuánto antes del +1 se marca un gol en el video: el toque llega cuando la jugada ya terminó. */
export const ANTES_DEL_GOL_MS = 10_000;

const ORDINALES = { 1: '1er', 2: '2do', 3: '3er', 4: '4to' };
const ordinal = (t) => ORDINALES[t] || `${t}°`;

/** Dónde se guarda el partido: en el navegador, o en memoria si no hay (pruebas). */
function almacenPorDefecto() {
  try {
    if (typeof localStorage !== 'undefined') {
      return {
        leer: (k) => localStorage.getItem(k),
        guardar: (k, v) => localStorage.setItem(k, v),
        borrar: (k) => localStorage.removeItem(k),
      };
    }
  } catch (e) { /* navegador sin almacenamiento */ }
  const m = new Map();
  return { leer: (k) => (m.has(k) ? m.get(k) : null), guardar: (k, v) => { m.set(k, v); }, borrar: (k) => { m.delete(k); } };
}

const K_ULTIMA = 'partido_config_ultima';
const pref = (clave) => 'partido_' + clave;

/**
 * Lo que se elige antes de salir: `{ local: {nombre, color1, color2}, visita: {...}, minutos, tiempos }`.
 * Los colores son números ARGB (0xFFD32F2F), igual que en la app.
 */
export const ConfigPartido = {
  /** Los datos del último partido, para no volver a cargarlos. */
  ultima(almacen = almacenPorDefecto()) {
    try {
      const t = almacen.leer(K_ULTIMA);
      return t ? JSON.parse(t) : null;
    } catch (e) {
      return null;
    }
  },
  guardarComoUltima(config, almacen = almacenPorDefecto()) {
    almacen.guardar(K_ULTIMA, JSON.stringify(config));
  },
};

export class Partido {
  /**
   * @param config ver [ConfigPartido]
   * @param opciones `clave`: id de la transmisión o 'manual'; `ahora`: reloj (pruebas);
   *   `almacen`: dónde se guarda; `anotar`: registro.
   */
  constructor(config, { clave = 'manual', ahora = Date.now, almacen = almacenPorDefecto(), anotar = () => {} } = {}) {
    this.config = config;
    this.clave = clave;
    this._ahora = ahora;
    this._almacen = almacen;
    this._anotar = anotar;

    this.tantosLocal = 0;
    this.tantosVisita = 0;
    /** Número de tiempo en juego (1, 2...). */
    this.tiempo = 1;
    /** Cómo se ve el reloj: de 00:00 para arriba (true) o de los minutos a 00:00 (false). */
    this.ascendente = false;
    /** 'juego' | 'entretiempo' | 'fin' */
    this.fase = 'juego';
    /** Texto del banner de abajo; vacío = no se muestra. */
    this.banner = '';

    /** Tiempo que quedaba en `_desde` (o ahora, si el reloj está parado), en ms. */
    this._restante = config.minutos * MIN;
    /** Desde cuándo corre el reloj (ms); null si está parado. */
    this._desde = null;
    this._timer = null;
    this._ultimoTick = '';
    /** Pantalla de inicio encendida por el operador (antes del partido). */
    this._previa = false;
    /** El operador tapó la pantalla de espera del entretiempo para volver a la cámara. */
    this._esperaOculta = false;
    /** Cuándo termina la cuenta regresiva de la pantalla de espera (ms) o null. */
    this._esperaHasta = null;
    /** Tiempo de juego de los tiempos ya terminados (ms): con lo corrido del actual da `jugado`. */
    this._jugadoPrevio = 0;
    /** Exclusiones en curso: `{ local, minutos, finEn }` con `finEn` medido en `jugado`. */
    this._exclusiones = [];
    this._marcas = [];
    this._oyentes = new Set();
  }

  // ---- Guardar y retomar ----------------------------------------------------------------

  /** Estado guardado de `clave`, o null. */
  static cargar(clave, opciones = {}) {
    const almacen = opciones.almacen || almacenPorDefecto();
    try {
      const t = almacen.leer(pref(clave));
      return t ? Partido.desdeJson(JSON.parse(t), { ...opciones, clave, almacen }) : null;
    } catch (e) {
      return null;
    }
  }

  static borrar(clave, almacen = almacenPorDefecto()) {
    almacen.borrar(pref(clave));
  }

  static desdeJson(j, opciones = {}) {
    const p = new Partido(j.config, opciones);
    p.tantosLocal = j.tantosLocal;
    p.tantosVisita = j.tantosVisita;
    p.tiempo = j.tiempo;
    p.fase = j.fase;
    p._restante = j.restanteMs;
    p.banner = j.banner || '';
    p._previa = !!j.previa;
    p.ascendente = !!j.ascendente;
    p._esperaOculta = !!j.esperaOculta;
    p._jugadoPrevio = j.jugadoPrevioMs || 0;
    for (const e of j.exclusiones || []) {
      p._exclusiones.push({ local: e.local ?? true, minutos: e.minutos ?? 2, finEn: e.finEnMs ?? 0 });
    }
    for (const m of j.marcas || []) {
      p._marcas.push({ cuando: m.cuando, texto: m.texto, clave: m.clave || '', golLocal: m.golLocal ?? null });
    }
    if (j.esperaHasta != null) p._esperaHasta = j.esperaHasta;
    if (j.desde != null && p.fase === 'juego') {
      p._desde = j.desde;
      if (p.restante === 0) p._terminarTiempo();
    }
    p._actualizarTimer();
    return p;
  }

  toJson() {
    return {
      config: this.config,
      tantosLocal: this.tantosLocal,
      tantosVisita: this.tantosVisita,
      tiempo: this.tiempo,
      fase: this.fase,
      restanteMs: this._restante,
      desde: this._desde,
      banner: this.banner,
      previa: this._previa,
      ascendente: this.ascendente,
      esperaOculta: this._esperaOculta,
      esperaHasta: this._esperaHasta,
      jugadoPrevioMs: this._jugadoPrevio,
      exclusiones: this._exclusiones.map((e) => ({ local: e.local, minutos: e.minutos, finEnMs: e.finEn })),
      marcas: this._marcas.map((m) => ({ ...m })),
    };
  }

  /** Guarda el partido tal como está (lo usa la pantalla de datos al crear uno nuevo). */
  guardar() {
    this._guardar();
  }

  _guardar() {
    try {
      this._almacen.guardar(pref(this.clave), JSON.stringify(this.toJson()));
    } catch (e) { /* sin lugar: el partido sigue en memoria */ }
  }

  // ---- Avisar a quien dibuja ------------------------------------------------------------

  /** Llama a `f` cada vez que cambia algo que se ve. Devuelve cómo dejar de escuchar. */
  escuchar(f) {
    this._oyentes.add(f);
    return () => this._oyentes.delete(f);
  }

  _avisar() {
    for (const f of [...this._oyentes]) f();
  }

  cerrar() {
    if (this._timer) clearInterval(this._timer);
    this._timer = null;
    this._oyentes.clear();
  }

  // ---- Marcas para los capítulos del video -----------------------------------------------

  /** Momentos del partido, en el orden en que pasaron: `{ cuando, texto, clave, golLocal }`. */
  get marcas() {
    return this._marcas.map((m) => ({ ...m }));
  }

  /** Marca un momento que va una sola vez (si ya estaba, queda la primera). */
  _marcar(clave, texto) {
    if (this._marcas.some((m) => m.clave === clave)) return;
    this._marcas.push({ cuando: this._ahora(), texto, clave, golLocal: null });
  }

  /** El tiempo había terminado por error y se vuelve atrás: se saca la marca del final. */
  _desmarcarFinal() {
    const clave = this.fase === 'fin' ? 'fin' : 'entretiempo' + this.tiempo;
    this._marcas = this._marcas.filter((m) => m.clave !== clave);
  }

  // ---- Reloj ----------------------------------------------------------------------------

  get corriendo() {
    return this._desde != null;
  }

  /** Lo que falta del tiempo, en ms. */
  get restante() {
    if (this._desde == null) return this._restante;
    return Math.max(0, this._restante - (this._ahora() - this._desde));
  }

  /** Segundos que faltan: redondea hacia arriba, así arranca en 30:00 y solo marca 00:00 al terminar. */
  get segundosRestantes() {
    return Math.floor((this.restante + 999) / 1000);
  }

  /** Segundos que marca el reloj a la vista: lo que falta, o lo jugado del tiempo si es ascendente. */
  get segundosReloj() {
    return this.ascendente ? this.config.minutos * 60 - this.segundosRestantes : this.segundosRestantes;
  }

  get reloj() {
    return mmss(this.segundosReloj);
  }

  /** Cambia el reloj entre descendente y ascendente. */
  cambiarSentido() {
    this.ascendente = !this.ascendente;
    this._cambio();
  }

  /** Tiempo de juego corrido desde que empezó el partido (ms). Solo avanza con el reloj corriendo. */
  get jugado() {
    return this._jugadoPrevio + Math.max(0, this.config.minutos * MIN - this.restante);
  }

  get esUltimoTiempo() {
    return this.tiempo >= this.config.tiempos;
  }

  // ---- Exclusiones ----------------------------------------------------------------------

  /** Cuántas exclusiones de `minutos` se pueden tener a la vez: tres de 2 y una de 4. */
  static cupo(minutos) {
    return minutos === 4 ? 1 : 3;
  }

  /** Las que están corriendo, con los segundos que les quedan, de menor a mayor. */
  get exclusiones() {
    const ahora = this.jugado;
    return this._exclusiones
      .filter((e) => e.finEn > ahora)
      // Redondea para arriba, igual que el reloj: arranca en 2:00, no en 1:59.
      .map((e) => ({ local: e.local, minutos: e.minutos, segundos: Math.floor((e.finEn - ahora + 999) / 1000) }))
      .sort((a, b) => a.segundos - b.segundos);
  }

  /** Prende una exclusión de `minutos` para un equipo. Sin cupo de esa duración, no hace nada. */
  excluir({ local, minutos }) {
    this._limpiarExclusiones();
    const usadas = this._exclusiones.filter((e) => e.minutos === minutos).length;
    if (usadas >= Partido.cupo(minutos)) return;
    this._exclusiones.push({ local, minutos, finEn: this.jugado + minutos * MIN });
    this._cambio();
  }

  /** Saca la exclusión a la que menos le falta de ese equipo y duración. */
  sacarExclusion({ local, minutos }) {
    this._limpiarExclusiones();
    let cual = null;
    for (const e of this._exclusiones) {
      if (e.local !== local || e.minutos !== minutos) continue;
      if (cual == null || e.finEn < cual.finEn) cual = e;
    }
    if (cual == null) return;
    this._exclusiones.splice(this._exclusiones.indexOf(cual), 1);
    this._cambio();
  }

  /** Cuántas hay prendidas de ese equipo y duración. */
  cuantasExclusiones({ local, minutos }) {
    const ahora = this.jugado;
    return this._exclusiones.filter((e) => e.local === local && e.minutos === minutos && e.finEn > ahora).length;
  }

  _limpiarExclusiones() {
    const ahora = this.jugado;
    this._exclusiones = this._exclusiones.filter((e) => e.finEn > ahora);
  }

  // ---- Pantalla de espera y banner --------------------------------------------------------

  /** Pantalla de espera que se ve ahora: 'ninguna' | 'previa' | 'entretiempo'. */
  get espera() {
    if (this.fase === 'entretiempo' && !this._esperaOculta) return 'entretiempo';
    if (this._previa) return 'previa';
    return 'ninguna';
  }

  get segundosEspera() {
    if (this._esperaHasta == null) return 0;
    const ms = this._esperaHasta - this._ahora();
    return ms <= 0 ? 0 : Math.floor((ms + 999) / 1000);
  }

  get relojEspera() {
    return mmss(this.segundosEspera);
  }

  get _textoEspera() {
    const e = this.espera;
    if (e === 'ninguna') return '';
    if (e === 'previa') return this.segundosEspera === 0 ? 'EL PARTIDO EMPIEZA EN INSTANTES' : 'EL PARTIDO EMPIEZA EN';
    return this.segundosEspera === 0 ? `EL ${this.tiempo + 1}T EMPIEZA EN INSTANTES` : `EL ${this.tiempo + 1}T EMPIEZA EN`;
  }

  /** La pantalla de espera solo se puede poner con el reloj parado. */
  get puedePonerPantalla() {
    return !this.corriendo;
  }

  /**
   * Muestra la pantalla de espera: la del entretiempo si el tiempo terminó, si no la de inicio.
   * `minutos` es la cuenta regresiva; null es "Nada" (la pantalla sin ningún número contando).
   */
  mostrarEspera({ minutos = null } = {}) {
    if (!this.puedePonerPantalla) return;
    if (this.fase === 'entretiempo') this._esperaOculta = false;
    else this._previa = true;
    this._esperaHasta = minutos == null ? null : this._ahora() + Math.min(99, Math.max(1, minutos)) * MIN;
    this._cambio();
  }

  /** Vuelve a la cámara (la cuenta regresiva sigue corriendo por detrás). */
  ocultarEspera() {
    if (this.fase === 'entretiempo') this._esperaOculta = true;
    else this._previa = false;
    this._cambio();
  }

  mostrarBanner(texto) {
    this.banner = String(texto || '').trim();
    this._cambio();
  }

  quitarBanner() {
    this.banner = '';
    this._cambio();
  }

  // ---- Lo que se dibuja ---------------------------------------------------------------------

  /** Lo que muestra el marcador en este momento. Dos vistas con la misma `firma` dibujan lo mismo. */
  get vista() {
    const espera = this.espera;
    const v = {
      local: this.config.local,
      visita: this.config.visita,
      tantosLocal: this.tantosLocal,
      tantosVisita: this.tantosVisita,
      tiempo: `${this.tiempo}T`,
      reloj: this.reloj,
      fase: this.fase,
      espera,
      relojEspera: espera === 'ninguna' || this.segundosEspera === 0 ? '' : this.relojEspera,
      textoEspera: this._textoEspera,
      banner: this.banner,
      exclusiones: this.exclusiones,
    };
    v.firma = [
      v.local.nombre, v.local.color1, v.local.color2, v.tantosLocal,
      v.visita.nombre, v.visita.color1, v.visita.color2, v.tantosVisita,
      v.tiempo, v.reloj, v.fase, v.espera, v.relojEspera, v.textoEspera, v.banner,
    ].join('|');
    return v;
  }

  // ---- Lo que toca el operador ------------------------------------------------------------

  /** Arranca o pausa el reloj (tiempos muertos). */
  iniciarOPausar() {
    if (this.fase !== 'juego') return;
    if (this.corriendo) {
      this._restante = this.restante;
      this._desde = null;
    } else {
      if (this.restante === 0) return;
      this._desde = this._ahora();
      // Arranca el partido: se va la pantalla de inicio.
      this._previa = false;
      this._marcar('inicio' + this.tiempo, `Inicio ${ordinal(this.tiempo)} tiempo`);
    }
    this._cambio();
  }

  /**
   * Suma `delta` a los tantos del local o de la visita (nunca baja de 0). Cada gol queda marcado
   * para el video; el -1 saca la marca del último de ese equipo.
   */
  sumar({ local, delta }) {
    const antes = local ? this.tantosLocal : this.tantosVisita;
    if (local) this.tantosLocal = Math.max(0, this.tantosLocal + delta);
    else this.tantosVisita = Math.max(0, this.tantosVisita + delta);
    const ahora = local ? this.tantosLocal : this.tantosVisita;
    if (ahora > antes) {
      const equipo = local ? this.config.local : this.config.visita;
      this._marcas.push({
        cuando: this._ahora() - ANTES_DEL_GOL_MS,
        texto: `Gol ${equipo.nombre} (${this.tantosLocal}-${this.tantosVisita})`,
        clave: '',
        golLocal: local,
      });
    } else if (ahora < antes) {
      let i = -1;
      this._marcas.forEach((m, k) => { if (m.golLocal === local) i = k; });
      if (i >= 0) this._marcas.splice(i, 1);
    }
    this._cambio();
  }

  /**
   * Corrige el reloj `segundos` (positivo o negativo) para igualarlo con el de la mesa. Es sobre lo
   * que se ve: con el reloj ascendente, +10 s lo adelanta. En el entretiempo o al final, volver el
   * reloj atrás vuelve al tiempo que terminó, en pausa.
   */
  ajustar(segundos) {
    if (this.ascendente) segundos = -segundos;
    if (this.fase !== 'juego') {
      if (segundos <= 0) return;
      this._desmarcarFinal();
      this.fase = 'juego';
      this._restante = segundos * 1000;
      this._desde = null;
      this._cambio();
      return;
    }
    const r = Math.min(TOPE_RELOJ_MS, Math.max(0, this.restante + segundos * 1000));
    this._restante = r;
    if (this.corriendo) this._desde = this._ahora();
    if (r === 0 && this.corriendo) this._terminarTiempo();
    this._cambio();
  }

  /**
   * Pone el reloj en un valor exacto (el que se ve). Si estaba corriendo, sigue corriendo desde
   * ahí. Si el tiempo ya había terminado, vuelve a ese tiempo, en pausa.
   */
  ponerReloj({ minutos, segundos }) {
    let total = Math.min(TOPE_RELOJ_MS, Math.max(0, minutos * MIN + segundos * 1000));
    if (this.ascendente) {
      const delTiempo = this.config.minutos * MIN;
      total = total >= delTiempo ? 0 : delTiempo - total;
    }
    if (this.fase !== 'juego') {
      if (total === 0) return;
      this._desmarcarFinal();
      this.fase = 'juego';
      this._desde = null;
    }
    this._restante = total;
    if (this.corriendo) this._desde = this._ahora();
    if (total === 0 && this.corriendo) this._terminarTiempo();
    this._cambio();
  }

  /** Termina el tiempo en juego ahora (por ejemplo, un amistoso que se corta antes). */
  terminarTiempo() {
    if (this.fase !== 'juego') return;
    this._terminarTiempo();
    this._cambio();
  }

  /** Salta al tiempo `t` a mano: el reloj vuelve a cero de ese tiempo, en pausa. No con el reloj corriendo. */
  irATiempo(t) {
    if (this.corriendo) return;
    if (t < 1 || t > this.config.tiempos || (t === this.tiempo && this.fase === 'juego')) return;
    this.tiempo = t;
    this.fase = 'juego';
    this._restante = this.config.minutos * MIN;
    this._desde = null;
    this._esperaHasta = null;
    this._esperaOculta = false;
    this._previa = false;
    // Las exclusiones siguen el tiempo de juego: se lo reubica en el tiempo elegido.
    this._jugadoPrevio = this.config.minutos * MIN * (t - 1);
    this._cambio();
  }

  /** Del entretiempo al tiempo siguiente: reloj completo y en pausa hasta el pitazo. */
  siguienteTiempo() {
    if (this.fase !== 'entretiempo') return;
    // El tiempo que se jugó queda sumado: una exclusión empezada sobre el final sigue en el siguiente.
    this._jugadoPrevio += this.config.minutos * MIN;
    this.tiempo++;
    this.fase = 'juego';
    this._restante = this.config.minutos * MIN;
    this._desde = null;
    this._esperaHasta = null;
    this._esperaOculta = false;
    this._cambio();
  }

  // ---- Por dentro -------------------------------------------------------------------------

  /** Se llama cada 200 ms mientras haya algo que cambia solo (y a mano en las pruebas). */
  tick() {
    const ahora = this._claveTick;
    if (ahora === this._ultimoTick) return;
    this._ultimoTick = ahora;
    if (this.corriendo && this.restante === 0) {
      this._terminarTiempo();
      this._actualizarTimer();
      this._guardar();
    }
    this._avisar();
  }

  /** Lo que se ve del reloj, la cuenta regresiva y las exclusiones: si no cambió, no hay que redibujar. */
  get _claveTick() {
    return `${this.segundosRestantes}|${this.espera === 'ninguna' ? 0 : this.segundosEspera}|` +
      this.exclusiones.map((e) => `${e.local ? 'L' : 'V'}${e.segundos}`).join(',');
  }

  _terminarTiempo() {
    this._desde = null;
    this._restante = 0;
    this.fase = this.esUltimoTiempo ? 'fin' : 'entretiempo';
    if (this.fase === 'fin') this._marcar('fin', 'Fin del partido');
    else this._marcar('entretiempo' + this.tiempo, 'Entretiempo');
    if (this.fase === 'entretiempo') {
      // Ni la pantalla ni su cuenta salen solas: las pone el operador desde PANTALLA.
      this._previa = false;
      this._esperaOculta = true;
      this._esperaHasta = null;
    }
  }

  /** El timer corre mientras haya algo que actualizar segundo a segundo. */
  _actualizarTimer() {
    const haceFalta = this.corriendo || this.espera !== 'ninguna';
    if (haceFalta && !this._timer) {
      this._timer = setInterval(() => this.tick(), 200);
      if (this._timer.unref) this._timer.unref(); // en Node (pruebas) no deja el proceso colgado
    } else if (!haceFalta && this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
  }

  _cambio() {
    this._anotar(`partido: ${this.tantosLocal}-${this.tantosVisita} ${this.tiempo}T ${this.reloj} ${this.fase}` +
      `${this.corriendo ? ' corriendo' : ''}${this.ascendente ? ' ascendente' : ''}` +
      ` excl=${this._exclusiones.length}${this.banner ? ` banner="${this.banner}"` : ''}` +
      `${this.espera === 'ninguna' ? '' : ` pantalla=${this.espera}`}`);
    this._ultimoTick = this._claveTick;
    this._actualizarTimer();
    this._guardar();
    this._avisar();
  }
}
