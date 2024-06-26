let ua = null;
let session = null;
let incomingSession = null;
let isOnHold = false;



function initializeJsSIP() {
  const sipUri = localStorage.getItem('sipUri') || 'sip:username@sipserver.com';
  const sipPassword = localStorage.getItem('sipPassword') || 'password';
  const wssServer = localStorage.getItem('wssServer') || 'wss://sipserver.com';
  const socket = new JsSIP.WebSocketInterface(wssServer);
  const configuration = {
    sockets: [socket],
    uri: sipUri,
    password: sipPassword,
  };

  ua = new JsSIP.UA(configuration);
  ua.start();

  ua.on('newRTCSession', (data) => {
    if (data.originator === 'remote') {
      incomingSession = data.session;
      const caller = data.request.from.display_name || data.request.from.uri.user;
      showIncomingCall(caller);
      updateStatusBar(`Incoming call from ${caller}`);
      playRingtone();
    }
  });

  ua.on('connected', () => updateStatusBar('Connected'));
  ua.on('disconnected', () => updateStatusBar('Disconnected'));
  ua.on('registered', () => updateStatusBar('Registered'));
  ua.on('unregistered', () => updateStatusBar('Unregistered'));
  ua.on('registrationFailed', () => updateStatusBar('Registration failed'));
}

function makeCall() {
  const phoneNumber = document.getElementById('phoneNumber').value;
  const uri = `sip:${phoneNumber}@sipserver.com`;
  const eventHandlers = {
    progress: () => {
      console.log('call is in progress');
      document.getElementById('transferControls').classList.remove('d-none');
      document.getElementById('callButton').classList.add('d-none');
      document.getElementById('closeButton').classList.remove('d-none');
      document.getElementById('holdButton').classList.remove('d-none');
      updateStatusBar('Calling...');
    },
    failed: () => {
      console.log('call failed');
      resetCallUI();
      updateStatusBar('Call failed');
    },
    ended: () => {
      console.log('call ended');
      resetCallUI();
      updateStatusBar('Call ended');
    },
    confirmed: () => {
      console.log('call confirmed');
      updateStatusBar('In call');
    },
  };

  const options = {
    eventHandlers: eventHandlers,
    mediaConstraints: { audio: true, video: false }
  };

  session = ua.call(uri, options);
}

function hangupCall() {
  if (session) {
    session.terminate();
    resetCallUI();
    updateStatusBar('Call ended');
  }
}

function answerCall() {
  if (incomingSession) {
    incomingSession.answer({
      mediaConstraints: { audio: true, video: false }
    });
    session = incomingSession;
    incomingSession = null;
    document.getElementById('answerButton').classList.add('d-none');
    document.getElementById('rejectButton').classList.add('d-none');
    document.getElementById('closeButton').classList.remove('d-none');
    document.getElementById('holdButton').classList.remove('d-none');
    document.getElementById('transferControls').classList.remove('d-none');
    stopRingtone();
    updateStatusBar('In call');
  }
}

function rejectCall() {
  if (incomingSession) {
    incomingSession.terminate();
    incomingSession = null;
    resetCallUI();
    stopRingtone();
    updateStatusBar('Call rejected');
  }
}

function toggleHold() {
  if (session) {
    if (!isOnHold) {
      session.hold();
      document.getElementById('holdButton').textContent = 'Unhold';
      isOnHold = true;
      updateStatusBar('Call on hold');
    } else {
      session.unhold();
      document.getElementById('holdButton').textContent = 'Hold';
      isOnHold = false;
      updateStatusBar('In call');
    }
  }
}

function transferCall() {
  const transferNumber = document.getElementById('transferNumber').value;
  if (session) {
    session.refer(`sip:${transferNumber}@sipserver.com`);
    updateStatusBar('Call transferred');
  }
}

