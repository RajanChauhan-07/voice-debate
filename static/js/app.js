// VoiceDebate Arena - Apple Minimalist Aesthetic (Pure White / Light Mode)
const { useState, useEffect, useRef } = React;

function VoiceDebateApp() {
    // Current User Profile
    const [user, setUser] = useState(() => {
        const saved = localStorage.getItem('voicedebate_user');
        if (saved) {
            try { return JSON.parse(saved); } catch (e) {}
        }
        const urlParams = new URLSearchParams(window.location.search);
        const userParam = urlParams.get('user');
        if (userParam === 'player2') {
            return {
                id: 'usr-jordan-blake',
                username: 'jordan_b',
                display_name: 'Jordan Blake',
                rating: 1220,
                avatar_color: '#242426'
            };
        }
        return {
            id: 'usr-alex-chen',
            username: 'alex_c',
            display_name: 'Alex Chen',
            rating: 1200,
            avatar_color: '#2c2c2e'
        };
    });

    // Screen State: 'LOBBY' | 'MATCHING' | 'MATCH_FOUND' | 'COIN_TOSS' | 'DEBATE' | 'EVALUATING' | 'RESULTS'
    const [screen, setScreen] = useState('LOBBY');

    // Modals
    const [showLeaderboard, setShowLeaderboard] = useState(false);
    const [showHistory, setShowHistory] = useState(false);
    const [leaderboardData, setLeaderboardData] = useState([]);
    const [historyData, setHistoryData] = useState([]);

    // Match / Room State
    const [roomId, setRoomId] = useState(null);
    const [playerA, setPlayerA] = useState(null);
    const [playerB, setPlayerB] = useState(null);
    const [topic, setTopic] = useState(null);
    const [mandatoryVocabulary, setMandatoryVocabulary] = useState([]);
    const [coinTossWinner, setCoinTossWinner] = useState('player_a');
    
    // Live Debate Turn State
    const [currentTurn, setCurrentTurn] = useState(null);
    const [turnIndex, setTurnIndex] = useState(1);
    const [turnTimeRemaining, setTurnTimeRemaining] = useState(45);
    const [totalDebateRemaining, setTotalDebateRemaining] = useState(180);
    const [micEnabledUserId, setMicEnabledUserId] = useState(null);
    const [liveTranscript, setLiveTranscript] = useState('');
    const [allTurnTranscripts, setAllTurnTranscripts] = useState({});
    const [hintsStatus, setHintsStatus] = useState([]);

    // Results State
    const [evaluationResult, setEvaluationResult] = useState(null);
    const [matchTurnsResult, setMatchTurnsResult] = useState([]);

    // References
    const socketRef = useRef(null);
    const webrtcRef = useRef(null);
    const sttRef = useRef(null);
    const visualizerCanvasRef = useRef(null);

    // Save user to local storage
    useEffect(() => {
        localStorage.setItem('voicedebate_user', JSON.stringify(user));
    }, [user]);

    // Initialize WebSocket Connection
    useEffect(() => {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${protocol}//${window.location.host}/ws`;
        const ws = new WebSocket(wsUrl);
        socketRef.current = ws;

        ws.onopen = () => {
            console.log('[WS] Connected to VoiceDebate server');
        };

        ws.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                handleServerMessage(data);
            } catch (err) {
                console.error('[WS] Parse error:', err);
            }
        };

        ws.onerror = (err) => {
            console.error('[WS] Error:', err);
        };

        ws.onclose = () => {
            console.log('[WS] Connection closed');
        };

        // Initialize WebRTC Voice Manager
        webrtcRef.current = new WebRTCVoiceManager((signalType, payload) => {
            if (ws && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({
                    type: signalType,
                    user_id: user.id,
                    payload: payload
                }));
            }
        });

        // Initialize Speech Recognition Manager
        sttRef.current = new SpeechRecognitionManager((transcriptText, isFinal) => {
            if (ws && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({
                    type: 'live_transcript',
                    user_id: user.id,
                    text: transcriptText,
                    is_final: isFinal
                }));
            }
        });

        return () => {
            if (ws) ws.close();
            if (webrtcRef.current) webrtcRef.current.cleanup();
            if (sttRef.current) sttRef.current.stopListening();
        };
    }, [user.id]);

    // Handle Server Events
    const handleServerMessage = (data) => {
        switch (data.type) {
            case 'queue_joined':
                setScreen('MATCHING');
                break;

            case 'queue_left':
                setScreen('LOBBY');
                break;

            case 'match_found':
                setRoomId(data.room_id);
                setPlayerA(data.player_a);
                setPlayerB(data.player_b);
                setScreen('MATCH_FOUND');
                window.soundFx.playCoinToss();

                if (webrtcRef.current) {
                    webrtcRef.current.initMicrophone().then(() => {
                        const isInitiator = data.player_a.id === user.id;
                        webrtcRef.current.createPeerConnection(isInitiator);
                    });
                }
                break;

            case 'topic_reveal':
                setTopic(data.topic);
                setMandatoryVocabulary(data.mandatory_vocabulary || []);
                if (data.mandatory_vocabulary) {
                    setHintsStatus(data.mandatory_vocabulary.map(word => ({ word, used: false, count: 0 })));
                }
                break;

            case 'coin_toss':
                setCoinTossWinner(data.first_speaker);
                setScreen('COIN_TOSS');
                window.soundFx.playCoinToss();
                break;

            case 'turn_start':
                setScreen('DEBATE');
                setTurnIndex(data.turn_index);
                setCurrentTurn(data);
                setTurnTimeRemaining(data.duration);
                setTotalDebateRemaining(data.total_debate_remaining);
                setMicEnabledUserId(data.mic_enabled_user_id);
                setLiveTranscript('');

                window.soundFx.playTurnGong();

                const isMyTurn = data.mic_enabled_user_id === user.id;
                if (webrtcRef.current) {
                    webrtcRef.current.setMicEnabled(isMyTurn);
                }

                if (sttRef.current) {
                    if (isMyTurn) {
                        sttRef.current.startListening();
                    } else {
                        sttRef.current.stopListening();
                    }
                }
                break;

            case 'timer_tick':
                setTurnTimeRemaining(data.turn_time_remaining);
                setTotalDebateRemaining(data.total_debate_remaining);

                if (data.turn_time_remaining > 0 && data.turn_time_remaining <= 3) {
                    window.soundFx.playCountdownBeep(data.turn_time_remaining === 1);
                }
                break;

            case 'live_transcript':
                setLiveTranscript(data.interim_text || data.full_turn_transcript);
                if (data.full_turn_transcript) {
                    setAllTurnTranscripts(prev => ({
                        ...prev,
                        [data.turn_index]: data.full_turn_transcript
                    }));
                }
                if (data.hints_status) {
                    const newlyUsed = data.hints_status.some((h, idx) => h.used && hintsStatus[idx] && !hintsStatus[idx].used);
                    if (newlyUsed) {
                        window.soundFx.playHintEarned();
                    }
                    setHintsStatus(data.hints_status);
                }
                break;

            case 'evaluation_start':
                setScreen('EVALUATING');
                if (webrtcRef.current) webrtcRef.current.setMicEnabled(false);
                if (sttRef.current) sttRef.current.stopListening();
                break;

            case 'debate_results':
                setEvaluationResult(data.evaluation);
                setMatchTurnsResult(data.turns);
                setScreen('RESULTS');
                window.soundFx.playVictoryFanfare();

                if (data.evaluation && data.evaluation.rating_changes) {
                    const changes = data.evaluation.rating_changes;
                    const myChange = changes.player_a.user_id === user.id ? changes.player_a : changes.player_b;
                    if (myChange) {
                        setUser(prev => ({ ...prev, rating: myChange.new_rating }));
                    }
                }
                break;

            case 'webrtc_offer':
                if (webrtcRef.current && data.sender_id !== user.id) {
                    webrtcRef.current.handleRemoteOffer(data.payload);
                }
                break;

            case 'webrtc_answer':
                if (webrtcRef.current && data.sender_id !== user.id) {
                    webrtcRef.current.handleRemoteAnswer(data.payload);
                }
                break;

            case 'webrtc_ice_candidate':
                if (webrtcRef.current && data.sender_id !== user.id) {
                    webrtcRef.current.handleRemoteCandidate(data.payload);
                }
                break;
        }
    };

    // UI Actions
    const handleStartMatch = () => {
        window.soundFx.init();
        if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
            socketRef.current.send(JSON.stringify({
                type: 'join_queue',
                user: user
            }));
        }
    };

    const handleCancelMatch = () => {
        if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
            socketRef.current.send(JSON.stringify({
                type: 'leave_queue',
                user: user
            }));
        }
        setScreen('LOBBY');
    };

    const handleStartPractice = () => {
        window.soundFx.init();
        if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
            socketRef.current.send(JSON.stringify({
                type: 'start_practice',
                user: user
            }));
        }
    };

    const handleDevSkipTurn = () => {
        if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
            socketRef.current.send(JSON.stringify({
                type: 'dev_skip_turn',
                user_id: user.id
            }));
        }
    };

    const handleDevFinishDebate = () => {
        if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
            socketRef.current.send(JSON.stringify({
                type: 'dev_finish_debate',
                user_id: user.id
            }));
        }
    };

    const handleInsertSampleSpeech = (sampleText) => {
        if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
            socketRef.current.send(JSON.stringify({
                type: 'live_transcript',
                user_id: user.id,
                text: sampleText,
                is_final: true
            }));
        }
    };

    const handleOpenLeaderboard = async () => {
        try {
            const resp = await fetch('/api/leaderboard');
            const data = await resp.json();
            setLeaderboardData(data);
            setShowLeaderboard(true);
        } catch (e) {
            console.error('Leaderboard error:', e);
        }
    };

    const handleOpenHistory = async () => {
        try {
            const resp = await fetch(`/api/users/${user.id}/matches`);
            const data = await resp.json();
            setHistoryData(data);
            setShowHistory(true);
        } catch (e) {
            console.error('History error:', e);
        }
    };

    const handleSwitchUser = (newProfile) => {
        setUser(newProfile);
        setScreen('LOBBY');
    };

    useEffect(() => {
        if (screen === 'DEBATE' && visualizerCanvasRef.current && webrtcRef.current) {
            webrtcRef.current.startVisualizer(visualizerCanvasRef.current);
        }
        return () => {
            if (webrtcRef.current) webrtcRef.current.stopVisualizer();
        };
    }, [screen]);

    return (
        <div className="min-h-screen bg-[#fbfbfd] text-[#1d1d1f] flex flex-col justify-between font-sf selection:bg-black selection:text-white">
            {/* Apple Minimalist Navigation Bar (Light Mode) */}
            <header className="border-b border-black/[0.08] apple-glass px-6 py-3.5 flex items-center justify-between sticky top-0 z-50">
                <div className="flex items-center space-x-3 cursor-pointer" onClick={() => setScreen('LOBBY')}>
                    <div className="w-8 h-8 rounded-full bg-black text-white flex items-center justify-center font-bold text-xs tracking-tight shadow-sm">
                        <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 100-6 3 3 0 000 6z" />
                        </svg>
                    </div>
                    <div>
                        <div className="text-sm font-semibold tracking-tight text-[#1d1d1f]">
                            VoiceDebate
                        </div>
                    </div>
                </div>

                {/* Right controls */}
                <div className="flex items-center space-x-3">
                    <button
                        onClick={handleOpenLeaderboard}
                        className="apple-btn-secondary !text-xs !py-1.5 !px-3"
                    >
                        Rankings
                    </button>

                    <button
                        onClick={handleOpenHistory}
                        className="apple-btn-secondary !text-xs !py-1.5 !px-3"
                    >
                        History
                    </button>

                    {/* User profile dropdown pill */}
                    <div className="flex items-center space-x-2.5 bg-black/[0.04] border border-black/[0.08] rounded-full px-3 py-1">
                        <div className="w-5 h-5 rounded-full bg-black text-white flex items-center justify-center text-[10px] font-semibold">
                            {user.display_name.charAt(0)}
                        </div>
                        <div className="text-xs text-[#1d1d1f] font-medium">
                            {user.display_name}
                        </div>
                        <span className="text-[11px] px-2 py-0.5 rounded-full bg-black/5 text-[#1d1d1f] font-mono-sf font-semibold">
                            {user.rating}
                        </span>

                        <button
                            title="Switch Player Profile (for 2-tab testing)"
                            onClick={() => {
                                if (user.username === 'alex_c') {
                                    handleSwitchUser({
                                        id: 'usr-jordan-blake',
                                        username: 'jordan_b',
                                        display_name: 'Jordan Blake',
                                        rating: 1240,
                                        avatar_color: '#242426'
                                    });
                                } else {
                                    handleSwitchUser({
                                        id: 'usr-alex-chen',
                                        username: 'alex_c',
                                        display_name: 'Alex Chen',
                                        rating: 1200,
                                        avatar_color: '#2c2c2e'
                                    });
                                }
                            }}
                            className="text-[10px] px-2 py-0.5 rounded-full bg-black/[0.06] hover:bg-black/10 text-[#86868b] hover:text-[#1d1d1f] transition"
                        >
                            Switch
                        </button>
                    </div>
                </div>
            </header>

            {/* Main Stage View Switcher */}
            <main className="flex-1 max-w-5xl w-full mx-auto px-6 py-8 md:py-12 flex flex-col justify-center">
                {screen === 'LOBBY' && (
                    <LobbyScreen
                        user={user}
                        onStartMatch={handleStartMatch}
                        onStartPractice={handleStartPractice}
                    />
                )}

                {screen === 'MATCHING' && (
                    <MatchingScreen
                        user={user}
                        onCancel={handleCancelMatch}
                        onStartPractice={handleStartPractice}
                    />
                )}

                {screen === 'MATCH_FOUND' && (
                    <MatchFoundScreen
                        playerA={playerA}
                        playerB={playerB}
                        topic={topic}
                        mandatoryVocabulary={mandatoryVocabulary}
                        currentUserId={user.id}
                    />
                )}

                {screen === 'COIN_TOSS' && (
                    <CoinTossScreen
                        winnerKey={coinTossWinner}
                        playerA={playerA}
                        playerB={playerB}
                    />
                )}

                {screen === 'DEBATE' && (
                    <DebateArenaScreen
                        playerA={playerA}
                        playerB={playerB}
                        currentUserId={user.id}
                        topic={topic}
                        turnIndex={turnIndex}
                        currentTurn={currentTurn}
                        turnTimeRemaining={turnTimeRemaining}
                        totalDebateRemaining={totalDebateRemaining}
                        micEnabledUserId={micEnabledUserId}
                        liveTranscript={liveTranscript}
                        allTurnTranscripts={allTurnTranscripts}
                        hintsStatus={hintsStatus}
                        visualizerCanvasRef={visualizerCanvasRef}
                        onDevSkipTurn={handleDevSkipTurn}
                        onDevFinishDebate={handleDevFinishDebate}
                        onInsertSample={handleInsertSampleSpeech}
                    />
                )}

                {screen === 'EVALUATING' && (
                    <EvaluatingScreen />
                )}

                {screen === 'RESULTS' && evaluationResult && (
                    <ResultsScreen
                        evaluation={evaluationResult}
                        turns={matchTurnsResult}
                        topic={topic}
                        currentUserId={user.id}
                        onPlayAgain={handleStartMatch}
                        onBackToLobby={() => setScreen('LOBBY')}
                    />
                )}
            </main>

            {/* Modals */}
            {showLeaderboard && (
                <LeaderboardModal
                    data={leaderboardData}
                    currentUserId={user.id}
                    onClose={() => setShowLeaderboard(false)}
                />
            )}

            {showHistory && (
                <HistoryModal
                    data={historyData}
                    onClose={() => setShowHistory(false)}
                />
            )}

            {/* Apple Minimalist Footer */}
            <footer className="border-t border-black/[0.08] py-5 text-center text-xs text-[#86868b]">
                VoiceDebate · Real-Time 1v1 Argumentation & Adjudication
            </footer>
        </div>
    );
}

