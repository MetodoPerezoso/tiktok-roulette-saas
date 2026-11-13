const { WebcastPushConnection } = require('tiktok-live-connector');

class TikTokSessionManager {
  constructor(io) {
    this.io = io;
    // Mapa de sesiones activas: key = streamerToken, value = { connection, username, cleanupTimer }
    this.sessions = new Map();
  }

  async connectStreamer(token, tiktokUsername, config) {
    const cleanUser = tiktokUsername.replace('@', '').trim().toLowerCase();

    // Si ya existe una conexión activa para este token y mismo usuario, reutilizarla
    if (this.sessions.has(token)) {
      const existing = this.sessions.get(token);
      if (existing.username === cleanUser && existing.isConnected) {
        if (existing.cleanupTimer) clearTimeout(existing.cleanupTimer);
        return { status: 'already_connected', username: cleanUser };
      }
      this.disconnectStreamer(token);
    }

    const tiktokConnection = new WebcastPushConnection(cleanUser, {
      processInitialData: false,
      enableExtendedGiftInfo: true,
      requestPollingIntervalMs: 2000
    });

    const sessionData = {
      connection: tiktokConnection,
      username: cleanUser,
      isConnected: false,
      cleanupTimer: null
    };

    this.sessions.set(token, sessionData);

    try {
      const state = await tiktokConnection.connect();
      sessionData.isConnected = true;
      
      // Notificar al dashboard y al overlay que está en vivo
      this.io.to(token).emit('tiktok:status', { 
        connected: true, 
        roomId: state.roomId, 
        username: cleanUser 
      });

      // ESCUCHAR REGALOS EN TIEMPO REAL
      tiktokConnection.on('gift', (data) => {
        // En TikTok, los regalos con racha (streakable) envían eventos repetidos.
        // Solo disparamos cuando la racha termina (repeatEnd === true) o no es racha.
        if (data.giftType === 1 && !data.repeatEnd) {
          return; 
        }

        const totalDiamonds = (data.diamondCount || 1) * (data.repeatCount || 1);

        const giftPayload = {
          id: `${data.msgId}_${Date.now()}`,
          user: data.nickname || data.uniqueId,
          uniqueId: data.uniqueId,
          avatar: data.profilePictureUrl,
          giftName: data.giftName,
          giftId: data.giftId,
          coins: totalDiamonds,
          repeatCount: data.repeatCount || 1
        };

        // Enviar el regalo únicamente a la sala (room) de este cliente
        this.io.to(token).emit('tiktok:gift', giftPayload);
      });

      // Manejo de desconexión o fin del vivo
      tiktokConnection.on('streamEnd', () => {
        this.io.to(token).emit('tiktok:status', { connected: false, reason: 'El directo ha finalizado' });
        this.disconnectStreamer(token);
      });

      tiktokConnection.on('disconnected', () => {
        sessionData.isConnected = false;
        this.io.to(token).emit('tiktok:status', { connected: false, reason: 'Desconectado de TikTok' });
      });

      return { status: 'connected', username: cleanUser };

    } catch (err) {
      this.sessions.delete(token);
      this.io.to(token).emit('tiktok:error', { 
        message: 'No se pudo conectar. Verificá que el usuario esté EN VIVO ahora mismo.' 
      });
      throw err;
    }
  }

  disconnectStreamer(token) {
    if (!this.sessions.has(token)) return;
    const session = this.sessions.get(token);
    if (session.cleanupTimer) clearTimeout(session.cleanupTimer);
    try {
      session.connection.disconnect();
    } catch (e) {}
    this.sessions.delete(token);
  }

  // Programa desconexión si el streamer cierra todas sus pestañas/OBS
  scheduleCleanup(token, delayMs = 60000) {
    const session = this.sessions.get(token);
    if (!session) return;
    if (session.cleanupTimer) clearTimeout(session.cleanupTimer);
    
    session.cleanupTimer = setTimeout(() => {
      const room = this.io.sockets.adapter.rooms.get(token);
      if (!room || room.size === 0) {
        console.log(`[Auto-Cleanup] Cerrando sesión inactiva: ${session.username}`);
        this.disconnectStreamer(token);
      }
    }, delayMs);
  }
}

module.exports = TikTokSessionManager;