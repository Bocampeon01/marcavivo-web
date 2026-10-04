// Capítulos del video en YouTube a partir de los momentos del partido (inicio de cada tiempo,
// entretiempo, goles y final). Es `lib/youtube/capitulos.dart` de la app de Android, en la web.

/** YouTube no acepta capítulos más cortos que esto: los que quedan más cerca se juntan. */
export const SEGUNDOS_MINIMOS_CAPITULO = 10;

/** Con menos capítulos YouTube no los muestra. */
export const MINIMO_CAPITULOS = 3;

/** Encabezado del bloque en la descripción del video. Si ya está, se reemplaza lo que sigue. */
export const TITULO_CAPITULOS = 'Momentos del partido:';

/** Minuto del video como lo escribe YouTube: 03:12, o 1:05:09 pasada la hora. */
export function tiempoVideo(segundos) {
  const dos = (n) => String(n).padStart(2, '0');
  const h = Math.floor(segundos / 3600), m = Math.floor((segundos % 3600) / 60), s = segundos % 60;
  return h > 0 ? `${h}:${dos(m)}:${dos(s)}` : `${dos(m)}:${dos(s)}`;
}

/**
 * Renglones de capítulos ("00:00 Previa", "03:12 Gol All Boys (1-0)"...) a partir de las `marcas`
 * del partido (`{ cuando (ms), texto }`). `inicio` es cuándo arrancó el video (ms).
 *
 * El primero va siempre en 00:00, como pide YouTube. Una marca a menos de 10 s del capítulo
 * anterior se junta con él. Si quedan menos de 3, devuelve una lista vacía: YouTube no los mostraría.
 */
export function armarCapitulos(marcas, inicio, { primero = 'Previa' } = {}) {
  const ordenadas = [...marcas].sort((a, b) => a.cuando - b.cuando);
  const capitulos = [[0, primero]];
  let soloPrimero = true; // el de 00:00 todavía es el genérico
  for (const m of ordenadas) {
    const segundo = Math.max(0, Math.trunc((m.cuando - inicio) / 1000));
    const [desde, texto] = capitulos[capitulos.length - 1];
    if (segundo - desde < SEGUNDOS_MINIMOS_CAPITULO) {
      // Muy cerca del anterior: van juntos. Al de 00:00 lo reemplaza (el partido arrancó apenas
      // empezó el video).
      capitulos[capitulos.length - 1] = [desde, capitulos.length === 1 && soloPrimero ? m.texto : `${texto} · ${m.texto}`];
    } else {
      capitulos.push([segundo, m.texto]);
    }
    if (capitulos.length === 1) soloPrimero = false;
  }
  if (capitulos.length < MINIMO_CAPITULOS) return [];
  return capitulos.map(([s, t]) => `${tiempoVideo(s)} ${t}`);
}

/** `descripcion` con los `capitulos` al final. Si ya tenía un bloque puesto por la app, se reemplaza. */
export function descripcionConCapitulos(descripcion, capitulos) {
  const i = descripcion.indexOf(TITULO_CAPITULOS);
  const base = (i < 0 ? descripcion : descripcion.slice(0, i)).trimEnd();
  const bloque = `${TITULO_CAPITULOS}\n${capitulos.join('\n')}`;
  return base ? `${base}\n\n${bloque}` : bloque;
}
