document.addEventListener('DOMContentLoaded', () => {
  const usernameInput = document.getElementById('username');
  const createRoomBtn = document.getElementById('create-room-btn');
  const roomIdInput = document.getElementById('room-id-input');
  const joinRoomBtn = document.getElementById('join-room-btn');

  // Загрузить сохранённое имя
  const savedName = localStorage.getItem('videocall-username');
  if (savedName) {
    usernameInput.value = savedName;
  }

  function getUsername() {
    const name = usernameInput.value.trim();
    if (!name) {
      usernameInput.focus();
      usernameInput.style.borderColor = '#f44336';
      setTimeout(() => {
        usernameInput.style.borderColor = '';
      }, 2000);
      return null;
    }
    localStorage.setItem('videocall-username', name);
    return name;
  }

  // Создать комнату
  createRoomBtn.addEventListener('click', () => {
    const username = getUsername();
    if (!username) return;

    // Генерируем ID на клиенте и переходим
    const roomId = generateRoomId();
    window.location.href = `/room/${roomId}`;
  });

  // Присоединиться к комнате
  joinRoomBtn.addEventListener('click', () => {
    const username = getUsername();
    if (!username) return;

    const roomId = roomIdInput.value.trim();
    if (!roomId) {
      roomIdInput.focus();
      roomIdInput.style.borderColor = '#f44336';
      setTimeout(() => {
        roomIdInput.style.borderColor = '';
      }, 2000);
      return;
    }

    window.location.href = `/room/${roomId}`;
  });

  // Enter для присоединения
  roomIdInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      joinRoomBtn.click();
    }
  });

  usernameInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      createRoomBtn.click();
    }
  });

  function generateRoomId() {
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    for (let i = 0; i < 8; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
  }
});