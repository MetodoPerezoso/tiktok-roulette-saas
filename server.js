require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');
const TikTokSessionManager = require('./services/tiktokManager');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' }
});

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const tiktokManager = new TikTokSessionManager(io);

// Rutas limpias para el SaaS
app.get('/dashboard', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

app.get('/overlay/:token', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'overlay.html'));
});

// Comunicación en tiempo real por cliente (aislado por token)
io.on('connection', (socket) => {
  const { token, role } = socket.handshake.query; // role: 'dashboard' | 'overlay'

  if (!token) {
    socket.disconnect();
    return;
  }

  // Unir el socket a la sala privada del cliente
  socket.join(token);

  // El dashboard solicita conectar el usuario de TikTok
  socket.on('client:connect_tiktok', async ({ username }) => {
    try {
      await tiktokManager.connectStreamer(token, username);
    } catch (error) {
      // El error ya fue emitido al socket dentro del manager
    }
  });

  // El dashboard solicita desconectar
  socket.on('client:disconnect_tiktok', () => {
    tiktokManager.disconnectStreamer(token);
    io.to(token).emit('tiktok:status', { connected: false, reason: 'Desconectado manualmente' });
  });

  // Sincronización en vivo: cuando el cliente guarda cambios en el dashboard, el overlay se actualiza al instante sin recargar OBS
  socket.on('client:update_config', (newConfig) => {
    socket.to(token).emit('overlay:sync_config', newConfig);
  });

  // Botón de "Test Spin" desde el dashboard hacia el overlay de OBS
  socket.on('client:test_gift', (simulatedGift) => {
    io.to(token).emit('tiktok:gift', simulatedGift);
  });

  socket.on('disconnect', () => {
    // Si no queda nadie en la sala (ni dashboard ni OBS), programar limpieza en 1 minuto
    const room = io.sockets.adapter.rooms.get(token);
    if (!room || room.size === 0) {
      tiktokManager.scheduleCleanup(token, 60000);
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 SaaS Ruleta TikTok corriendo en http://localhost:${PORT}`);
});