// -------------------------------------------------------------
// STEP 01: LOBBY SCREEN (Apple Light Mode Hero)
// -------------------------------------------------------------
function LobbyScreen({ user, onStartMatch, onStartPractice }) {
    return (
        <div className="flex flex-col items-center justify-center py-6 md:py-10 text-center">
            {/* Minimalist Light Pill */}
            <div className="apple-pill mb-8">
                Step 01 · 1v1 Competitive Debate
            </div>

            {/* Headline */}
            <h1 className="text-5xl md:text-7xl font-semibold tracking-[-0.03em] leading-[1.08] text-[#1d1d1f] max-w-3xl mb-4">
                Speak with conviction.<br />
                <span className="text-[#86868b]">Out-debate in real time.</span>
            </h1>

            {/* Subtitle */}
            <p className="text-[#86868b] max-w-lg text-base md:text-lg mb-10 leading-relaxed font-normal">
                Four 45-second turns under time pressure. Spoken live over real-time audio. Scored on argumentation and English mastery.
            </p>

            {/* Apple Solid Black "Start Match" Pill Button */}
            <div className="flex flex-col items-center space-y-4 mb-14">
                <button
                    onClick={onStartMatch}
                    className="apple-btn-primary !px-10 !py-4 !text-base shadow-xl shadow-black/10"
                >
                    Start Match
                </button>
                <span className="text-xs text-[#86868b] font-mono-sf">
                    Enters queue · Matched by Elo rating
                </span>
            </div>

            {/* Secondary Actions */}
            <div className="flex flex-wrap items-center justify-center gap-3 mb-16">
                <button
                    onClick={onStartPractice}
                    className="apple-btn-secondary"
                >
                    Practice with AI Debater
                </button>

                <button
                    onClick={() => {
                        window.open(window.location.origin + '?user=player2', '_blank');
                    }}
                    className="apple-btn-secondary"
                >
                    Open Player 2 Window (Split Screen)
                </button>
            </div>

            {/* Minimalist Turn Schedule Cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 w-full max-w-3xl text-left">
                {[
                    { turn: '01', title: 'Motion / Opening', speaker: 'Player A', time: '0:45' },
                    { turn: '02', title: 'Constructive Speech', speaker: 'Player B', time: '0:45' },
                    { turn: '03', title: 'Rebuttal', speaker: 'Player A', time: '0:45' },
                    { turn: '04', title: 'Closing Summary', speaker: 'Player B', time: '0:45' },
                ].map((item, idx) => (
                    <div key={idx} className="apple-glass-card p-4">
                        <div className="flex items-center justify-between text-xs font-mono-sf text-[#86868b] mb-1.5">
                            <span>TURN {item.turn}</span>
                            <span className="text-[#1d1d1f] font-medium">{item.time}</span>
                        </div>
                        <div className="text-sm font-semibold text-[#1d1d1f] tracking-tight">{item.title}</div>
                        <div className="text-xs text-[#86868b] mt-1">{item.speaker}</div>
                    </div>
                ))}
            </div>
        </div>
    );
}

// -------------------------------------------------------------
// STEP 01 (ACTIVE): MATCHING SCREEN (Light Mode Minimalist Radar)
// -------------------------------------------------------------
function MatchingScreen({ user, onCancel, onStartPractice }) {
    return (
        <div className="flex flex-col items-center justify-center py-12 text-center">
            {/* Minimalist Light Radar Rings */}
            <div className="relative w-56 h-56 mb-8 flex items-center justify-center">
                <div className="absolute inset-0 rounded-full border border-black/[0.06]"></div>
                <div className="absolute inset-8 rounded-full border border-black/[0.08]"></div>
                <div className="absolute inset-16 rounded-full border border-black/[0.12]"></div>
                
                {/* Subtle Pulse */}
                <div className="absolute inset-0 rounded-full bg-black/[0.03] apple-radar-wave"></div>

                {/* Center User Dot */}
                <div className="relative z-10 w-16 h-16 rounded-full bg-black text-white flex items-center justify-center text-xl font-semibold shadow-md">
                    {user.display_name.charAt(0)}
                </div>
            </div>

            <div className="apple-pill mb-3">
                Step 01 · Finding Opponent
            </div>
            <h2 className="text-2xl md:text-3xl font-semibold tracking-tight text-[#1d1d1f] mb-2">
                Connecting to live debater...
            </h2>
            <p className="text-sm text-[#86868b] max-w-sm mb-8 font-normal">
                Matching with players in your skill tier ({user.rating} Elo). Initializing real-time voice link.
            </p>

            <div className="flex items-center space-x-3">
                <button
                    onClick={onCancel}
                    className="apple-btn-secondary !text-[#86868b] hover:!text-[#1d1d1f]"
                >
                    Cancel
                </button>

                <button
                    onClick={onStartPractice}
                    className="apple-btn-secondary"
                >
                    Switch to Practice Partner
                </button>
            </div>
        </div>
    );
}

