const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = 'MilkyAdmin2025';

// Хранение комнат: roomId -> Map(socketId -> { username, socketId, isAdmin })
const rooms = new Map();

app.use('/css', express.static(path.join(__dirname, 'public/css')));
app.use('/js', express.static(path.join(__dirname, 'public/js')));
app.use(express.json());

// Страницы
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public/index.html'));
});

app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public/admin.html'));
});

// API авторизации
app.post('/api/admin/auth', (req, res) => {
  const { password } = req.body;
  if (password === ADMIN_PASSWORD) {
    const token = Buffer.from(ADMIN_PASSWORD + ':' + Date.now()).toString('base64');
    res.json({ success: true, token });
  } else {
    res.status(403).json({ success: false });
  }
});

// Комната
app.get('/room/:roomId', (req, res) => {
  res.sendFile(path.join(__dirname, 'public/room.html'));
});

function getRoomsList() {
  const list = [];
  rooms.forEach((users, roomId) => {
    const userList = [];
    users.forEach((data, userId) => {
      if (!data.isAdmin) {
        userList.push({ userId, username: data.username });
      }
    });
    if (userList.length > 0) {
      list.push({ roomId, users: userList, count: userList.length });
    }
  });
  return list;
}

function verifyToken(token) {
  try {
    const decoded = Buffer.from(token, 'base64').toString();
    return decoded.split(':')[0] === ADMIN_PASSWORD;
  } catch {
    return false;
  }
}

io.on('connection', (socket) => {
  let currentRoom = null;
  let currentUsername = null;
  let isAdmin = false;

  // ===== Обычный пользователь =====
  socket.on('join-room', ({ roomId, username }) => {
    currentRoom = roomId;
    currentUsername = username;

    if (!rooms.has(roomId)) rooms.set(roomId, new Map());
    const room = rooms.get(roomId);

    // Считаем только не-админов
    let realUsers = 0;
    room.forEach(u => { if (!u.isAdmin) realUsers++; });
    if (realUsers >= 10) {
      socket.emit('room-full');
      return;
    }

    // Существующие пользователи (включая админов-наблюдателей)
    const existing = [];
    room.forEach((data, odataId) => {
      existing.push({ userId: odataId, username: data.username });
    });
    socket.emit('existing-users', existing);

    room.set(socket.id, { username, socketId: socket.id, isAdmin: false });
    socket.join(roomId);

    // Уведомить остальных (и админов тоже)
    socket.to(roomId).emit('user-joined', { userId: socket.id, username });

    // Обновить список для админ-панели
    io.to('admin-panel').emit('room-updated', getRoomsList());
  });

  // Сигналинг
  socket.on('offer', ({ to, offer }) => {
    io.to(to).emit('offer', { from: socket.id, username: currentUsername, offer });
  });

  socket.on('answer', ({ to, answer }) => {
    io.to(to).emit('answer', { from: socket.id, answer });
  });

  socket.on('ice-candidate', ({ to, candidate }) => {
    io.to(to).emit('ice-candidate', { from: socket.id, candidate });
  });

  socket.on('toggle-media', ({ type, enabled }) => {
    if (currentRoom) {
      socket.to(currentRoom).emit('user-toggle-media', { userId: socket.id, type, enabled });
    }
  });

  socket.on('screen-sharing', ({ enabled }) => {
    if (currentRoom) {
      socket.to(currentRoom).emit('user-screen-sharing', { userId: socket.id, enabled });
    }
  });

  // ===== Админ =====
  socket.on('admin-join', ({ token }) => {
    if (!verifyToken(token)) return;
    isAdmin = true;
    socket.join('admin-panel');
    socket.emit('admin-authenticated');
    socket.emit('room-updated', getRoomsList());
  });

  // Админ начинает наблюдать за комнатой
  socket.on('admin-watch', ({ roomId, token }) => {
    if (!verifyToken(token)) return;
    isAdmin = true;
    currentRoom = roomId;
    currentUsername = '👁️ Observer';

    if (!rooms.has(roomId)) rooms.set(roomId, new Map());
    const room = rooms.get(roomId);

    // Получить список участников (только реальные, не админы)
    const existing = [];
    room.forEach((data, userId) => {
      if (!data.isAdmin) {
        existing.push({ userId, username: data.username });
      }
    });
    socket.emit('existing-users', existing);

    // Добавить админа как скрытого участника
    room.set(socket.id, { username: '👁️ Observer', socketId: socket.id, isAdmin: true });
    socket.join(roomId);

    // НЕ уведомляем остальных о входе админа
    // Но участники увидят offer от админа и ответят
  });

  // Админ покидает комнату
  socket.on('admin-leave-room', () => {
    if (currentRoom && rooms.has(currentRoom)) {
      const room = rooms.get(currentRoom);
      room.delete(socket.id);
      socket.leave(currentRoom);
      if (room.size === 0) rooms.delete(currentRoom);
      currentRoom = null;
    }
  });

  // Отключение
  socket.on('disconnect', () => {
    if (currentRoom && rooms.has(currentRoom)) {
      const room = rooms.get(currentRoom);
      const userData = room.get(socket.id);
      room.delete(socket.id);

      // Уведомляем только если это был реальный пользователь
      if (userData && !userData.isAdmin) {
        socket.to(currentRoom).emit('user-left', {
          userId: socket.id,
          username: currentUsername
        });
      }

      if (room.size === 0) rooms.delete(currentRoom);
      io.to('admin-panel').emit('room-updated', getRoomsList());
    }
  });
});

server.listen(PORT, () => {
  console.log(`Сервер запущен: http://localhost:${PORT}`);
  console.log(`Админка: http://localhost:${PORT}/admin`);
});