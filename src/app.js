// filepath: softphone-app/softphone-app/src/app.js

document.addEventListener('DOMContentLoaded', function() {
    // Buttons
    const startCallButton = document.getElementById('start-call-btn'); // Button to start an outgoing call
    const endCallButton = document.getElementById('end-btn'); // Button to end the current call
    const holdCallButton = document.getElementById('hold-btn'); // Button to hold/unhold the current call
    const transferCallButton = document.getElementById('transfer-btn'); // Button to transfer the current call
    const answerCallButton = document.getElementById('answer-btn'); // Button to answer an incoming call
    const unregisterButton = document.getElementById('unregister-btn'); // Button to unregister from SIP server
    const registerButton = document.getElementById('register-btn'); // Button to register to SIP server
    const terminateCallButton = document.getElementById('terminate-btn'); // Button to terminate the current call (alternative to end)
    const saveSettingsButton = document.querySelector('#sip-settings button[type="submit"]'); // Button to save SIP settings

    // Setting inputs
    const sipServerInput = document.getElementById('sip-server'); // Input for SIP server address
    const sipPortInput = document.getElementById('sip-port'); // Input for SIP server port
    const sipUsernameInput = document.getElementById('sip-username'); // Input for SIP username
    const sipPasswordInput = document.getElementById('sip-password'); // Input for SIP password
    const sipDisplayNameInput = document.getElementById('sip-display-name'); // Input for SIP display name
    const outboundProxyInput = document.getElementById('outbound-proxy'); // Input for outbound proxy (optional)
    const stunServerInput = document.getElementById('stun-server'); // Input for STUN server
    const turnServerInput = document.getElementById('turn-server'); // Input for TURN server
    const turnUsernameInput = document.getElementById('turn-username'); // Input for TURN username
    const turnPasswordInput = document.getElementById('turn-password'); // Input for TURN password
    const wssUriInput = document.getElementById('wss-uri-input'); // Input for WSS URI (WebSocket URI)

    // Destination input
    const destinationInput = document.getElementById('destination'); // Input for call destination (number or SIP URI)

    // Ringtone Audio element
    const ringtone = new Audio('sounds/bell.mp3'); // Ringtone audio file
    ringtone.loop = true; // Loop the ringtone

    // Global UA instance
    let ua; // JsSIP UA instance
    let settings = {}; // SIP settings object
    let currentSession = null; // Current active call session

    // Function to load settings from localStorage and populate form fields
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
            } catch (e) {
                console.error('Failed to parse settings from localStorage:', e);
            }
        }
    }

    // Function to build a valid iceServers array for WebRTC
    function getIceServersConfig(currentSettings) {
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
        return iceServers;
    }

    // Function to update button visibility and disabled state based on current app state
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

    // Function to setup event handlers for a JsSIP.UA instance
    function setupUaEventHandlers(jssipUa) {
        jssipUa.on('connecting', () => {
            document.getElementById('call-status').textContent = 'Connecting to SIP server...';
        });

        jssipUa.on('connected', () => {
            document.getElementById('call-status').textContent = 'Connected to SIP server. Registering...';
        });

        jssipUa.on('disconnected', (e) => {
            let statusText = 'Disconnected from SIP server.';
            if (e && e.cause) {
                statusText += ` Cause: ${e.cause}`;
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
            document.getElementById('call-status').textContent = 'SIP Registered';
            updateButtonVisibility();
        });

        jssipUa.on('unregistered', (e) => {
            let statusText = 'SIP Unregistered';
            if (e && e.cause) {
                statusText += `: ${e.cause}`;
            }
            document.getElementById('call-status').textContent = statusText;
            updateButtonVisibility();
        });

        jssipUa.on('registrationFailed', (e) => {
            let statusText = 'SIP Registration Failed';
            if (e && e.cause) {
                statusText += `: ${e.cause}`;
            }
            document.getElementById('call-status').textContent = statusText;
            updateButtonVisibility();
        });

        // Handle new call session (incoming or outgoing)
        jssipUa.on('newRTCSession', (data) => {
            currentSession = data.session;
            const remoteIdentity = currentSession.remote_identity.uri.toString();

            // Set Hold button text to default
            holdCallButton.textContent = 'Hold';

            // Incoming call: show status and play ringtone
            if (currentSession.direction === 'incoming') {
                document.getElementById('call-status').textContent = `Incoming call from ${remoteIdentity}`;
                try {
                    ringtone.currentTime = 0;
                    ringtone.play();
                } catch (e) {
                    console.error('Ringtone play failed:', e);
                }
            } else {
                // Outgoing call: ensure ringtone is stopped
                ringtone.pause();
                ringtone.currentTime = 0;
            }
            updateButtonVisibility();

            // Session event handlers
            currentSession.on('ended', (e) => {
                document.getElementById('call-status').textContent = 'Call ended';
                currentSession = null;
                // Ensure ringtone stops if call ends while ringing (e.g., remote hangs up before answer)
                ringtone.pause();
                holdCallButton.textContent = 'Hold';
                ringtone.currentTime = 0;
                updateButtonVisibility();
            });

            currentSession.on('failed', (e) => {
                let failMsg = 'Call failed';
                if (e.cause) {
                    failMsg += `: ${e.cause}`;
                }
                document.getElementById('call-status').textContent = failMsg;
                currentSession = null;
                // Ensure ringtone stops if call fails while ringing
                ringtone.pause();
                holdCallButton.textContent = 'Hold';
                ringtone.currentTime = 0;
                updateButtonVisibility();
            });

            currentSession.on('accepted', () => {
                document.getElementById('call-status').textContent = 'Call accepted';
                // Ensure ringtone stops when call is accepted
                ringtone.pause();
                ringtone.currentTime = 0;
                updateButtonVisibility();
            });

            currentSession.on('confirmed', () => {
                document.getElementById('call-status').textContent = 'Call active';
                // Ensure ringtone stops when call is confirmed
                ringtone.pause();
                ringtone.currentTime = 0;
                updateButtonVisibility();
            });

            currentSession.on('peerconnection', (e) => {
                const peerconnection = e.peerconnection;
                peerconnection.oniceconnectionstatechange = () => {
                    console.log('ICE connection state changed to:', peerconnection.iceConnectionState);
                };
            });

            // Listen for hold/unhold events
            currentSession.on('hold', (e) => {
                const originator = e.originator || 'unknown';
                document.getElementById('call-status').textContent = `Call On Hold (by ${originator})`;
                holdCallButton.textContent = 'Unhold';
            });

            currentSession.on('unhold', (e) => {
                const originator = e.originator || 'unknown';
                document.getElementById('call-status').textContent = `Call Resumed (unheld by ${originator})`;
                holdCallButton.textContent = 'Hold';
            });

            // Handle call termination/connection loss
            currentSession.on('bye', () => {
                document.getElementById('call-status').textContent = 'Call ended by remote.';
                currentSession = null;
                ringtone.pause();
                ringtone.currentTime = 0;
                holdCallButton.textContent = 'Hold';
                updateButtonVisibility();
            });
            currentSession.on('peerconnection', (e) => {
                const pc = e.peerconnection;
                pc.onconnectionstatechange = () => {
                    if (pc.connectionState === 'disconnected' || pc.connectionState === 'closed' || pc.connectionState === 'failed') {
                        document.getElementById('call-status').textContent = 'Call connection lost.';
                        ringtone.pause();
                        ringtone.currentTime = 0;
                        holdCallButton.textContent = 'Hold';
                        updateButtonVisibility();
                    }
                };
            });
        });

        // Handle incoming SIP MESSAGE
        jssipUa.on('newMessage', (data) => {
            console.log('New SIP message received:', data);
            alert(`New message from ${data.originator.uri.user}: ${data.request.body}`);
        });
    }

    // Function to initialize and register SIP with current settings
    function initializeAndRegisterSip(currentSettings) {
        if (ua) {
            console.log('Stopping existing UA instance...');
            ua.stop();
            ua = null;
        }

        const uri = `sip:${currentSettings.sipUsername}@${currentSettings.sipServer}${currentSettings.sipPort ? ':' + currentSettings.sipPort : ''}`;
        let socketUri;

        if (currentSettings.wssUri && currentSettings.wssUri.trim() !== '') {
            socketUri = currentSettings.wssUri.trim();
        } else if (currentSettings.sipServer) {
            socketUri = `wss://${currentSettings.sipServer.trim()}${currentSettings.sipPort ? ':' + currentSettings.sipPort.trim() : ''}`;
        } else {
            document.getElementById('call-status').textContent = 'WSS URI or SIP Server required for WebSocket.';
            alert('Configuration error: WSS URI or SIP Server must be set.');
            return;
        }

        if (!currentSettings.sipUsername || !currentSettings.sipServer) {
            document.getElementById('call-status').textContent = 'SIP Username and Server are required.';
            alert('Configuration error: SIP Username and Server must be set.');
            updateButtonVisibility();
            return;
        }

        try {
            const socket = new JsSIP.WebSocketInterface(socketUri);
            const configuration = {
                sockets: [socket],
                uri: uri,
                password: currentSettings.sipPassword,
                display_name: currentSettings.sipDisplayName,
                outbound_proxy_set: currentSettings.outboundProxy || undefined,
                session_timers: false,
                registrar_server: currentSettings.sipServer,
                contact_uri: null, 
                user_agent: 'MyJsSIPSoftphone/1.0'
            };

            ua = new JsSIP.UA(configuration);
            setupUaEventHandlers(ua);
            ua.start();
            document.getElementById('call-status').textContent = 'Initializing SIP...';

        } catch (error) {
            console.error('Error initializing JsSIP UA:', error);
            document.getElementById('call-status').textContent = `Error: ${error.message}`;
            alert(`Failed to initialize SIP client: ${error.message}`);
            updateButtonVisibility();
        }
    }

    // Save settings and re-initialize SIP if valid
    saveSettingsButton.addEventListener('click', function(e) {
        e.preventDefault();
        settings = {
            sipServer: sipServerInput.value.trim(),
            sipPort: sipPortInput.value.trim(),
            sipUsername: sipUsernameInput.value.trim(),
            sipPassword: sipPasswordInput.value, // Passwords usually not trimmed
            sipDisplayName: sipDisplayNameInput.value.trim(),
            outboundProxy: outboundProxyInput.value.trim(),
            stunServer: stunServerInput.value.trim(),
            turnServer: turnServerInput.value.trim(),
            turnUsername: turnUsernameInput.value.trim(),
            turnPassword: turnPasswordInput.value, // Passwords usually not trimmed
            wssUri: wssUriInput.value.trim()
        };
        localStorage.setItem('softphoneSettings', JSON.stringify(settings));
        alert('Settings saved!');

        // Re-initialize and register SIP with new settings
        if (settings.sipUsername && settings.sipServer && (settings.wssUri || settings.sipServer)) {
            initializeAndRegisterSip(settings);
        } else {
            document.getElementById('call-status').textContent = 'SIP settings incomplete. Cannot register.';
            if (ua) {
                ua.stop();
                ua = null;
            }
        }
    });

    // Start outgoing call
    startCallButton.addEventListener('click', function() {
        if (!ua || !ua.isRegistered || !ua.isRegistered()) {
            alert('SIP client is not registered. Please check settings or wait for registration.');
            return;
        }
        const target = destinationInput.value.trim();
        if (target) {
            const callTarget = target.startsWith('sip:') ? target : `sip:${target}@${settings.sipServer}`;
            try {
                currentSession = ua.call(callTarget, {
                    mediaConstraints: { audio: true, video: false },
                    pcConfig: { iceServers: getIceServersConfig(settings) },
                    eventHandlers: {
                        'progress': function(e) { document.getElementById('call-status').textContent = 'Calling (Ringing)...'; },
                        'failed': function(e) {
                            document.getElementById('call-status').textContent = 'Call failed (outgoing).';
                            currentSession = null;
                            updateButtonVisibility();
                        },
                        'ended': function(e) {
                            document.getElementById('call-status').textContent = 'Call ended (outgoing).';
                            currentSession = null;
                            updateButtonVisibility();
                        }
                    }
                });
                if (currentSession) {
                    document.getElementById('call-status').textContent = 'Initiating call...';
                }
            } catch (err) {
                alert('Call could not be started: ' + err.message);
                document.getElementById('call-status').textContent = 'Call start error.';
            }
        } else {
            alert('Please enter a destination to call.');
        }
    });

    // End Call button will now handle termination in all states (ringing, established)
    endCallButton.addEventListener('click', function() {
        if (currentSession) { // Check if a session exists in any state
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
                currentSession.hold({ failed_callback: (e) => { console.error('Hold failed', e); alert('Failed to put call on hold.'); } });
            } else {
                currentSession.unhold({ failed_callback: (e) => { console.error('Unhold failed', e); alert('Failed to resume call.'); } });
            }
        } else {
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
                    eventHandlers: {
                        'requestSucceeded': function(e) {
                            document.getElementById('call-status').textContent = 'Transfer initiated...';
                        },
                        'requestFailed': function(e) {
                            document.getElementById('call-status').textContent = 'Transfer failed.';
                            alert('Call transfer failed.');
                        },
                        'accepted': function(e) {
                            document.getElementById('call-status').textContent = 'Transfer accepted by server.';
                        },
                        'failed': function(e) {
                             document.getElementById('call-status').textContent = `Transfer failed: ${e.cause}`;
                             alert(`Call transfer failed: ${e.cause}`);
                        }
                    }
                });
            }
        } else {
            document.getElementById('call-status').textContent = 'No active call to transfer.';
        }
    });

    // Answer incoming call
    answerCallButton.addEventListener('click', function() {
        if (currentSession && currentSession.direction === 'incoming' && !currentSession.isEstablished()) {
            currentSession.answer({
                mediaConstraints: { audio: true, video: false },
                pcConfig: { iceServers: getIceServersConfig(settings) }
            });
            ringtone.pause(); // Stop ringtone when call is answered
            ringtone.currentTime = 0;
        } else {
            document.getElementById('call-status').textContent = 'No incoming call to answer.';
        }
        updateButtonVisibility();
    });

    // Unregister from SIP server and terminate any active call
    unregisterButton.addEventListener('click', function() {
        if (currentSession && typeof currentSession.terminate === 'function') {
            currentSession.terminate();
            currentSession = null;
            ringtone.pause();
            ringtone.currentTime = 0;
        }
        if (ua && (ua.isRegistered() || ua.isConnecting())) {
            document.getElementById('call-status').textContent = 'Unregistering...';
            ua.unregister(); 
        } else if (ua) {
            ua.stop(); 
        }
        else {
            document.getElementById('call-status').textContent = 'SIP client not active.';
        }
        updateButtonVisibility();
    });

    // Register to SIP server
    registerButton.addEventListener('click', function() {
        if (settings.sipUsername && settings.sipServer && (settings.wssUri || settings.sipServer)) {
            if (ua && ua.isRegistered()) {
                alert('Already registered.');
                return;
            }
            initializeAndRegisterSip(settings);
        } else {
            alert('SIP settings incomplete. Please configure and save settings first.');
        }
        updateButtonVisibility();
    });

    // Only add event listener if terminateCallButton exists in the DOM
    if (terminateCallButton) {
        terminateCallButton.addEventListener('click', function() {
            if (currentSession) {
                currentSession.terminate();
                ringtone.pause(); // Ensure ringtone stops
                ringtone.currentTime = 0;
                document.getElementById('call-status').textContent = 'No active call to terminate.';
            }
            updateButtonVisibility();
        });
    }

    // Check if JsSIP library is loaded
    if (typeof JsSIP === 'undefined' || typeof JsSIP.UA === 'undefined') {
        alert('JsSIP library could not be loaded! Please check your js/jssip-3.10.0.js path.');
        document.getElementById('call-status').textContent = 'JsSIP library not loaded.';
        return;
    }

    // Load settings and update UI on page load
    loadSettings();
    updateButtonVisibility();

    // Attempt to auto-register SIP on page load if settings are present
    const canRegisterAfterLoad = settings.sipUsername && settings.sipServer && (settings.wssUri || settings.sipServer);
    if (canRegisterAfterLoad) {
        initializeAndRegisterSip(settings);
    } else {
        document.getElementById('call-status').textContent = 'SIP settings incomplete. Please configure.';
        updateButtonVisibility();
    }

    // Utility: Log status messages to the status log textarea
    function logStatus(msg) {
        const el = document.getElementById('status-log');
        if (el) {
            const time = new Date().toLocaleTimeString();
            el.value += `[${time}] ${msg}\n`;
            el.scrollTop = el.scrollHeight;
        }
    }
});