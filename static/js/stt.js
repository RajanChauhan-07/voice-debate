// Real-Time Speech-to-Text via Web Speech API with Mobile (iOS/Android) support
class SpeechRecognitionManager {
    constructor(onTranscriptCallback) {
        this.onTranscript = onTranscriptCallback;
        this.recognition = null;
        this.isListening = false;
        this.isSupported = false;
        this.hasUserInteracted = false;
        this._restartTimer = null;

        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (SpeechRecognition) {
            this.isSupported = true;
            this._SpeechRecClass = SpeechRecognition;
            this._createRecognitionInstance();
        } else {
            console.warn('[STT] Speech recognition is NOT supported in this browser.');
        }
    }

    _createRecognitionInstance() {
        try {
            if (!this._SpeechRecClass) {
                this._SpeechRecClass = window.SpeechRecognition || window.webkitSpeechRecognition;
            }
            if (!this._SpeechRecClass) return;

            this.recognition = new this._SpeechRecClass();
            // On Safari / WebKit, continuous=true causes silent aborts or stops working.
            // Detecting WebKit/Safari vs Chromium:
            const isSafari = !navigator.userAgent.includes('Chrome') && (navigator.userAgent.includes('Safari') || navigator.userAgent.includes('AppleWebKit'));
            this.recognition.continuous = !isSafari;
            this.recognition.interimResults = true;
            this.recognition.lang = 'en-US';
            this.recognition.maxAlternatives = 1;

            this.recognition.onresult = (event) => {
                let interimTranscript = '';
                let finalTranscript = '';

                for (let i = event.resultIndex; i < event.results.length; ++i) {
                    const transcriptPiece = event.results[i][0].transcript;
                    if (event.results[i].isFinal) {
                        finalTranscript += transcriptPiece;
                    } else {
                        interimTranscript += transcriptPiece;
                    }
                }

                if (finalTranscript.trim().length > 0) {
                    this.onTranscript(finalTranscript.trim(), true);
                } else if (interimTranscript.trim().length > 0) {
                    this.onTranscript(interimTranscript.trim(), false);
                }
            };

            this.recognition.onerror = (event) => {
                console.warn('[STT] Recognition error:', event.error);
                if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
                    this.isListening = false;
                    console.error('[STT] Microphone permission denied for speech recognition.');
                }
                // For recoverable errors like 'network' or 'aborted', the onend handler restarts
            };

            this.recognition.onend = () => {
                console.log('[STT] Recognition ended. isListening:', this.isListening);
                // Auto-restart if we're supposed to still be listening
                if (this.isListening) {
                    if (this._restartTimer) clearTimeout(this._restartTimer);
                    this._restartTimer = setTimeout(() => {
                        if (this.isListening && this.recognition) {
                            try {
                                console.log('[STT] Auto-restarting recognition...');
                                this.recognition.start();
                            } catch (e) {
                                console.warn('[STT] Restart failed, recreating instance:', e);
                                this._createRecognitionInstance();
                                try { this.recognition.start(); } catch(e2) {}
                            }
                        }
                    }, 150);
                }
            };
        } catch (err) {
            console.warn('[STT] Instance initialization error:', err);
        }
    }

    // Call this inside a direct user gesture (click/tap) to unlock mobile permissions
    unlockMobilePermission() {
        this.hasUserInteracted = true;
        if (!this.recognition) {
            this._createRecognitionInstance();
        }
        // On mobile, do a quick start/stop cycle to trigger the permission dialog
        if (this.recognition && !this.isListening) {
            try {
                this.recognition.start();
                setTimeout(() => {
                    if (!this.isListening) {
                        try { this.recognition.stop(); } catch(e) {}
                    }
                }, 500);
            } catch(e) {
                // Already started or not available
            }
        }
    }

    startListening() {
        if (!this.isSupported) {
            console.warn('[STT] Speech recognition not supported.');
            return false;
        }
        if (!this.recognition) {
            this._createRecognitionInstance();
        }
        
        this.isListening = true;
        console.log('[STT] Starting speech recognition...');
        
        try {
            this.recognition.start();
            console.log('[STT] Recognition started successfully.');
            return true;
        } catch (e) {
            console.warn('[STT] Start exception, attempting reset:', e.message);
            // If already started, stop first then restart
            try {
                this.recognition.stop();
            } catch (err) {}
            
            if (this._restartTimer) clearTimeout(this._restartTimer);
            this._restartTimer = setTimeout(() => {
                if (this.isListening) {
                    try { 
                        this.recognition.start(); 
                        console.log('[STT] Recognition restarted after reset.');
                    } catch(err) {
                        console.warn('[STT] Final restart attempt failed:', err);
                    }
                }
            }, 200);
            return true;
        }
    }

    stopListening() {
        console.log('[STT] Stopping speech recognition.');
        this.isListening = false;
        if (this._restartTimer) {
            clearTimeout(this._restartTimer);
            this._restartTimer = null;
        }
        if (this.recognition) {
            try {
                this.recognition.stop();
            } catch (e) {}
        }
    }
}