function saveSettings() {
  const sipUri = document.getElementById('sipUri').value;
  const sipPassword = document.getElementById('sipPassword').value;
  const wssServer = document.getElementById('wssServer').value;
  localStorage.setItem('sipUri', sipUri);
  localStorage.setItem('sipPassword', sipPassword);
  localStorage.setItem('wssServer', wssServer);
  initializeJsSIP();
  showCallDiv();
}

function showCallDiv() {
  document.getElementById('callDiv').classList.remove('d-none');
  document.getElementById('callDiv').style.transform = 'translateX(0)';
  document.getElementById('settingsDiv').classList.add('d-none');
  document.getElementById('settingsDiv').style.transform = 'translateX(100%)';

  // Load settings from localStorage
  document.getElementById('sipUri').value = localStorage.getItem('sipUri') || '';
  document.getElementById('sipPassword').value = localStorage.getItem('sipPassword') || '';
  document.getElementById('wssServer').value = localStorage.getItem('wssServer') || '';
}

function showSettingsDiv() {
  document.getElementById('settingsDiv').classList.remove('d-none');
  document.getElementById('settingsDiv').style.transform = 'translateX(0)';
  document.getElementById('callDiv').classList.add('d-none');
  document.getElementById('callDiv').style.transform = 'translateX(-100%)';
}

function showIncomingCall(caller) {
  document.getElementById('answerButton').classList.remove('d-none');
  document.getElementById('rejectButton').classList.remove('d-none');
  document.getElementById('callButton').classList.add('d-none');
  document.getElementById('closeButton').classList.add('d-none');
  updateStatusBar(`Incoming call from ${caller}`);
}

function resetCallUI() {
  document.getElementById('transferControls').classList.add('d-none');
  document.getElementById('callButton').classList.remove('d-none');
  document.getElementById('closeButton').classList.add('d-none');
  document.getElementById('answerButton').classList.add('d-none');
  document.getElementById('rejectButton').classList.add('d-none');
  document.getElementById('holdButton').classList.add('d-none');
  document.getElementById('holdButton').textContent = 'Hold';
  session = null;
  isOnHold = false;
}

function updateStatusBar(message) {
  document.getElementById('statusBar').textContent = message;
}

function playRingtone() {
  const ringtone = document.getElementById('ringtone');
  ringtone.play();
}

function stopRingtone() {
  const ringtone = document.getElementById('ringtone');
  ringtone.pause();
  ringtone.currentTime = 0;
}

function sendDTMF(digit) {
  if (session && session.isInProgress()) {
    session.sendDTMF(digit);
    console.log(`Sent DTMF: ${digit}`);
  }
}

document.getElementById('phoneNumber').addEventListener('input', (event) => {
  const validChars = '0123456789*#';
  const input = event.target.value;
  const lastChar = input.slice(-1);
  if (validChars.includes(lastChar)) {
    sendDTMF(lastChar);
  } else {
    event.target.value = input.slice(0, -1); // Remove invalid character
  }
});

document.addEventListener('DOMContentLoaded', () => {
  initializeJsSIP();
  showCallDiv(); // Load call div by default on page load
});

document.getElementById('toggleButton').addEventListener('click', function () {
  var toggleDiv = document.getElementById('toggleDiv');
  var toggleButton = document.getElementById('toggleButton');
  var arrowIcon = toggleButton.querySelector('.arrow');

  if (toggleDiv.classList.contains('visible')) {
    toggleDiv.classList.remove('visible');
    toggleButton.style.top = '-5px'; // Butonu başlangıç konumuna getir
    toggleDiv.style.top = '-200px'; // Butonu başlangıç konumuna getir

    arrowIcon.classList.remove('arrow-up');
    arrowIcon.classList.add('arrow-down');
  } else {
    toggleDiv.classList.add('visible');
    toggleButton.style.top = '193px'; // Buton div ile birlikte hareket eder
    toggleDiv.style.top = '0px'; // Butonu başlangıç konumuna getir

    arrowIcon.classList.remove('arrow-down');
    arrowIcon.classList.add('arrow-up');
  }
});
