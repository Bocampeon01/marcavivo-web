// Leer el título de una programada armado por MarcaVivo ("12hs Infantiles F - Handball All Boys vs
// Ferro - Fecha 5"), para completar solos los datos del partido. Es la parte de
// `lib/youtube/titulo_programada.dart` de la app de Android que hace falta en la web.

import { CLUB_PROPIO } from './biblioteca.js';

const normal = (t) => String(t).toLowerCase().replace(/[^a-z0-9]+/g, '');

/** "Logo Ferro" / "Escudo de Ferro" -> "Ferro": muchos escudos se cargaron con esos nombres. */
export function sinPrefijo(n) {
  return String(n).trim()
    .replace(/^(logo|escudo)\s+(del?\s+)?/i, '')
    .replace(/\s+logo$/i, '');
}

/** Cómo va un equipo en el título: sin "Logo", y el nuestro siempre como "All Boys". */
export function nombreEnTitulo(n) {
  n = sinPrefijo(n);
  return normal(n).includes(normal(CLUB_PROPIO)) ? CLUB_PROPIO : n;
}

/** Local y visitante de un título armado por MarcaVivo, o null si el título no tiene esa forma. */
export function equiposDeTitulo(titulo) {
  const m = /handball\s+(.+?)\s+vs\.?\s+(.+?)(?:\s+-\s+|$)/i.exec(String(titulo || ''));
  if (!m) return null;
  const local = m[1].trim(), visitante = m[2].trim();
  if (!local || !visitante || visitante === '…') return null;
  return { local, visitante };
}

/** Nombre para el marcador (hasta `largo` letras): se cortan palabras enteras. */
export function nombreParaMarcador(nombre, largo = 16) {
  const limpio = nombreEnTitulo(nombre);
  if (limpio.length <= largo) return limpio;
  let corto = '';
  for (const palabra of limpio.split(/\s+/)) {
    const siguiente = corto ? `${corto} ${palabra}` : palabra;
    if (siguiente.length > largo) break;
    corto = siguiente;
  }
  return corto || limpio.slice(0, largo);
}
