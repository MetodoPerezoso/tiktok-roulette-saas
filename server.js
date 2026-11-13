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

// Memoria de historial de giros recientes por token
let appHistories = {};

const tiktokManager = new TikTokSessionManager(io);

// Rutas del SaaS
app.get('/', (req, res) => {
  res.redirect('/dashboard');
});

app.get('/dashboard', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

app.get('/overlay/:token', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'overlay.html'));
});

// Función auxiliar para registrar un giro en el historial del streamer
function logSpinHistory(token, giftData, prizeLabel = 'Giro Completado') {
  const historyItem = {
    id: giftData.id || ('spin_' + Date.now()),
    user: giftData.user || 'Anónimo',
    giftName: giftData.giftName || 'Regalo',
    coins: giftData.coins || 1,
    prize: prizeLabel,
    timestamp: new Date().toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  };

  if (!appHistories[token]) appHistories[token] = [];
  appHistories[token].unshift(historyItem);

  if (appHistories[token].length > 10) {
    appHistories[token].pop();
  }

  io.to(token).emit('dashboard:sync_history', appHistories[token]);
}

// Eventos en tiempo real
io.on('connection', (socket) => {
  const { token, role } = socket.handshake.query;

  if (!token) {
    socket.disconnect();
    return;
  }

  socket.join(token);

  // Sincronización al conectar según el rol
  if (role === 'overlay') {
    const currentConfig = appConfigs[token] || null;
    socket.emit('overlay:sync_config', currentConfig);
  }

  if (role === 'dashboard') {
    const currentConfig = appConfigs[token] || null;
    if (currentConfig) {
      socket.emit('dashboard:sync_config', currentConfig);
    }
    socket.emit('dashboard:sync_history', appHistories[token] || []);
  }

  // El dashboard guarda cambios en la configuración de sus 3 niveles
  socket.on('client:save_config', (newConfig) => {
    appConfigs[token] = newConfig;
    saveConfigs(appConfigs);

    // Sincronizar al instante con el overlay de OBS
    socket.to(token).emit('overlay:sync_config', newConfig);
  });

  // Conectar a TikTok
  socket.on('client:connect_tiktok', async ({ username }) => {
    try {
      await tiktokManager.connectStreamer(token, username);
    } catch (error) {
      socket.emit('tiktok:error', { message: error.message || 'Error al conectar con TikTok' });
    }
  });

  // Desconectar de TikTok
  socket.on('client:disconnect_tiktok', () => {
    tiktokManager.disconnectStreamer(token);
    io.to(token).emit('tiktok:status', { connected: false, reason: 'Desconectado manualmente' });
  });

  // Testear giro desde el dashboard
  socket.on('client:test_gift', (simulatedGift) => {
    io.to(token).emit('tiktok:gift', simulatedGift);
    logSpinHistory(token, simulatedGift);
  });

  // Registrar resultado exacto enviado desde el overlay al frenar la ruleta
  socket.on('overlay:spin_result', ({ gift, prize }) => {
    logSpinHistory(token, gift, prize);
  });

  // Vaciar historial desde el dashboard
  socket.on('client:clear_history', () => {
    appHistories[token] = [];
    io.to(token).emit('dashboard:sync_history', []);
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
  console.log(`🚀 SaaS Ruleta TikTok corriendo en http://localhost:${PORT}`);
});