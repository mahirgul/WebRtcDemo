document.addEventListener('DOMContentLoaded', function() {
    // DOM Element Selectors
    // Buttons
    const startCallButton = document.getElementById('start-call-btn'); // Button to start an outgoing call
    const endCallButton = document.getElementById('end-btn'); // Button to end the current call
    const holdCallButton = document.getElementById('hold-btn'); // Button to hold/unhold the current call
    const transferCallButton = document.getElementById('transfer-btn'); // Button to transfer the current call
    const answerCallButton = document.getElementById('answer-btn'); // Button to answer an incoming call
    const unregisterButton = document.getElementById('unregister-btn'); // Button to unregister from SIP server
    const registerButton = document.getElementById('register-btn'); // Button to register to SIP server
    const terminateCallButton = document.getElementById('terminate-btn'); // Button to terminate the current call (alternative to endCallButton)
    const unlockAudioButton = document.getElementById('unlock-audio-btn'); // Button to manually unlock audio context
    const toggleLogsButton = document.getElementById('toggle-logs-btn'); // Button to toggle logs visibility
    const toggleSettingsButton = document.getElementById('toggle-settings-btn'); // Button to toggle settings visibility
    const toggleDevicesButton = document.getElementById('toggle-devices-btn'); // Button to toggle audio devices section visibility
    const saveSettingsButton = document.querySelector('#sip-settings button[type="submit"]'); // Button to save SIP settings

    // SIP Setting Inputs
    const sipServerInput = document.getElementById('sip-server'); // Input for SIP server address
    const sipPortInput = document.getElementById('sip-port'); // Input for SIP server port
    const sipUsernameInput = document.getElementById('sip-username'); // Input for SIP username
    const sipPasswordInput = document.getElementById('sip-password'); // Input for SIP password
    const sipDisplayNameInput = document.getElementById('sip-display-name'); // Input for SIP display name
    const outboundProxyInput = document.getElementById('outbound-proxy'); // Input for outbound proxy (optional)
    const wssUriInput = document.getElementById('wss-uri-input'); // Input for WSS URI (WebSocket URI)

    // STUN/TURN Setting Inputs
    const stunServerInput = document.getElementById('stun-server'); // Input for STUN server
    const turnServerInput = document.getElementById('turn-server'); // Input for TURN server
    const turnUsernameInput = document.getElementById('turn-username'); // Input for TURN username
    const turnPasswordInput = document.getElementById('turn-password'); // Input for TURN password

    // UI Sections
    const logSection = document.getElementById('logs');
    const settingsSection = document.getElementById('settings');
    const devicesSection = document.getElementById('devices');

    // Call Destination Input
    const destinationInput = document.getElementById('destination'); // Input for call destination (number or SIP URI)

    // Device selection elements
    const audioInputSelect = document.getElementById('audio-input-select');
    const audioOutputSelect = document.getElementById('audio-output-select');

    // Ringtone Audio element
    const ringtone = new Audio('sounds/bell.mp3');

    // Global State Variables
    let ua; // JsSIP UA instance
    let settings = {}; // SIP settings object
    let currentSession = null; // Current active call session
    let audioContextUnlocked = false; // Flag to track if user interaction has unlocked audio

    // Initialize ringtone properties
    ringtone.loop = true;

    // Utility Functions
    /**
     * Logs a message to the status log textarea.
     * @param {string} msg - The message to log.
     */
    function logStatus(msg) {
        const el = document.getElementById('status-log');
        if (el) {
            const time = new Date().toLocaleTimeString();
            const currentLogValue = el.value;
            el.value = `[${time}] ${msg}\n` + currentLogValue; // Prepend new message

            const maxLogLines = 100; // Keep a reasonable number of log lines
            let lines = el.value.split('\n');
            if (lines.length > maxLogLines) {
                lines = lines.slice(0, maxLogLines); // Keep the newest (top) lines
                el.value = lines.join('\n');
            }
            el.scrollTop = 0; // Scroll to the top to see the latest message
        }
    }

    /**
     * Attempts to unlock the audio context by playing and pausing an audio element.
     * This is necessary due to browser autoplay policies that require user interaction
     * before audio can be played programmatically.
     */
    function attemptUnlockAudioContext() {
        if (audioContextUnlocked) return; // Already unlocked

        // Play and pause a silent sound or the ringtone briefly to unlock audio
        ringtone.pause();
        ringtone.currentTime = 0;
        audioContextUnlocked = true;
        if (unlockAudioButton) {
            unlockAudioButton.textContent = 'Audio Enabled';
            unlockAudioButton.disabled = true;
            unlockAudioButton.classList.replace('btn-warning', 'btn-success');
        }
        logStatus('Audio context unlocked successfully.');
    }

    /**
     * Loads settings from localStorage and populates form fields.
     */
    function loadSettings() {
        const savedSettings = localStorage.getItem('softphoneSettings');
        if (savedSettings) {
            try {
                settings = JSON.parse(savedSettings);
                // Populate form fields with loaded settings
                sipServerInput.value = settings.sipServer || '';
                sipPortInput.value = settings.sipPort || '';
                sipUsernameInput.value = settings.sipUsername || '';
                sipPasswordInput.value = settings.sipPassword || '';
                sipDisplayNameInput.value = settings.sipDisplayName || '';
                outboundProxyInput.value = settings.outboundProxy || '';
                wssUriInput.value = settings.wssUri || '';
                stunServerInput.value = settings.stunServer || '';
                turnServerInput.value = settings.turnServer || '';
                turnUsernameInput.value = settings.turnUsername || '';
                turnPasswordInput.value = settings.turnPassword || '';
                settings.selectedAudioInputId = settings.selectedAudioInputId || ''; // Load saved input device
                settings.selectedAudioOutputId = settings.selectedAudioOutputId || ''; // Load saved output device
                logStatus('Settings loaded from localStorage.');
            } catch (e) {
                console.error('Failed to parse settings from localStorage:', e);
                logStatus('Error: Failed to parse settings from localStorage.');
            }
        } else {
            logStatus('No saved settings found in localStorage.');
        }
    }

    /**
     * Checks if an address is local (private IP, localhost, or .local hostname).
     * @param {string} address - The address (hostname or IP) to check.
     * @returns {boolean} True if the address is considered local, false otherwise.
     */
    function isLocalAddress(address) {
        // IPv4 private ranges and localhost
        const localPatterns = [
            /^10\./,
            /^192\.168\./,
            /^172\.(1[6-9]|2[0-9]|3[0-1])\./,
            /\.local$/i,
            /^127\./,
            /^localhost$/i
        ];
        return localPatterns.some(re => re.test(address));
    }

    /**
     * Builds a valid iceServers array for WebRTC.
     * Disables NAT traversal (STUN/TURN) if the destination is detected as a local address.
     * @param {object} currentSettings - The current SIP/WebRTC settings.
     * @param {string} destination - The call destination URI or address.
     * @returns {RTCIceServer[]} An array of ICE server configurations.
     */
    function getIceServersConfig(currentSettings, destination) {
        let destHost = '';
        if (destination) {
            // Try to extract host from SIP URI: sip:user@host:port;params or just host
            const sipUriMatch = destination.match(/@([^;>$:\s]+)/i); // Extracts host part after @
            if (sipUriMatch && sipUriMatch[1]) {
                destHost = sipUriMatch[1];
            } else if (!destination.includes('@') && destination.includes('.')) { // Likely a hostname or IP
                destHost = destination.split(/[:;]/)[0]; // Remove port or params
            }
        }
        if (destHost && isLocalAddress(destHost.split(':')[0])) { // Check host part without port
            logStatus(`Local destination host (${destHost}) detected, disabling NAT traversal (no STUN/TURN).`);
            return [];
        }
        const iceServers = [];
        if (currentSettings.stunServer && currentSettings.stunServer.trim() !== '') {
            iceServers.push({ urls: currentSettings.stunServer.trim() });
        }
        if (currentSettings.turnServer && currentSettings.turnServer.trim() !== '') {
            iceServers.push({
                urls: currentSettings.turnServer.trim(),
                username: currentSettings.turnUsername,
                credential: currentSettings.turnPassword
            });
        }
        logStatus(`ICE Servers configured: ${iceServers.length > 0 ? JSON.stringify(iceServers) : 'None (for local call or no STUN/TURN configured)'}`);
        return iceServers;
    }

    /**
     * Enumerates available audio input and output devices and populates the selection dropdowns.
     */
    async function populateAudioDevices() {
        if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) {
            logStatus("enumerateDevices() not supported.");
            audioInputSelect.innerHTML = '<option value="">Not Supported</option>';
            audioOutputSelect.innerHTML = '<option value="">Not Supported</option>';
            return;
        }

        try {
            const devices = await navigator.mediaDevices.enumerateDevices();
            audioInputSelect.innerHTML = ''; // Clear previous options
            audioOutputSelect.innerHTML = ''; // Clear previous options
    
            // Add a default option for system default
            const defaultInputOption = document.createElement('option');
            defaultInputOption.value = '';
            defaultInputOption.text = 'System Default Input';
            audioInputSelect.appendChild(defaultInputOption);

            const defaultOutputOption = document.createElement('option');
            defaultOutputOption.value = '';
            defaultOutputOption.text = 'System Default Output';
            audioOutputSelect.appendChild(defaultOutputOption);

            let micIdx = 0, spkIdx = 0; // Counters for default labels if actual labels are missing
            for (const dev of devices) {
                if (dev.kind === 'audioinput') {
                    const opt = document.createElement('option');
                    opt.value = dev.deviceId;
                    opt.textContent = dev.label || `Mic #${++micIdx}`;
                    audioInputSelect.appendChild(opt);
                } else if (dev.kind === 'audiooutput') {
                    const opt = document.createElement('option');
                    opt.value = dev.deviceId;
                    opt.textContent = dev.label || `Speaker #${++spkIdx}`;
                    audioOutputSelect.appendChild(opt);
                }
            }
            // Set selected values after options are added
            if (settings.selectedAudioInputId) audioInputSelect.value = settings.selectedAudioInputId;
            if (settings.selectedAudioOutputId) audioOutputSelect.value = settings.selectedAudioOutputId;
            logStatus('Audio devices populated.');
        } catch (err) {
            logStatus(`Error populating audio devices: ${err.message}`);
            console.error('Error populating audio devices:', err);
            audioInputSelect.innerHTML = '<option value="">Error Loading</option>';
            audioOutputSelect.innerHTML = '<option value="">Error Loading</option>';
        }
    }

    /**
     * Applies the selected audio output device to the remote audio element.
     * @param {string} deviceId - The device ID of the selected audio output device.
     */
    function applyAudioOutputDevice(deviceId) {
        const remoteAudio = document.getElementById('remote-audio');
        if (remoteAudio && typeof remoteAudio.setSinkId === 'function') {
            remoteAudio.setSinkId(deviceId)
                .then(() => logStatus(`Audio output device set to: ${deviceId || 'System Default'}`))
                .catch(e => logStatus(`Error setting audio output: ${e.message}`));
        }
    }

    /**
     * Updates the visibility and disabled state of UI buttons based on the current application state.
     */
    function updateButtonVisibility() {
        const isRegistered = ua && ua.isRegistered && ua.isRegistered();
        const isConnecting = ua && ua.transport && ua.transport.isConnecting && ua.transport.isConnecting();
        const settingsAreValid = settings.sipUsername && settings.sipServer && (settings.wssUri || settings.sipServer);

        // Safe access to RTCSession status constants
        const STATUS_TERMINATED = (typeof JsSIP !== 'undefined' && JsSIP.RTCSession && JsSIP.RTCSession.C) ? JsSIP.RTCSession.C.STATUS_TERMINATED : 8;
    
        // Register Button
        if (!isRegistered && !isConnecting && settingsAreValid && !currentSession) {
            registerButton.classList.remove('d-none');
            registerButton.disabled = false;
        } else {
            registerButton.classList.add('d-none');
            registerButton.disabled = true;
        }
    
        // Unregister Button
        if ((isRegistered || isConnecting) && !currentSession) {
            unregisterButton.classList.remove('d-none');
            unregisterButton.disabled = false;
        } else {
            unregisterButton.classList.add('d-none');
            unregisterButton.disabled = true;
        }
    
        // Start Call Button
        if (isRegistered && !currentSession) {
            startCallButton.classList.remove('d-none');
            startCallButton.disabled = false;
        } else {
            startCallButton.classList.add('d-none');
            startCallButton.disabled = true;
        }
    
        // Answer Call Button: visible if there is an incoming call and not yet answered
        if (currentSession && currentSession.direction === 'incoming' && (!currentSession.isEstablished || !currentSession.isEstablished()) && (!currentSession.status || currentSession.status !== STATUS_TERMINATED)) {
            answerCallButton.classList.remove('d-none');
            answerCallButton.disabled = false;
        } else {
            answerCallButton.classList.add('d-none');
            answerCallButton.disabled = true;
        }
    
        // Call Action Buttons (End, Hold, Transfer)
        const callEstablished = currentSession && currentSession.isEstablished && currentSession.isEstablished();
    
        endCallButton.classList.toggle('d-none', !callEstablished);
        endCallButton.disabled = !callEstablished;
    
        holdCallButton.classList.toggle('d-none', !callEstablished);
        holdCallButton.disabled = !callEstablished;
    
        transferCallButton.classList.toggle('d-none', !callEstablished);
        transferCallButton.disabled = !callEstablished;
    
        // End Call button should be visible if call is active (ringing, accepted, confirmed)
        const callActive = currentSession && (!currentSession.status || currentSession.status !== STATUS_TERMINATED);
        endCallButton.classList.toggle('d-none', !callActive);
        endCallButton.disabled = !callActive;
    }
    /**
     * Sets up event handlers for a JsSIP.UA instance.
     * @param {JsSIP.UA} jssipUa - The JsSIP User Agent instance.
     */
    function setupUaEventHandlers(jssipUa) {
        jssipUa.on('connecting', () => {
            console.log('UA Event: connecting fired');
            document.getElementById('call-status').textContent = 'Connecting to SIP server...';
            logStatus('UA: Connecting to SIP server...');
        });

        jssipUa.on('connected', () => {
            console.log('UA Event: connected fired');
            document.getElementById('call-status').textContent = 'Connected to SIP server. Registering...';
            logStatus('UA: Connected to SIP server. Registering...');
        });

        jssipUa.on('disconnected', (e) => {
            console.log('UA Event: disconnected fired', e);
            let statusText = 'Disconnected from SIP server.';
            if (e && e.cause) {
                statusText += ` Cause: ${e.cause}`;
                logStatus(`UA: Disconnected. Cause: ${e.cause}`);
            } else {
                logStatus('UA: Disconnected.');
            }
            document.getElementById('call-status').textContent = statusText;
            // If UA disconnected while an incoming call was ringing, stop the ringtone.
            if (currentSession && currentSession.direction === 'incoming' && !currentSession.isEstablished() && !ringtone.paused) {
                ringtone.pause();
                ringtone.currentTime = 0;
            }
            updateButtonVisibility();
        });

        jssipUa.on('registered', () => {
            console.log('UA Event: registered fired');
            document.getElementById('call-status').textContent = 'SIP Registered';
            logStatus('UA: SIP Registered.');
            updateButtonVisibility();
        });

        jssipUa.on('unregistered', (e) => {
            console.log('UA Event: unregistered fired', e);
            let statusText = 'SIP Unregistered';
            if (e && e.cause) {
                statusText += `: ${e.cause}`;
                logStatus(`UA: SIP Unregistered. Cause: ${e.cause}`);
            } else {
                logStatus('UA: SIP Unregistered.');
            }
            document.getElementById('call-status').textContent = statusText;
            updateButtonVisibility();
        });

        jssipUa.on('registrationFailed', (e) => {
            console.log('UA Event: registrationFailed fired', e);
            let statusText = 'SIP Registration Failed';
            if (e && e.cause) {
                statusText += `: ${e.cause}`;
                logStatus(`UA: SIP Registration Failed. Cause: ${e.cause}`);
            } else {
                logStatus('UA: SIP Registration Failed.');
            }
            document.getElementById('call-status').textContent = statusText;
            updateButtonVisibility();
        });

        // Handle new call session (incoming or outgoing)
        jssipUa.on('newRTCSession', (data) => {
            console.log('UA Event: newRTCSession fired', data);
            currentSession = data.session;
            const remoteIdentity = currentSession.remote_identity.uri.toString();

            // Set Hold button text to default
            holdCallButton.textContent = 'Hold';

            // Incoming call: show status and play ringtone
            if (currentSession.direction === 'incoming') {
                const statusMsg = `Incoming call from ${remoteIdentity}`;
                document.getElementById('call-status').textContent = statusMsg;
                logStatus(`Session: ${statusMsg}`);
                if (audioContextUnlocked) { // Only play ringtone if audio context is unlocked
                    
                    ringtone.currentTime = 0;
                    ringtone.play().catch(e => logStatus(`Ringtone play error: ${e.message}`));
                    
                }
            } else {
                // Outgoing call: ensure ringtone is stopped
                ringtone.pause();
                ringtone.currentTime = 0;
            }
            updateButtonVisibility();

            // Session event handlers
            currentSession.on('ended', (e) => {
                console.log('Session Event: ended fired', e);
                const statusMsg = `Call ended. Originator: ${e.originator}, Cause: ${e.cause || 'N/A'}`;
                document.getElementById('call-status').textContent = statusMsg;
                logStatus(`Session: ${statusMsg}`);
                currentSession = null;
                // Ensure ringtone stops if call ends while ringing (e.g., remote hangs up before answer)
                ringtone.pause();
                holdCallButton.textContent = 'Hold';
                ringtone.currentTime = 0;
                updateButtonVisibility();
            });

            currentSession.on('failed', (e) => {
                console.log('Session Event: failed fired', e);
                let failMsg = 'Call failed';
                if (e.cause) {
                    failMsg += `: ${e.cause}. Originator: ${e.originator}`;
                } else {
                    failMsg += `. Originator: ${e.originator}`;
                }
                logStatus(`Session: ${failMsg}`);
                document.getElementById('call-status').textContent = failMsg;
                currentSession = null;
                // Ensure ringtone stops if call fails while ringing
                ringtone.pause();
                holdCallButton.textContent = 'Hold';
                ringtone.currentTime = 0;
                updateButtonVisibility();
            });

            currentSession.on('progress', (e) => {
                console.log('Session Event: progress fired', e);
                const statusMsg = 'Call progress (Ringing)...';
                document.getElementById('call-status').textContent = statusMsg;
                logStatus(`Session: ${statusMsg}`);
                // You might play a local ringback tone here if needed
            });

            currentSession.on('accepted', () => {
                console.log('Session Event: accepted fired');
                const statusMsg = 'Call accepted';
                document.getElementById('call-status').textContent = statusMsg;
                logStatus(`Session: ${statusMsg}`);
                // Ensure ringtone stops when call is accepted
                ringtone.pause();
                ringtone.currentTime = 0;
                updateButtonVisibility();
            });

            currentSession.on('confirmed', () => {
                console.log('Session Event: confirmed fired');
                const statusMsg = 'Call active';
                document.getElementById('call-status').textContent = statusMsg;
                logStatus(`Session: ${statusMsg}`);
                // Ensure ringtone stops when call is confirmed
                ringtone.pause();
                ringtone.currentTime = 0;
                updateButtonVisibility();                
            });

            // Listen for hold/unhold events
            currentSession.on('hold', (e) => {
                console.log('Session Event: hold fired', e);
                const originator = e.originator || 'unknown';
                const statusMsg = `Call On Hold (by ${originator})`;
                document.getElementById('call-status').textContent = statusMsg;
                logStatus(`Session: ${statusMsg}`);
                holdCallButton.textContent = 'Unhold';
            });

            currentSession.on('unhold', (e) => {
                console.log('Session Event: unhold fired', e);
                const originator = e.originator || 'unknown';
                const statusMsg = `Call Resumed (unheld by ${originator})`;
                document.getElementById('call-status').textContent = statusMsg;
                logStatus(`Session: ${statusMsg}`);
                holdCallButton.textContent = 'Hold';
            });

            // Handle call termination/connection loss
            currentSession.on('bye', () => {
                console.log('Session Event: bye fired');
                logStatus('Session: Call ended by remote (BYE received).');
                document.getElementById('call-status').textContent = 'Call ended by remote.';
                currentSession = null;
                ringtone.pause();
                ringtone.currentTime = 0;
                holdCallButton.textContent = 'Hold';
                updateButtonVisibility();
            });

            currentSession.on('sdp', (data) => {
                logStatus(`SDP: Originator: ${data.originator}, Type: ${data.type}`);
                console.log(`SDP (${data.originator} ${data.type}):\n${data.sdp}`);
            });

            // PeerConnection event handler'ı direkt olarak RTCSession'a bağlanıyor
            console.log('Setting up peerconnection handler for session:', currentSession);
            if (currentSession.connection) {
                logStatus('Session already has a connection, setting up handlers...');
                peerConnectionStateChangeHandler({ peerconnection: currentSession.connection });
            }
            
            currentSession.on('peerconnection', (e) => {
                logStatus('Session: PeerConnection event triggered!');
                console.log('PeerConnection event details:', e);
                
                if (!e || !e.peerconnection) {
                    logStatus('ERROR: Invalid peerconnection event received');
                    console.error('Invalid peerconnection event:', e);
                    return;
                }

                const pc = e.peerconnection;
                logStatus(`PeerConnection state: ${pc.connectionState || 'unknown'}`);
                
                // Audio track handler'ı
                pc.ontrack = (event) => {
                    console.log('Remote track event received:', event);
                    if (event.track.kind === 'audio') {
                        logStatus('Audio track received, setting up remote audio...');
                        const remoteAudio = document.getElementById('remote-audio');
                        if (!remoteAudio) {
                            logStatus('ERROR: remote-audio element not found!');
                            return;
                        }

                        if (remoteAudio.srcObject) {
                            remoteAudio.srcObject.getTracks().forEach(track => track.stop());
                        }

                        let streamToPlay = event.streams?.[0] || new MediaStream([event.track]);
                        remoteAudio.srcObject = streamToPlay;
                        
                        if (settings.selectedAudioOutputId && typeof remoteAudio.setSinkId === 'function') {
                            remoteAudio.setSinkId(settings.selectedAudioOutputId)
                                .then(() => logStatus('Audio output device set successfully'))
                                .catch(err => logStatus(`setSinkId error: ${err.message}`));
                        }

                        remoteAudio.muted = false;
                        remoteAudio.volume = 1.0;

                        const playPromise = remoteAudio.play();
                        if (playPromise) {
                            playPromise
                                .then(() => logStatus('Remote audio playing successfully'))
                                .catch(err => {
                                    logStatus(`Error playing audio: ${err.message}`);
                                    console.error('Audio play error:', err);
                                    // Try to recover by requesting user interaction
                                    if (!audioContextUnlocked) {
                                        logStatus('Audio context locked. User interaction needed.');
                                        attemptUnlockAudioContext();
                                    }
                                });
                        }
                    }
                };

                // Monitor ICE connection state changes
                pc.oniceconnectionstatechange = () => {
                    logStatus(`ICE connection state: ${pc.iceConnectionState}`);
                    console.log('ICE connection state changed:', pc.iceConnectionState);
                    
                    if (pc.iceConnectionState === 'failed') {
                        logStatus('ICE connection failed - checking candidates...');
                        pc.getStats().then(stats => {
                            console.log('ICE failure stats:', stats);
                        });
                    }
                };

                // Monitor general connection state changes
                pc.onconnectionstatechange = () => {
                    logStatus(`Connection state changed to: ${pc.connectionState}`);
                    if (['disconnected', 'failed', 'closed'].includes(pc.connectionState)) {
                        logStatus('Connection lost or failed');
                        document.getElementById('call-status').textContent = `Call connection ${pc.connectionState}`;
                    }
                };
            });
        });

        // Handle incoming SIP MESSAGE
        jssipUa.on('newMessage', (data) => {
            console.log('UA Event: newMessage fired', data);
            const message = `New message from ${data.originator.uri.user}: ${data.request.body}`;
            logStatus(`SIP Message: ${message}`);
            alert(message);
        });
    }

    function peerConnectionStateChangeHandler(e) {
        console.log('--- Entering peerConnectionStateChangeHandler ---', e); // More prominent log
        logStatus('DEBUG: Entering peerConnectionStateChangeHandler.'); // Add to UI log for visibility

        try {
            const pc = e.peerconnection;
            console.log('PeerConnection object (inside handler):', pc);
            logStatus('DEBUG: PeerConnection object obtained.');

                // Handle incoming remote audio/video tracks
                pc.ontrack = (event) => {
                    console.log('PeerConnection Event: ontrack fired', event);
                    if (event.track.kind === 'audio') {
                        logStatus('Session: Remote audio track received.');
                        const remoteAudio = document.getElementById('remote-audio');
                        if (!remoteAudio) {
                            logStatus('Error: remote-audio HTML element not found.');
                            console.error('CRITICAL: remote-audio element NOT FOUND!');
                            return;
                        }

                        // Clean up previous stream if any
                        if (remoteAudio.srcObject) {
                            remoteAudio.srcObject.getTracks().forEach(track => track.stop());
                        }

                        let streamToPlay = null;
                        if (event.streams && event.streams[0]) { // For older browser compatibility
                            streamToPlay = event.streams[0];
                            logStatus('Session: Using event.streams[0] for remote audio.');
                        } else { // event.track is the standard way
                            streamToPlay = new MediaStream();
                            streamToPlay.addTrack(event.track);
                            logStatus('Session: Created new MediaStream from event.track for remote audio.');
                        }

                        remoteAudio.srcObject = streamToPlay;
                        applyAudioOutputDevice(settings.selectedAudioOutputId); // Apply selected output device

                        remoteAudio.muted = false; // Ensure not muted
                        remoteAudio.volume = 1.0; // Set volume to max
                        remoteAudio.play().then(() => {
                            logStatus('Remote audio playback started.');
                        }).catch(err => {
                            logStatus(`Error playing remote audio: ${err.message} (User interaction might be required).`);
                            console.error('Error playing remote audio:', err);
                        });

                    } else if (event.track.kind === 'video') {
                        logStatus('Session: Remote video track received (currently not handled).');
                        // Placeholder for future video handling if needed
                    }
                };

                pc.oniceconnectionstatechange = () => {
                    console.log('PeerConnection Event: oniceconnectionstatechange fired. New state:', pc.iceConnectionState);
                    logStatus(`ICE state: ${pc.iceConnectionState}`);
                    if (pc.iceConnectionState === 'failed') {
                        logStatus('ICE connection failed. This is a common cause for no audio/video.');
                        // Additional debugging information can be collected here, e.g., collected candidates.
                        pc.getStats().then(stats => {
                            console.log('PeerConnection stats on ICE failure:', stats);
                        });
                    }
                };

                pc.onconnectionstatechange = () => {
                    console.log('PeerConnection Event: onconnectionstatechange fired. New state:', pc.connectionState);
                    if (pc.connectionState === 'disconnected' || pc.connectionState === 'closed' || pc.connectionState === 'failed') {
                        logStatus(`PeerConnection state changed to ${pc.connectionState}. Call connection likely lost.`);
                        document.getElementById('call-status').textContent = `Call connection ${pc.connectionState}.`;
                        ringtone.pause();
                        ringtone.currentTime = 0;
                        holdCallButton.textContent = 'Hold';
                        updateButtonVisibility();
                    }
                };
            logStatus('DEBUG: PeerConnection event handlers attached.');
        } catch (error) {
            console.error('--- ERROR in peerConnectionStateChangeHandler ---', error);
            logStatus(`CRITICAL ERROR in peerConnectionStateChangeHandler: ${error.message}`);
        }
        console.log('--- Exiting peerConnectionStateChangeHandler ---');
        logStatus('DEBUG: Exiting peerConnectionStateChangeHandler.');
    }


    /**
     * Initializes and registers the SIP User Agent with the current settings.
     * @param {object} currentSettings - The SIP settings to use for initialization.
     */
    function initializeAndRegisterSip(currentSettings) {
        if (ua) {
            console.log('Stopping existing UA instance...');
            ua.stop();
            logStatus('Stopping existing UA instance.');
            ua = null;
        }

        const sipUri = `sip:${currentSettings.sipUsername}@${currentSettings.sipServer}${currentSettings.sipPort ? ':' + currentSettings.sipPort : ''}`;
        let socketUri;

        if (currentSettings.wssUri && currentSettings.wssUri.trim() !== '') {
            socketUri = currentSettings.wssUri.trim();
        } else if (currentSettings.sipServer) {
            socketUri = `wss://${currentSettings.sipServer.trim()}${currentSettings.sipPort ? ':' + currentSettings.sipPort.trim() : ':443'}`; // Default WSS port
        } else {
            document.getElementById('call-status').textContent = 'WSS URI or SIP Server required for WebSocket.';
            logStatus('Config Error: WSS URI or SIP Server required for WebSocket.');
            alert('Configuration error: WSS URI or SIP Server must be set.');
            return;
        }

        if (!currentSettings.sipUsername || !currentSettings.sipServer) {
            document.getElementById('call-status').textContent = 'SIP Username and Server are required.';
            logStatus('Config Error: SIP Username and Server are required.');
            alert('Configuration error: SIP Username and Server must be set.');
            updateButtonVisibility();
            return;
        }

        try {
            const socket = new JsSIP.WebSocketInterface(socketUri);
            const configuration = {
                sockets: [socket],
                uri: sipUri,
                password: currentSettings.sipPassword,
                display_name: currentSettings.sipDisplayName,
                user: currentSettings.sipUsername,
                authUser: currentSettings.sipUsername,
                outbound_proxy_set: currentSettings.outboundProxy || undefined,
                session_timers: false,
                registrar_server: currentSettings.sipServer,
                contact_uri: null, // Let JsSIP generate it
                user_agent: 'MyJsSIPSoftphone/1.0'
            };

            ua = new JsSIP.UA(configuration);
            setupUaEventHandlers(ua);
            ua.start();
            logStatus(`Initializing SIP with URI: ${sipUri} and WebSocket: ${socketUri}`);
            document.getElementById('call-status').textContent = 'Initializing SIP...';

        } catch (error) {
            console.error('Error initializing JsSIP UA:', error);
            document.getElementById('call-status').textContent = `Error: ${error.message}`;
            logStatus(`Error initializing JsSIP UA: ${error.message}`);
            alert(`Failed to initialize SIP client: ${error.message}`);
            updateButtonVisibility();
        }
    }

    // Event Listeners
    // Save settings and re-initialize SIP if valid
    saveSettingsButton.addEventListener('click', function(e) {
        e.preventDefault();
        settings = {
            sipServer: sipServerInput.value.trim(),
            sipPort: sipPortInput.value.trim(),
            sipUsername: sipUsernameInput.value.trim(),
            sipPassword: sipPasswordInput.value, // Passwords should not be trimmed
            sipDisplayName: sipDisplayNameInput.value.trim(),
            outboundProxy: outboundProxyInput.value.trim(),
            stunServer: stunServerInput.value.trim(),
            turnServer: turnServerInput.value.trim(),
            turnUsername: turnUsernameInput.value.trim(),
            turnPassword: turnPasswordInput.value, // Passwords should not be trimmed
            wssUri: wssUriInput.value.trim()
        };
        localStorage.setItem('softphoneSettings', JSON.stringify(settings));
        logStatus('Settings saved to localStorage.');
        alert('Settings saved!');

        // Re-initialize and register SIP with new settings
        if (settings.sipUsername && (settings.wssUri || settings.sipServer)) {
            logStatus('Attempting to re-initialize and register SIP with new settings.');
            initializeAndRegisterSip(settings);
        } else {
            document.getElementById('call-status').textContent = 'SIP settings incomplete. Cannot register.';
            logStatus('SIP settings incomplete after save. Cannot register.');
            if (ua) {
                ua.stop();
                logStatus('Stopped UA due to incomplete settings after save.');
                ua = null;
            }
        }
    });

    // Start outgoing call
    startCallButton.addEventListener('click', function() {
        if (!ua || !ua.isRegistered()) {
            alert('SIP client is not registered. Please check settings or wait for registration.');
            logStatus('Start Call: SIP client not registered.');
            return;
        }
        const target = destinationInput.value.trim();
        if (target) {
            const callTarget = target.startsWith('sip:') ? target : `sip:${target}@${settings.sipServer}`;
            logStatus(`Attempting to call: ${callTarget}`);
            try { // This try-catch is for the ua.call() method itself, not for session events
                currentSession = ua.call(callTarget, {
                    mediaConstraints: {
                        audio: settings.selectedAudioInputId ? { deviceId: { exact: settings.selectedAudioInputId } } : true,
                        video: false
                    },
                    pcConfig: { iceServers: getIceServersConfig(settings, callTarget) },
                    eventHandlers: {
                        'progress': function(e) {
                            const statusMsg = 'Calling (Ringing)...';
                            document.getElementById('call-status').textContent = statusMsg;
                            logStatus(`Outgoing Call to ${callTarget}: ${statusMsg}`);
                        },
                        'failed': function(e) {
                            const statusMsg = `Call failed (outgoing): ${e.cause}`;
                            document.getElementById('call-status').textContent = statusMsg;
                            logStatus(`Outgoing Call to ${callTarget}: ${statusMsg}`);
                            currentSession = null;
                            updateButtonVisibility();
                        },
                        'ended': function(e) {
                            const statusMsg = `Call ended (outgoing): ${e.cause}`;
                            document.getElementById('call-status').textContent = statusMsg;
                            logStatus(`Outgoing Call to ${callTarget}: ${statusMsg}`);
                            currentSession = null;
                            updateButtonVisibility();
                        }
                    }
                });
                if (currentSession) {
                    logStatus(`Initiating call to ${callTarget}...`);
                    document.getElementById('call-status').textContent = 'Initiating call...';
                }
            } catch (err) {
                logStatus(`Error initiating call: ${err.message}`);
                alert('Call could not be started: ' + err.message);
                document.getElementById('call-status').textContent = 'Call start error.';
                currentSession = null; // Ensure session is cleared on immediate call error
            }
        } else {
            logStatus('Start Call: No destination entered.');
            document.getElementById('call-status').textContent = 'Please enter a destination to call.';
        }
    });

    // End Call button will now handle termination in all states (ringing, established)
    endCallButton.addEventListener('click', function() {
        if (currentSession) { // Check if a session exists in any state
            logStatus('End Call button clicked. Terminating current session...');
            currentSession.terminate();
            ringtone.pause(); // Ensure ringtone stops if call is ended locally while ringing
            ringtone.currentTime = 0;
        }
        updateButtonVisibility();
    });

    // Hold/Unhold call
    holdCallButton.addEventListener('click', function() {
        if (currentSession && currentSession.isEstablished()) {
            if (!currentSession.isOnHold().local) {
                logStatus('Attempting to hold call...');
                currentSession.hold({
                    failed_callback: (e) => {
                        console.error('Hold failed', e);
                        logStatus(`Hold failed: ${e ? e.cause : 'Unknown reason'}`);
                        alert('Failed to put call on hold.');
                    }
                }); // No options needed for basic hold
            } else {
                logStatus('Unhold Call button clicked. Attempting to unhold call.');
                currentSession.unhold({ failed_callback: (e) => {
                    console.error('Unhold failed', e);
                    logStatus(`Unhold failed: ${e ? e.cause : 'Unknown reason'}`);
                    alert('Failed to resume call.'); } });
            }
        } else {
             logStatus('Hold/Unhold: No active call to hold/unhold.');
             document.getElementById('call-status').textContent = 'No active call to hold/unhold.';
        }
    });

    // Transfer call to another SIP URI
    transferCallButton.addEventListener('click', function() {
        if (currentSession && currentSession.isEstablished()) {
            const target = prompt('Enter the SIP URI to transfer to (e.g., sip:1002@domain.com or 1002):');
            if (target) {
                const transferTarget = target.includes('@') ? target : `sip:${target}@${settings.sipServer}`;
                currentSession.refer(transferTarget, {
                    eventHandlers: { // These are for the REFER request itself
                        'requestSucceeded': function(e) {
                            logStatus(`Transfer to ${transferTarget} request succeeded.`);
                            document.getElementById('call-status').textContent = 'Transfer initiated...';
                        },
                        'requestFailed': function(e) {
                            logStatus(`Transfer to ${transferTarget} request failed: ${e.cause}`);
                            document.getElementById('call-status').textContent = 'Transfer failed.';
                            alert('Call transfer failed.');
                        },
                        'accepted': function(e) {
                            logStatus(`Transfer to ${transferTarget} accepted by server.`);
                            document.getElementById('call-status').textContent = 'Transfer accepted by server.';
                        },
                        'failed': function(e) {
                             logStatus(`Transfer to ${transferTarget} ultimately failed: ${e.cause}`);
                             document.getElementById('call-status').textContent = `Transfer failed: ${e.cause}`;
                             alert(`Call transfer failed: ${e.cause}`);
                        }
                    }});
                logStatus(`Attempting to transfer call to ${transferTarget}.`);
            }
        } else {
            logStatus('Transfer: No active call to transfer.');
            document.getElementById('call-status').textContent = 'No active call to transfer.';
        }
    });

    // Answer incoming call
    answerCallButton.addEventListener('click', function() {
        if (currentSession && currentSession.direction === 'incoming' && !currentSession.isEstablished()) {
            logStatus('Answering incoming call...');
            const remoteHost = currentSession.remote_identity?.uri?.host; // Safely access remote host
            currentSession.answer({
                // Use selected audio input device if available
                mediaConstraints: {
                    audio: settings.selectedAudioInputId ? { deviceId: { exact: settings.selectedAudioInputId } } : true,
                    video: false
                },
                pcConfig: { iceServers: getIceServersConfig(settings, remoteHost) }
            });
            ringtone.pause();
            ringtone.currentTime = 0;
            document.getElementById('call-status').textContent = 'Answering call...';
        } else {
            document.getElementById('call-status').textContent = 'No incoming call to answer.';
        }
        updateButtonVisibility();
    });

    // Unregister from SIP server and terminate any active call
    unregisterButton.addEventListener('click', function() {
        if (currentSession && typeof currentSession.terminate === 'function') {
            logStatus('Terminating active session before unregistering...');
            currentSession.terminate();
            currentSession = null;
            ringtone.pause();
            ringtone.currentTime = 0;
        }
        if (ua && (ua.isRegistered() || ua.isConnecting())) {
            logStatus('Unregister button: Unregistering from SIP server.');
            ua.unregister({all: true}); // Unregister all contacts
            // Consider ua.stop() after unregister if you want to fully shut down.
        } else if (ua) {
            logStatus('Unregister button: UA exists but not registered/connecting. Stopping UA.');
            ua.stop(); // If not registered/connecting, just stop it.
        } else {
            logStatus('Unregister button: SIP client not active.');
            document.getElementById('call-status').textContent = 'SIP client not active to unregister.';
        }
        // ua.stop() might be more appropriate if you want to fully shut down after unregister.
        updateButtonVisibility();
    });

    // Register to SIP server
    registerButton.addEventListener('click', function() {
        if (settings.sipUsername && (settings.wssUri || settings.sipServer)) {
            if (ua && ua.isRegistered()) {
                alert('Already registered.');
                logStatus('Register button: Already registered.');
                return;
            }
            initializeAndRegisterSip(settings);
            logStatus('Register button: Attempting to initialize and register SIP.');
        } else {
            alert('SIP settings incomplete. Please configure and save settings first.');
            logStatus('Register button: SIP settings incomplete.');
        }
        updateButtonVisibility();
    });

    // Only add event listener if terminateCallButton exists in the DOM
    if (terminateCallButton) {
        terminateCallButton.addEventListener('click', function() {
            if (currentSession) {
                logStatus('Terminate Call button clicked. Terminating current session...');
                currentSession.terminate();
                ringtone.pause(); // Ensure ringtone stops
                ringtone.currentTime = 0;
            } else {
                logStatus('Terminate Call button (alternative): No active call to terminate.');
            }
            updateButtonVisibility();
        });
    }

    // Initial Setup and Checks
    // Check if JsSIP library is loaded
    if (typeof JsSIP === 'undefined' || typeof JsSIP.UA === 'undefined') {
        alert('JsSIP library could not be loaded! Please check your js/jssip-3.10.0.js path.');
        document.getElementById('call-status').textContent = 'JsSIP library not loaded.';
        logStatus('FATAL: JsSIP library not loaded.');
        return;
    }

    // Enable JsSIP debugging for detailed logs
    // This should be called after JsSIP is confirmed to be loaded
    JsSIP.debug.enable('JsSIP:*');
    console.log('JsSIP debugging enabled.'); // Optional: confirm in console

    // Add event listeners for user interaction to unlock audio context
    // General interaction listeners (first click/keydown)
    document.addEventListener('click', attemptUnlockAudioContext, { capture: true, once: true }); // More specific to body
    document.addEventListener('keydown', attemptUnlockAudioContext, { capture: true, once: true });

    // Specific button for unlocking audio
    if (unlockAudioButton) {
        unlockAudioButton.addEventListener('click', () => {
            attemptUnlockAudioContext(); // Call the function directly
        });
    }

    // Event listener for toggling logs visibility
    if (toggleLogsButton && logSection) {
        toggleLogsButton.addEventListener('click', () => {
            logSection.classList.toggle('d-none');
            if (logSection.classList.contains('d-none')) {
                toggleLogsButton.textContent = 'Show Logs';
            } else {
                toggleLogsButton.textContent = 'Hide Logs';
            }
        });
    }

    // Event listener for toggling settings visibility
    if (toggleSettingsButton && settingsSection) {
        toggleSettingsButton.addEventListener('click', () => {
            settingsSection.classList.toggle('d-none');
            if (settingsSection.classList.contains('d-none')) {
                toggleSettingsButton.textContent = 'Show Settings';
            } else {
                toggleSettingsButton.textContent = 'Hide Settings';
            }
        });
    }

    if (toggleDevicesButton && devicesSection) {
        toggleDevicesButton.addEventListener('click', () => {
            devicesSection.classList.toggle('d-none');
            if (devicesSection.classList.contains('d-none')) {
                toggleDevicesButton.textContent = 'Show Devices';
            } else {
                toggleDevicesButton.textContent = 'Hide Devices';
            }
        });
    }

    // Event listener for audio input selection
    if (audioInputSelect) {
        audioInputSelect.addEventListener('change', function() {
            settings.selectedAudioInputId = this.value;
            localStorage.setItem('softphoneSettings', JSON.stringify(settings)); // Save selection
            logStatus(`Audio input device selected: ${this.options[this.selectedIndex].text}`);
            // Note: Input device change typically applies on the next call or renegotiation.
        });
    }

    // Event listener for audio output selection
    if (audioOutputSelect) {
        audioOutputSelect.addEventListener('change', function() {
            settings.selectedAudioOutputId = this.value;
            localStorage.setItem('softphoneSettings', JSON.stringify(settings)); // Save selection
            logStatus(`Audio output device selected: ${this.options[this.selectedIndex].text}`);
            applyAudioOutputDevice(this.value);
        });
    }

    // Load settings and update UI on page load
    loadSettings();
    populateAudioDevices(); // Populate devices after loading settings
    updateButtonVisibility();

    // Attempt to auto-register SIP on page load if settings are present and valid
    const canRegisterAfterLoad = settings.sipUsername && settings.sipServer && (settings.wssUri || settings.sipServer);
    if (canRegisterAfterLoad) {
        logStatus('Auto-registering on page load with saved settings.');
        initializeAndRegisterSip(settings);
    } else {
        document.getElementById('call-status').textContent = 'SIP settings incomplete. Please configure.';
        logStatus('Page load: SIP settings incomplete. Please configure.');
        updateButtonVisibility();
    }

    // Set focus to the destination input field after page load
    if (destinationInput) {
        destinationInput.focus();
        logStatus('Destination input focused on page load.');
    }

    // Add event listener to destination input for Enter key press
    if (destinationInput && startCallButton) {
        destinationInput.addEventListener('keypress', function(event) {
            if (event.key === 'Enter' || event.keyCode === 13) { // Check for Enter key
                event.preventDefault(); // Prevent default form submission if any
                startCallButton.click(); // Programmatically click the start call button
            }
        });
    }
});