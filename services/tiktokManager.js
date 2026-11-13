const { WebcastPushConnection } = require('tiktok-live-connector');

class TikTokSessionManager {
  constructor(io) {
    this.io = io;
    this.sessions = {}; // token -> { connection, username, retryTimer, cleanupTimer }
  }

  async connectStreamer(token, username) {
    // Si ya hay una conexión activa para este token, la desconectamos primero
    this.disconnectStreamer(token);

    console.log(`🔗 Intentando conectar con TikTok para el canal: @${username} (Token: ${token})`);

    const tiktokLiveConnection = new WebcastPushConnection(username);
    let intentosReconexion = 0;
    const maxIntentos = 5;

    const conectarConReintento = () => {
      tiktokLiveConnection.connect().then(state => {
        console.log(`✅ Conectado exitosamente al stream de TikTok: @${username} (Room ID: ${state.roomId})`);
        intentosReconexion = 0;

        // Notificar al dashboard/overlay que la conexión fue exitosa
        this.io.to(token).emit('tiktok:status', { connected: true, username, room: state.roomId });

      }).catch(err => {
        console.error(`❌ Error al conectar con TikTok para @${username}:`, err.message);

        if (intentosReconexion < maxIntentos) {
          intentosReconexion++;
          let tiempoEspera = Math.min(10000 * Math.pow(2, intentosReconexion - 1), 60000);
          console.log(`🔄 Reintentando conexión en ${tiempoEspera / 1000}s (Intento ${intentosReconexion}/${maxIntentos})...`);
          
          this.io.to(token).emit('tiktok:status', { connected: false, message: `Reintentando en ${tiempoEspera / 1000}s...` });
          
          this.sessions[token].retryTimer = setTimeout(() => conectarConReintento(), tiempoEspera);
        } else {
          this.io.to(token).emit('tiktok:status', { connected: false });
          this.io.to(token).emit('tiktok:error', { 
            message: `No se pudo conectar con @${username}. Asegúrate de que el usuario esté en vivo y el nombre sea exacto.` 
          });
        }
      });
    };

    // Escuchar eventos de regalos en tiempo real
    tiktokLiveConnection.on('gift', (data) => {
      if (data.giftType === 1 && !data.repeatEnd) {
        return; 
      }

      const giftPayload = {
        id: data.giftId || ('gift_' + Date.now()),
        user: data.uniqueId || (data.user && data.user.nickname) || 'Anónimo',
        uniqueId: data.uniqueId || (data.user && data.user.uniqueId),
        avatar: (data.user && data.user.avatarThumb && data.user.avatarThumb.urlList && data.user.avatarThumb.urlList[0]) || '',
        giftName: data.giftName || (data.gift && data.gift.name) || 'Regalo',
        coins: ((data.diamondCount !== undefined) ? data.diamondCount : ((data.gift && data.gift.diamondCount) || 0)) * (data.repeatCount || 1),
        repeatCount: data.repeatCount || 1
      };

      // Enviar el evento de regalo al overlay del streamer
      this.io.to(token).emit('tiktok:gift', giftPayload);
    });

    tiktokLiveConnection.on('disconnected', () => {
      console.log(`❌ Desconectado de @${username}`);
      this.disconnectStreamer(token);
      this.io.to(token).emit('tiktok:status', { connected: false, reason: 'Transmisión finalizada o caída' });
    });

    // Guardar la sesión en memoria
    this.sessions[token] = {
      connection: tiktokLiveConnection,
      username: username,
      retryTimer: null,
      cleanupTimer: null
    };

    conectarConReintento();
  }

  disconnectStreamer(token) {
    if (this.sessions[token]) {
      const session = this.sessions[token];
      
      if (session.connection) {
        try {
          session.connection.disconnect();
        } catch (e) {}
      }

      if (session.retryTimer) clearTimeout(session.retryTimer);
      if (session.cleanupTimer) clearTimeout(session.cleanupTimer);

      delete this.sessions[token];
      console.log(`🔌 Sesión de TikTok desconectada para el token: ${token}`);
    }
  }

  scheduleCleanup(token, delay) {
    if (this.sessions[token]) {
      if (this.sessions[token].cleanupTimer) clearTimeout(this.sessions[token].cleanupTimer);

      this.sessions[token].cleanupTimer = setTimeout(() => {
        const room = this.io.sockets.adapter.rooms.get(token);
        if (!room || room.size === 0) {
          console.log(`🧹 Limpiando sesión inactiva para el token: ${token}`);
          this.disconnectStreamer(token);
        }
      }, delay);
    }
  }
}

module.exports = TikTokSessionManager;