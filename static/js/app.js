// VoiceDebate Arena - Main React 18 Application
const { useState, useEffect, useRef } = React;

function VoiceDebateApp() {
    // Current User Profile
    const [user, setUser] = useState(() => {
        const saved = localStorage.getItem('voicedebate_user');
        if (saved) {
            try { return JSON.parse(saved); } catch (e) {}
        }
        // Check URL param ?user=player2
        const urlParams = new URLSearchParams(window.location.search);
        const userParam = urlParams.get('user');
        if (userParam === 'player2') {
            return {
                id: 'usr-jordan-blake',
                username: 'jordan_b',
                display_name: 'Jordan Blake',
                rating: 1220,
                avatar_color: '#8B5CF6'
            };
        }
        return {
            id: 'usr-alex-chen',
            username: 'alex_c',
            display_name: 'Alex Chen',
            rating: 1200,
            avatar_color: '#3B82F6'
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
            console.log('[WS] Connected to VoiceDebate Arena server');
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
        console.log('[WS Inbound]:', data.type, data);

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

                // Setup WebRTC connection (Player A initiates)
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
                // Initialize hint statuses
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

                // Sound cue
                window.soundFx.playTurnGong();

                // Server-authoritative mic state
                const isMyTurn = data.mic_enabled_user_id === user.id;
                if (webrtcRef.current) {
                    webrtcRef.current.setMicEnabled(isMyTurn);
                }

                // Speech recognition control
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

                // Sound beeps on final 3 seconds
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
                    // Check if a new hint was activated to play pleasant chime
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

                // Refresh user rating if updated
                if (data.evaluation && data.evaluation.rating_changes) {
                    const changes = data.evaluation.rating_changes;
                    const myChange = changes.player_a.user_id === user.id ? changes.player_a : changes.player_b;
                    if (myChange) {
                        setUser(prev => ({ ...prev, rating: myChange.new_rating }));
                    }
                }
                break;

            // WebRTC signaling
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

    // Quick speech sample insertion for effortless mic-less testing
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

    // Fetch Leaderboard
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

    // Fetch User Match History
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

    // Switch between Player 1 & Player 2 for testing
    const handleSwitchUser = (newProfile) => {
        setUser(newProfile);
        setScreen('LOBBY');
    };

    // Setup visualizer canvas
    useEffect(() => {
        if (screen === 'DEBATE' && visualizerCanvasRef.current && webrtcRef.current) {
            webrtcRef.current.startVisualizer(visualizerCanvasRef.current);
        }
        return () => {
            if (webrtcRef.current) webrtcRef.current.stopVisualizer();
        };
    }, [screen]);

    return (
        <div className="min-h-screen bg-[#0a0b10] text-slate-100 flex flex-col justify-between selection:bg-cyan-500 selection:text-black">
            {/* Top Navigation Bar */}
            <header className="border-b border-slate-800/80 bg-[#0e111a]/90 backdrop-blur-md px-6 py-4 flex items-center justify-between sticky top-0 z-50">
                <div className="flex items-center space-x-3 cursor-pointer" onClick={() => setScreen('LOBBY')}>
                    <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-cyan-500 to-indigo-600 flex items-center justify-center shadow-lg shadow-cyan-500/20">
                        <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 100-6 3 3 0 000 6z" />
                        </svg>
                    </div>
                    <div>
                        <div className="text-xl font-black tracking-tight font-display bg-gradient-to-r from-white via-slate-200 to-cyan-400 bg-clip-text text-transparent">
                            VOICE<span className="text-cyan-400">DEBATE</span>
                        </div>
                        <div className="text-[10px] uppercase font-bold tracking-widest text-slate-400 font-mono">
                            1v1 Real-Time League
                        </div>
                    </div>
                </div>

                {/* Right controls */}
                <div className="flex items-center space-x-4">
                    <button
                        onClick={handleOpenLeaderboard}
                        className="px-3.5 py-1.5 rounded-lg border border-slate-700 bg-slate-900/60 hover:bg-slate-800 text-xs font-semibold text-slate-300 transition-all flex items-center space-x-2"
                    >
                        <span>🏆</span>
                        <span>Leaderboard</span>
                    </button>

                    <button
                        onClick={handleOpenHistory}
                        className="px-3.5 py-1.5 rounded-lg border border-slate-700 bg-slate-900/60 hover:bg-slate-800 text-xs font-semibold text-slate-300 transition-all flex items-center space-x-2"
                    >
                        <span>📜</span>
                        <span>History</span>
                    </button>

                    {/* User profile dropdown / switch pill */}
                    <div className="flex items-center space-x-3 bg-slate-900/80 border border-slate-800 rounded-xl px-3 py-1.5">
                        <div className="w-7 h-7 rounded-lg flex items-center justify-center text-xs font-bold text-white shadow" style={{ backgroundColor: user.avatar_color }}>
                            {user.display_name.charAt(0)}
                        </div>
                        <div className="text-left">
                            <div className="text-xs font-bold text-slate-200 flex items-center space-x-1.5">
                                <span>{user.display_name}</span>
                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-cyan-950 text-cyan-400 border border-cyan-800 font-mono font-bold">
                                    {user.rating} Elo
                                </span>
                            </div>
                        </div>

                        {/* Quick switch user button for 2-tab testing */}
                        <button
                            title="Switch User (Test 2 players)"
                            onClick={() => {
                                if (user.username === 'alex_c') {
                                    handleSwitchUser({
                                        id: 'usr-jordan-blake',
                                        username: 'jordan_b',
                                        display_name: 'Jordan Blake',
                                        rating: 1240,
                                        avatar_color: '#8B5CF6'
                                    });
                                } else {
                                    handleSwitchUser({
                                        id: 'usr-alex-chen',
                                        username: 'alex_c',
                                        display_name: 'Alex Chen',
                                        rating: 1200,
                                        avatar_color: '#3B82F6'
                                    });
                                }
                            }}
                            className="text-[10px] px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-slate-200 border border-slate-700 transition"
                        >
                            Switch
                        </button>
                    </div>
                </div>
            </header>

            {/* Main Stage View Switcher */}
            <main className="flex-1 max-w-6xl w-full mx-auto p-4 md:p-6 flex flex-col justify-center">
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

            {/* Footer */}
            <footer className="border-t border-slate-900/90 py-3 text-center text-xs text-slate-500 font-mono">
                VoiceDebate 1v1 Competitive Arena · Real-Time WebRTC Voice & AI Adjudication
            </footer>
        </div>
    );
}

// -------------------------------------------------------------
// STEP 01: LOBBY SCREEN
// -------------------------------------------------------------
function LobbyScreen({ user, onStartMatch, onStartPractice }) {
    return (
        <div className="flex flex-col items-center justify-center py-6 text-center">
            {/* Badge */}
            <div className="inline-flex items-center space-x-2 px-3 py-1 rounded-full bg-cyan-950/60 border border-cyan-800/80 text-cyan-400 text-xs font-semibold mb-6">
                <span className="w-2 h-2 rounded-full bg-cyan-400 animate-ping"></span>
                <span>STEP 01 · COMPETITIVE MATCHMAKING</span>
            </div>

            <h1 className="text-4xl md:text-6xl font-black font-display tracking-tight max-w-3xl leading-tight mb-4">
                Prove Your Logic.<br />
                <span className="bg-gradient-to-r from-cyan-400 via-indigo-300 to-purple-400 bg-clip-text text-transparent">
                    Out-Debate Strangers Live.
                </span>
            </h1>

            <p className="text-slate-400 max-w-xl text-base md:text-lg mb-10">
                1v1 competitive voice debate under time pressure. 4 turns, 45 seconds each.
                Transcribed live, evaluated for English and debating mastery.
            </p>

            {/* Hero Start Button */}
            <div className="flex flex-col items-center space-y-4">
                <button
                    onClick={onStartMatch}
                    className="relative group px-12 py-5 rounded-2xl bg-gradient-to-r from-cyan-500 to-indigo-600 text-white font-extrabold text-xl tracking-wider uppercase font-display shadow-2xl shadow-cyan-500/30 hover:shadow-cyan-500/50 hover:scale-[1.03] active:scale-[0.98] transition-all duration-200"
                >
                    <div className="flex items-center space-x-3">
                        <svg className="w-6 h-6 text-white animate-pulse" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M13 10V3L4 14h7v7l9-11h-7z" />
                        </svg>
                        <span>START MATCH</span>
                    </div>
                </button>
                <span className="text-xs text-slate-500 font-mono">
                    Enters matchmaking queue · Opponent matched by Elo rating
                </span>
            </div>

            {/* Secondary actions / Testing helpers */}
            <div className="mt-12 flex flex-wrap items-center justify-center gap-4">
                <button
                    onClick={onStartPractice}
                    className="px-5 py-2.5 rounded-xl border border-slate-800 bg-slate-900/60 hover:bg-slate-800 text-sm font-semibold text-slate-300 transition flex items-center space-x-2"
                >
                    <span>🤖</span>
                    <span>Practice Match (AI Debater)</span>
                </button>

                <button
                    onClick={() => {
                        window.open(window.location.origin + '?user=player2', '_blank');
                    }}
                    className="px-5 py-2.5 rounded-xl border border-indigo-900/80 bg-indigo-950/40 hover:bg-indigo-900/60 text-sm font-semibold text-indigo-300 transition flex items-center space-x-2"
                >
                    <span>👥</span>
                    <span>Open Player 2 Window (Split-Screen Test)</span>
                </button>
            </div>

            {/* Match Format Cards */}
            <div className="mt-16 grid grid-cols-1 md:grid-cols-4 gap-4 w-full max-w-4xl text-left">
                {[
                    { turn: '01', title: 'Motion / Opening', speaker: 'Player A', time: '0:45' },
                    { turn: '02', title: 'Constructive Speech', speaker: 'Player B', time: '0:45' },
                    { turn: '03', title: 'Rebuttal', speaker: 'Player A', time: '0:45' },
                    { turn: '04', title: 'Closing Summary', speaker: 'Player B', time: '0:45' },
                ].map((item, idx) => (
                    <div key={idx} className="glass-panel p-4 rounded-xl border border-slate-800/80">
                        <div className="flex items-center justify-between text-xs font-mono text-cyan-400 font-bold mb-1">
                            <span>TURN {item.turn}</span>
                            <span className="bg-slate-800 px-1.5 py-0.5 rounded text-slate-300">{item.time}</span>
                        </div>
                        <div className="text-sm font-bold text-slate-200">{item.title}</div>
                        <div className="text-xs text-slate-400 mt-1">{item.speaker}</div>
                    </div>
                ))}
            </div>
        </div>
    );
}

// -------------------------------------------------------------
// STEP 01 (ACTIVE): MATCHMAKING RADAR
// -------------------------------------------------------------
function MatchingScreen({ user, onCancel, onStartPractice }) {
    return (
        <div className="flex flex-col items-center justify-center py-12 text-center">
            {/* Animated Radar Container */}
            <div className="relative w-64 h-64 mb-8 flex items-center justify-center">
                {/* Concentric Radar Rings */}
                <div className="absolute inset-0 rounded-full border border-cyan-500/20"></div>
                <div className="absolute inset-8 rounded-full border border-cyan-500/30"></div>
                <div className="absolute inset-16 rounded-full border border-cyan-500/40"></div>
                
                {/* Pulsing Waves */}
                <div className="absolute inset-0 rounded-full bg-cyan-500/10 animate-ping-slow"></div>

                {/* Rotating Scanner Needle */}
                <div className="absolute inset-0 rounded-full overflow-hidden animate-radar">
                    <div className="w-1/2 h-1/2 bg-gradient-to-br from-cyan-400/30 to-transparent origin-bottom-right transform rotate-45"></div>
                </div>

                {/* Center Pulse Player Avatar */}
                <div className="relative z-10 w-20 h-20 rounded-2xl flex items-center justify-center text-2xl font-bold text-white shadow-xl shadow-cyan-500/30" style={{ backgroundColor: user.avatar_color }}>
                    {user.display_name.charAt(0)}
                </div>
            </div>

            <div className="text-xs font-mono font-bold tracking-widest text-cyan-400 uppercase mb-2">
                STEP 01 · FIND AN OPPONENT
            </div>
            <h2 className="text-2xl md:text-3xl font-extrabold font-display mb-2">
                Scanning Queue for Rival Debater...
            </h2>
            <p className="text-sm text-slate-400 max-w-md mb-8">
                Matching against participants in your skill tier ({user.rating} Elo).
                Connecting real-time WebRTC audio channel.
            </p>

            <div className="flex items-center space-x-4">
                <button
                    onClick={onCancel}
                    className="px-6 py-2.5 rounded-xl border border-rose-900/60 bg-rose-950/30 hover:bg-rose-900/50 text-rose-300 font-semibold text-sm transition"
                >
                    Cancel Matchmaking
                </button>

                <button
                    onClick={onStartPractice}
                    className="px-6 py-2.5 rounded-xl border border-slate-700 bg-slate-800/80 hover:bg-slate-700 text-slate-200 font-semibold text-sm transition"
                >
                    Switch to Practice Partner
                </button>
            </div>
        </div>
    );
}

// -------------------------------------------------------------
// STEP 02 & STEP 03: MATCH FOUND & TOPIC REVEAL
// -------------------------------------------------------------
function MatchFoundScreen({ playerA, playerB, topic, mandatoryVocabulary, currentUserId }) {
    if (!playerA || !playerB) return null;

    return (
        <div className="flex flex-col items-center justify-center py-6 text-center max-w-4xl mx-auto w-full">
            {/* Header Badge */}
            <div className="inline-flex items-center space-x-2 px-4 py-1.5 rounded-full bg-emerald-950/80 border border-emerald-700 text-emerald-400 text-xs font-bold mb-6">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping"></span>
                <span>STEP 02 & 03 · MATCH LOCKED & TOPIC GENERATED</span>
            </div>

            {/* Players VS Card */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 items-center w-full mb-8">
                {/* Player A Card */}
                <div className={`glass-panel p-6 rounded-2xl border ${playerA.id === currentUserId ? 'border-cyan-500/80 shadow-lg shadow-cyan-500/20' : 'border-slate-800'} text-center`}>
                    <div className="w-16 h-16 rounded-2xl mx-auto mb-3 flex items-center justify-center text-2xl font-bold text-white shadow-lg" style={{ backgroundColor: playerA.avatar_color || '#3B82F6' }}>
                        {playerA.display_name.charAt(0)}
                    </div>
                    <div className="text-lg font-extrabold text-slate-100">{playerA.display_name}</div>
                    <div className="text-xs font-mono text-cyan-400 font-bold mt-1">{playerA.rating} ELO</div>
                    <div className="mt-3 inline-block px-3 py-1 rounded bg-emerald-950 text-emerald-400 text-xs font-bold border border-emerald-800">
                        SIDE: FOR
                    </div>
                    {playerA.id === currentUserId && (
                        <div className="text-[10px] uppercase tracking-wider text-cyan-300 font-bold mt-2">YOU</div>
                    )}
                </div>

                {/* VS Emblem */}
                <div className="flex flex-col items-center">
                    <div className="w-14 h-14 rounded-full bg-slate-900 border-2 border-slate-700 flex items-center justify-center text-xl font-black font-display text-slate-300 shadow-xl">
                        VS
                    </div>
                    <div className="text-xs font-mono text-slate-500 mt-2">1v1 ROOM</div>
                </div>

                {/* Player B Card */}
                <div className={`glass-panel p-6 rounded-2xl border ${playerB.id === currentUserId ? 'border-cyan-500/80 shadow-lg shadow-cyan-500/20' : 'border-slate-800'} text-center`}>
                    <div className="w-16 h-16 rounded-2xl mx-auto mb-3 flex items-center justify-center text-2xl font-bold text-white shadow-lg" style={{ backgroundColor: playerB.avatar_color || '#8B5CF6' }}>
                        {playerB.display_name.charAt(0)}
                    </div>
                    <div className="text-lg font-extrabold text-slate-100">{playerB.display_name}</div>
                    <div className="text-xs font-mono text-purple-400 font-bold mt-1">{playerB.rating} ELO</div>
                    <div className="mt-3 inline-block px-3 py-1 rounded bg-rose-950 text-rose-400 text-xs font-bold border border-rose-800">
                        SIDE: AGAINST
                    </div>
                    {playerB.id === currentUserId && (
                        <div className="text-[10px] uppercase tracking-wider text-cyan-300 font-bold mt-2">YOU</div>
                    )}
                </div>
            </div>

            {/* Motion & 5 Mandatory Vocabulary Hints */}
            {topic && (
                <div className="w-full glass-panel p-6 md:p-8 rounded-2xl border border-slate-800 text-left">
                    <div className="flex items-center justify-between mb-3">
                        <span className="text-xs font-mono font-bold tracking-widest text-cyan-400 uppercase">
                            DEBATE MOTION
                        </span>
                        <span className="text-xs px-2.5 py-0.5 rounded-full bg-slate-800 text-slate-300 font-medium">
                            {topic.category}
                        </span>
                    </div>

                    <h3 className="text-xl md:text-2xl font-black font-display text-white mb-2">
                        "{topic.motion}"
                    </h3>
                    <p className="text-sm text-slate-400 mb-6">
                        {topic.description}
                    </p>

                    {/* 5 Mandatory Vocabulary Hints */}
                    <div className="border-t border-slate-800/80 pt-4">
                        <div className="flex items-center justify-between mb-3">
                            <span className="text-xs font-mono font-bold text-amber-400 uppercase flex items-center space-x-1.5">
                                <span>⭐</span>
                                <span>5 Mandatory Vocabulary Hints</span>
                            </span>
                            <span className="text-[11px] text-slate-400 font-mono">
                                +2 Bonus points for each word used
                            </span>
                        </div>
                        <div className="flex flex-wrap gap-2.5">
                            {mandatoryVocabulary.map((word, idx) => (
                                <span
                                    key={idx}
                                    className="px-3.5 py-1.5 rounded-lg bg-amber-950/40 border border-amber-600/50 text-amber-300 text-xs font-bold font-mono shadow-sm flex items-center space-x-1.5"
                                >
                                    <span>#{idx + 1}</span>
                                    <span>{word}</span>
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
// STEP 04: COIN TOSS SCREEN
// -------------------------------------------------------------
function CoinTossScreen({ winnerKey, playerA, playerB }) {
    const firstSpeaker = winnerKey === 'player_a' ? playerA : playerB;

    return (
        <div className="flex flex-col items-center justify-center py-12 text-center">
            <div className="text-xs font-mono font-bold tracking-widest text-amber-400 uppercase mb-4">
                STEP 04 · COIN TOSS
            </div>

            <div className="coin-container mb-8">
                <div className="coin flipping">
                    <div className="coin-face coin-front">
                        <span className="text-2xl">🪙</span>
                        <span className="text-xs mt-1">FIRST</span>
                    </div>
                    <div className="coin-face coin-back">
                        <span className="text-2xl">⚡</span>
                        <span className="text-xs mt-1">SPEAK</span>
                    </div>
                </div>
            </div>

            <h2 className="text-3xl md:text-4xl font-black font-display text-white mb-2">
                {firstSpeaker ? firstSpeaker.display_name.toUpperCase() : 'PLAYER A'} GOES FIRST!
            </h2>
            <p className="text-slate-400 max-w-md text-sm">
                Speaking order locked. 4 turns of 45 seconds each. Microphones are strictly controlled by server turns.
            </p>
        </div>
    );
}

// -------------------------------------------------------------
// STEP 05: LIVE DEBATE ARENA
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

    // Turn definitions
    const turnSchedule = [
        { index: 1, name: 'Motion / Opening', speaker: playerA.display_name, side: 'FOR' },
        { index: 2, name: 'Constructive Speech', speaker: playerB.display_name, side: 'AGAINST' },
        { index: 3, name: 'Rebuttal', speaker: playerA.display_name, side: 'FOR' },
        { index: 4, name: 'Closing Summary', speaker: playerB.display_name, side: 'AGAINST' }
    ];

    // Format remaining time MM:SS
    const formatTime = (secs) => {
        const m = Math.floor(secs / 60);
        const s = secs % 60;
        return `${m}:${s < 10 ? '0' : ''}${s}`;
    };

    return (
        <div className="flex flex-col space-y-5 max-w-5xl mx-auto w-full">
            {/* Top Motion Header & Total Clock */}
            <div className="glass-panel p-4 rounded-2xl border border-slate-800 flex flex-col md:flex-row md:items-center justify-between gap-3">
                <div className="flex-1">
                    <div className="text-[11px] font-mono font-bold text-cyan-400 uppercase tracking-wider">
                        LIVE DEBATE MOTION
                    </div>
                    <div className="text-base md:text-lg font-bold text-slate-100">
                        "{topic ? topic.motion : 'Competitive Motion'}"
                    </div>
                </div>

                {/* Total debate countdown */}
                <div className="flex items-center space-x-3 bg-slate-900/90 border border-slate-800 px-4 py-2 rounded-xl self-start md:self-auto">
                    <span className="text-xs text-slate-400 font-mono">MATCH REMAINING</span>
                    <span className="text-lg font-black font-mono text-cyan-400">
                        {formatTime(totalDebateRemaining)}
                    </span>
                </div>
            </div>

            {/* 4-Turn Timeline Header */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
                {turnSchedule.map((t) => {
                    const isActive = turnIndex === t.index;
                    const isPast = turnIndex > t.index;
                    return (
                        <div
                            key={t.index}
                            className={`p-3 rounded-xl border transition-all ${
                                isActive
                                    ? 'bg-cyan-950/40 border-cyan-500 shadow-md shadow-cyan-500/20'
                                    : isPast
                                    ? 'bg-slate-950/40 border-slate-800 text-slate-500'
                                    : 'bg-slate-900/40 border-slate-800/60 text-slate-400'
                            }`}
                        >
                            <div className="flex items-center justify-between text-[11px] font-mono font-bold">
                                <span>TURN 0{t.index}</span>
                                {isActive && (
                                    <span className="px-1.5 py-0.2 rounded bg-cyan-500 text-black text-[9px] font-extrabold uppercase animate-pulse">
                                        LIVE
                                    </span>
                                )}
                                {isPast && <span>✓</span>}
                            </div>
                            <div className={`text-xs font-bold mt-1 ${isActive ? 'text-white' : 'text-slate-300'}`}>
                                {t.name}
                            </div>
                            <div className="text-[10px] text-slate-400 mt-0.5">
                                {t.speaker} ({t.side})
                            </div>
                        </div>
                    );
                })}
            </div>

            {/* Main Center Stage: Huge Timer Ring + Debater Split */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 items-center">
                {/* Player A Box */}
                <div
                    className={`glass-panel p-5 rounded-2xl border transition-all ${
                        isPlayerAActive
                            ? 'glass-panel-active border-cyan-500 shadow-xl shadow-cyan-500/25'
                            : 'border-slate-800/80 opacity-70'
                    }`}
                >
                    <div className="flex items-center space-x-3 mb-3">
                        <div className="w-12 h-12 rounded-xl flex items-center justify-center text-lg font-bold text-white shadow" style={{ backgroundColor: playerA.avatar_color || '#3B82F6' }}>
                            {playerA.display_name.charAt(0)}
                        </div>
                        <div>
                            <div className="text-sm font-extrabold text-slate-100 flex items-center space-x-1.5">
                                <span>{playerA.display_name}</span>
                                {playerA.id === currentUserId && (
                                    <span className="text-[9px] px-1 py-0.5 rounded bg-cyan-900 text-cyan-300 font-bold">YOU</span>
                                )}
                            </div>
                            <div className="text-xs font-mono text-cyan-400">SIDE: FOR</div>
                        </div>
                    </div>

                    {/* Mic state status */}
                    {isPlayerAActive ? (
                        <div className="flex items-center space-x-2 text-xs font-bold text-emerald-400 bg-emerald-950/40 border border-emerald-800/60 px-3 py-2 rounded-xl">
                            <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-ping"></span>
                            <span>MICROPHONE ACTIVE (SPEAKING)</span>
                        </div>
                    ) : (
                        <div className="flex items-center space-x-2 text-xs font-semibold text-slate-400 bg-slate-900/60 border border-slate-800 px-3 py-2 rounded-xl">
                            <svg className="w-4 h-4 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 100-6 3 3 0 000 6z" />
                                <line x1="1" y1="1" x2="23" y2="23" stroke="currentColor" strokeWidth="2" />
                            </svg>
                            <span>Mic muted · Listening</span>
                        </div>
                    )}
                </div>

                {/* Center Turn Timer Dial */}
                <div className="flex flex-col items-center justify-center text-center p-4">
                    <div className="relative w-40 h-40 flex items-center justify-center">
                        {/* Circular progress SVG */}
                        <svg className="w-full h-full transform -rotate-90" viewBox="0 0 100 100">
                            <circle
                                cx="50"
                                cy="50"
                                r="42"
                                className="text-slate-800 stroke-current"
                                strokeWidth="6"
                                fill="transparent"
                            />
                            <circle
                                cx="50"
                                cy="50"
                                r="42"
                                className={`stroke-current transition-all duration-1000 ${
                                    turnTimeRemaining <= 5
                                        ? 'text-rose-500'
                                        : turnTimeRemaining <= 10
                                        ? 'text-amber-400'
                                        : 'text-cyan-400'
                                }`}
                                strokeWidth="6"
                                strokeDasharray={264}
                                strokeDashoffset={264 - (264 * turnTimeRemaining) / 45}
                                strokeLinecap="round"
                                fill="transparent"
                            />
                        </svg>

                        {/* Digits inside circle */}
                        <div className="absolute inset-0 flex flex-col items-center justify-center">
                            <span className={`text-4xl font-black font-mono tracking-tight ${
                                turnTimeRemaining <= 5 ? 'text-rose-400 animate-pulse' : 'text-white'
                            }`}>
                                0:{turnTimeRemaining < 10 ? '0' : ''}{turnTimeRemaining}
                            </span>
                            <span className="text-[10px] font-mono uppercase text-slate-400 mt-0.5">
                                {currentTurn ? currentTurn.turn_name : 'Speaking Turn'}
                            </span>
                        </div>
                    </div>

                    <div className="text-xs text-slate-400 mt-2 font-mono">
                        Active: <strong className="text-slate-200">{activePlayer ? activePlayer.display_name : ''}</strong>
                    </div>
                </div>

                {/* Player B Box */}
                <div
                    className={`glass-panel p-5 rounded-2xl border transition-all ${
                        !isPlayerAActive
                            ? 'glass-panel-active border-purple-500 shadow-xl shadow-purple-500/25'
                            : 'border-slate-800/80 opacity-70'
                    }`}
                >
                    <div className="flex items-center space-x-3 mb-3">
                        <div className="w-12 h-12 rounded-xl flex items-center justify-center text-lg font-bold text-white shadow" style={{ backgroundColor: playerB.avatar_color || '#8B5CF6' }}>
                            {playerB.display_name.charAt(0)}
                        </div>
                        <div>
                            <div className="text-sm font-extrabold text-slate-100 flex items-center space-x-1.5">
                                <span>{playerB.display_name}</span>
                                {playerB.id === currentUserId && (
                                    <span className="text-[9px] px-1 py-0.5 rounded bg-purple-900 text-purple-300 font-bold">YOU</span>
                                )}
                            </div>
                            <div className="text-xs font-mono text-purple-400">SIDE: AGAINST</div>
                        </div>
                    </div>

                    {/* Mic state status */}
                    {!isPlayerAActive ? (
                        <div className="flex items-center space-x-2 text-xs font-bold text-emerald-400 bg-emerald-950/40 border border-emerald-800/60 px-3 py-2 rounded-xl">
                            <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-ping"></span>
                            <span>MICROPHONE ACTIVE (SPEAKING)</span>
                        </div>
                    ) : (
                        <div className="flex items-center space-x-2 text-xs font-semibold text-slate-400 bg-slate-900/60 border border-slate-800 px-3 py-2 rounded-xl">
                            <svg className="w-4 h-4 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 100-6 3 3 0 000 6z" />
                                <line x1="1" y1="1" x2="23" y2="23" stroke="currentColor" strokeWidth="2" />
                            </svg>
                            <span>Mic muted · Listening</span>
                        </div>
                    )}
                </div>
            </div>

            {/* Audio Waveform Canvas */}
            <div className="glass-panel p-3 rounded-2xl border border-slate-800/80">
                <div className="flex items-center justify-between text-xs font-mono text-slate-400 mb-2">
                    <span className="flex items-center space-x-2">
                        <span className={`w-2 h-2 rounded-full ${isMyTurn ? 'bg-cyan-400 animate-pulse' : 'bg-slate-500'}`}></span>
                        <span>{isMyTurn ? 'YOUR MICROPHONE AUDIO LEVEL' : "OPPONENT'S LIVE AUDIO WAVE"}</span>
                    </span>
                    <span className="text-[10px] text-slate-500 font-mono">WebRTC Opus 48kHz</span>
                </div>
                <canvas ref={visualizerCanvasRef} width={800} height={50} className="waveform-canvas bg-slate-950/50" />
            </div>

            {/* Mandatory Vocabulary Tracker */}
            <div className="glass-panel p-4 rounded-2xl border border-slate-800">
                <div className="flex items-center justify-between mb-2.5">
                    <div className="text-xs font-mono font-bold text-amber-400 uppercase flex items-center space-x-1.5">
                        <span>⭐</span>
                        <span>Mandatory Vocabulary Hints</span>
                    </div>
                    <div className="text-xs font-mono text-slate-400">
                        Words Spoken: <strong className="text-emerald-400 font-bold">{hintsStatus.filter(h => h.used).length}</strong> / {hintsStatus.length}
                    </div>
                </div>

                <div className="flex flex-wrap gap-2">
                    {hintsStatus.map((hint, idx) => (
                        <div
                            key={idx}
                            className={`px-3 py-1.5 rounded-lg text-xs font-mono font-bold transition-all flex items-center space-x-1.5 ${
                                hint.used
                                    ? 'bg-emerald-950/80 border border-emerald-500 text-emerald-300 shadow-md shadow-emerald-500/20'
                                    : 'bg-slate-900 border border-slate-800 text-slate-400'
                            }`}
                        >
                            <span>{hint.used ? '✓' : `#${idx + 1}`}</span>
                            <span>{hint.word}</span>
                            {hint.used && <span className="text-[10px] text-emerald-400">(+2)</span>}
                        </div>
                    ))}
                </div>
            </div>

            {/* Live Speech-to-Text Transcript Feed */}
            <div className="glass-panel p-5 rounded-2xl border border-slate-800">
                <div className="flex items-center justify-between mb-3 text-xs font-mono">
                    <span className="text-cyan-400 font-bold uppercase flex items-center space-x-1.5">
                        <span className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse"></span>
                        <span>LIVE TRANSCRIPTION FEED (SPEECH-TO-TEXT)</span>
                    </span>
                    <span className="text-slate-500">Transcribing Spoken Words Live</span>
                </div>

                <div className="min-h-[90px] p-4 rounded-xl bg-slate-950/70 border border-slate-800/80 text-slate-200 text-sm leading-relaxed font-sans">
                    {liveTranscript ? (
                        <span>
                            {liveTranscript.split(' ').map((word, wIdx) => {
                                const clean = word.toLowerCase().replace(/[^a-z]/g, '');
                                const isHint = hintsStatus.some(h => clean.startsWith(h.word.toLowerCase()));
                                return (
                                    <span
                                        key={wIdx}
                                        className={isHint ? 'bg-emerald-950 text-emerald-300 font-bold px-1 rounded' : ''}
                                    >
                                        {word}{' '}
                                    </span>
                                );
                            })}
                        </span>
                    ) : (
                        <span className="text-slate-500 italic">
                            {isMyTurn
                                ? 'Speak into your microphone now... Your words will be transcribed in real time.'
                                : `Listening to ${activePlayer ? activePlayer.display_name : 'opponent'}... Words will stream live.`}
                        </span>
                    )}
                </div>
            </div>

            {/* Developer Testing Bar (For effortless quick testing without 3-minute wait) */}
            <div className="p-3 rounded-xl border border-dashed border-slate-800 bg-slate-950/40 flex flex-wrap items-center justify-between gap-3 text-xs">
                <span className="font-mono text-slate-500 flex items-center space-x-1">
                    <span>⚡</span>
                    <span>Test & Evaluation Shortcuts:</span>
                </span>

                <div className="flex flex-wrap gap-2">
                    <button
                        onClick={() => {
                            // Sample speech with mandatory words
                            const sampleWords = hintsStatus.map(h => h.word).slice(0, 3).join(', ');
                            onInsertSample(
                                `I firmly argue that while innovation and efficiency provide immense value, we must prioritize critical thinking, empathy, and accountability in our long-term societal institutions.`
                            );
                        }}
                        className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 font-mono transition"
                    >
                        + Insert Spoken Argument
                    </button>

                    <button
                        onClick={onDevSkipTurn}
                        className="px-2.5 py-1 rounded bg-indigo-950 hover:bg-indigo-900 border border-indigo-800 text-indigo-300 font-mono font-bold transition"
                    >
                        Fast-Forward Turn ⏩
                    </button>

                    <button
                        onClick={onDevFinishDebate}
                        className="px-2.5 py-1 rounded bg-purple-950 hover:bg-purple-900 border border-purple-800 text-purple-300 font-mono font-bold transition"
                    >
                        Finish & AI Evaluate 📊
                    </button>
                </div>
            </div>
        </div>
    );
}

// -------------------------------------------------------------
// STEP 06: AI EVALUATION SCREEN
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
        { id: 1, title: 'Transcribing 4 Speaking Turns', desc: 'Aggregating audio transcripts from Player A and Player B' },
        { id: 2, title: 'Auditing Grammar & Fluency', desc: 'Syntax verification, lexical density, and 5 mandatory vocabulary bonus count' },
        { id: 3, title: 'Evaluating Argumentative Logic', desc: 'Analyzing causal reasoning, thesis clarity, and rebuttal clash' },
        { id: 4, title: 'Calculating Deterministic Scores', desc: 'Computing independent English & Debating proficiency scores and Elo delta' }
    ];

    return (
        <div className="flex flex-col items-center justify-center py-16 text-center max-w-lg mx-auto">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-tr from-cyan-500 to-indigo-600 flex items-center justify-center text-3xl mb-6 shadow-2xl shadow-cyan-500/40 animate-bounce">
                🤖
            </div>

            <div className="text-xs font-mono font-bold tracking-widest text-cyan-400 uppercase mb-2">
                STEP 06 · AI EVALUATION IN PROGRESS
            </div>
            <h2 className="text-2xl md:text-3xl font-extrabold font-display text-white mb-8">
                Adjudicating Debate Speeches...
            </h2>

            <div className="w-full space-y-3.5 text-left">
                {steps.map(s => {
                    const isDone = step > s.id;
                    const isCurrent = step === s.id;
                    return (
                        <div
                            key={s.id}
                            className={`p-3.5 rounded-xl border transition-all ${
                                isCurrent
                                    ? 'bg-cyan-950/40 border-cyan-500 shadow-md shadow-cyan-500/20'
                                    : isDone
                                    ? 'bg-slate-900/40 border-emerald-900 text-slate-300'
                                    : 'bg-slate-950/30 border-slate-900 text-slate-600'
                            }`}
                        >
                            <div className="flex items-center space-x-3">
                                <div className="text-sm">
                                    {isDone ? '✅' : isCurrent ? '⏳' : '⚪'}
                                </div>
                                <div className="flex-1">
                                    <div className="text-xs font-bold font-display text-slate-100">
                                        {s.title}
                                    </div>
                                    <div className="text-[11px] text-slate-400 font-mono">
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
// STEP 07: RESULTS & SCORECARD SCREEN
// -------------------------------------------------------------
function ResultsScreen({ evaluation, turns, topic, currentUserId, onPlayAgain, onBackToLobby }) {
    const pA = evaluation.player_a;
    const pB = evaluation.player_b;
    const winnerKey = evaluation.winner; // 'player_a' | 'player_b' | null
    const changes = evaluation.rating_changes || {};

    const isPlayerAWinner = winnerKey === 'player_a';
    const isPlayerBWinner = winnerKey === 'player_b';
    const isDraw = !winnerKey;

    // Active player perspective
    const isPlayerA = pA.player_id === currentUserId;
    const myEval = isPlayerA ? pA : pB;
    const oppEval = isPlayerA ? pB : pA;
    const myChange = isPlayerA ? changes.player_a : changes.player_b;

    return (
        <div className="flex flex-col space-y-8 max-w-5xl mx-auto w-full py-4">
            {/* Winner Banner */}
            <div className="glass-panel p-6 md:p-8 rounded-3xl border border-amber-500/40 text-center relative overflow-hidden shadow-2xl shadow-amber-500/10">
                <div className="absolute top-0 left-1/2 transform -translate-x-1/2 w-96 h-20 bg-gradient-to-b from-amber-500/20 to-transparent blur-2xl"></div>

                <div className="inline-flex items-center space-x-2 px-3.5 py-1 rounded-full bg-amber-950/60 border border-amber-600 text-amber-300 text-xs font-bold font-mono uppercase mb-4">
                    <span>🏆</span>
                    <span>STEP 07 · FINAL ADJUDICATION & RESULTS</span>
                </div>

                <h1 className="text-3xl md:text-5xl font-black font-display tracking-tight text-white mb-2">
                    {isDraw ? 'DEBATE ENDED IN A DRAW!' : `${evaluation.winner_name.toUpperCase()} WINS!`}
                </h1>

                <p className="text-slate-400 text-sm max-w-lg mx-auto mb-6">
                    Motion: "{evaluation.motion}"
                </p>

                {/* Rating updates pills */}
                {myChange && (
                    <div className="inline-flex items-center space-x-3 bg-slate-900/90 border border-slate-700 px-5 py-2.5 rounded-2xl shadow-lg">
                        <span className="text-xs text-slate-400 font-mono">YOUR ELO RATING:</span>
                        <span className="text-sm font-bold text-slate-200">{myChange.old_rating}</span>
                        <span className="text-xs text-slate-500">→</span>
                        <span className="text-base font-black font-mono text-cyan-400">{myChange.new_rating}</span>
                        <span className={`text-xs font-bold font-mono px-2 py-0.5 rounded ${myChange.delta >= 0 ? 'bg-emerald-950 text-emerald-400 border border-emerald-800' : 'bg-rose-950 text-rose-400 border border-rose-800'}`}>
                            {myChange.delta >= 0 ? `+${myChange.delta}` : myChange.delta} Elo
                        </span>
                    </div>
                )}
            </div>

            {/* Dual Scorecards: English Proficiency vs Debating Proficiency */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Player A Score Card */}
                <DebaterScoreCard
                    playerEval={pA}
                    isWinner={isPlayerAWinner}
                    isCurrent={pA.player_id === currentUserId}
                    side="FOR"
                />

                {/* Player B Score Card */}
                <DebaterScoreCard
                    playerEval={pB}
                    isWinner={isPlayerBWinner}
                    isCurrent={pB.player_id === currentUserId}
                    side="AGAINST"
                />
            </div>

            {/* Grammar Corrections & Feedback Section */}
            <div className="glass-panel p-6 rounded-2xl border border-slate-800">
                <div className="flex items-center justify-between mb-4">
                    <h3 className="text-lg font-bold font-display text-white flex items-center space-x-2">
                        <span>✍️</span>
                        <span>Personalized Language & Grammar Coaching</span>
                    </h3>
                    <span className="text-xs font-mono text-cyan-400">Feedback for {myEval.player_name}</span>
                </div>

                <div className="space-y-3 mb-6">
                    {myEval.grammar_corrections && myEval.grammar_corrections.map((corr, idx) => (
                        <div key={idx} className="p-3.5 rounded-xl bg-slate-950/70 border border-slate-800 text-xs">
                            <div className="flex items-center space-x-2 text-rose-400 font-mono mb-1">
                                <span>Original:</span>
                                <span className="text-slate-300 font-normal">"{corr.original}"</span>
                            </div>
                            <div className="flex items-center space-x-2 text-emerald-400 font-mono mb-1.5">
                                <span>Correction:</span>
                                <span className="font-bold">{corr.corrected}</span>
                            </div>
                            <div className="text-slate-400 text-[11px] leading-relaxed">
                                {corr.explanation}
                            </div>
                        </div>
                    ))}
                </div>

                {/* 3 Personalized Improvement Suggestions */}
                <div className="border-t border-slate-800 pt-4">
                    <div className="text-xs font-mono font-bold text-amber-400 uppercase mb-3">
                        3 Key Strategic Recommendations
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                        {myEval.suggestions && myEval.suggestions.map((sug, idx) => (
                            <div key={idx} className="p-3 rounded-xl bg-slate-900/60 border border-slate-800/80 text-xs leading-relaxed text-slate-300">
                                <span className="text-amber-400 font-mono font-bold mr-1.5">#{idx + 1}</span>
                                {sug}
                            </div>
                        ))}
                    </div>
                </div>
            </div>

            {/* Spoken Speeches Transcript Accordion */}
            <div className="glass-panel p-6 rounded-2xl border border-slate-800">
                <h3 className="text-lg font-bold font-display text-white mb-4 flex items-center space-x-2">
                    <span>📜</span>
                    <span>Full Debate Transcripts</span>
                </h3>

                <div className="space-y-4">
                    {turns && turns.map((t, idx) => (
                        <div key={idx} className="p-4 rounded-xl bg-slate-950/60 border border-slate-800/70">
                            <div className="flex items-center justify-between text-xs font-mono mb-2">
                                <span className="font-bold text-cyan-400">
                                    TURN 0{t.turn_index} · {t.turn_name}
                                </span>
                                <span className="px-2 py-0.5 rounded bg-slate-800 text-slate-300">
                                    {t.speaker_key === 'player_a' ? pA.player_name : pB.player_name} ({t.speaker_side})
                                </span>
                            </div>
                            <p className="text-sm text-slate-300 leading-relaxed font-sans">
                                {t.transcript}
                            </p>
                        </div>
                    ))}
                </div>
            </div>

            {/* Action Buttons */}
            <div className="flex flex-wrap items-center justify-center gap-4 py-4">
                <button
                    onClick={onPlayAgain}
                    className="px-8 py-3.5 rounded-xl bg-gradient-to-r from-cyan-500 to-indigo-600 text-white font-extrabold text-base tracking-wider uppercase font-display shadow-lg shadow-cyan-500/30 hover:scale-[1.02] transition"
                >
                    PLAY AGAIN 🔄
                </button>

                <button
                    onClick={onBackToLobby}
                    className="px-6 py-3.5 rounded-xl border border-slate-700 bg-slate-900 hover:bg-slate-800 text-slate-200 font-semibold text-base transition"
                >
                    Back to Lobby
                </button>
            </div>
        </div>
    );
}

// Subcomponent: Debater Score Card
function DebaterScoreCard({ playerEval, isWinner, isCurrent, side }) {
    const eng = playerEval.english_proficiency;
    const deb = playerEval.debating_proficiency;
    const eb = playerEval.english_breakdown || {};
    const db = playerEval.debate_breakdown || {};

    return (
        <div className={`glass-panel p-6 rounded-2xl border transition-all ${
            isWinner
                ? 'border-amber-500/70 shadow-xl shadow-amber-500/10'
                : 'border-slate-800'
        }`}>
            {/* Header */}
            <div className="flex items-center justify-between mb-4">
                <div>
                    <div className="text-lg font-black font-display text-white flex items-center space-x-2">
                        <span>{playerEval.player_name}</span>
                        {isCurrent && <span className="text-[10px] px-1.5 py-0.5 rounded bg-cyan-950 text-cyan-400 border border-cyan-800">YOU</span>}
                        {isWinner && <span className="text-sm">👑 WINNER</span>}
                    </div>
                    <div className="text-xs font-mono text-slate-400">SIDE: {side}</div>
                </div>
                <div className="text-right">
                    <div className="text-xs font-mono text-slate-400">COMPOSITE</div>
                    <div className="text-xl font-black font-mono text-cyan-400">{playerEval.composite_score}</div>
                </div>
            </div>

            {/* Dual Hero Metric Badges */}
            <div className="grid grid-cols-2 gap-3 mb-6">
                <div className="p-3.5 rounded-xl bg-slate-950/80 border border-slate-800/80 text-center">
                    <div className="text-[11px] font-mono text-slate-400 uppercase">English Proficiency</div>
                    <div className="text-3xl font-black font-display text-cyan-400 mt-1">{eng}</div>
                    <div className="text-[10px] text-slate-500 font-mono">out of 100</div>
                </div>

                <div className="p-3.5 rounded-xl bg-slate-950/80 border border-slate-800/80 text-center">
                    <div className="text-[11px] font-mono text-slate-400 uppercase">Debating Proficiency</div>
                    <div className="text-3xl font-black font-display text-purple-400 mt-1">{deb}</div>
                    <div className="text-[10px] text-slate-500 font-mono">out of 100</div>
                </div>
            </div>

            {/* Mandatory Vocabulary Bonus */}
            <div className="p-3 rounded-xl bg-amber-950/30 border border-amber-900/60 mb-5 flex items-center justify-between text-xs font-mono">
                <span className="text-amber-300 font-bold flex items-center space-x-1.5">
                    <span>⭐</span>
                    <span>Vocabulary Hints Used:</span>
                </span>
                <span className="text-amber-400 font-bold">
                    +{playerEval.hints_used_count || 0} words ({eb.hint_bonus ? `+${eb.hint_bonus} pts` : '+0 pts'})
                </span>
            </div>

            {/* Sub-Criteria Progress Bars */}
            <div className="space-y-2.5 text-xs">
                <div className="font-mono text-[11px] font-bold text-slate-400 uppercase mb-1">
                    English Skills Breakdown
                </div>
                <ScoreProgressBar label="Grammar" value={eb.grammar || 80} />
                <ScoreProgressBar label="Vocabulary Range" value={eb.vocabulary || 80} />
                <ScoreProgressBar label="Fluency & Pace" value={eb.fluency || 80} />
                <ScoreProgressBar label="Pronunciation / Clarity" value={eb.clarity || 80} />

                <div className="font-mono text-[11px] font-bold text-slate-400 uppercase mt-4 mb-1">
                    Debating Skills Breakdown
                </div>
                <ScoreProgressBar label="Logical Reasoning" value={db.logical_reasoning || 80} />
                <ScoreProgressBar label="Argument Structure" value={db.argument_structure || 80} />
                <ScoreProgressBar label="Rebuttal Quality" value={db.rebuttal_quality || 80} />
                <ScoreProgressBar label="Persuasiveness" value={db.persuasiveness || 80} />
            </div>
        </div>
    );
}

function ScoreProgressBar({ label, value }) {
    return (
        <div>
            <div className="flex justify-between text-[11px] text-slate-300 mb-0.5">
                <span>{label}</span>
                <span className="font-mono font-bold text-slate-400">{value}</span>
            </div>
            <div className="w-full h-1.5 rounded-full bg-slate-800 overflow-hidden">
                <div
                    className="h-full rounded-full bg-gradient-to-r from-cyan-500 to-indigo-500 transition-all duration-1000"
                    style={{ width: `${Math.min(100, Math.max(0, value))}%` }}
                ></div>
            </div>
        </div>
    );
}

// -------------------------------------------------------------
// MODALS: LEADERBOARD & MATCH HISTORY
// -------------------------------------------------------------
function LeaderboardModal({ data, currentUserId, onClose }) {
    return (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="glass-panel p-6 rounded-2xl border border-slate-700 max-w-2xl w-full max-h-[85vh] flex flex-col">
                <div className="flex items-center justify-between pb-4 border-b border-slate-800">
                    <div className="flex items-center space-x-2">
                        <span className="text-2xl">🏆</span>
                        <h2 className="text-xl font-bold font-display text-white">Global Debating Rankings</h2>
                    </div>
                    <button onClick={onClose} className="text-slate-400 hover:text-white text-lg">✕</button>
                </div>

                <div className="overflow-y-auto flex-1 py-4 space-y-2">
                    {data.map((user, idx) => (
                        <div
                            key={user.id}
                            className={`p-3 rounded-xl flex items-center justify-between border ${
                                user.id === currentUserId
                                    ? 'bg-cyan-950/40 border-cyan-500/80'
                                    : 'bg-slate-900/60 border-slate-800'
                            }`}
                        >
                            <div className="flex items-center space-x-3">
                                <span className="w-6 text-center font-mono font-bold text-xs text-slate-400">
                                    {idx + 1 === 1 ? '🥇' : idx + 1 === 2 ? '🥈' : idx + 1 === 3 ? '🥉' : `#${idx + 1}`}
                                </span>
                                <div className="w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold text-white" style={{ backgroundColor: user.avatar_color }}>
                                    {user.display_name.charAt(0)}
                                </div>
                                <div>
                                    <div className="text-sm font-bold text-slate-200">{user.display_name}</div>
                                    <div className="text-[10px] text-slate-400 font-mono">
                                        {user.matches_won}W - {user.matches_lost}L ({user.total_debates} Debates)
                                    </div>
                                </div>
                            </div>

                            <div className="text-right">
                                <div className="text-sm font-black font-mono text-cyan-400">{user.rating} ELO</div>
                                <div className="text-[10px] text-slate-400 font-mono">
                                    Avg: {user.avg_english_score} Eng · {user.avg_debate_score} Deb
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
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="glass-panel p-6 rounded-2xl border border-slate-700 max-w-2xl w-full max-h-[85vh] flex flex-col">
                <div className="flex items-center justify-between pb-4 border-b border-slate-800">
                    <div className="flex items-center space-x-2">
                        <span className="text-2xl">📜</span>
                        <h2 className="text-xl font-bold font-display text-white">Your Debate History</h2>
                    </div>
                    <button onClick={onClose} className="text-slate-400 hover:text-white text-lg">✕</button>
                </div>

                <div className="overflow-y-auto flex-1 py-4 space-y-3">
                    {data.length === 0 ? (
                        <div className="text-center py-12 text-slate-500 font-mono text-sm">
                            No past matches recorded yet. Start a debate to see your match log!
                        </div>
                    ) : (
                        data.map((m, idx) => {
                            let topicObj = {};
                            try { topicObj = JSON.parse(m.topic_json); } catch (e) {}
                            return (
                                <div key={m.id || idx} className="p-4 rounded-xl bg-slate-900/60 border border-slate-800 text-xs">
                                    <div className="font-bold text-slate-200 mb-1">
                                        "{topicObj.motion || 'Competitive Debate'}"
                                    </div>
                                    <div className="flex items-center justify-between text-slate-400 font-mono mt-2">
                                        <span>{m.player_a_name} vs {m.player_b_name}</span>
                                        <span className="text-cyan-400 font-bold">
                                            Scores: {m.player_a_english_score}/{m.player_a_debate_score} - {m.player_b_english_score}/{m.player_b_debate_score}
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
