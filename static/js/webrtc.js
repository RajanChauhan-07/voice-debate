// WebRTC Peer-to-Peer Audio Manager & Visualizer
class WebRTCVoiceManager {
    constructor(signalingSendFn) {
        this.sendSignal = signalingSendFn;
        this.localStream = null;
        this.peerConnection = null;
        this.remoteAudioEl = null;
        this.audioContext = null;
        this.analyser = null;
        this.isMicHardwareAvailable = false;
        this.isMicTurnActive = false;
        this.visualizerCanvas = null;
        this.visualizerAnimationId = null;
        this.queuedCandidates = [];

        this.rtcConfig = {
            iceServers: [
                { urls: 'stun:stun.l.google.com:19302' },
                { urls: 'stun:stun1.l.google.com:19302' },
                { urls: 'stun:stun2.l.google.com:19302' },
                { urls: 'stun:stun3.l.google.com:19302' },
                { urls: 'stun:stun4.l.google.com:19302' },
                { urls: 'stun:global.stun.twilio.com:3478' }
            ]
        };
    }

    async initMicrophone() {
        if (this.localStream) return true;

        try {
            this.localStream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true
                },
                video: false
            });
            this.isMicHardwareAvailable = true;
            console.log('[WebRTC] Microphone permission granted. Tracks:', this.localStream.getAudioTracks().length);

            // Default mic state: MUTED until server explicitly activates turn!
            this.setMicEnabled(false);

            this._setupAudioAnalyser();
            return true;
        } catch (err) {
            console.warn('[WebRTC] Microphone permission not granted or mic unavailable:', err);
            this.isMicHardwareAvailable = false;
            return false;
        }
    }

    _setupAudioAnalyser() {
        try {
            const AudioCtx = window.AudioContext || window.webkitAudioContext;
            if (!AudioCtx || !this.localStream) return;

            this.audioContext = new AudioCtx();
            // Resume AudioContext (required on mobile after user gesture)
            if (this.audioContext.state === 'suspended') {
                this.audioContext.resume();
            }
            const source = this.audioContext.createMediaStreamSource(this.localStream);
            this.analyser = this.audioContext.createAnalyser();
            this.analyser.fftSize = 64;
            source.connect(this.analyser);
        } catch (e) {
            console.warn('[WebRTC] Analyser setup error:', e);
        }
    }

    setMicEnabled(enabled) {
        this.isMicTurnActive = enabled;
        if (this.localStream) {
            const audioTracks = this.localStream.getAudioTracks();
            audioTracks.forEach(track => {
                track.enabled = enabled;
            });
            console.log(`[WebRTC] Mic ${enabled ? 'ENABLED' : 'MUTED'}. Tracks: ${audioTracks.length}`);
        }
        // Resume AudioContext on mobile if suspended
        if (enabled && this.audioContext && this.audioContext.state === 'suspended') {
            this.audioContext.resume();
        }
    }

    ensureRemoteAudioElement() {
        if (!this.remoteAudioEl) {
            let el = document.getElementById('peer-remote-audio');
            if (!el) {
                el = document.createElement('audio');
                el.id = 'peer-remote-audio';
                el.autoplay = true;
                el.playsInline = true;  // Critical for iOS
                el.style.display = 'none';
                document.body.appendChild(el);
            }
            this.remoteAudioEl = el;
        }
        return this.remoteAudioEl;
    }

    async createPeerConnection(isInitiator = false) {
        if (this.peerConnection) {
            this.peerConnection.close();
        }

        this.peerConnection = new RTCPeerConnection(this.rtcConfig);
        console.log('[WebRTC] Created PeerConnection. isInitiator:', isInitiator);

        // Add local tracks if available
        if (this.localStream) {
            this.localStream.getAudioTracks().forEach(track => {
                this.peerConnection.addTrack(track, this.localStream);
                console.log('[WebRTC] Added local audio track:', track.label);
            });
        }

        // Handle remote stream — this receives the opponent's audio
        this.peerConnection.ontrack = (event) => {
            console.log('[WebRTC] Received remote track:', event.track.kind, event.track.label);
            const audioEl = this.ensureRemoteAudioElement();
            if (audioEl && event.streams && event.streams[0]) {
                audioEl.srcObject = event.streams[0];
                // Force play (critical for mobile)
                const playPromise = audioEl.play();
                if (playPromise !== undefined) {
                    playPromise.catch(e => {
                        console.log('[WebRTC] Autoplay blocked, will retry on user gesture:', e);
                        // Retry play on next user interaction
                        const retryPlay = () => {
                            audioEl.play().catch(() => {});
                            document.removeEventListener('click', retryPlay);
                            document.removeEventListener('touchend', retryPlay);
                        };
                        document.addEventListener('click', retryPlay, { once: true });
                        document.addEventListener('touchend', retryPlay, { once: true });
                    });
                }
            }
        };

        // Handle ICE candidates
        this.peerConnection.onicecandidate = (event) => {
            if (event.candidate) {
                this.sendSignal('webrtc_ice_candidate', event.candidate);
            }
        };

        this.peerConnection.oniceconnectionstatechange = () => {
            console.log('[WebRTC] ICE state:', this.peerConnection.iceConnectionState);
        };

        this.peerConnection.onconnectionstatechange = () => {
            console.log('[WebRTC] Connection state:', this.peerConnection.connectionState);
        };

        if (isInitiator) {
            try {
                const offer = await this.peerConnection.createOffer({
                    offerToReceiveAudio: true
                });
                await this.peerConnection.setLocalDescription(offer);
                this.sendSignal('webrtc_offer', offer);
                console.log('[WebRTC] Created and sent offer.');
            } catch (err) {
                console.error('[WebRTC] Error creating offer:', err);
            }
        }
    }

    async handleRemoteOffer(offer) {
        try {
            // Initialize mic if not done yet
            if (!this.localStream) {
                await this.initMicrophone();
            }
            await this.createPeerConnection(false);
            await this.peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
            console.log('[WebRTC] Set remote offer description. Flushing queued candidates:', this.queuedCandidates.length);
            
            // Flush any queued ICE candidates
            while (this.queuedCandidates.length > 0) {
                const cand = this.queuedCandidates.shift();
                try {
                    await this.peerConnection.addIceCandidate(new RTCIceCandidate(cand));
                } catch (e) {
                    console.warn('[WebRTC] Error adding flushed candidate:', e);
                }
            }

            const answer = await this.peerConnection.createAnswer();
            await this.peerConnection.setLocalDescription(answer);
            this.sendSignal('webrtc_answer', answer);
            console.log('[WebRTC] Handled offer, sent answer.');
        } catch (err) {
            console.error('[WebRTC] Error handling offer:', err);
        }
    }

    async handleRemoteAnswer(answer) {
        try {
            if (this.peerConnection) {
                await this.peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
                console.log('[WebRTC] Set remote answer description. Flushing queued candidates:', this.queuedCandidates.length);
                
                // Flush any queued ICE candidates
                while (this.queuedCandidates.length > 0) {
                    const cand = this.queuedCandidates.shift();
                    try {
                        await this.peerConnection.addIceCandidate(new RTCIceCandidate(cand));
                    } catch (e) {
                        console.warn('[WebRTC] Error adding flushed candidate:', e);
                    }
                }
            }
        } catch (err) {
            console.error('[WebRTC] Error handling answer:', err);
        }
    }

    async handleRemoteCandidate(candidate) {
        try {
            if (this.peerConnection && this.peerConnection.remoteDescription && this.peerConnection.remoteDescription.type) {
                await this.peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
                console.log('[WebRTC] Directly added remote ICE candidate');
            } else {
                console.log('[WebRTC] Remote description not set yet, queueing ICE candidate');
                this.queuedCandidates.push(candidate);
            }
        } catch (err) {
            console.error('[WebRTC] Error adding ICE candidate:', err);
        }
    }

    // Try to play remote audio (call on user interaction to bypass autoplay policy)
    tryPlayRemoteAudio() {
        if (this.remoteAudioEl && this.remoteAudioEl.srcObject) {
            this.remoteAudioEl.play().catch(() => {});
        }
        if (this.audioContext && this.audioContext.state === 'suspended') {
            this.audioContext.resume();
        }
    }

    startVisualizer(canvasElement) {
        this.visualizerCanvas = canvasElement;
        if (!canvasElement) return;

        const ctx = canvasElement.getContext('2d');
        const bufferLength = this.analyser ? this.analyser.frequencyBinCount : 32;
        const dataArray = new Uint8Array(bufferLength);

        const render = () => {
            this.visualizerAnimationId = requestAnimationFrame(render);

            const width = canvasElement.width;
            const height = canvasElement.height;
            ctx.clearRect(0, 0, width, height);

            if (this.analyser && this.isMicTurnActive) {
                this.analyser.getByteFrequencyData(dataArray);
            } else {
                // Subtle resting wave
                dataArray.fill(0);
            }

            const barWidth = (width / bufferLength) * 1.5;
            let x = 0;

            for (let i = 0; i < bufferLength; i++) {
                let barHeight;
                if (this.isMicTurnActive) {
                    barHeight = (dataArray[i] / 255) * (height - 6) + 4;
                } else {
                    // Gentle ambient idle pulse
                    const time = Date.now() / 600;
                    barHeight = 4 + Math.sin(time + i * 0.4) * 3;
                }

                // Apple Light Mode Monochrome gradient
                const grad = ctx.createLinearGradient(0, height - barHeight, 0, height);
                if (this.isMicTurnActive) {
                    grad.addColorStop(0, '#1d1d1f');
                    grad.addColorStop(1, '#6e6e73');
                } else {
                    grad.addColorStop(0, '#d2d2d7');
                    grad.addColorStop(1, '#e5e5ea');
                }

                ctx.fillStyle = grad;
                ctx.beginPath();
                ctx.roundRect(x, height - barHeight, barWidth - 2, barHeight, [2, 2, 0, 0]);
                ctx.fill();

                x += barWidth;
            }
        };

        render();
    }

    stopVisualizer() {
        if (this.visualizerAnimationId) {
            cancelAnimationFrame(this.visualizerAnimationId);
            this.visualizerAnimationId = null;
        }
    }

    cleanup() {
        this.stopVisualizer();
        this.setMicEnabled(false);
        if (this.peerConnection) {
            this.peerConnection.close();
            this.peerConnection = null;
        }
        if (this.localStream) {
            this.localStream.getTracks().forEach(t => t.stop());
            this.localStream = null;
        }
        if (this.audioContext) {
            this.audioContext.close();
            this.audioContext = null;
        }
    }
}
