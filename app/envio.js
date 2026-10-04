// Mandar el video (lo que se dibuja en un lienzo) y el micrófono al servidor por WebRTC (WHIP).
//
// Configuración que quedó de las pruebas del 2026-10-03 (docs/resultados-pruebas.md):
// - Sin control por demora (`sinDemora`): el servidor saca ese aviso de la oferta y el navegador
//   solo baja el envío si se pierden paquetes. Con el control normal, en 4G se hundía.
// - Tope de envío: 4.000 kbps con wifi, 2.500 con datos móviles.
// - El envío arranca bajo y sube de a poco (unos 30 s): `listo` avisa cuando llegó al 70% del tope.

import { servidor } from './servidor.js';

function esperarICE(conexion, maximoMs) {
  return new Promise((ok) => {
    if (conexion.iceGatheringState === 'complete') return ok();
    const fin = () => { conexion.removeEventListener('icegatheringstatechange', cambio); ok(); };
    const cambio = () => { if (conexion.iceGatheringState === 'complete') fin(); };
    conexion.addEventListener('icegatheringstatechange', cambio);
    setTimeout(fin, maximoMs);
  });
}

export class Envio {
  /**
   * @param lienzo el canvas con el cuadro ya armado (cámara + marcador)
   * @param microfono pista de audio o null
   * @param opciones `topeKbps`, `sinDemora`, `forzarRelay`, `alCambiar(medida)`
   */
  constructor(lienzo, microfono, { topeKbps = 4000, sinDemora = true, forzarRelay = false, alCambiar = () => {} } = {}) {
    this.lienzo = lienzo;
    this.microfono = microfono;
    this.topeKbps = topeKbps;
    this.sinDemora = sinDemora;
    this.forzarRelay = forzarRelay;
    this.alCambiar = alCambiar;
    this.pc = null;
    this._timer = null;
    this._bytes = 0;
    this._cuando = 0;
    this._desde = 0;
    /** Lo último que se midió. */
    this.medida = { conexion: 'nueva', kbps: 0, fps: 0, ancho: 0, alto: 0, listo: false, texto: '' };
  }

  get conectado() {
    return !!this.pc && this.pc.connectionState === 'connected';
  }

  async conectar() {
    const salida = this.lienzo.captureStream(30);
    // Es movimiento (deporte): ante una red floja conviene bajar el tamaño antes que los cuadros.
    salida.getVideoTracks()[0].contentHint = 'motion';
    // Servidores de relay: con la clave de Cloudflare permiten llegar desde cualquier red.
    const rIce = await servidor.pedir('/api/ice');
    if (!rIce.ok) throw new Error('el servidor no dio los servidores de relay (' + rIce.status + ')');
    const ice = await rIce.json();
    this._relay = ice.turn ? 'Cloudflare' : 'no (solo STUN: anda en la misma red)';

    const pc = new RTCPeerConnection({
      iceServers: ice.iceServers || [],
      iceTransportPolicy: this.forzarRelay ? 'relay' : 'all',
    });
    this.pc = pc;
    this._salida = salida;
    pc.onconnectionstatechange = () => this._avisar({ conexion: pc.connectionState });
    const tv = pc.addTransceiver(salida.getVideoTracks()[0], {
      direction: 'sendonly', streams: [salida],
      sendEncodings: [{ maxBitrate: this.topeKbps * 1000, maxFramerate: 30 }],
    });
    this._sender = tv.sender;
    if (this.microfono) pc.addTransceiver(this.microfono, { direction: 'sendonly', streams: [salida] });
    // H.264 primero: es lo que mejor codifican los celulares por hardware.
    if (tv.setCodecPreferences && RTCRtpSender.getCapabilities) {
      const caps = RTCRtpSender.getCapabilities('video').codecs;
      const h264 = caps.filter((c) => c.mimeType === 'video/H264');
      if (h264.length) tv.setCodecPreferences([...h264, ...caps.filter((c) => c.mimeType !== 'video/H264')]);
    }
    await pc.setLocalDescription(await pc.createOffer());
    await esperarICE(pc, 4000);
    // El servidor pasa la conexión a MediaMTX: por el túnel solo hace falta una dirección.
    const r = await servidor.pedir('/whip/' + encodeURIComponent(servidor.ruta) + (this.sinDemora ? '?sindemora=1' : ''),
      { method: 'POST', headers: { 'Content-Type': 'application/sdp' }, body: pc.localDescription.sdp });
    if (!r.ok) throw new Error(`el servidor contestó ${r.status}: ${(await r.text()).slice(0, 200)}`);
    if (this.pc !== pc) return; // se canceló mientras tanto
    await pc.setRemoteDescription({ type: 'answer', sdp: await r.text() });
    try {
      const pr = this._sender.getParameters();
      pr.degradationPreference = 'maintain-framerate';
      await this._sender.setParameters(pr);
    } catch (e) { /* este navegador no lo admite */ }
    this._desde = performance.now();
    this._timer = setInterval(() => this._medir(), 2000);
  }

