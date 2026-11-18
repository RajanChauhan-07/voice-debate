// Real-Time Speech-to-Text via Web Speech API with fallback
class SpeechRecognitionManager {
    constructor(onTranscriptCallback) {
        this.onTranscript = onTranscriptCallback;
        this.recognition = null;
        this.isListening = false;
        this.isSupported = false;

        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (SpeechRecognition) {
            this.isSupported = true;
            this.recognition = new SpeechRecognition();
            this.recognition.continuous = true;
            this.recognition.interimResults = true;
            this.recognition.lang = 'en-US';

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
                console.warn('[STT] Speech recognition warning/error:', event.error);
                if (event.error === 'not-allowed') {
                    this.isListening = false;
                }
            };

            this.recognition.onend = () => {
                // If turn is still active, automatically restart recognition
                if (this.isListening) {
                    try {
                        this.recognition.start();
                    } catch (e) {
                        // Already started or busy
                    }
                }
            };
        }
    }

    startListening() {
        if (!this.isSupported || !this.recognition) return false;
        this.isListening = true;
        try {
            this.recognition.start();
            return true;
        } catch (e) {
            console.log('[STT] Start call exception:', e);
            return false;
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