// -------------------------------------------------------------
// STEP 02 & STEP 03: MATCH FOUND & TOPIC REVEAL (Light Mode)
// -------------------------------------------------------------
function MatchFoundScreen({ playerA, playerB, topic, mandatoryVocabulary, currentUserId }) {
    if (!playerA || !playerB) return null;

    return (
        <div className="flex flex-col items-center justify-center py-6 text-center max-w-3xl mx-auto w-full">
            <div className="apple-pill mb-8">
                Step 02 & 03 · Match Locked & Motion Ready
            </div>

            {/* Players VS Row */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-center w-full mb-8">
                {/* Player A Card */}
                <div className={`apple-glass-card p-6 text-center ${playerA.id === currentUserId ? 'apple-glass-card-active' : ''}`}>
                    <div className="w-14 h-14 rounded-full bg-black text-white mx-auto mb-3 flex items-center justify-center text-lg font-semibold shadow-sm">
                        {playerA.display_name.charAt(0)}
                    </div>
                    <div className="text-base font-semibold text-[#1d1d1f] tracking-tight">{playerA.display_name}</div>
                    <div className="text-xs font-mono-sf text-[#86868b] mt-1">{playerA.rating} Elo</div>
                    <div className="mt-3 inline-block px-3 py-1 rounded-full bg-black text-white text-xs font-semibold">
                        FOR
                    </div>
                    {playerA.id === currentUserId && (
                        <div className="text-[10px] uppercase tracking-wider text-[#86868b] font-mono-sf mt-2">You</div>
                    )}
                </div>

                {/* Minimalist VS */}
                <div className="flex flex-col items-center">
                    <div className="text-xs font-mono-sf text-[#86868b] uppercase tracking-widest">
                        versus
                    </div>
                </div>

                {/* Player B Card */}
                <div className={`apple-glass-card p-6 text-center ${playerB.id === currentUserId ? 'apple-glass-card-active' : ''}`}>
                    <div className="w-14 h-14 rounded-full bg-black text-white mx-auto mb-3 flex items-center justify-center text-lg font-semibold shadow-sm">
                        {playerB.display_name.charAt(0)}
                    </div>
                    <div className="text-base font-semibold text-[#1d1d1f] tracking-tight">{playerB.display_name}</div>
                    <div className="text-xs font-mono-sf text-[#86868b] mt-1">{playerB.rating} Elo</div>
                    <div className="mt-3 inline-block px-3 py-1 rounded-full bg-black/[0.06] text-[#1d1d1f] border border-black/10 text-xs font-semibold">
                        AGAINST
                    </div>
                    {playerB.id === currentUserId && (
                        <div className="text-[10px] uppercase tracking-wider text-[#86868b] font-mono-sf mt-2">You</div>
                    )}
                </div>
            </div>

            {/* Motion & 5 Mandatory Vocabulary Hints */}
            {topic && (
                <div className="w-full apple-glass-card p-6 md:p-8 text-left">
                    <div className="flex items-center justify-between mb-3">
                        <span className="text-xs font-mono-sf text-[#86868b] uppercase tracking-wider">
                            Debate Motion
                        </span>
                        <span className="text-xs text-[#86868b]">
                            {topic.category}
                        </span>
                    </div>

                    <h3 className="text-xl md:text-2xl font-semibold tracking-tight text-[#1d1d1f] mb-2">
                        "{topic.motion}"
                    </h3>
                    <p className="text-sm text-[#86868b] mb-6 leading-relaxed">
                        {topic.description}
                    </p>

                    {/* 5 Mandatory Vocabulary Hints */}
                    <div className="border-t border-black/[0.08] pt-5">
                        <div className="flex items-center justify-between mb-3 text-xs">
                            <span className="font-medium text-[#1d1d1f]">
                                Mandatory Vocabulary Hints
                            </span>
                            <span className="text-[#86868b] font-mono-sf">
                                +2 bonus points per word used
                            </span>
                        </div>
                        <div className="flex flex-wrap gap-2">
                            {mandatoryVocabulary.map((word, idx) => (
                                <span
                                    key={idx}
                                    className="px-3.5 py-1.5 rounded-full bg-black/[0.04] border border-black/10 text-[#1d1d1f] text-xs font-medium font-mono-sf"
                                >
                                    {word}
                                </span>
                            ))}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

// -------------------------------------------------------------
// STEP 04: COIN TOSS SCREEN (Apple Aluminum Token)
// -------------------------------------------------------------
function CoinTossScreen({ winnerKey, playerA, playerB }) {
    const firstSpeaker = winnerKey === 'player_a' ? playerA : playerB;

    return (
        <div className="flex flex-col items-center justify-center py-12 text-center">
            <div className="apple-pill mb-8">
                Step 04 · Coin Toss
            </div>

            {/* Minimalist Aluminum Coin */}
            <div className="coin-container mb-8">
                <div className="coin flipping">
                    <div className="coin-face coin-front">
                        <span className="text-xs font-mono-sf tracking-widest text-[#86868b]">FIRST</span>
                        <span className="text-2xl font-bold text-[#1d1d1f] mt-1">A</span>
                    </div>
                    <div className="coin-face coin-back">
                        <span className="text-xs font-mono-sf tracking-widest text-[#86868b]">FIRST</span>
                        <span className="text-2xl font-bold text-[#1d1d1f] mt-1">B</span>
                    </div>
                </div>
            </div>

            <h2 className="text-3xl md:text-4xl font-semibold tracking-tight text-[#1d1d1f] mb-2">
                {firstSpeaker ? firstSpeaker.display_name : 'Player A'} speaks first
            </h2>
            <p className="text-[#86868b] max-w-sm text-sm font-normal">
                Order locked. 4 turns of 45 seconds each. Active speaker's microphone is enabled by the server.
            </p>
        </div>
    );
}

// -------------------------------------------------------------
// STEP 05: LIVE DEBATE ARENA (Apple Light Mode Stage)
// -------------------------------------------------------------
function DebateArenaScreen({
    playerA,
    playerB,
    currentUserId,
    topic,
    turnIndex,
    currentTurn,
    turnTimeRemaining,
    totalDebateRemaining,
    micEnabledUserId,
    liveTranscript,
    allTurnTranscripts,
    hintsStatus,
    visualizerCanvasRef,
    onDevSkipTurn,
    onDevFinishDebate,
    onInsertSample
}) {
    const isMyTurn = micEnabledUserId === currentUserId;
    const activePlayer = currentTurn && currentTurn.speaker_id === playerA.id ? playerA : playerB;
    const isPlayerAActive = currentTurn && currentTurn.speaker_id === playerA.id;

    const turnSchedule = [
        { index: 1, name: 'Motion / Opening', speaker: playerA.display_name, side: 'FOR' },
        { index: 2, name: 'Constructive Speech', speaker: playerB.display_name, side: 'AGAINST' },
        { index: 3, name: 'Rebuttal', speaker: playerA.display_name, side: 'FOR' },
        { index: 4, name: 'Closing Summary', speaker: playerB.display_name, side: 'AGAINST' }
    ];

    const formatTime = (secs) => {
        const m = Math.floor(secs / 60);
        const s = secs % 60;
        return `${m}:${s < 10 ? '0' : ''}${s}`;
    };

    return (
        <div className="flex flex-col space-y-6 max-w-4xl mx-auto w-full">
            {/* Top Bar: Motion & Total Clock */}
            <div className="apple-glass-card p-5 flex flex-col md:flex-row md:items-center justify-between gap-3">
                <div className="flex-1">
                    <div className="text-[11px] font-mono-sf text-[#86868b] uppercase tracking-wider mb-1">
                        Motion · {topic ? topic.category : 'General'}
                    </div>
                    <div className="text-base md:text-lg font-semibold text-[#1d1d1f] tracking-tight">
                        "{topic ? topic.motion : 'Competitive Motion'}"
                    </div>
                </div>

                <div className="flex items-center space-x-2.5 bg-black/[0.04] border border-black/[0.08] px-4 py-2 rounded-full self-start md:self-auto font-mono-sf text-xs">
                    <span className="text-[#86868b]">MATCH</span>
                    <span className="text-[#1d1d1f] font-semibold">
                        {formatTime(totalDebateRemaining)}
                    </span>
                </div>
            </div>

            {/* 4-Turn Timeline Header */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                {turnSchedule.map((t) => {
                    const isActive = turnIndex === t.index;
                    const isPast = turnIndex > t.index;
                    return (
                        <div
                            key={t.index}
                            className={`p-3 rounded-xl border transition-all ${
                                isActive
                                    ? 'bg-black text-white border-black shadow-sm'
                                    : isPast
                                    ? 'bg-white border-black/[0.06] text-neutral-400'
                                    : 'bg-white border-black/[0.06] text-neutral-500'
                            }`}
                        >
                            <div className="flex items-center justify-between text-[11px] font-mono-sf">
                                <span>TURN 0{t.index}</span>
                                {isActive && (
                                    <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse"></span>
                                )}
                                {isPast && <span>✓</span>}
                            </div>
                            <div className={`text-xs font-semibold mt-1 tracking-tight ${isActive ? 'text-white' : 'text-[#1d1d1f]'}`}>
                                {t.name}
                            </div>
                            <div className={`text-[10px] mt-0.5 ${isActive ? 'text-white/70' : 'text-[#86868b]'}`}>
                                {t.speaker}
                            </div>
                        </div>
                    );
                })}
            </div>

            {/* Center Stage: Debater Split & Minimalist Ring Timer */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-center">
                {/* Player A Box */}
                <div
                    className={`apple-glass-card p-5 transition-all ${
                        isPlayerAActive ? 'apple-speaker-active' : 'opacity-70'
                    }`}
                >
                    <div className="flex items-center space-x-3 mb-3">
                        <div className="w-10 h-10 rounded-full bg-black text-white flex items-center justify-center text-sm font-semibold shadow-sm">
                            {playerA.display_name.charAt(0)}
                        </div>
                        <div>
                            <div className="text-sm font-semibold text-[#1d1d1f] tracking-tight flex items-center space-x-1.5">
                                <span>{playerA.display_name}</span>
                                {playerA.id === currentUserId && (
                                    <span className="text-[10px] text-[#86868b] font-mono-sf">(You)</span>
                                )}
                            </div>
                            <div className="text-xs text-[#86868b] font-mono-sf">SIDE: FOR</div>
                        </div>
                    </div>

                    {isPlayerAActive ? (
                        <div className="flex items-center space-x-2 text-xs text-white bg-black px-3 py-1.5 rounded-full shadow-sm">
                            <span className="w-2 h-2 rounded-full bg-white animate-pulse"></span>
                            <span>Speaking</span>
                        </div>
                    ) : (
                        <div className="flex items-center space-x-2 text-xs text-[#86868b] px-3 py-1.5">
                            <span className="w-1.5 h-1.5 rounded-full bg-neutral-400"></span>
                            <span>Listening</span>
                        </div>
                    )}
                </div>

                {/* Minimalist Turn Timer Dial */}
                <div className="flex flex-col items-center justify-center text-center p-2">
                    <div className="relative w-36 h-36 flex items-center justify-center">
                        <svg className="w-full h-full transform -rotate-90" viewBox="0 0 100 100">
                            <circle
                                cx="50"
                                cy="50"
                                r="42"
                                className="text-black/[0.08] stroke-current"
                                strokeWidth="4"
                                fill="transparent"
                            />
                            <circle
                                cx="50"
                                cy="50"
                                r="42"
                                className="text-black stroke-current transition-all duration-1000"
                                strokeWidth="4"
                                strokeDasharray={264}
                                strokeDashoffset={264 - (264 * turnTimeRemaining) / 45}
                                strokeLinecap="round"
                                fill="transparent"
                            />
                        </svg>

                        <div className="absolute inset-0 flex flex-col items-center justify-center">
                            <span className="text-3xl font-semibold font-mono-sf tracking-tight text-[#1d1d1f]">
                                0:{turnTimeRemaining < 10 ? '0' : ''}{turnTimeRemaining}
                            </span>
                            <span className="text-[10px] font-mono-sf uppercase text-[#86868b] mt-0.5">
                                {currentTurn ? currentTurn.turn_name : 'Turn'}
                            </span>
                        </div>
                    </div>
                </div>

                {/* Player B Box */}
                <div
                    className={`apple-glass-card p-5 transition-all ${
                        !isPlayerAActive ? 'apple-speaker-active' : 'opacity-70'
                    }`}
                >
                    <div className="flex items-center space-x-3 mb-3">
                        <div className="w-10 h-10 rounded-full bg-black text-white flex items-center justify-center text-sm font-semibold shadow-sm">
                            {playerB.display_name.charAt(0)}
                        </div>
                        <div>
                            <div className="text-sm font-semibold text-[#1d1d1f] tracking-tight flex items-center space-x-1.5">
                                <span>{playerB.display_name}</span>
                                {playerB.id === currentUserId && (
                                    <span className="text-[10px] text-[#86868b] font-mono-sf">(You)</span>
                                )}
                            </div>
                            <div className="text-xs text-[#86868b] font-mono-sf">SIDE: AGAINST</div>
                        </div>
                    </div>

                    {!isPlayerAActive ? (
                        <div className="flex items-center space-x-2 text-xs text-white bg-black px-3 py-1.5 rounded-full shadow-sm">
                            <span className="w-2 h-2 rounded-full bg-white animate-pulse"></span>
                            <span>Speaking</span>
                        </div>
                    ) : (
                        <div className="flex items-center space-x-2 text-xs text-[#86868b] px-3 py-1.5">
                            <span className="w-1.5 h-1.5 rounded-full bg-neutral-400"></span>
                            <span>Listening</span>
                        </div>
                    )}
                </div>
            </div>

            {/* Audio Waveform Canvas (Clean Charcoal/Black) */}
            <div className="apple-glass-card p-3">
                <div className="flex items-center justify-between text-xs font-mono-sf text-[#86868b] mb-2 px-1">
                    <span className="flex items-center space-x-2">
                        <span className={`w-1.5 h-1.5 rounded-full ${isMyTurn ? 'bg-black' : 'bg-neutral-400'}`}></span>
                        <span>{isMyTurn ? 'Your Audio Input' : "Opponent's Live Audio"}</span>
                    </span>
                    <span className="text-[10px] text-[#86868b] font-mono-sf">Opus 48kHz</span>
                </div>
                <canvas ref={visualizerCanvasRef} width={800} height={46} className="waveform-canvas" />
            </div>

            {/* Mandatory Vocabulary Tracker */}
            <div className="apple-glass-card p-4">
                <div className="flex items-center justify-between mb-2.5 px-1">
                    <span className="text-xs font-mono-sf text-[#86868b] uppercase tracking-wider">
                        Vocabulary Hints
                    </span>
                    <span className="text-xs font-mono-sf text-[#1d1d1f] font-medium">
                        Used: {hintsStatus.filter(h => h.used).length} / {hintsStatus.length}
                    </span>
                </div>

                <div className="flex flex-wrap gap-2">
                    {hintsStatus.map((hint, idx) => (
                        <div
                            key={idx}
                            className={`px-3 py-1 rounded-full text-xs font-mono-sf transition-all ${
                                hint.used
                                    ? 'bg-black text-white font-semibold shadow-sm'
                                    : 'bg-black/[0.04] border border-black/10 text-neutral-600'
                            }`}
                        >
                            <span>{hint.used ? '✓ ' : ''}</span>
                            <span>{hint.word}</span>
                            {hint.used && <span className="ml-1 text-[10px] text-neutral-300">(+2)</span>}
                        </div>
                    ))}
                </div>
            </div>

            {/* Live Speech-to-Text Transcript Feed */}
            <div className="apple-glass-card p-5">
                <div className="flex items-center justify-between mb-3 text-xs font-mono-sf text-[#86868b]">
                    <span>Live Speech Recognition</span>
                    <span>{isMyTurn ? 'Active Input' : 'Incoming Stream'}</span>
                </div>

                <div className="min-h-[80px] p-4 rounded-xl bg-black/[0.02] border border-black/[0.06] text-[#1d1d1f] text-sm leading-relaxed font-normal">
                    {liveTranscript ? (
                        <span>
                            {liveTranscript.split(' ').map((word, wIdx) => {
                                const clean = word.toLowerCase().replace(/[^a-z]/g, '');
                                const isHint = hintsStatus.some(h => clean.startsWith(h.word.toLowerCase()));
                                return (
                                    <span
                                        key={wIdx}
                                        className={isHint ? 'bg-black text-white font-medium px-1.5 py-0.5 rounded' : ''}
                                    >
                                        {word}{' '}
                                    </span>
                                );
                            })}
                        </span>
                    ) : (
                        <span className="text-[#86868b] italic">
                            {isMyTurn
                                ? 'Speak into your microphone... Spoken words will transcribe in real time.'
                                : `Listening to ${activePlayer ? activePlayer.display_name : 'opponent'}...`}
                        </span>
                    )}
                </div>
            </div>

            {/* Minimalist Testing Bar */}
            <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-[#86868b] pt-2 px-1">
                <span className="font-mono-sf">Test Controls:</span>
                <div className="flex flex-wrap gap-2">
                    <button
                        onClick={() => {
                            onInsertSample(
                                `I firmly argue that innovation and efficiency provide immense value, but we must prioritize critical thinking, empathy, and accountability in our long-term institutions.`
                            );
                        }}
                        className="apple-btn-secondary !text-xs !py-1 !px-2.5"
                    >
                        + Insert Sample
                    </button>

                    <button
                        onClick={onDevSkipTurn}
                        className="apple-btn-secondary !text-xs !py-1 !px-2.5"
                    >
                        Skip Turn ⏩
                    </button>

                    <button
                        onClick={onDevFinishDebate}
                        className="apple-btn-secondary !text-xs !py-1 !px-2.5"
                    >
                        Evaluate 📊
                    </button>
                </div>
            </div>
        </div>
    );
}

// -------------------------------------------------------------
// STEP 06: AI EVALUATION SCREEN (Apple Light Mode)
// -------------------------------------------------------------
function EvaluatingScreen() {
    const [step, setStep] = useState(1);

    useEffect(() => {
        const t1 = setTimeout(() => setStep(2), 1200);
        const t2 = setTimeout(() => setStep(3), 2400);
        const t3 = setTimeout(() => setStep(4), 3600);
        return () => {
            clearTimeout(t1);
            clearTimeout(t2);
            clearTimeout(t3);
        };
    }, []);

    const steps = [
        { id: 1, title: 'Transcribing 4 Speaking Turns', desc: 'Aggregating recorded speech segments' },
        { id: 2, title: 'Auditing Grammar & Vocabulary', desc: 'Syntax verification and mandatory word bonus count' },
        { id: 3, title: 'Evaluating Logical Reasoning', desc: 'Analyzing argument clash, thesis clarity, and rebuttals' },
        { id: 4, title: 'Calculating Deterministic Scores', desc: 'Computing independent English & Debating proficiency' }
    ];

    return (
        <div className="flex flex-col items-center justify-center py-16 text-center max-w-md mx-auto">
            {/* Minimalist Loading Spinner */}
            <div className="w-10 h-10 rounded-full border-2 border-black/20 border-t-black animate-spin mb-6"></div>

            <div className="apple-pill mb-3">
                Step 06 · AI Adjudication
            </div>
            <h2 className="text-2xl md:text-3xl font-semibold tracking-tight text-[#1d1d1f] mb-8">
                Evaluating debate speeches...
            </h2>

            <div className="w-full space-y-2.5 text-left">
                {steps.map(s => {
                    const isDone = step > s.id;
                    const isCurrent = step === s.id;
                    return (
                        <div
                            key={s.id}
                            className={`p-3.5 rounded-xl border transition-all ${
                                isCurrent
                                    ? 'bg-white border-black/40 shadow-sm'
                                    : isDone
                                    ? 'bg-white/80 border-black/[0.08] text-[#1d1d1f]'
                                    : 'bg-transparent border-black/[0.04] text-[#86868b]'
                            }`}
                        >
                            <div className="flex items-center space-x-3">
                                <div className="text-xs font-mono-sf font-semibold">
                                    {isDone ? '✓' : isCurrent ? '○' : '·'}
                                </div>
                                <div className="flex-1">
                                    <div className="text-xs font-semibold text-[#1d1d1f] tracking-tight">
                                        {s.title}
                                    </div>
                                    <div className="text-[11px] text-[#86868b]">
                                        {s.desc}
                                    </div>
                                </div>
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

// -------------------------------------------------------------
// STEP 07: RESULTS & SCORECARD (Apple Keynote Light Mode)
// -------------------------------------------------------------
function ResultsScreen({ evaluation, turns, topic, currentUserId, onPlayAgain, onBackToLobby }) {
    const pA = evaluation.player_a;
    const pB = evaluation.player_b;
    const winnerKey = evaluation.winner;
    const changes = evaluation.rating_changes || {};

    const isPlayerAWinner = winnerKey === 'player_a';
    const isPlayerBWinner = winnerKey === 'player_b';
    const isDraw = !winnerKey;

    const isPlayerA = pA.player_id === currentUserId;
    const myEval = isPlayerA ? pA : pB;
    const myChange = isPlayerA ? changes.player_a : changes.player_b;

    return (
        <div className="flex flex-col space-y-8 max-w-4xl mx-auto w-full py-4">
            {/* Winner Keynote Banner */}
            <div className="apple-glass-card p-8 text-center relative overflow-hidden">
                <div className="apple-pill mb-4">
                    Step 07 · Final Results
                </div>

                <h1 className="text-4xl md:text-6xl font-bold tracking-tight text-[#1d1d1f] mb-2">
                    {isDraw ? 'Debate Ended in a Draw' : `${evaluation.winner_name} Wins`}
                </h1>

                <p className="text-[#86868b] text-sm max-w-md mx-auto mb-6">
                    Motion: "{evaluation.motion}"
                </p>

                {myChange && (
                    <div className="inline-flex items-center space-x-3 bg-black/[0.04] border border-black/10 px-5 py-2 rounded-full font-mono-sf text-xs">
                        <span className="text-[#86868b]">RATING</span>
                        <span className="text-[#1d1d1f] font-semibold">{myChange.old_rating}</span>
                        <span className="text-neutral-400">→</span>
                        <span className="text-[#1d1d1f] font-bold">{myChange.new_rating}</span>
                        <span className="px-2 py-0.5 rounded-full bg-black text-white font-semibold">
                            {myChange.delta >= 0 ? `+${myChange.delta}` : myChange.delta}
                        </span>
                    </div>
                )}
            </div>

            {/* Dual Scorecards: English Proficiency vs Debating Proficiency */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <DebaterScoreCard
                    playerEval={pA}
                    isWinner={isPlayerAWinner}
                    isCurrent={pA.player_id === currentUserId}
                    side="FOR"
                />

                <DebaterScoreCard
                    playerEval={pB}
                    isWinner={isPlayerBWinner}
                    isCurrent={pB.player_id === currentUserId}
                    side="AGAINST"
                />
            </div>

            {/* Grammar Corrections & Feedback Section */}
            <div className="apple-glass-card p-6">
                <div className="flex items-center justify-between mb-4">
                    <h3 className="text-base font-semibold text-[#1d1d1f] tracking-tight">
                        Language & Grammar Analysis
                    </h3>
                    <span className="text-xs text-[#86868b] font-mono-sf">Feedback for {myEval.player_name}</span>
                </div>

                <div className="space-y-3 mb-6">
                    {myEval.grammar_corrections && myEval.grammar_corrections.map((corr, idx) => (
                        <div key={idx} className="p-4 rounded-xl bg-black/[0.02] border border-black/[0.06] text-xs">
                            <div className="flex items-baseline space-x-2 text-neutral-600 mb-1">
                                <span className="font-mono-sf text-[11px] text-[#86868b]">Spoken:</span>
                                <span>"{corr.original}"</span>
                            </div>
                            <div className="flex items-baseline space-x-2 text-[#1d1d1f] mb-2">
                                <span className="font-mono-sf text-[11px] text-[#86868b]">Revision:</span>
                                <span className="font-semibold">{corr.corrected}</span>
                            </div>
                            <div className="text-[#86868b] text-[11px] leading-relaxed">
                                {corr.explanation}
                            </div>
                        </div>
                    ))}
                </div>

                {/* 3 Personalized Improvement Suggestions */}
                <div className="border-t border-black/[0.08] pt-5">
                    <div className="text-xs font-mono-sf text-[#86868b] uppercase tracking-wider mb-3">
                        Strategic Recommendations
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                        {myEval.suggestions && myEval.suggestions.map((sug, idx) => (
                            <div key={idx} className="p-3.5 rounded-xl bg-black/[0.02] border border-black/[0.06] text-xs leading-relaxed text-[#1d1d1f]">
                                <span className="font-mono-sf text-[#86868b] mr-1.5">{idx + 1}.</span>
                                {sug}
                            </div>
                        ))}
                    </div>
                </div>
            </div>

            {/* Spoken Speeches Transcript Accordion */}
            <div className="apple-glass-card p-6">
                <h3 className="text-base font-semibold text-[#1d1d1f] tracking-tight mb-4">
                    Debate Transcripts
                </h3>

                <div className="space-y-3">
                    {turns && turns.map((t, idx) => (
                        <div key={idx} className="p-4 rounded-xl bg-black/[0.02] border border-black/[0.06]">
                            <div className="flex items-center justify-between text-xs font-mono-sf mb-2">
                                <span className="text-[#1d1d1f] font-semibold">
                                    TURN 0{t.turn_index} · {t.turn_name}
                                </span>
                                <span className="text-[#86868b]">
                                    {t.speaker_key === 'player_a' ? pA.player_name : pB.player_name} ({t.speaker_side})
                                </span>
                            </div>
                            <p className="text-sm text-[#1d1d1f] leading-relaxed font-normal">
                                {t.transcript}
                            </p>
                        </div>
                    ))}
                </div>
            </div>

            {/* Action Buttons */}
            <div className="flex flex-wrap items-center justify-center gap-3 py-4">
                <button
                    onClick={onPlayAgain}
                    className="apple-btn-primary"
                >
                    Start Another Debate
                </button>

                <button
                    onClick={onBackToLobby}
                    className="apple-btn-secondary"
                >
                    Return to Overview
                </button>
            </div>
        </div>
    );
}

// Subcomponent: Debater Score Card (Apple Light Mode)
function DebaterScoreCard({ playerEval, isWinner, isCurrent, side }) {
    const eng = playerEval.english_proficiency;
    const deb = playerEval.debating_proficiency;
    const eb = playerEval.english_breakdown || {};
    const db = playerEval.debate_breakdown || {};

    return (
        <div className={`apple-glass-card p-6 ${isWinner ? 'border-black/30 shadow-md' : ''}`}>
            {/* Header */}
            <div className="flex items-center justify-between mb-5">
                <div>
                    <div className="text-base font-semibold text-[#1d1d1f] tracking-tight flex items-center space-x-2">
                        <span>{playerEval.player_name}</span>
                        {isCurrent && <span className="text-[10px] text-[#86868b] font-mono-sf">(You)</span>}
                        {isWinner && <span className="text-[10px] px-2 py-0.5 rounded-full bg-black text-white font-semibold">Winner</span>}
                    </div>
                    <div className="text-xs font-mono-sf text-[#86868b] mt-0.5">Side: {side}</div>
                </div>
                <div className="text-right">
                    <div className="text-[10px] font-mono-sf text-[#86868b]">COMPOSITE</div>
                    <div className="text-lg font-semibold font-mono-sf text-[#1d1d1f]">{playerEval.composite_score}</div>
                </div>
            </div>

            {/* Dual Hero Metric Numbers */}
            <div className="grid grid-cols-2 gap-3 mb-5">
                <div className="p-3.5 rounded-xl bg-black/[0.02] border border-black/[0.06] text-center">
                    <div className="text-[11px] font-mono-sf text-[#86868b]">English Proficiency</div>
                    <div className="text-3xl font-semibold tracking-tight text-[#1d1d1f] mt-1">{eng}</div>
                    <div className="text-[10px] text-[#86868b] font-mono-sf">/ 100</div>
                </div>

                <div className="p-3.5 rounded-xl bg-black/[0.02] border border-black/[0.06] text-center">
                    <div className="text-[11px] font-mono-sf text-[#86868b]">Debating Proficiency</div>
                    <div className="text-3xl font-semibold tracking-tight text-[#1d1d1f] mt-1">{deb}</div>
                    <div className="text-[10px] text-[#86868b] font-mono-sf">/ 100</div>
                </div>
            </div>

            {/* Mandatory Vocabulary Bonus */}
            <div className="p-3 rounded-xl bg-black/[0.02] border border-black/[0.06] mb-3 flex items-center justify-between text-xs font-mono-sf">
                <span className="text-[#86868b]">Vocabulary Hints Used:</span>
                <span className="text-[#1d1d1f] font-semibold">
                    +{playerEval.hints_used_count || 0} words ({eb.hint_bonus ? `+${eb.hint_bonus} pts` : '+0 pts'})
                </span>
            </div>

            {/* Trained ML Speech Model Accreditation */}
            <div className="p-2.5 rounded-xl bg-black/[0.03] border border-black/[0.08] mb-5 flex items-center justify-between text-[11px] font-mono-sf">
                <span className="text-[#86868b] flex items-center space-x-1">
                    <span>🎙️</span>
                    <span>Speech ML Level:</span>
                </span>
                <span className="text-[#1d1d1f] font-semibold">
                    {playerEval.speech_ml ? playerEval.speech_ml.cefr_level : 'B2 (Upper Interm)'}
                </span>
            </div>

            {/* Sub-Criteria Minimalist Meters */}
            <div className="space-y-2.5 text-xs">
                <div className="font-mono-sf text-[11px] text-[#86868b] uppercase mb-1">
                    English Skills
                </div>
                <AppleScoreBar label="Grammar & Syntax" value={eb.grammar || 80} />
                <AppleScoreBar label="Vocabulary Range" value={eb.vocabulary || 80} />
                <AppleScoreBar label="Fluency & Pace" value={eb.fluency || 80} />
                <AppleScoreBar label="Clarity & Diction" value={eb.clarity || 80} />

                <div className="font-mono-sf text-[11px] text-[#86868b] uppercase mt-4 mb-1">
                    Debating Skills
                </div>
                <AppleScoreBar label="Logical Reasoning" value={db.logical_reasoning || 80} />
                <AppleScoreBar label="Argument Structure" value={db.argument_structure || 80} />
                <AppleScoreBar label="Rebuttal Clash" value={db.rebuttal_quality || 80} />
                <AppleScoreBar label="Persuasiveness" value={db.persuasiveness || 80} />
            </div>
        </div>
    );
}

function AppleScoreBar({ label, value }) {
    return (
        <div>
            <div className="flex justify-between text-[11px] text-[#1d1d1f] mb-1">
                <span>{label}</span>
                <span className="font-mono-sf text-[#86868b]">{value}</span>
            </div>
            <div className="w-full h-1 rounded-full bg-black/[0.08] overflow-hidden">
                <div
                    className="h-full rounded-full bg-black transition-all duration-1000"
                    style={{ width: `${Math.min(100, Math.max(0, value))}%` }}
                ></div>
            </div>
        </div>
    );
}

// -------------------------------------------------------------
// MODALS: LEADERBOARD & MATCH HISTORY (Apple Frosted Sheet Light)
// -------------------------------------------------------------
function LeaderboardModal({ data, currentUserId, onClose }) {
    return (
        <div className="fixed inset-0 bg-black/25 backdrop-blur-md z-50 flex items-center justify-center p-4">
            <div className="bg-white p-6 rounded-3xl border border-black/10 shadow-2xl max-w-xl w-full max-h-[80vh] flex flex-col">
                <div className="flex items-center justify-between pb-4 border-b border-black/[0.08]">
                    <h2 className="text-base font-semibold text-[#1d1d1f] tracking-tight">Global Rankings</h2>
                    <button onClick={onClose} className="text-[#86868b] hover:text-[#1d1d1f] text-sm">✕</button>
                </div>

                <div className="overflow-y-auto flex-1 py-4 space-y-2">
                    {data.map((user, idx) => (
                        <div
                            key={user.id}
                            className={`p-3 rounded-xl flex items-center justify-between border ${
                                user.id === currentUserId
                                    ? 'bg-black/[0.04] border-black/20'
                                    : 'bg-transparent border-black/[0.04]'
                            }`}
                        >
                            <div className="flex items-center space-x-3">
                                <span className="w-6 text-center font-mono-sf text-xs text-[#86868b]">
                                    #{idx + 1}
                                </span>
                                <div className="w-7 h-7 rounded-full bg-black text-white flex items-center justify-center text-xs font-semibold">
                                    {user.display_name.charAt(0)}
                                </div>
                                <div>
                                    <div className="text-sm font-medium text-[#1d1d1f]">{user.display_name}</div>
                                    <div className="text-[10px] text-[#86868b] font-mono-sf">
                                        {user.matches_won}W - {user.matches_lost}L
                                    </div>
                                </div>
                            </div>

                            <div className="text-right">
                                <div className="text-sm font-semibold font-mono-sf text-[#1d1d1f]">{user.rating}</div>
                                <div className="text-[10px] text-[#86868b] font-mono-sf">
                                    Avg: {user.avg_english_score} Eng
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}

function HistoryModal({ data, onClose }) {
    return (
        <div className="fixed inset-0 bg-black/25 backdrop-blur-md z-50 flex items-center justify-center p-4">
            <div className="bg-white p-6 rounded-3xl border border-black/10 shadow-2xl max-w-xl w-full max-h-[80vh] flex flex-col">
                <div className="flex items-center justify-between pb-4 border-b border-black/[0.08]">
                    <h2 className="text-base font-semibold text-[#1d1d1f] tracking-tight">Debate History</h2>
                    <button onClick={onClose} className="text-[#86868b] hover:text-[#1d1d1f] text-sm">✕</button>
                </div>

                <div className="overflow-y-auto flex-1 py-4 space-y-2.5">
                    {data.length === 0 ? (
                        <div className="text-center py-12 text-[#86868b] font-mono-sf text-xs">
                            No past matches recorded yet. Complete a debate to review match logs.
                        </div>
                    ) : (
                        data.map((m, idx) => {
                            let topicObj = {};
                            try { topicObj = JSON.parse(m.topic_json); } catch (e) {}
                            return (
                                <div key={m.id || idx} className="p-3.5 rounded-xl bg-black/[0.02] border border-black/[0.06] text-xs">
                                    <div className="font-medium text-[#1d1d1f] mb-1">
                                        "{topicObj.motion || 'Competitive Debate'}"
                                    </div>
                                    <div className="flex items-center justify-between text-[#86868b] font-mono-sf mt-2">
                                        <span>{m.player_a_name} vs {m.player_b_name}</span>
                                        <span className="text-[#1d1d1f] font-semibold">
                                            {m.player_a_english_score}/{m.player_a_debate_score} - {m.player_b_english_score}/{m.player_b_debate_score}
                                        </span>
                                    </div>
                                </div>
                            );
                        })
                    )}
                </div>
            </div>
        </div>
    );
}

// Mount React Root
const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<VoiceDebateApp />);
