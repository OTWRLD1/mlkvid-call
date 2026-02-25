document.addEventListener('DOMContentLoaded', () => {

  // ===== RNNoise-подобный шумодав через AudioWorklet =====
  const noiseSuppressionWorklet = `
    class RNNoiseProcessor extends AudioWorkletProcessor {
      constructor() {
        super();
        this.noiseFloor = 0.008;
        this.speechThreshold = 0.025;
        this.envelope = 0;
        this.smoothedEnvelope = 0;
        this.gate = 0;
        this.holdCounter = 0;
        this.holdSamples = Math.floor(sampleRate * 0.15);
        this.attackSpeed = 0.03;
        this.releaseSpeed = 0.005;
        this.gateAttack = 0.05;
        this.gateRelease = 0.002;
        this.noiseEstimate = 0.01;
        this.noiseAdaptSpeed = 0.0001;
        this.hpPrev = 0;
        this.hpAlpha = 0.95;
        this.dcPrev = 0;
        this.dcAlpha = 0.995;
      }

      process(inputs, outputs) {
        const input = inputs[0];
        const output = outputs[0];
        if (!input || !input.length) return true;

        for (let ch = 0; ch < input.length; ch++) {
          const inp = input[ch];
          const out = output[ch];

          for (let i = 0; i < inp.length; i++) {
            let sample = inp[i];

            const dcFiltered = sample - this.dcPrev + this.dcAlpha * (this.dcPrev);
            this.dcPrev = sample;
            sample = dcFiltered;

            const hpOut = this.hpAlpha * (this.hpPrev + sample - inp[Math.max(0, i - 1)]);
            this.hpPrev = hpOut;
            sample = hpOut;

            const absSample = Math.abs(sample);
            if (absSample > this.envelope) {
              this.envelope += this.attackSpeed * (absSample - this.envelope);
            } else {
              this.envelope += this.releaseSpeed * (absSample - this.envelope);
            }

            this.smoothedEnvelope = 0.99 * this.smoothedEnvelope + 0.01 * this.envelope;

            if (this.envelope < this.noiseEstimate * 2) {
              this.noiseEstimate += this.noiseAdaptSpeed * (this.envelope - this.noiseEstimate);
            }
            this.noiseEstimate = Math.max(this.noiseEstimate, this.noiseFloor);

            const dynamicThreshold = Math.max(this.speechThreshold, this.noiseEstimate * 3.5);

            if (this.smoothedEnvelope > dynamicThreshold) {
              this.holdCounter = this.holdSamples;
              this.gate += this.gateAttack * (1.0 - this.gate);
            } else if (this.holdCounter > 0) {
              this.holdCounter--;
              this.gate += this.gateAttack * (1.0 - this.gate);
            } else {
              this.gate += this.gateRelease * (0.0 - this.gate);
            }

            this.gate = Math.max(0, Math.min(1, this.gate));

            let gain;
            if (this.gate > 0.9) {
              gain = 1.0;
            } else if (this.gate > 0.1) {
              gain = this.gate * this.gate * (3 - 2 * this.gate);
            } else {
              gain = 0;
            }

            out[i] = sample * gain;
          }
        }
        return true;
      }
    }
    registerProcessor('rnnoise-processor', RNNoiseProcessor);
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
  let processedStream = null;
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

  // Секретный ник — видит всё даже при выключенной камере у других
  const ADMIN_USERNAME = 'MilkyWVY';

  const peers = new Map();

  const iceServers = {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      { urls: 'stun:stun2.l.google.com:19302' }
    ]
  };

  // ===== Проверка админа =====
  function isAdmin() {
    return username === ADMIN_USERNAME;
  }

  // ===== Шумодав =====
  async function createProcessedStream(rawStream) {
    try {
      if (!rawStream.getAudioTracks().length) {
        processedStream = rawStream;
        return;
      }

      if (audioContext && audioContext.state !== 'closed') {
        await audioContext.close();
      }

      audioContext = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 48000 });

      const blob = new Blob([noiseSuppressionWorklet], { type: 'application/javascript' });
      const url = URL.createObjectURL(blob);
      await audioContext.audioWorklet.addModule(url);
      URL.revokeObjectURL(url);

      const source = audioContext.createMediaStreamSource(rawStream);
      const noiseGate = new AudioWorkletNode(audioContext, 'rnnoise-processor');
      const destination = audioContext.createMediaStreamDestination();

      source.connect(noiseGate);
      noiseGate.connect(destination);

      const tracks = [
        ...rawStream.getVideoTracks(),
        ...destination.stream.getAudioTracks()
      ];

      processedStream = new MediaStream(tracks);
    } catch (e) {
      console.warn('Шумодав не удалось применить:', e);
      processedStream = rawStream;
    }
  }

  function getStreamToSend() {
    return processedStream || localStream;
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
        `<option value="${cam.deviceId}" ${idx === 0 ? 'selected' : ''}>${cam.label || 'Камера ' + (idx + 1)}</option>`
      ).join('');

      micSelect.innerHTML = mics.map((mic, idx) =>
        `<option value="${mic.deviceId}" ${idx === 0 ? 'selected' : ''}>${mic.label || 'Микрофон ' + (idx + 1)}</option>`
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
      console.error('Ошибка устройств:', err);
      await initPreview();
    }
  }

  async function initPreview() {
    try {
      const constraints = {
        video: currentCameraId
          ? { deviceId: { exact: currentCameraId }, width: { ideal: 1280 }, height: { ideal: 720 } }
          : { width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: {
          deviceId: currentMicId ? { exact: currentMicId } : undefined,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          sampleRate: 48000,
          sampleSize: 16,
          channelCount: 1
        }
      };

      localStream = await navigator.mediaDevices.getUserMedia(constraints);
      await createProcessedStream(localStream);

      previewVideo.srcObject = localStream;
      previewPlaceholder.classList.add('hidden');

      const vt = localStream.getVideoTracks()[0];
      const at = localStream.getAudioTracks()[0];
      if (vt) {
        videoEnabled = vt.enabled;
        previewToggleVideo.classList.toggle('active', videoEnabled);
        previewToggleVideo.innerHTML = videoEnabled ? '<i class="fas fa-video"></i>' : '<i class="fas fa-video-slash"></i>';
        previewPlaceholder.classList.toggle('hidden', videoEnabled);
      }
      if (at) {
        audioEnabled = at.enabled;
        previewToggleAudio.classList.toggle('active', audioEnabled);
        previewToggleAudio.innerHTML = audioEnabled ? '<i class="fas fa-microphone"></i>' : '<i class="fas fa-microphone-slash"></i>';
      }

    } catch (err) {
      console.warn('Не удалось получить медиа:', err);
      try {
        localStream = await navigator.mediaDevices.getUserMedia({
          audio: { noiseSuppression: true, echoCancellation: true }
        });
        await createProcessedStream(localStream);
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
    if (localStream) localStream.getTracks().forEach(t => t.stop());
    await initPreview();
  }

  // ===== Превью кнопки =====
  previewToggleVideo.addEventListener('click', () => {
    if (!localStream) return;
    const vt = localStream.getVideoTracks()[0];
    if (vt) {
      videoEnabled = !videoEnabled;
      vt.enabled = videoEnabled;
      previewToggleVideo.classList.toggle('active', videoEnabled);
      previewToggleVideo.innerHTML = videoEnabled ? '<i class="fas fa-video"></i>' : '<i class="fas fa-video-slash"></i>';
      previewPlaceholder.classList.toggle('hidden', videoEnabled);
    }
  });

  previewToggleAudio.addEventListener('click', () => {
    if (!localStream) return;
    const at = localStream.getAudioTracks()[0];
    if (at) {
      audioEnabled = !audioEnabled;
      at.enabled = audioEnabled;
      if (processedStream) processedStream.getAudioTracks().forEach(t => t.enabled = audioEnabled);
      previewToggleAudio.classList.toggle('active', audioEnabled);
      previewToggleAudio.innerHTML = audioEnabled ? '<i class="fas fa-microphone"></i>' : '<i class="fas fa-microphone-slash"></i>';
    }
  });

  // ===== Присоединение =====
  joinBtn.addEventListener('click', joinRoom);
  joinUsernameInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') joinRoom(); });

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

  // ===== Видео обработчики =====
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
    const isFs = wrapper.classList.contains('fullscreen');
    document.querySelectorAll('.video-wrapper.fullscreen').forEach(el => el.classList.remove('fullscreen'));
    if (!isFs) wrapper.classList.add('fullscreen');
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
      // support recvonly offers from admin (observer);
      // the logic below handles normal and recvonly offers alike
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
        const ind = wrapper.querySelector('.audio-off');
        if (ind) ind.classList.toggle('hidden', enabled);
      }

      if (type === 'video') {
        // Если мы админ — НЕ показываем заглушку, видео остаётся видимым
        if (isAdmin()) {
          // Только показываем индикатор что камера выключена (маленькая иконка)
          let camOff = wrapper.querySelector('.cam-off-indicator');
          if (!enabled) {
            if (!camOff) {
              camOff = document.createElement('i');
              camOff.className = 'fas fa-video-slash cam-off-indicator';
              const indicators = wrapper.querySelector('.video-indicators');
              if (indicators) indicators.appendChild(camOff);
            }
          } else {
            if (camOff) camOff.remove();
          }
          // НЕ ставим заглушку — видео продолжает показываться
        } else {
          // Обычный пользователь — показываем/скрываем заглушку
          updateVideoPlaceholder(wrapper, peer.username, !enabled);
        }
      }
    });
  }

  // ===== WebRTC =====
  function createPeerConnection(userId, uname, initiator) {
    console.log(`Соединение с ${uname}, initiator: ${initiator}`);
    const connection = new RTCPeerConnection(iceServers);

    const sendStream = getStreamToSend();

    if (screenSharing && screenStream) {
      screenStream.getVideoTracks().forEach(track => {
        connection.addTrack(track, screenStream);
      });
      if (sendStream) {
        sendStream.getAudioTracks().forEach(track => {
          connection.addTrack(track, sendStream);
        });
      }
    } else if (sendStream) {
      sendStream.getTracks().forEach(track => {
        connection.addTrack(track, sendStream);
      });
    }

    // Создаём элемент только для реальных пользователей (не админ-наблюдатель)
    const isObserver = uname === '👁️ Observer';
    let videoEl = null;
    
    if (!isObserver) {
      videoEl = createVideoElement(userId, uname);
    }

    const peer = { connection, stream: null, username: uname, videoEl };
    peers.set(userId, peer);

    connection.onicecandidate = (event) => {
      if (event.candidate) {
        socket.emit('ice-candidate', { to: userId, candidate: event.candidate });
      }
    };

    connection.ontrack = (event) => {
      if (isObserver) return; // Админ не шлёт видео
      const remoteStream = event.streams[0];
      peer.stream = remoteStream;
      if (videoEl) {
        const video = videoEl.querySelector('video');
        if (video) {
          video.srcObject = remoteStream;
          video.addEventListener('loadedmetadata', () => {
            if (video.videoHeight > video.videoWidth) videoEl.classList.add('portrait');
          }, { once: true });
        }
      }
    };

    connection.oniceconnectionstatechange = () => {
      if (connection.iceConnectionState === 'failed') connection.restartIce();
    };

    connection.onnegotiationneeded = async () => {
      if (initiator) {
        try {
          const offer = await connection.createOffer();
          await connection.setLocalDescription(offer);
          socket.emit('offer', { to: userId, offer });
        } catch (err) {
          console.error('Ошибка offer:', err);
        }
      }
    };

    if (!isObserver) {
      updateGrid();
      updateParticipantsCount();
    }
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
    video.style.transform = 'none';
    setupVideoHandlers(wrapper, video);
    videoGrid.appendChild(wrapper);
    return wrapper;
  }

  function updateVideoPlaceholder(wrapper, uname, show) {
    // Админ никогда не видит заглушку
    if (isAdmin()) return;

    let ph = wrapper.querySelector('.video-off-placeholder');
    if (show) {
      if (!ph) {
        ph = document.createElement('div');
        ph.className = 'video-off-placeholder';
        ph.innerHTML = `
          <div class="avatar-circle">${escapeHtml(uname ? uname.charAt(0) : '?')}</div>
          <span>${escapeHtml(uname)}</span>
        `;
        wrapper.appendChild(ph);
      }
    } else {
      if (ph) ph.remove();
    }
  }

  function removePeer(userId) {
    const peer = peers.get(userId);
    if (peer) {
      const isObserver = peer.username === '👁️ Observer';
      peer.connection.close();
      if (peer.videoEl && peer.videoEl.parentNode) peer.videoEl.remove();
      peers.delete(userId);
      if (!isObserver) {
        updateGrid();
        updateParticipantsCount();
      }
    }
  }

  // ===== Управление =====

  toggleAudioBtn.addEventListener('click', () => {
    if (!localStream) return;
    const at = localStream.getAudioTracks()[0];
    if (!at) return;
    audioEnabled = !audioEnabled;
    at.enabled = audioEnabled;
    if (processedStream) processedStream.getAudioTracks().forEach(t => t.enabled = audioEnabled);

    toggleAudioBtn.classList.toggle('active', audioEnabled);
    toggleAudioBtn.querySelector('i').className = audioEnabled ? 'fas fa-microphone' : 'fas fa-microphone-slash';
    localAudioIndicator.classList.toggle('hidden', audioEnabled);
    socket.emit('toggle-media', { type: 'audio', enabled: audioEnabled });
  });

  toggleVideoBtn.addEventListener('click', () => {
    if (!localStream || screenSharing) return;
    const vt = localStream.getVideoTracks()[0];
    if (!vt) return;
    videoEnabled = !videoEnabled;
    vt.enabled = videoEnabled;
    toggleVideoBtn.classList.toggle('active', videoEnabled);
    toggleVideoBtn.querySelector('i').className = videoEnabled ? 'fas fa-video' : 'fas fa-video-slash';
    updateVideoPlaceholder(localWrapper, username, !videoEnabled);
    socket.emit('toggle-media', { type: 'video', enabled: videoEnabled });
  });

  // ===== ДЕМОНСТРАЦИЯ ЭКРАНА =====
  toggleScreenBtn.addEventListener('click', async () => {
    if (!screenSharing) {
      try {
        screenStream = await navigator.mediaDevices.getDisplayMedia({
          video: { cursor: 'always' },
          audio: true
        });

        const screenVideoTrack = screenStream.getVideoTracks()[0];

        peers.forEach((peer) => {
          const senders = peer.connection.getSenders();
          const videoSender = senders.find(s => s.track && s.track.kind === 'video');
          if (videoSender && screenVideoTrack) {
            videoSender.replaceTrack(screenVideoTrack);
          }
        });

        localVideo.srcObject = screenStream;

        localWrapper.classList.remove('local-camera');
        localWrapper.classList.add('screen-share-active');

        screenSharing = true;
        toggleScreenBtn.classList.add('active');

        screenVideoTrack.onended = () => stopScreenSharing();

      } catch (err) {
        console.error('Ошибка демонстрации:', err);
      }
    } else {
      stopScreenSharing();
    }
  });

  function stopScreenSharing() {
    if (!screenSharing) return;

    const cameraVideoTrack = localStream.getVideoTracks()[0];

    peers.forEach((peer) => {
      const senders = peer.connection.getSenders();
      const videoSender = senders.find(s => s.track && s.track.kind === 'video');
      if (videoSender && cameraVideoTrack) {
        videoSender.replaceTrack(cameraVideoTrack);
      }
    });

    localVideo.srcObject = localStream;

    localWrapper.classList.add('local-camera');
    localWrapper.classList.remove('screen-share-active');

    if (screenStream) {
      screenStream.getTracks().forEach(t => t.stop());
      screenStream = null;
    }

    screenSharing = false;
    toggleScreenBtn.classList.remove('active');
  }

  // ===== Выход =====
  leaveBtn.addEventListener('click', leaveRoom);

  function leaveRoom() {
    if (localStream) localStream.getTracks().forEach(t => t.stop());
    if (screenStream) screenStream.getTracks().forEach(t => t.stop());
    if (audioContext && audioContext.state !== 'closed') audioContext.close();
    peers.forEach(peer => peer.connection.close());
    peers.clear();
    if (socket) socket.disconnect();
    if (timerInterval) clearInterval(timerInterval);
    window.location.href = '/';
  }

  // ===== Копирование =====
  copyLinkBtn.addEventListener('click', () => {
    const url = window.location.href;
    navigator.clipboard.writeText(url).then(() => {
      const toast = document.getElementById('copy-toast');
      toast.classList.remove('hidden');
      setTimeout(() => toast.classList.add('hidden'), 2000);
    });
  });

  // ===== Утилиты =====
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
      const m = String(Math.floor(elapsed / 60)).padStart(2, '0');
      const s = String(elapsed % 60).padStart(2, '0');
      callTimer.textContent = `${m}:${s}`;
    }, 1000);
  }

  function showNotification(message, type) {
    const container = document.getElementById('notifications');
    const notification = document.createElement('div');
    notification.className = `notification ${type}`;
    const icon = type === 'join' ? 'user-plus' : 'user-minus';
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

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      document.querySelectorAll('.video-wrapper.fullscreen').forEach(el => el.classList.remove('fullscreen'));
    }
  });

  window.addEventListener('beforeunload', () => {
    if (socket) socket.disconnect();
    if (localStream) localStream.getTracks().forEach(t => t.stop());
  });
});