// Admin client-side script
// This file handles the socket interactions for the admin dashboard.
// NOTE: corresponding styles are now in public/css/admin.css

let socket;
let currentWatchingRoom = null;
const adminPeers = new Map();

function initAdmin() {
  socket = io();

  socket.on('connect', () => {
    console.log('Admin connected', socket.id);
  });

  // handlers from server
  socket.on('admin-room-users', ({ roomId, users }) => {
    if (roomId === currentWatchingRoom) {
      users.forEach(user => {
        if (!adminPeers.has(user.userId)) {
          createAdminPeer(user.userId, user.username);
        }
      });
    }
  });

  socket.on('user-left', ({ userId }) => {
    removeAdminPeer(userId);
  });

  socket.on('user-joined', ({ userId, username }) => {
    if (currentWatchingRoom) {
      createAdminPeer(userId, username);
    }
  });
}

// stub functions
function createAdminPeer(userId, username) {
  // TODO: implement admin peer creation logic
}

function removeAdminPeer(userId) {
  // TODO: cleanup admin peer
}

if (document.readyState !== 'loading') {
  initAdmin();
} else {
  document.addEventListener('DOMContentLoaded', initAdmin);
}
