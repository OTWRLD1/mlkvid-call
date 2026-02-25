// Admin client-side script
// This file handles the socket interactions for the admin dashboard.
// NOTE: corresponding styles are now in public/css/admin.css

let socket;
let token = null;
let currentWatchingRoom = null;
const adminPeers = new Map();
const iceServers = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };

function initAdmin() {
  socket = io();

  socket.on('connect', () => {
    console.log('Admin connected', socket.id);
  });

  socket.on('admin-authenticated', () => {
    // server confirms auth, we might already have updated UI
    console.log('Admin authenticated');
  });

  socket.on('room-updated', (rooms) => {
    updateRoomList(rooms);
  });

  // when admin joins a room as observer the server sends existing-users
  socket.on('existing-users', (users) => {
    if (!currentWatchingRoom) return;
    users.forEach(u => {
      if (!adminPeers.has(u.userId)) {
        createAdminPeer(u.userId, u.username);
      }
    });
    document.getElementById('watchCount').textContent = users.length;
  });

  socket.on('user-joined', ({ userId, username }) => {
    if (currentWatchingRoom) {
      createAdminPeer(userId, username);
      const countEl = document.getElementById('watchCount');
      countEl.textContent = parseInt(countEl.textContent || '0', 10) + 1;
    }
  });

  socket.on('user-left', ({ userId }) => {
    removeAdminPeer(userId);
    const countEl = document.getElementById('watchCount');
    countEl.textContent = Math.max(0, parseInt(countEl.textContent || '0', 10) - 1);
  });

  socket.on('answer', ({ from, answer }) => {
    const peer = adminPeers.get(from);
    if (peer) peer.connection.setRemoteDescription(new RTCSessionDescription(answer));
  });

  socket.on('ice-candidate', ({ from, candidate }) => {
    const peer = adminPeers.get(from);
    if (peer && candidate) peer.connection.addIceCandidate(new RTCIceCandidate(candidate));
  });

  document.getElementById('admin-login-btn').addEventListener('click', doAdminLogin);
}

function doAdminLogin() {
  const pwd = document.getElementById('admin-password').value;
  fetch('/api/admin/auth', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: pwd })
  })
    .then(r => r.json())
    .then(data => {
      if (data.success) {
        token = data.token;
        showAdminPanel();
        socket.emit('admin-join', { token });
      } else {
        showLoginError();
      }
    })
    .catch(() => showLoginError());
}

function showLoginError() {
  const err = document.getElementById('adminLoginError');
  err.classList.remove('hidden');
  setTimeout(() => err.classList.add('hidden'), 2000);
}

function showAdminPanel() {
  document.getElementById('adminLogin').classList.add('hidden');
  document.getElementById('adminPanel').classList.remove('hidden');
}

function updateRoomList(rooms) {
  const listEl = document.getElementById('roomsList');
  listEl.innerHTML = '';
  document.getElementById('roomCount').textContent = `Комнат: ${rooms.length}`;
  rooms.forEach(r => {
    const item = document.createElement('div');
    item.className = 'room-item';
    item.textContent = `${r.roomId} (${r.count})`;
    item.addEventListener('click', () => watchRoom(r.roomId));
    listEl.appendChild(item);
  });
}

function watchRoom(roomId) {
  currentWatchingRoom = roomId;
  // reset grid
  const grid = document.getElementById('adminVideoGrid');
  grid.innerHTML = '';
  document.getElementById('noRoomMsg').classList.add('hidden');
  const watchSection = document.getElementById('watchingRoom');
  document.getElementById('watchRoomId').textContent = roomId;
  watchSection.classList.remove('hidden');
  socket.emit('admin-watch', { roomId, token });
}

function createAdminPeer(userId, username) {
  if (adminPeers.has(userId)) return;
  const connection = new RTCPeerConnection(iceServers);
  const wrapper = document.createElement('div');
  wrapper.className = 'admin-video-wrapper';
  wrapper.id = `admin-video-${userId}`;
  wrapper.innerHTML = `<video autoplay playsinline></video><div class="admin-video-overlay"><span class="admin-video-name">${escapeHtml(username)}</span><span class="admin-video-id">${userId}</span></div>`;
  const video = wrapper.querySelector('video');
  document.getElementById('adminVideoGrid').appendChild(wrapper);

  adminPeers.set(userId, { connection, videoEl: wrapper, username });

  connection.onicecandidate = e => {
    if (e.candidate) socket.emit('admin-ice-candidate', { to: userId, candidate: e.candidate });
  };

  connection.ontrack = e => {
    console.log('admin received track from', userId, e.streams);
    if (e.streams && e.streams[0]) {
      video.srcObject = e.streams[0];
    } else {
      // no stream - keep black placeholder or show text
      console.warn('no stream received for', userId);
    }
  };

  connection.oniceconnectionstatechange = () => {
    if (connection.iceConnectionState === 'failed') connection.restartIce();
  };

  connection.onnegotiationneeded = async () => {
    try {
      const offer = await connection.createOffer();
      await connection.setLocalDescription(offer);
      socket.emit('admin-offer', { to: userId, offer });
    } catch (err) {
      console.error('Admin offer error', err);
    }
  };
}

function removeAdminPeer(userId) {
  const peer = adminPeers.get(userId);
  if (peer) {
    peer.connection.close();
    if (peer.videoEl && peer.videoEl.parentNode) peer.videoEl.remove();
    adminPeers.delete(userId);
  }
}

function escapeHtml(str) {
  return str.replace(/[&<>"]+/g, s => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[s]);
}

if (document.readyState !== 'loading') {
  initAdmin();
} else {
  document.addEventListener('DOMContentLoaded', initAdmin);
}
