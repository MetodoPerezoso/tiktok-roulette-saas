const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');
const TikTokSessionManager = require('./services/tiktokManager');
const { loadConfigs, saveConfigs } = require('./services/storage');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' }
});

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Memoria local de configuraciones cargada del archivo JSON
let appConfigs = loadConfigs();

const tiktokManager = new TikTokSessionManager(io);

// Rutas del SaaS
app.get('/dashboard', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

app.get('/overlay/:token', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'overlay.html'));
});

// Eventos en tiempo real
io.on('connection', (socket) => {
  const { token, role } = socket.handshake.query;

  if (!token) {
    socket.disconnect();
    return;
  }

  socket.join(token);

  // Si es un overlay pidiendo la configuración actual al conectar
  if (role === 'overlay') {
    const currentConfig = appConfigs[token] || null;
    socket.emit('overlay:sync_config', currentConfig);
  }

  // El dashboard guarda cambios en la configuración de sus 3 niveles
  socket.on('client:save_config', (newConfig) => {
    appConfigs[token] = newConfig;
    saveConfigs(appConfigs); // Guarda en el archivo local config.json

    // Sincronizar al instante con el overlay de OBS
    socket.to(token).emit('overlay:sync_config', newConfig);
  });

  // Conectar a TikTok
  socket.on('client:connect_tiktok', async ({ username }) => {
    try {
      await tiktokManager.connectStreamer(token, username);
    } catch (error) {}
  });

  // Desconectar de TikTok
  socket.on('client:disconnect_tiktok', () => {
    tiktokManager.disconnectStreamer(token);
    io.to(token).emit('tiktok:status', { connected: false, reason: 'Desconectado manualmente' });
  });

  // Testear giro desde el dashboard
  socket.on('client:test_gift', (simulatedGift) => {
    io.to(token).emit('tiktok:gift', simulatedGift);
  });

  socket.on('disconnect', () => {
    const room = io.sockets.adapter.rooms.get(token);
    if (!room || room.size === 0) {
      tiktokManager.scheduleCleanup(token, 60000);
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 SaaS Ruleta TikTok corriendo localmente en http://localhost:${PORT}`);
});