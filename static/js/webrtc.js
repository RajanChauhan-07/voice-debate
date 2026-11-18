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

        this.rtcConfig = {
            iceServers: [
                { urls: 'stun:stun.l.google.com:19302' },
                { urls: 'stun:stun1.l.google.com:19302' }
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
        }
    }

    ensureRemoteAudioElement() {
        if (!this.remoteAudioEl) {
            let el = document.getElementById('peer-remote-audio');
            if (!el) {
                el = document.createElement('audio');
                el.id = 'peer-remote-audio';
                el.autoplay = true;
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

        // Add local tracks if available
        if (this.localStream) {
            this.localStream.getAudioTracks().forEach(track => {
                this.peerConnection.addTrack(track, this.localStream);
            });
        }

        // Handle remote stream
        this.peerConnection.ontrack = (event) => {
            const audioEl = this.ensureRemoteAudioElement();
            if (audioEl && event.streams && event.streams[0]) {
                audioEl.srcObject = event.streams[0];
                audioEl.play().catch(e => console.log('[WebRTC] Autoplay waiting on user gesture:', e));
            }
        };

        // Handle ICE candidates
        this.peerConnection.onicecandidate = (event) => {
            if (event.candidate) {
                this.sendSignal('webrtc_ice_candidate', event.candidate);
            }
        };

        if (isInitiator) {
            try {
                const offer = await this.peerConnection.createOffer({
                    offerToReceiveAudio: true
                });
                await this.peerConnection.setLocalDescription(offer);
                this.sendSignal('webrtc_offer', offer);
            } catch (err) {
                console.error('[WebRTC] Error creating offer:', err);
            }
        }
    }

    async handleRemoteOffer(offer) {
        try {
            await this.createPeerConnection(false);
            await this.peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
            const answer = await this.peerConnection.createAnswer();
            await this.peerConnection.setLocalDescription(answer);
            this.sendSignal('webrtc_answer', answer);
        } catch (err) {
            console.error('[WebRTC] Error handling offer:', err);
        }
    }

    async handleRemoteAnswer(answer) {
        try {
            if (this.peerConnection) {
                await this.peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
            }
        } catch (err) {
            console.error('[WebRTC] Error handling answer:', err);
        }
    }

    async handleRemoteCandidate(candidate) {
        try {
            if (this.peerConnection) {
                await this.peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
            }
        } catch (err) {
            console.error('[WebRTC] Error adding ICE candidate:', err);
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

