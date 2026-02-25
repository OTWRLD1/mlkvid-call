document.addEventListener('DOMContentLoaded', () => {
  // ===== Элементы =====
  const joinModal = document.getElementById('join-modal');
  const joinUsernameInput = document.getElementById('join-username');
  const joinBtn = document.getElementById('join-btn');
  const previewVideo = document.getElementById('preview-video');
  const previewPlaceholder = document.getElementById('preview-placeholder');
  const previewToggleVideo = document.getElementById('preview-toggle-video');
  const previewToggleAudio = document.getElementById('preview-toggle-audio');

  const roomContainer = document.getElementById('room-container');
  const videoGrid = document.getElementById('video-grid');
  const localVideo = document.getElementById('local-video');
  const roomIdDisplay = document.getElementById('room-id-display');
  const copyLinkBtn = document.getElementById('copy-link-btn');
  const participantsCount = document.getElementById('participants-count').querySelector('span');
  const callTimer = document.getElementById('call-timer');

  const toggleAudioBtn = document.getElementById('toggle-audio');
  const toggleVideoBtn = document.getElementById('toggle-video');
  const toggleScreenBtn = document.getElementById('toggle-screen');
  const leaveBtn = document.getElementById('leave-btn');
  const localAudioIndicator = document.getElementById('local-audio-indicator');

  // ===== Состояние =====
  const roomId = window.location.pathname.split('/').pop();
  let username = '';
  let localStream = null;
  let screenStream = null;
  let socket = null;
  let audioEnabled = true;
  let videoEnabled = true;
  let screenSharing = false;
  let timerInterval = null;
  let callStartTime = null;

  // Хранение пиров
  const peers = new Map(); // userId -> { connection, stream, username, videoEl }

  // ICE серверы
  const iceServers = {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      { urls: 'stun:stun2.l.google.com:19302' },
      { urls: 'stun:stun3.l.google.com:19302' },
      { urls: 'stun:stun4.l.google.com:19302' }
    ]
  };

  // ===== Инициализация =====
  roomIdDisplay.textContent = roomId;

  // Загрузить имя
  const savedName = localStorage.getItem('videocall-username');
  if (savedName) {
    joinUsernameInput.value = savedName;
  }

  // Запросить превью с максимальным шумодавом
  initPreview();

  async function initPreview() {
    try {
      localStream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 1280 },
          height: { ideal: 720 },
          facingMode: 'user'
        },
        audio: {
          // Максимальный шумодав (как в модах Minecraft)
          echoCancellation: { ideal: true },
          noiseSuppression: { ideal: true },
          autoGainControl: { ideal: true },
          // Специфичные для Chrome (работают лучше стандарта)
          googEchoCancellation: true,
          googNoiseSuppression: true,
          googAutoGainControl: true,
          googHighpassFilter: true,
          googTypingNoiseDetection: true,
          googNoiseReduction: true,
          // Качество аудио
          sampleRate: { ideal: 48000 },
          sampleSize: { ideal: 16 },
          channelCount: { ideal: 1 }
        }
      });
      previewVideo.srcObject = localStream;
      previewPlaceholder.classList.add('hidden');
    } catch (err) {
      console.warn('Не удалось получить медиа:', err);
      // Пробуем только аудио
      try {
        localStream = await navigator.mediaDevices.getUserMedia({ 
          audio: {
            echoCancellation: { ideal: true },
            noiseSuppression: { ideal: true },
            autoGainControl: { ideal: true },
            googEchoCancellation: true,
            googNoiseSuppression: true,
            googAutoGainControl: true,
            googNoiseReduction: true
          } 
        });
        videoEnabled = false;
        previewToggleVideo.classList.remove('active');
        previewToggleVideo.innerHTML = '<i class="fas fa-video-slash"></i>';
      } catch (e) {
        console.warn('Медиа недоступны:', e);
        localStream = new MediaStream();
        videoEnabled = false;
        audioEnabled = false;
        previewToggleVideo.classList.remove('active');
        previewToggleAudio.classList.remove('active');
      }
    }
  }

  // Превью кнопки
  previewToggleVideo.addEventListener('click', () => {
    if (!localStream) return;
    const videoTrack = localStream.getVideoTracks()[0];
    if (videoTrack) {
      videoEnabled = !videoEnabled;
      videoTrack.enabled = videoEnabled;
      previewToggleVideo.classList.toggle('active', videoEnabled);
      previewToggleVideo.innerHTML = videoEnabled
        ? '<i class="fas fa-video"></i>'
        : '<i class="fas fa-video-slash"></i>';
      previewPlaceholder.classList.toggle('hidden', videoEnabled);
    }
  });

  previewToggleAudio.addEventListener('click', () => {
    if (!localStream) return;
    const audioTrack = localStream.getAudioTracks()[0];
    if (audioTrack) {
      audioEnabled = !audioEnabled;
      audioTrack.enabled = audioEnabled;
      previewToggleAudio.classList.toggle('active', audioEnabled);
      previewToggleAudio.innerHTML = audioEnabled
        ? '<i class="fas fa-microphone"></i>'
        : '<i class="fas fa-microphone-slash"></i>';
    }
  });

  // Присоединение к комнате
  joinBtn.addEventListener('click', joinRoom);
  joinUsernameInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') joinRoom();
  });

  function joinRoom() {
    username = joinUsernameInput.value.trim();
    if (!username) {
      joinUsernameInput.focus();
      joinUsernameInput.style.borderColor = '#f44336';
      setTimeout(() => { joinUsernameInput.style.borderColor = ''; }, 2000);
      return;
    }
    localStorage.setItem('videocall-username', username);

    // Показать комнату
    joinModal.style.display = 'none';
    roomContainer.classList.remove('hidden');

    // Установить локальное видео
    localVideo.srcObject = localStream;

    // Настройка обработчиков для локального видео (fullscreen + portrait)
    setupVideoHandlers(document.getElementById('local-video-wrapper'), localVideo, 'Вы');

    // Синхронизировать кнопки
    toggleAudioBtn.classList.toggle('active', audioEnabled);
    toggleAudioBtn.querySelector('i').className = audioEnabled
      ? 'fas fa-microphone' : 'fas fa-microphone-slash';
    localAudioIndicator.classList.toggle('hidden', audioEnabled);

    toggleVideoBtn.classList.toggle('active', videoEnabled);
    toggleVideoBtn.querySelector('i').className = videoEnabled
      ? 'fas fa-video' : 'fas fa-video-slash';

    // Подключиться к сокету
    connectSocket();

    // Запустить таймер
    startTimer();

    // Обновить сетку
    updateGrid();
  }

  // ===== Утилиты для видео =====
  
  function setupVideoHandlers(wrapper, videoEl, uname) {
    // Определение вертикального видео
    const checkOrientation = () => {
      if (videoEl.videoHeight > videoEl.videoWidth) {
        wrapper.classList.add('portrait');
      } else {
        wrapper.classList.remove('portrait');
      }
    };

    videoEl.addEventListener('loadedmetadata', checkOrientation);
    // Проверяем сразу если метаданные уже загружены
    if (videoEl.readyState >= 1) checkOrientation();

    // Обработчик клика для полноэкранного режима
    wrapper.addEventListener('click', (e) => {
      // Игнорируем клики по индикаторам микрофона
      if (e.target.closest('.video-indicators')) return;
      
      toggleFullscreen(wrapper);
    });
  }

  function toggleFullscreen(wrapper) {
    const isFullscreen = wrapper.classList.contains('fullscreen');
    
    // Закрываем все открытые fullscreen
    document.querySelectorAll('.video-wrapper.fullscreen').forEach(el => {
      el.classList.remove('fullscreen');
    });

    // Если не был fullscreen - открываем
    if (!isFullscreen) {
      wrapper.classList.add('fullscreen');
    }
  }

  // ===== Socket.IO =====
  function connectSocket() {
    socket = io();

    socket.on('connect', () => {
      console.log('Подключено к серверу:', socket.id);
      socket.emit('join-room', { roomId, username });
    });

    // Список существующих пользователей
    socket.on('existing-users', (users) => {
      console.log('Существующие пользователи:', users);
      users.forEach(user => {
        createPeerConnection(user.userId, user.username, true);
      });
    });

    // Новый пользователь
    socket.on('user-joined', ({ userId, username: uname }) => {
      console.log(`${uname} присоединился`);
      showNotification(`${uname} присоединился`, 'join');
      createPeerConnection(userId, uname, false);
    });

    // Получение offer
    socket.on('offer', async ({ from, username: uname, offer }) => {
      console.log('Получен offer от', from);
      let peer = peers.get(from);
      if (!peer) {
        createPeerConnection(from, uname, false);
        peer = peers.get(from);
      }

      try {
        await peer.connection.setRemoteDescription(new RTCSessionDescription(offer));
        const answer = await peer.connection.createAnswer();
        await peer.connection.setLocalDescription(answer);
        socket.emit('answer', { to: from, answer });
      } catch (err) {
        console.error('Ошибка обработки offer:', err);
      }
    });

    // Получение answer
    socket.on('answer', async ({ from, answer }) => {
      console.log('Получен answer от', from);
      const peer = peers.get(from);
      if (peer) {
        try {
          await peer.connection.setRemoteDescription(new RTCSessionDescription(answer));
        } catch (err) {
          console.error('Ошибка обработки answer:', err);
        }
      }
    });

    // ICE candidate
    socket.on('ice-candidate', ({ from, candidate }) => {
      const peer = peers.get(from);
      if (peer && candidate) {
        peer.connection.addIceCandidate(new RTCIceCandidate(candidate)).catch(console.error);
      }
    });

    // Пользователь ушёл
    socket.on('user-left', ({ userId, username: uname }) => {
      console.log(`${uname} покинул звонок`);
      showNotification(`${uname} покинул звонок`, 'leave');
      removePeer(userId);
    });

    // Комната переполнена
    socket.on('room-full', () => {
      alert('Комната переполнена (максимум 10 участников)');
      window.location.href = '/';
    });

    // Переключение медиа другим пользователем
    socket.on('user-toggle-media', ({ userId, type, enabled }) => {
      const peer = peers.get(userId);
      if (!peer) return;

      const wrapper = peer.videoEl;
      if (type === 'audio') {
        const indicator = wrapper.querySelector('.audio-off');
        if (indicator) indicator.classList.toggle('hidden', enabled);
      }
      if (type === 'video') {
        updateVideoPlaceholder(wrapper, peer.username, !enabled);
      }
    });

    // Демонстрация экрана другим пользователем
    socket.on('user-screen-sharing', ({ userId, enabled }) => {
      const peer = peers.get(userId);
      if (peer) {
        const wrapper = peer.videoEl;
        if (enabled) {
          wrapper.classList.add('screen-sharing');
        } else {
          wrapper.classList.remove('screen-sharing');
        }
      }
    });
  }

  // ===== WebRTC =====
  function createPeerConnection(userId, uname, initiator) {
    console.log(`Создание соединения с ${uname} (${userId}), initiator: ${initiator}`);

    const connection = new RTCPeerConnection(iceServers);

    // Добавить локальные треки
    if (localStream) {
      localStream.getTracks().forEach(track => {
        connection.addTrack(track, localStream);
      });
    }

    // Создать видео элемент для удалённого пользователя
    const videoEl = createVideoElement(userId, uname);

    const peer = {
      connection,
      stream: null,
      username: uname,
      videoEl
    };
    peers.set(userId, peer);

    // ICE candidates
    connection.onicecandidate = (event) => {
      if (event.candidate) {
        socket.emit('ice-candidate', {
          to: userId,
          candidate: event.candidate
        });
      }
    };

    // Получение удалённого потока
    connection.ontrack = (event) => {
      console.log('Получен трек от', uname);
      const remoteStream = event.streams[0];
      peer.stream = remoteStream;
      const video = videoEl.querySelector('video');
      if (video) {
        video.srcObject = remoteStream;
        // Проверим ориентацию после загрузки метаданных
        video.addEventListener('loadedmetadata', () => {
          if (video.videoHeight > video.videoWidth) {
            videoEl.classList.add('portrait');
          }
        }, { once: true });
      }
    };

    // Отслеживание состояния
    connection.oniceconnectionstatechange = () => {
      console.log(`ICE состояние с ${uname}: ${connection.iceConnectionState}`);
      if (connection.iceConnectionState === 'disconnected' ||
          connection.iceConnectionState === 'failed') {
        // Попытка переподключения
        if (connection.iceConnectionState === 'failed') {
          connection.restartIce();
        }
      }
    };

    connection.onnegotiationneeded = async () => {
      if (initiator) {
        try {
          const offer = await connection.createOffer();
          await connection.setLocalDescription(offer);
          socket.emit('offer', { to: userId, offer });
        } catch (err) {
          console.error('Ошибка создания offer:', err);
        }
      }
    };

    updateGrid();
    updateParticipantsCount();
  }

  function createVideoElement(userId, uname) {
    const wrapper = document.createElement('div');
    wrapper.className = 'video-wrapper';
    wrapper.id = `video-${userId}`;

    wrapper.innerHTML = `
      <video autoplay playsinline></video>
      <div class="video-overlay">
        <span class="video-username">${escapeHtml(uname)}</span>
        <div class="video-indicators">
          <i class="fas fa-microphone-slash audio-off hidden"></i>
        </div>
      </div>
    `;

    const video = wrapper.querySelector('video');
    
    // Настраиваем обработчики для полноэкранного режима и определения ориентации
    setupVideoHandlers(wrapper, video, uname);

    videoGrid.appendChild(wrapper);
    return wrapper;
  }

  function updateVideoPlaceholder(wrapper, uname, showPlaceholder) {
    let placeholder = wrapper.querySelector('.video-off-placeholder');

    if (showPlaceholder) {
      if (!placeholder) {
        placeholder = document.createElement('div');
        placeholder.className = 'video-off-placeholder';
        const initial = uname ? uname.charAt(0) : '?';
        placeholder.innerHTML = `
          <div class="avatar-circle">${escapeHtml(initial)}</div>
          <span>${escapeHtml(uname)}</span>
        `;
        wrapper.appendChild(placeholder);
      }
    } else {
      if (placeholder) {
        placeholder.remove();
      }
    }
  }

  function removePeer(userId) {
    const peer = peers.get(userId);
    if (peer) {
      peer.connection.close();
      if (peer.videoEl && peer.videoEl.parentNode) {
        peer.videoEl.parentNode.removeChild(peer.videoEl);
      }
      peers.delete(userId);
    }
    updateGrid();
    updateParticipantsCount();
  }

  // ===== Управление =====

  // Микрофон
  toggleAudioBtn.addEventListener('click', () => {
    if (!localStream) return;
    const audioTrack = localStream.getAudioTracks()[0];
    if (!audioTrack) return;

    audioEnabled = !audioEnabled;
    audioTrack.enabled = audioEnabled;

    toggleAudioBtn.classList.toggle('active', audioEnabled);
    toggleAudioBtn.querySelector('i').className = audioEnabled
      ? 'fas fa-microphone' : 'fas fa-microphone-slash';
    localAudioIndicator.classList.toggle('hidden', audioEnabled);

    socket.emit('toggle-media', { type: 'audio', enabled: audioEnabled });
  });

  // Камера
  toggleVideoBtn.addEventListener('click', () => {
    if (!localStream) return;
    const videoTrack = localStream.getVideoTracks()[0];
    if (!videoTrack) return;

    videoEnabled = !videoEnabled;
    videoTrack.enabled = videoEnabled;

    toggleVideoBtn.classList.toggle('active', videoEnabled);
    toggleVideoBtn.querySelector('i').className = videoEnabled
      ? 'fas fa-video' : 'fas fa-video-slash';

    // Показать/скрыть заглушку для локального видео
    const localWrapper = document.getElementById('local-video-wrapper');
    updateVideoPlaceholder(localWrapper, username, !videoEnabled);

    socket.emit('toggle-media', { type: 'video', enabled: videoEnabled });
  });

  // Демонстрация экрана
  toggleScreenBtn.addEventListener('click', async () => {
    if (!screenSharing) {
      try {
        screenStream = await navigator.mediaDevices.getDisplayMedia({
          video: { cursor: 'always' },
          audio: false
        });

        const screenTrack = screenStream.getVideoTracks()[0];

        // Заменить видео-трек у всех пиров
        peers.forEach((peer) => {
          const sender = peer.connection.getSenders().find(s => s.track && s.track.kind === 'video');
          if (sender) {
            sender.replaceTrack(screenTrack);
          }
        });

        // Заменить локальное видео
        localVideo.srcObject = screenStream;

        screenSharing = true;
        toggleScreenBtn.classList.add('active');
        socket.emit('screen-sharing', { enabled: true });

        // Обработка остановки через системный интерфейс
        screenTrack.onended = () => {
          stopScreenSharing();
        };

      } catch (err) {
        console.error('Ошибка демонстрации экрана:', err);
      }
    } else {
      stopScreenSharing();
    }
  });

  function stopScreenSharing() {
    if (!screenSharing) return;

    const videoTrack = localStream.getVideoTracks()[0];

    // Вернуть видео-трек камеры
    peers.forEach((peer) => {
      const sender = peer.connection.getSenders().find(s => s.track && s.track.kind === 'video');
      if (sender && videoTrack) {
        sender.replaceTrack(videoTrack);
      }
    });

    // Вернуть локальное видео
    localVideo.srcObject = localStream;

    if (screenStream) {
      screenStream.getTracks().forEach(t => t.stop());
      screenStream = null;
    }

    screenSharing = false;
    toggleScreenBtn.classList.remove('active');
    socket.emit('screen-sharing', { enabled: false });
  }

  // Выйти
  leaveBtn.addEventListener('click', () => {
    leaveRoom();
  });

  function leaveRoom() {
    // Остановить все треки
    if (localStream) {
      localStream.getTracks().forEach(t => t.stop());
    }
    if (screenStream) {
      screenStream.getTracks().forEach(t => t.stop());
    }

    // Закрыть все соединения
    peers.forEach((peer, userId) => {
      peer.connection.close();
    });
    peers.clear();

    // Отключить сокет
    if (socket) {
      socket.disconnect();
    }

    // Остановить таймер
    if (timerInterval) {
      clearInterval(timerInterval);
    }

    window.location.href = '/';
  }

  // Копировать ссылку
  copyLinkBtn.addEventListener('click', () => {
    const url = window.location.href;
    navigator.clipboard.writeText(url).then(() => {
      showCopyToast();
    }).catch(() => {
      // Fallback
      const input = document.createElement('input');
      input.value = url;
      document.body.appendChild(input);
      input.select();
      document.execCommand('copy');
      document.body.removeChild(input);
      showCopyToast();
    });
  });

  function showCopyToast() {
    const toast = document.getElementById('copy-toast');
    toast.classList.remove('hidden');
    setTimeout(() => {
      toast.classList.add('hidden');
    }, 2000);
  }

  // ===== Утилиты =====

  function updateGrid() {
    const count = peers.size + 1; // +1 для локального
    // Убрать старые классы
    videoGrid.className = 'video-grid';
    videoGrid.classList.add(`grid-${Math.min(count, 10)}`);
  }

  function updateParticipantsCount() {
    participantsCount.textContent = peers.size + 1;
  }

  function startTimer() {
    callStartTime = Date.now();
    timerInterval = setInterval(() => {
      const elapsed = Math.floor((Date.now() - callStartTime) / 1000);
      const minutes = String(Math.floor(elapsed / 60)).padStart(2, '0');
      const seconds = String(elapsed % 60).padStart(2, '0');
      callTimer.textContent = `${minutes}:${seconds}`;
    }, 1000);
  }

  function showNotification(message, type) {
    const container = document.getElementById('notifications');
    const notification = document.createElement('div');
    notification.className = `notification ${type}`;

    let icon = 'info-circle';
    if (type === 'join') icon = 'user-plus';
    if (type === 'leave') icon = 'user-minus';

    notification.innerHTML = `<i class="fas fa-${icon}"></i> ${escapeHtml(message)}`;
    container.appendChild(notification);

    setTimeout(() => {
      if (notification.parentNode) {
        notification.parentNode.removeChild(notification);
      }
    }, 3000);
  }

  function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // ===== Глобальные обработчики =====

  // Выход из полноэкранного по ESC
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      document.querySelectorAll('.video-wrapper.fullscreen').forEach(el => {
        el.classList.remove('fullscreen');
      });
    }
  });

  // Обработка закрытия страницы
  window.addEventListener('beforeunload', () => {
    if (socket) {
      socket.disconnect();
    }
    if (localStream) {
      localStream.getTracks().forEach(t => t.stop());
    }
  });
});