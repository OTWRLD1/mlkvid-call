document.addEventListener('DOMContentLoaded', () => {
  // ===== Элементы =====
  const joinModal = document.getElementById('join-modal');
  const joinUsernameInput = document.getElementById('join-username');
  const joinBtn = document.getElementById('join-btn');
  const previewVideo = document.getElementById('preview-video');
  const previewPlaceholder = document.getElementById('preview-placeholder');
  const previewToggleVideo = document.getElementById('preview-toggle-video');
  const previewToggleAudio = document.getElementById('preview-toggle-audio');
  const cameraSelect = document.getElementById('camera-select');
  const micSelect = document.getElementById('mic-select');

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
  let currentCameraId = null;
  let currentMicId = null;

  // Хранение пиров
  const peers = new Map();

  // ICE серверы
  const iceServers = {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      { urls: 'stun:stun2.l.google.com:19302' }
    ]
  };

  // ===== Инициализация =====
  roomIdDisplay.textContent = roomId;

  const savedName = localStorage.getItem('videocall-username');
  if (savedName) {
    joinUsernameInput.value = savedName;
  }

  // Загрузка и выбор устройств
  initDevices();

  async function initDevices() {
    try {
      // Запрашиваем разрешение первый раз, чтобы получить список устройств
      const tempStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
      tempStream.getTracks().forEach(t => t.stop());
      
      const devices = await navigator.mediaDevices.enumerateDevices();
      
      const cameras = devices.filter(d => d.kind === 'videoinput');
      const mics = devices.filter(d => d.kind === 'audioinput');
      
      // Заполняем селекторы
      cameraSelect.innerHTML = cameras.map((cam, idx) => 
        `<option value="${cam.deviceId}" ${idx === 0 ? 'selected' : ''}>${cam.label || `Камера ${idx + 1}`}</option>`
      ).join('');
      
      micSelect.innerHTML = mics.map((mic, idx) => 
        `<option value="${mic.deviceId}" ${idx === 0 ? 'selected' : ''}>${mic.label || `Микрофон ${idx + 1}`}</option>`
      ).join('');
      
      currentCameraId = cameraSelect.value;
      currentMicId = micSelect.value;
      
      // Инициализация превью с выбранными устройствами
      initPreview();
      
      // Обработчики смены устройств
      cameraSelect.addEventListener('change', async () => {
        currentCameraId = cameraSelect.value;
        await restartPreview();
      });
      
      micSelect.addEventListener('change', async () => {
        currentMicId = micSelect.value;
        await restartPreview();
      });
      
    } catch (err) {
      console.error('Ошибка доступа к устройствам:', err);
      // Пробуем без разрешений (будет пустой список)
      initPreview();
    }
  }

  async function initPreview() {
    try {
      const constraints = {
        video: currentCameraId ? {
          deviceId: { exact: currentCameraId },
          width: { ideal: 1280 },
          height: { ideal: 720 }
        } : {
          width: { ideal: 1280 },
          height: { ideal: 720 }
        },
        audio: currentMicId ? {
          deviceId: { exact: currentMicId },
          echoCancellation: { ideal: true },
          noiseSuppression: { ideal: true },
          autoGainControl: { ideal: true },
          googEchoCancellation: true,
          googNoiseSuppression: true,
          googAutoGainControl: true,
          googHighpassFilter: true,
          googTypingNoiseDetection: true,
          googNoiseReduction: true,
          sampleRate: { ideal: 48000 },
          sampleSize: { ideal: 16 },
          channelCount: { ideal: 1 }
        } : {
          echoCancellation: { ideal: true },
          noiseSuppression: { ideal: true },
          autoGainControl: { ideal: true },
          googEchoCancellation: true,
          googNoiseSuppression: true,
          googAutoGainControl: true,
          googHighpassFilter: true,
          googTypingNoiseDetection: true,
          googNoiseReduction: true,
          sampleRate: { ideal: 48000 },
          sampleSize: { ideal: 16 },
          channelCount: { ideal: 1 }
        }
      };
      
      localStream = await navigator.mediaDevices.getUserMedia(constraints);
      previewVideo.srcObject = localStream;
      previewPlaceholder.classList.add('hidden');
      
      // Обновляем состояние кнопок
      const videoTrack = localStream.getVideoTracks()[0];
      const audioTrack = localStream.getAudioTracks()[0];
      
      if (videoTrack) {
        videoEnabled = videoTrack.enabled;
        previewToggleVideo.classList.toggle('active', videoEnabled);
        previewToggleVideo.innerHTML = videoEnabled ? '<i class="fas fa-video"></i>' : '<i class="fas fa-video-slash"></i>';
        previewPlaceholder.classList.toggle('hidden', videoEnabled);
      }
      
      if (audioTrack) {
        audioEnabled = audioTrack.enabled;
        previewToggleAudio.classList.toggle('active', audioEnabled);
        previewToggleAudio.innerHTML = audioEnabled ? '<i class="fas fa-microphone"></i>' : '<i class="fas fa-microphone-slash"></i>';
      }
      
    } catch (err) {
      console.warn('Не удалось получить медиа:', err);
      try {
        // Пробуем только аудио
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

  async function restartPreview() {
    if (localStream) {
      localStream.getTracks().forEach(t => t.stop());
    }
    await initPreview();
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

    joinModal.style.display = 'none';
    roomContainer.classList.remove('hidden');

    localVideo.srcObject = localStream;
    
    // Убираем зеркальность при демонстрации экрана будет проверяться в toggleScreen
    updateLocalVideoTransform();

    setupVideoHandlers(document.getElementById('local-video-wrapper'), localVideo, 'Вы');

    toggleAudioBtn.classList.toggle('active', audioEnabled);
    toggleAudioBtn.querySelector('i').className = audioEnabled
      ? 'fas fa-microphone' : 'fas fa-microphone-slash';
    localAudioIndicator.classList.toggle('hidden', audioEnabled);

    toggleVideoBtn.classList.toggle('active', videoEnabled);
    toggleVideoBtn.querySelector('i').className = videoEnabled
      ? 'fas fa-video' : 'fas fa-video-slash';

    connectSocket();
    startTimer();
    updateGrid();
  }

  // ===== Утилиты для видео =====
  
  function updateLocalVideoTransform() {
    const wrapper = document.getElementById('local-video-wrapper');
    if (screenSharing) {
      // Демонстрация экрана - не зеркалим
      localVideo.style.transform = 'none';
      wrapper.classList.remove('local');
    } else {
      // Камера - зеркалим для локального пользователя (как в зеркале)
      localVideo.style.transform = 'scaleX(-1)';
      wrapper.classList.add('local');
    }
  }

  function setupVideoHandlers(wrapper, videoEl, uname) {
    const checkOrientation = () => {
      if (videoEl.videoHeight > videoEl.videoWidth) {
        wrapper.classList.add('portrait');
      } else {
        wrapper.classList.remove('portrait');
      }
    };

    videoEl.addEventListener('loadedmetadata', checkOrientation);
    if (videoEl.readyState >= 1) checkOrientation();

    wrapper.addEventListener('click', (e) => {
      if (e.target.closest('.video-indicators')) return;
      toggleFullscreen(wrapper);
    });
  }

  function toggleFullscreen(wrapper) {
    const isFullscreen = wrapper.classList.contains('fullscreen');
    
    document.querySelectorAll('.video-wrapper.fullscreen').forEach(el => {
      el.classList.remove('fullscreen');
    });

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

    socket.on('existing-users', (users) => {
      console.log('Существующие пользователи:', users);
      users.forEach(user => {
        createPeerConnection(user.userId, user.username, true);
      });
    });

    socket.on('user-joined', ({ userId, username: uname }) => {
      console.log(`${uname} присоединился`);
      showNotification(`${uname} присоединился`, 'join');
      createPeerConnection(userId, uname, false);
    });

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

    socket.on('ice-candidate', ({ from, candidate }) => {
      const peer = peers.get(from);
      if (peer && candidate) {
        peer.connection.addIceCandidate(new RTCIceCandidate(candidate)).catch(console.error);
      }
    });

    socket.on('user-left', ({ userId, username: uname }) => {
      console.log(`${uname} покинул звонок`);
      showNotification(`${uname} покинул звонок`, 'leave');
      removePeer(userId);
    });

    socket.on('room-full', () => {
      alert('Комната переполнена (максимум 10 участников)');
      window.location.href = '/';
    });

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

    if (localStream) {
      localStream.getTracks().forEach(track => {
        connection.addTrack(track, localStream);
      });
    }

    const videoEl = createVideoElement(userId, uname);

    const peer = {
      connection,
      stream: null,
      username: uname,
      videoEl
    };
    peers.set(userId, peer);

    connection.onicecandidate = (event) => {
      if (event.candidate) {
        socket.emit('ice-candidate', {
          to: userId,
          candidate: event.candidate
        });
      }
    };

    connection.ontrack = (event) => {
      console.log('Получен трек от', uname);
      const remoteStream = event.streams[0];
      peer.stream = remoteStream;
      const video = videoEl.querySelector('video');
      if (video) {
        video.srcObject = remoteStream;
        video.addEventListener('loadedmetadata', () => {
          if (video.videoHeight > video.videoWidth) {
            videoEl.classList.add('portrait');
          }
        }, { once: true });
      }
    };

    connection.oniceconnectionstatechange = () => {
      console.log(`ICE состояние с ${uname}: ${connection.iceConnectionState}`);
      if (connection.iceConnectionState === 'disconnected' ||
          connection.iceConnectionState === 'failed') {
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
    
    // Удаленные видео никогда не зеркалим
    video.style.transform = 'none';
    
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

  toggleVideoBtn.addEventListener('click', () => {
    if (!localStream) return;
    const videoTrack = localStream.getVideoTracks()[0];
    if (!videoTrack) return;

    videoEnabled = !videoEnabled;
    videoTrack.enabled = videoEnabled;

    toggleVideoBtn.classList.toggle('active', videoEnabled);
    toggleVideoBtn.querySelector('i').className = videoEnabled
      ? 'fas fa-video' : 'fas fa-video-slash';

    const localWrapper = document.getElementById('local-video-wrapper');
    updateVideoPlaceholder(localWrapper, username, !videoEnabled);

    socket.emit('toggle-media', { type: 'video', enabled: videoEnabled });
  });

  // Демонстрация экрана с аудио
  toggleScreenBtn.addEventListener('click', async () => {
    if (!screenSharing) {
      try {
        // Захватываем видео и аудио с экрана (system audio)
        screenStream = await navigator.mediaDevices.getDisplayMedia({
          video: { cursor: 'always' },
          audio: {
            echoCancellation: false,
            noiseSuppression: false,
            sampleRate: 48000
          }
        });

        const screenVideoTrack = screenStream.getVideoTracks()[0];
        const screenAudioTrack = screenStream.getAudioTracks()[0];

        // Заменяем видео-трек у всех пиров
        peers.forEach((peer) => {
          const videoSender = peer.connection.getSenders().find(s => s.track && s.track.kind === 'video');
          if (videoSender) {
            videoSender.replaceTrack(screenVideoTrack);
          }
          
          // Добавляем аудио-трек с экрана, если его еще нет
          if (screenAudioTrack) {
            const audioSender = peer.connection.getSenders().find(s => s.track && s.track.kind === 'audio');
            if (audioSender) {
              // Создаем новый трансивер для аудио экрана или заменяем существующий
              audioSender.replaceTrack(screenAudioTrack);
            } else {
              peer.connection.addTrack(screenAudioTrack, screenStream);
            }
          }
        });

        // Показываем демонстрацию локально
        localVideo.srcObject = screenStream;
        
        // Убираем зеркальность для демонстрации
        updateLocalVideoTransform();

        screenSharing = true;
        toggleScreenBtn.classList.add('active');
        socket.emit('screen-sharing', { enabled: true });

        // Обработка остановки демонстрации
        screenVideoTrack.onended = () => {
          stopScreenSharing();
        };
        
        if (screenAudioTrack) {
          screenAudioTrack.onended = () => {
            // Если аудио остановилось раньше видео
            if (screenSharing) stopScreenSharing();
          };
        }

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
    const audioTrack = localStream.getAudioTracks()[0];

    // Возвращаем треки камеры и микрофона
    peers.forEach((peer) => {
      const videoSender = peer.connection.getSenders().find(s => s.track && s.track.kind === 'video');
      if (videoSender && videoTrack) {
        videoSender.replaceTrack(videoTrack);
      }
      
      const audioSender = peer.connection.getSenders().find(s => s.track && s.track.kind === 'audio');
      if (audioSender && audioTrack) {
        audioSender.replaceTrack(audioTrack);
      }
    });

    // Возвращаем локальное видео камеры
    localVideo.srcObject = localStream;
    
    // Возвращаем зеркальность для камеры
    updateLocalVideoTransform();

    if (screenStream) {
      screenStream.getTracks().forEach(t => t.stop());
      screenStream = null;
    }

    screenSharing = false;
    toggleScreenBtn.classList.remove('active');
    socket.emit('screen-sharing', { enabled: false });
  }

  leaveBtn.addEventListener('click', () => {
    leaveRoom();
  });

  function leaveRoom() {
    if (localStream) {
      localStream.getTracks().forEach(t => t.stop());
    }
    if (screenStream) {
      screenStream.getTracks().forEach(t => t.stop());
    }

    peers.forEach((peer, userId) => {
      peer.connection.close();
    });
    peers.clear();

    if (socket) {
      socket.disconnect();
    }

    if (timerInterval) {
      clearInterval(timerInterval);
    }

    window.location.href = '/';
  }

  copyLinkBtn.addEventListener('click', () => {
    const url = window.location.href;
    navigator.clipboard.writeText(url).then(() => {
      showCopyToast();
    }).catch(() => {
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

  function updateGrid() {
    const count = peers.size + 1;
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

  // Выход из полноэкранного по ESC
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      document.querySelectorAll('.video-wrapper.fullscreen').forEach(el => {
        el.classList.remove('fullscreen');
      });
    }
  });

  window.addEventListener('beforeunload', () => {
    if (socket) {
      socket.disconnect();
    }
    if (localStream) {
      localStream.getTracks().forEach(t => t.stop());
    }
  });
});