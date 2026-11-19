// Real-Time Speech-to-Text via Web Speech API with Mobile (iOS/Android) support
class SpeechRecognitionManager {
    constructor(onTranscriptCallback) {
        this.onTranscript = onTranscriptCallback;
        this.recognition = null;
        this.isListening = false;
        this.isSupported = false;
        this.hasUserInteracted = false;

        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (SpeechRecognition) {
            this.isSupported = true;
            this._createRecognitionInstance(SpeechRecognition);
        }
    }

    _createRecognitionInstance(SpeechRecognitionClass) {
        try {
            const SpeechRec = SpeechRecognitionClass || window.SpeechRecognition || window.webkitSpeechRecognition;
            if (!SpeechRec) return;

            this.recognition = new SpeechRec();
            // On mobile iOS Safari, continuous=true can cause silent aborts.
            // Using continuous with automatic recovery provides optimal stability across mobile & desktop.
            this.recognition.continuous = true;
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
                console.warn('[STT] Speech recognition event error:', event.error);
                if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
                    this.isListening = false;
                }
            };

            this.recognition.onend = () => {
                // If user's turn is still active, automatically restart recognition
                if (this.isListening) {
                    try {
                        this.recognition.start();
                    } catch (e) {
                        // Might already be active or queued
                    }
                }
            };
        } catch (err) {
            console.warn('[STT] Instance initialization error:', err);
        }
    }

    // Warm up / request permission synchronously during user tap gesture
    unlockMobilePermission() {
        this.hasUserInteracted = true;
        if (!this.recognition) {
            const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
            if (SpeechRec) this._createRecognitionInstance(SpeechRec);
        }
    }

    startListening() {
        if (!this.isSupported || !this.recognition) return false;
        this.isListening = true;
        try {
            this.recognition.start();
            return true;
        } catch (e) {
            // If already started or reset required
            try {
                this.recognition.stop();
                setTimeout(() => {
                    if (this.isListening) {
                        try { this.recognition.start(); } catch(err) {}
                    }
                }, 100);
            } catch (err) {}
            return true;
        }
    }

    stopListening() {
        this.isListening = false;
        if (this.recognition) {
            try {
                this.recognition.stop();
            } catch (e) {}
        }
    }
}