  cerrar() {
    if (this._timer) clearInterval(this._timer);
    this._timer = null;
    const pc = this.pc;
    this.pc = null;
    if (pc) {
      pc.onconnectionstatechange = null;
      try { pc.close(); } catch (e) { /* ya estaba cerrada */ }
    }
    if (this._salida) this._salida.getVideoTracks().forEach((t) => t.stop());
    this._salida = null;
  }

  _avisar(cambios) {
    this.medida = { ...this.medida, ...cambios };
    this.alCambiar(this.medida);
  }

  async _medir() {
    const pc = this.pc;
    if (!pc) return;
    let todo;
    try { todo = await pc.getStats(); } catch (e) { return; }
    let video = null, par = null, remoto = null, fuente = null;
    todo.forEach((s) => {
      if (s.type === 'media-source' && s.kind === 'video') fuente = s;
      if (s.type === 'outbound-rtp' && s.kind === 'video') video = s;
      if (s.type === 'remote-inbound-rtp' && s.kind === 'video') remoto = s;
      if (s.type === 'candidate-pair' && s.state === 'succeeded' && s.nominated) par = s;
    });
    if (!video) return;
    const ahora = performance.now();
    const kbps = this._cuando ? Math.round(((video.bytesSent - this._bytes) * 8) / (ahora - this._cuando)) : 0;
    this._bytes = video.bytesSent;
    this._cuando = ahora;
    const fps = Math.round(video.framesPerSecond || 0);
    const rtt = par && par.currentRoundTripTime != null ? Math.round(par.currentRoundTripTime * 1000) : null;
    const calculado = par && par.availableOutgoingBitrate != null ? Math.round(par.availableOutgoingBitrate / 1000) : null;
    const camino = par && todo.get(par.localCandidateId) ? todo.get(par.localCandidateId).candidateType : '?';
    const codec = video.codecId && todo.get(video.codecId) ? todo.get(video.codecId).mimeType : '?';
    const dur = video.qualityLimitationDurations || {};
    const limite = video.qualityLimitationReason && video.qualityLimitationReason !== 'none' ? video.qualityLimitationReason : '';
    // El envío arranca bajo y sube de a poco: salir antes es salir pixelado.
    const listo = this.medida.listo || kbps >= this.topeKbps * 0.7 || ahora - this._desde > 60000;
    // Las mismas líneas que la página de prueba: son las que se guardan en el servidor.
    const texto = [
      `Relay: ${this._relay} · forzado: ${this.forzarRelay ? 'SÍ' : 'no'}${this.sinDemora ? ' · sin control por demora' : ''} · tope ${this.topeKbps} kbps`,
      `WebRTC: ${pc.connectionState}`,
      `Red: calcula ${calculado == null ? '?' : calculado + ' kbps'} · perdido ${remoto && remoto.fractionLost != null ? Math.round(remoto.fractionLost * 100) + '%' : '?'}` +
        ` · NACK ${video.nackCount ?? '?'} · PLI ${video.pliCount ?? '?'} · codifica ${video.encoderImplementation || '?'}` +
        ` · limitado: red ${Math.round(dur.bandwidth || 0)} s, cpu ${Math.round(dur.cpu || 0)} s`,
      `Cuadros: fuente ${Math.round((fuente && fuente.framesPerSecond) || 0)} fps · enviados ${fps} fps · codificar ` +
        `${video.framesEncoded ? ((video.totalEncodeTime / video.framesEncoded) * 1000).toFixed(1) : '?'} ms por cuadro`,
      listo ? 'LISTO para salir en vivo.' : `Subiendo la calidad: ${kbps} de ${this.topeKbps} kbps.`,
      `Envío: ${video.frameWidth}x${video.frameHeight} a ${fps} fps, ${kbps} kbps, ${codec}` +
        `${limite ? `, limitado por ${limite}` : ''}${rtt != null ? `, ida y vuelta ${rtt} ms` : ''}, por ${camino}`,
    ].join('\n');
    this._avisar({
      conexion: pc.connectionState, kbps, fps, ancho: video.frameWidth || 0, alto: video.frameHeight || 0,
      rtt, calculado, camino, listo, texto,
      // Red mala de verdad: la ida y vuelta se fue a casi un segundo.
      redMala: rtt != null && rtt > 800,
    });
  }
}
