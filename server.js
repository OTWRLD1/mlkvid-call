const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { v4: uuidv4 } = require('uuid');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

const PORT = process.env.PORT || 3000;

// Статические файлы
app.use(express.static(path.join(__dirname, 'public')));

// Главная страница
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Создать новую комнату
app.get('/create', (req, res) => {
  const roomId = uuidv4().slice(0, 8);
  res.redirect(`/room/${roomId}`);
});

// Страница комнаты
app.get('/room/:roomId', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'room.html'));
});

// Хранение комнат
const rooms = new Map();

io.on('connection', (socket) => {
  console.log(`Пользователь подключился: ${socket.id}`);

  // Присоединение к комнате
  socket.on('join-room', ({ roomId, username }) => {
    // Проверяем количество участников
    if (!rooms.has(roomId)) {
      rooms.set(roomId, new Set());
    }

    const room = rooms.get(roomId);

    if (room.size >= 10) {
      socket.emit('room-full');
      return;
    }

    socket.join(roomId);
    socket.roomId = roomId;
    socket.username = username;
    room.add(socket.id);

    console.log(`${username} (${socket.id}) присоединился к комнате ${roomId}. Участников: ${room.size}`);

    // Уведомляем остальных о новом участнике
    socket.to(roomId).emit('user-joined', {
      userId: socket.id,
      username: username
    });

    // Отправляем список существующих участников новому пользователю
    const existingUsers = [];
    for (const [id, s] of io.of('/').sockets) {
      if (s.roomId === roomId && s.id !== socket.id) {
        existingUsers.push({
          userId: s.id,
          username: s.username
        });
      }
    }
    socket.emit('existing-users', existingUsers);
  });

  // WebRTC сигнализация
  socket.on('offer', ({ to, offer }) => {
    io.to(to).emit('offer', {
      from: socket.id,
      username: socket.username,
      offer
    });
  });

  socket.on('answer', ({ to, answer }) => {
    io.to(to).emit('answer', {
      from: socket.id,
      answer
    });
  });

  socket.on('ice-candidate', ({ to, candidate }) => {
    io.to(to).emit('ice-candidate', {
      from: socket.id,
      candidate
    });
  });

  // Переключение аудио/видео
  socket.on('toggle-media', ({ type, enabled }) => {
    if (socket.roomId) {
      socket.to(socket.roomId).emit('user-toggle-media', {
        userId: socket.id,
        type,
        enabled
      });
    }
  });

  // Демонстрация экрана
  socket.on('screen-sharing', ({ enabled }) => {
    if (socket.roomId) {
      socket.to(socket.roomId).emit('user-screen-sharing', {
        userId: socket.id,
        enabled
      });
    }
  });

  // Отключение
  socket.on('disconnect', () => {
    console.log(`Пользователь отключился: ${socket.id}`);

    if (socket.roomId && rooms.has(socket.roomId)) {
      const room = rooms.get(socket.roomId);
      room.delete(socket.id);

      if (room.size === 0) {
        rooms.delete(socket.roomId);
      }

      socket.to(socket.roomId).emit('user-left', {
        userId: socket.id,
        username: socket.username
      });
    }
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Сервер запущен на порту ${PORT}`);
  console.log(`Откройте http://localhost:${PORT}`);
});