const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = 'MilkyAdmin2025'; // Пароль для админки

// Хранение комнат
const rooms = new Map(); // roomId -> Map(userId -> { username, socketId })

// Статические файлы
app.use('/css', express.static(path.join(__dirname, 'public/css')));
app.use('/js', express.static(path.join(__dirname, 'public/js')));

// JSON парсер
app.use(express.json());

// ===== Страницы =====

// Главная
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public/index.html'));
});

// Админка
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public/admin.html'));
});

// API: проверка пароля админки
app.post('/api/admin/auth', (req, res) => {
  const { password } = req.body;
  if (password === ADMIN_PASSWORD) {
    res.json({ success: true, token: Buffer.from(ADMIN_PASSWORD + ':' + Date.now()).toString('base64') });
  } else {
    res.status(403).json({ success: false, message: 'Неверный пароль' });
  }
});

// API: список комнат и участников
app.post('/api/admin/rooms', (req, res) => {
  const { token } = req.body;
  if (!token) return res.status(403).json({ error: 'No token' });

  try {
    const decoded = Buffer.from(token, 'base64').toString();
    const pass = decoded.split(':')[0];
    if (pass !== ADMIN_PASSWORD) return res.status(403).json({ error: 'Invalid' });
  } catch {
    return res.status(403).json({ error: 'Invalid token' });
  }

  const roomList = [];
  rooms.forEach((users, roomId) => {
    const userList = [];
    users.forEach((userData, userId) => {
      userList.push({
        userId,
        username: userData.username,
        socketId: userData.socketId
      });
    });
    roomList.push({ roomId, users: userList, count: users.size });
  });

  res.json({ rooms: roomList });
});

// Комната
app.get('/room/:roomId', (req, res) => {
  res.sendFile(path.join(__dirname, 'public/room.html'));
});

// ===== Socket.IO =====
io.on('connection', (socket) => {
  let currentRoom = null;
  let currentUsername = null;

  socket.on('join-room', ({ roomId, username }) => {
    currentRoom = roomId;
    currentUsername = username;

    // Создать комнату если нет
    if (!rooms.has(roomId)) {
      rooms.set(roomId, new Map());
    }

    const room = rooms.get(roomId);

    // Проверка на переполнение
    if (room.size >= 10) {
      socket.emit('room-full');
      return;
    }

    // Список текущих пользователей
    const existingUsers = [];
    room.forEach((userData, userId) => {
      existingUsers.push({ userId, username: userData.username });
    });
    socket.emit('existing-users', existingUsers);

    // Добавить пользователя
    room.set(socket.id, { username, socketId: socket.id });

    // Уведомить остальных
    socket.to(roomId).emit('user-joined', {
      userId: socket.id,
      username
    });

    socket.join(roomId);

    // Уведомить админов
    io.to('admin-room').emit('room-updated', getRoomsList());
  });

  // Переправка offer
  socket.on('offer', ({ to, offer }) => {
    io.to(to).emit('offer', {
      from: socket.id,
      username: currentUsername,
      offer
    });
  });

  // Переправка answer
  socket.on('answer', ({ to, answer }) => {
    io.to(to).emit('answer', {
      from: socket.id,
      answer
    });
  });

  // ICE candidate
  socket.on('ice-candidate', ({ to, candidate }) => {
    io.to(to).emit('ice-candidate', {
      from: socket.id,
      candidate
    });
  });

  // Переключение медиа
  socket.on('toggle-media', ({ type, enabled }) => {
    if (currentRoom) {
      socket.to(currentRoom).emit('user-toggle-media', {
        userId: socket.id,
        type,
        enabled
      });
    }
  });

  // Демонстрация экрана
  socket.on('screen-sharing', ({ enabled }) => {
    if (currentRoom) {
      socket.to(currentRoom).emit('user-screen-sharing', {
        userId: socket.id,
        enabled
      });
    }
  });

  // ===== Админ =====
  socket.on('admin-join', ({ token }) => {
    try {
      const decoded = Buffer.from(token, 'base64').toString();
      const pass = decoded.split(':')[0];
      if (pass === ADMIN_PASSWORD) {
        socket.join('admin-room');
        socket.emit('admin-authenticated');
        socket.emit('room-updated', getRoomsList());
      }
    } catch {}
  });

  // Админ хочет смотреть комнату
  socket.on('admin-watch-room', ({ roomId }) => {
    socket.join(roomId);
    // Отправляем список пользователей
    const room = rooms.get(roomId);
    if (room) {
      const users = [];
      room.forEach((userData, userId) => {
        users.push({ userId, username: userData.username });
      });
      socket.emit('admin-room-users', { roomId, users });
    }
  });

  // Админ предлагает свой offer участнику (для просмотра)
  socket.on('admin-offer', ({ to, offer }) => {
    io.to(to).emit('offer', {
      from: socket.id,
      username: '👁 Admin',
      offer
    });
  });

  socket.on('admin-answer', ({ to, answer }) => {
    io.to(to).emit('answer', {
      from: socket.id,
      answer
    });
  });

  socket.on('admin-ice-candidate', ({ to, candidate }) => {
    io.to(to).emit('ice-candidate', {
      from: socket.id,
      candidate
    });
  });

  // Отключение
  socket.on('disconnect', () => {
    if (currentRoom && rooms.has(currentRoom)) {
      const room = rooms.get(currentRoom);
      room.delete(socket.id);

      socket.to(currentRoom).emit('user-left', {
        userId: socket.id,
        username: currentUsername
      });

      if (room.size === 0) {
        rooms.delete(currentRoom);
      }

      // Уведомить админов
      io.to('admin-room').emit('room-updated', getRoomsList());
    }
  });
});

function getRoomsList() {
  const roomList = [];
  rooms.forEach((users, roomId) => {
    const userList = [];
    users.forEach((userData, userId) => {
      userList.push({ userId, username: userData.username });
    });
    roomList.push({ roomId, users: userList, count: users.size });
  });
  return roomList;
}

server.listen(PORT, () => {
  console.log(`Сервер запущен на порту ${PORT}`);
});