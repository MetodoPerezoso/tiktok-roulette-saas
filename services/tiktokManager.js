const { WebcastPushConnection } = require('tiktok-live-connector');

class TikTokSessionManager {
  constructor(io) {
    this.io = io;
    this.connections = new Map();
  }

  async connectStreamer(token, username) {
    // Si ya hay una conexión activa para este token, la desconectamos primero
    this.disconnectStreamer(token);

    const tiktokTvConnection = new WebcastPushConnection(username);

    try {
      // Intentar conectar con TikTok
      const state = await tiktokTvConnection.connect();
      console.log(`✅ Conectado exitosamente a la sala de: @${username} (Room ID: ${state.roomId})`);
      
      this.connections.set(token, tiktokTvConnection);

      // Notificar al dashboard que se conectó con éxito
      this.io.to(token).emit('tiktok:status', { connected: true, username });

      // Escuchar eventos de regalos en tiempo real
      tiktokTvConnection.on('gift', (data) => {
        // Filtrar solo regalos que se estén enviando (evitar duplicados por streaks en curso si es necesario)
        if (data.giftType === 1 && !data.repeatEnd) {
          return; 
        }

        const giftPayload = {
          id: data.giftId || ('gift_' + Date.now()),
          user: data.uniqueId || data.nickname || 'Anónimo',
          uniqueId: data.uniqueId,
          avatar: data.profilePictureUrl || '',
          giftName: data.giftName || 'Regalo',
          coins: (data.diamondCount || 1) * (data.repeatCount || 1),
          repeatCount: data.repeatCount || 1
        };

        // Enviar el evento de regalo al overlay del streamer
        this.io.to(token).emit('tiktok:gift', giftPayload);
      });

      tiktokTvConnection.on('disconnected', () => {
        console.log(`❌ Desconectado de @${username}`);
        this.disconnectStreamer(token);
        this.io.to(token).emit('tiktok:status', { connected: false, reason: 'Transmisión finalizada o caída' });
      });

    } catch (err) {
      console.error(`❌ Error al conectar con @${username}:`, err.message);
      this.io.to(token).emit('tiktok:status', { connected: false });
      // Enviar el error específico al cliente para depuración
      this.io.to(token).emit('tiktok:error', { 
        message: `No se pudo conectar con @${username}. Asegúrate de que el usuario esté en vivo y el nombre sea exacto.` 
      });
    }
  }

  disconnectStreamer(token) {
    if (this.connections.has(token)) {
      const connection = this.connections.get(token);
      try {
        connection.disconnect();
      } catch (e) {}
      this.connections.delete(token);
    }
  }

  scheduleCleanup(token, delay) {
    setTimeout(() => {
      const room = this.io.sockets.adapter.rooms.get(token);
      if (!room || room.size === 0) {
        this.disconnectStreamer(token);
      }
    }, delay);
  }
}

module.exports = TikTokSessionManager;