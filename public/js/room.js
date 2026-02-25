document.addEventListener('DOMContentLoaded', () => {
  // ===== AudioWorklet для шумодава (Noise Gate) =====
  const audioWorkletCode = `
    class NoiseGateProcessor extends AudioWorkletProcessor {
      constructor() {
        super();
        this.threshold = 0.015;
        this.attack = 0.02;
        this.release = 0.1;
        this.envelope = 0;
        this.holdTime = 0;
        this.holdSamples = Math.floor(sampleRate * 0.05); // 50ms hold
      }
      
      process(inputs, outputs, parameters) {
        const input = inputs[0];
        const output = outputs[0];
        
        if (input.length === 0) return true;
        
        for (let channel = 0; channel < input.length; channel++) {
          const inputChannel = input[channel];
          const outputChannel = output[channel];
          
          for (let i = 0; i < inputChannel.length; i++) {
            const sample = inputChannel[i];
            const abs = Math.abs(sample);
            
            // Обнаружение огибающей с атакой и спадом
            if (abs > this.envelope) {
              this.envelope = abs * this.attack + this.envelope * (1 - this.attack);
              this.holdTime = this.holdSamples;
            } else {
              this.envelope = abs * this.release + this.envelope * (1 - this.release);
              if (this.holdTime > 0) this.holdTime--;
            }
            
            // Noise Gate + мягкое подавление
            if (this.envelope < this.threshold && this.holdTime === 0) {
              // Полное подавление шума
              outputChannel[i] = 0;
            } else if (this.envelope < this.threshold * 2 && this.holdTime === 0) {
              // Мягкое затухание
              const gain = (this.envelope - this.threshold) / this.threshold;
              outputChannel[i] = sample * gain;
            } else {
              outputChannel[i] = sample;
            }
          }
        }
        return true;
      }
    }
    registerProcessor('noise-gate', NoiseGateProcessor);
  `;

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
  const localWrapper = document.getElementById('local-video-wrapper');
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
  let processedStream = null; // С шумодавом
  let screenStream = null;
  let socket = null;
  let audioEnabled = true;
  let videoEnabled = true;
  let screenSharing = false;
  let timerInterval = null;
  let callStartTime = null;
  let currentCameraId = null;
  let currentMicId = null;
  let audioContext = null;
  let noiseGateNode = null;

  const peers = new Map();

  const iceServers = {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      { urls: 'stun:stun2.l.google.com:19302' }
    ]
  };

  // ===== Инициализация шумодава =====
  async function initNoiseSuppression(stream) {
    try {
      if (!stream.getAudioTracks().length) return stream;
      
      audioContext = new (window.AudioContext || window.webkitAudioContext)();
      
      // Создаем Blob из кода Worklet
      const blob = new Blob([audioWorkletCode], { type: 'application/javascript' });
      const url = URL.createObjectURL(blob);
      
      await audioContext.audioWorklet.addModule(url);
      
      const source = audioContext.createMediaStreamSource(stream);
      noiseGateNode = new AudioWorkletNode(audioContext, 'noise-gate');
      const destination = audioContext.createMediaStreamDestination();
      
      source.connect(noiseGateNode);
      noiseGateNode.connect(destination);
      
      // Создаем новый поток: видео из оригинала + аудио из обработанного
      const processedTracks = [
        ...stream.getVideoTracks(),
        ...destination.stream.getAudioTracks()
      ];
      
      processedStream = new MediaStream(processedTracks);
      return processedStream;
    } catch (e) {
      console.warn('Шумодав не удалось применить:', e);
      processedStream = stream;
      return stream;
    }
  }

  // ===== Инициализация =====
  roomIdDisplay.textContent = roomId;

  const savedName = localStorage.getItem('videocall-username');
  if (savedName) {
    joinUsernameInput.value = savedName;
  }

  initDevices();

  async function initDevices() {
    try {
      const tempStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
      tempStream.getTracks().forEach(t => t.stop());
      
      const devices = await navigator.mediaDevices.enumerateDevices();
      
      const cameras = devices.filter(d => d.kind === 'videoinput');
      const mics = devices.filter(d => d.kind === 'audioinput');
      
      cameraSelect.innerHTML = cameras.map((cam, idx) => 
        `<option value="${cam.deviceId}" ${idx === 0 ? 'selected' : ''}>${cam.label || `Камера ${idx + 1}`}</option>`
      ).join('');
      
      micSelect.innerHTML = mics.map((mic, idx) => 
        `<option value="${mic.deviceId}" ${idx === 0 ? 'selected' : ''}>${mic.label || `Микрофон ${idx + 1}`}</option>`
      ).join('');
      
      currentCameraId = cameraSelect.value;
      currentMicId = micSelect.value;
      
      await initPreview();
      
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
      initPreview();
    }
  }

  async function initPreview() {
    try {
      // Максимальные настройки шумоподавления WebRTC + наш обработчик
      const constraints = {
        video: currentCameraId ? {
          deviceId: { exact: currentCameraId },
          width: { ideal: 1280 },
          height: { ideal: 720 }
        } : { width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: {
          deviceId: currentMicId ? { exact: currentMicId } : undefined,
          // Стандартный шумодав (работает в паре с нашим)
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          // Высокое качество аудио
          sampleRate: 48000,
          sampleSize: 16,
          channelCount: 1
        }
      };
      
      localStream = await navigator.mediaDevices.getUserMedia(constraints);
      
      // Применяем дополнительный шумодав через AudioWorklet
      await initNoiseSuppression(localStream);
      
      previewVideo.srcObject = localStream;
      previewPlaceholder.classList.add('hidden');
      
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
        localStream = await navigator.mediaDevices.getUserMedia({ 
          audio: { noiseSuppression: true, echoCancellation: true } 
        });
        await initNoiseSuppression(localStream);
        videoEnabled = false;
        previewToggleVideo.classList.remove('active');
        previewToggleVideo.innerHTML = '<i class="fas fa-video-slash"></i>';
      } catch (e) {
        localStream = new MediaStream();
        processedStream = localStream;
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
    if (audioContext) {
      await audioContext.close();
    }
    await initPreview();
  }

  previewToggleVideo.addEventListener('click', () => {
    if (!localStream) return;
    const videoTrack = localStream.getVideoTracks()[0];
    if (videoTrack) {
      videoEnabled = !videoEnabled;
      videoTrack.enabled = videoEnabled;
      previewToggleVideo.classList.toggle('active', videoEnabled);
      previewToggleVideo.innerHTML = videoEnabled ? '<i class="fas fa-video"></i>' : '<i class="fas fa-video-slash"></i>';
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
      previewToggleAudio.innerHTML = audioEnabled ? '<i class="fas fa-microphone"></i>' : '<i class="fas fa-microphone-slash"></i>';
    }
  });

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

    // Используем processedStream (с шумодавом) если доступен
    const streamToShow = processedStream || localStream;
    localVideo.srcObject = streamToShow;
    
    setupVideoHandlers(localWrapper, localVideo);

    toggleAudioBtn.classList.toggle('active', audioEnabled);
    toggleAudioBtn.querySelector('i').className = audioEnabled ? 'fas fa-microphone' : 'fas fa-microphone-slash';
    localAudioIndicator.classList.toggle('hidden', audioEnabled);

    toggleVideoBtn.classList.toggle('active', videoEnabled);
    toggleVideoBtn.querySelector('i').className = videoEnabled ? 'fas fa-video' : 'fas fa-video-slash';

    connectSocket();
    startTimer();
    updateGrid();
  }

  function setupVideoHandlers(wrapper, videoEl) {
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
      console.log('Подключено:', socket.id);
      socket.emit('join-room', { roomId, username });
    });

    socket.on('existing-users', (users) => {
      users.forEach(user => createPeerConnection(user.userId, user.username, true));
    });

    socket.on('user-joined', ({ userId, username: uname }) => {
      showNotification(`${uname} присоединился`, 'join');
      createPeerConnection(userId, uname, false);
    });

    socket.on('offer', async ({ from, username: uname, offer }) => {
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
        console.error('Ошибка offer:', err);
      }
    });

    socket.on('answer', async ({ from, answer }) => {
      const peer = peers.get(from);
      if (peer) {
        await peer.connection.setRemoteDescription(new RTCSessionDescription(answer));
      }
    });

    socket.on('ice-candidate', ({ from, candidate }) => {
      const peer = peers.get(from);
      if (peer && candidate) {
        peer.connection.addIceCandidate(new RTCIceCandidate(candidate));
      }
    });

    socket.on('user-left', ({ userId, username: uname }) => {
      showNotification(`${uname} покинул звонок`, 'leave');
      removePeer(userId);
    });

    socket.on('room-full', () => {
      alert('Комната переполнена');
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
  }

  // ===== WebRTC =====
  function createPeerConnection(userId, uname, initiator) {
    console.log(`Создание соединения с ${uname}, initiator: ${initiator}`);
    const connection = new RTCPeerConnection(iceServers);

    // Определяем какой поток отправлять
    let streamToSend = processedStream || localStream;
    
    // Если идёт демонстрация - отправляем экран (но аудио с шумодавом оставляем)
    if (screenSharing && screenStream) {
      // Берем видео с экрана
      screenStream.getVideoTracks().forEach(track => {
        connection.addTrack(track, screenStream);
      });
      // Берем аудио с обработанного потока (микрофон с шумодавом)
      if (streamToSend) {
        streamToSend.getAudioTracks().forEach(track => {
          connection.addTrack(track, streamToSend);
        });
      }
    } else if (streamToSend) {
      // Обычный режим - отправляем обработанный поток (с шумодавом)
      streamToSend.getTracks().forEach(track => {
        connection.addTrack(track, streamToSend);
      });
    }

    const videoEl = createVideoElement(userId, uname);
    const peer = { connection, stream: null, username: uname, videoEl };
    peers.set(userId, peer);

    connection.onicecandidate = (event) => {
      if (event.candidate) {
        socket.emit('ice-candidate', { to: userId, candidate: event.candidate });
      }
    };

    connection.ontrack = (event) => {
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
      if (connection.iceConnectionState === 'failed') {
        connection.restartIce();
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
    // Удалённые видео никогда не зеркалим
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
      if (placeholder) placeholder.remove();
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
    
    // Также выключаем в processedStream если есть
    if (processedStream) {
      processedStream.getAudioTracks().forEach(t => t.enabled = audioEnabled);
    }
    
    toggleAudioBtn.classList.toggle('active', audioEnabled);
    toggleAudioBtn.querySelector('i').className = audioEnabled ? 'fas fa-microphone' : 'fas fa-microphone-slash';
    localAudioIndicator.classList.toggle('hidden', audioEnabled);
    socket.emit('toggle-media', { type: 'audio', enabled: audioEnabled });
  });

  toggleVideoBtn.addEventListener('click', () => {
    if (!localStream || screenSharing) return;
    const videoTrack = localStream.getVideoTracks()[0];
    if (!videoTrack) return;
    videoEnabled = !videoEnabled;
    videoTrack.enabled = videoEnabled;
    toggleVideoBtn.classList.toggle('active', videoEnabled);
    toggleVideoBtn.querySelector('i').className = videoEnabled ? 'fas fa-video' : 'fas fa-video-slash';
    updateVideoPlaceholder(localWrapper, username, !videoEnabled);
    socket.emit('toggle-media', { type: 'video', enabled: videoEnabled });
  });

  // ДЕМОНСТРАЦИЯ ЭКРАНА
  toggleScreenBtn.addEventListener('click', async () => {
    if (!screenSharing) {
      try {
        // Захватываем видео и системный звук
        screenStream = await navigator.mediaDevices.getDisplayMedia({
          video: { cursor: 'always' },
          audio: true
        });

        const screenVideoTrack = screenStream.getVideoTracks()[0];
        const screenAudioTrack = screenStream.getAudioTracks()[0];

        // Заменяем треки у всех пиров
        peers.forEach((peer) => {
          const senders = peer.connection.getSenders();
          const videoSender = senders.find(s => s.track && s.track.kind === 'video');
          const audioSender = senders.find(s => s.track && s.track.kind === 'audio');
          
          if (videoSender && screenVideoTrack) {
            videoSender.replaceTrack(screenVideoTrack);
          }
          
          if (screenAudioTrack && audioSender) {
            // Заменяем на звук с экрана
            audioSender.replaceTrack(screenAudioTrack);
          } else if (screenAudioTrack) {
            // Добавляем если не было
            peer.connection.addTrack(screenAudioTrack, screenStream);
          }
        });

        // Локально показываем экран
        localVideo.srcObject = screenStream;
        
        // Убираем зеркальность для демонстрации
        localWrapper.classList.remove('local-camera');
        localWrapper.classList.add('screen-share-active');

        screenSharing = true;
        toggleScreenBtn.classList.add('active');

        // Когда пользователь нажмёт "Остановить" в браузере
        screenVideoTrack.onended = () => {
          stopScreenSharing();
        };
        
      } catch (err) {
        console.error('Ошибка демонстрации:', err);
      }
    } else {
      stopScreenSharing();
    }
  });

  function stopScreenSharing() {
    if (!screenSharing) return;

    const streamToUse = processedStream || localStream;
    const cameraVideoTrack = localStream.getVideoTracks()[0];
    const micAudioTrack = streamToUse.getAudioTracks()[0];

    // Возвращаем камеру и микрофон
    peers.forEach((peer) => {
      const senders = peer.connection.getSenders();
      const videoSender = senders.find(s => s.track && s.track.kind === 'video');
      const audioSender = senders.find(s => s.track && s.track.kind === 'audio');
      
      if (videoSender && cameraVideoTrack) {
        videoSender.replaceTrack(cameraVideoTrack);
      }
      
      if (audioSender && micAudioTrack) {
        audioSender.replaceTrack(micAudioTrack);
      }
    });

    // Локально возвращаем камеру
    const streamToShow = processedStream || localStream;
    localVideo.srcObject = streamToShow;
    
    // Возвращаем зеркальность для камеры
    localWrapper.classList.add('local-camera');
    localWrapper.classList.remove('screen-share-active');

    if (screenStream) {
      screenStream.getTracks().forEach(t => t.stop());
      screenStream = null;
    }

    screenSharing = false;
    toggleScreenBtn.classList.remove('active');
  }

  leaveBtn.addEventListener('click', leaveRoom);

  function leaveRoom() {
    if (localStream) localStream.getTracks().forEach(t => t.stop());
    if (screenStream) screenStream.getTracks().forEach(t => t.stop());
    if (audioContext) audioContext.close();
    peers.forEach(peer => peer.connection.close());
    peers.clear();
    if (socket) socket.disconnect();
    if (timerInterval) clearInterval(timerInterval);
    window.location.href = '/';
  }

  copyLinkBtn.addEventListener('click', () => {
    const url = window.location.href;
    navigator.clipboard.writeText(url).then(() => {
      const toast = document.getElementById('copy-toast');
      toast.classList.remove('hidden');
      setTimeout(() => toast.classList.add('hidden'), 2000);
    });
  });

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
      const mins = String(Math.floor(elapsed / 60)).padStart(2, '0');
      const secs = String(elapsed % 60).padStart(2, '0');
      callTimer.textContent = `${mins}:${secs}`;
    }, 1000);
  }

  function showNotification(message, type) {
    const container = document.getElementById('notifications');
    const notification = document.createElement('div');
    notification.className = `notification ${type}`;
    let icon = type === 'join' ? 'user-plus' : 'user-minus';
    notification.innerHTML = `<i class="fas fa-${icon}"></i> ${escapeHtml(message)}`;
    container.appendChild(notification);
    setTimeout(() => notification.remove(), 3000);
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
    if (socket) socket.disconnect();
    if (localStream) localStream.getTracks().forEach(t => t.stop());
  });
});