const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

// rooms: roomId -> Map(socketId -> { username, socketId })
const rooms = new Map();

app.use('/css', express.static(path.join(__dirname, 'public/css')));
app.use('/js', express.static(path.join(__dirname, 'public/js')));
app.use(express.json());

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public/index.html'));
});


app.get('/room/:roomId', (req, res) => {
  res.sendFile(path.join(__dirname, 'public/room.html'));
});

function getRoomsList() {
  const roomList = [];
  rooms.forEach((users, roomId) => {
    const userList = [];
    users.forEach((data, socketId) => {
      userList.push({ userId: socketId, username: data.username });
    });
    roomList.push({ roomId, users: userList, count: users.size });
  });
  return roomList;
}


io.on('connection', (socket) => {
  let currentRoom = null;
  let currentUsername = null;

  // ===== Обычный пользователь =====
  socket.on('join-room', ({ roomId, username }) => {
    currentRoom = roomId;
    currentUsername = username;

    if (!rooms.has(roomId)) rooms.set(roomId, new Map());
    const room = rooms.get(roomId);

    if (room.size >= 10) {
      socket.emit('room-full');
      return;
    }

    // Список текущих участников
    const existingUsers = [];
    room.forEach((userData, sid) => {
      existingUsers.push({ userId: sid, username: userData.username });
    });
    socket.emit('existing-users', existingUsers);

    room.set(socket.id, { username, socketId: socket.id });
    socket.join(roomId);

    socket.to(roomId).emit('user-joined', { userId: socket.id, username });
  });

  // ===== Сигналинг =====
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

  // ===== Отключение =====
  socket.on('disconnect', () => {
    if (currentRoom && rooms.has(currentRoom)) {
      const room = rooms.get(currentRoom);
      room.delete(socket.id);

      socket.to(currentRoom).emit('user-left', { userId: socket.id, username: currentUsername });

      if (room.size === 0) {
        rooms.delete(currentRoom);
      }
    }
  });
});

server.listen(PORT, () => {
  console.log(`Сервер запущен: http://localhost:${PORT}`);
});