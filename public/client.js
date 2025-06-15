let ws = null;
let currentRoom = null;
let username = null;

// WebRTC variables
let localStream = null;
let peerConnection = null;
let isVideoEnabled = true;
let isAudioEnabled = true;
let isInitiator = false;
let isCallStarted = false;
let iceCandidateQueue = [];
let remoteDescriptionSet = false;

// WebRTC configuration
const configuration = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' }
    ]
};

function joinRoom() {
    const roomId = document.getElementById('room-id').value.trim();
    username = document.getElementById('username').value.trim();

    if (!roomId || !username) {
        alert('Please enter both room ID and username');
        return;
    }

    // Create WebSocket connection
    ws = new WebSocket(`ws://${window.location.host}`);

    ws.onopen = () => {
        // Send join message
        ws.send(JSON.stringify({
            type: 'join',
            roomId: roomId,
            username: username
        }));

        // Update UI
        currentRoom = roomId;
        document.getElementById('join-container').style.display = 'none';
        document.getElementById('chat-container').style.display = 'block';
        document.getElementById('current-room').textContent = roomId;
    };

    ws.onmessage = async (event) => {
        const data = JSON.parse(event.data);
        console.log('Received message:', data);
        
        if (data.type === 'message' || data.type === 'system') {
            displayMessage(data);
        } else if (data.type === 'video-offer') {
            await handleVideoOffer(data);
        } else if (data.type === 'video-answer') {
            await handleVideoAnswer(data);
        } else if (data.type === 'ice-candidate') {
            await handleIceCandidate(data);
        } else if (data.type === 'user-joined') {
            handleUserJoined(data);
        } else if (data.type === 'call-request') {
            handleCallRequest(data);
        }
    };

    ws.onclose = () => {
        alert('Connection closed. Please refresh the page to reconnect.');
    };
}

function leaveRoom() {
    if (ws) {
        ws.close();
    }
    endCall();
    currentRoom = null;
    document.getElementById('join-container').style.display = 'block';
    document.getElementById('chat-container').style.display = 'none';
    document.getElementById('messages').innerHTML = '';
    document.getElementById('room-id').value = '';
    document.getElementById('username').value = '';
}

function sendMessage() {
    const messageInput = document.getElementById('message-input');
    const message = messageInput.value.trim();

    if (message && ws && currentRoom) {
        ws.send(JSON.stringify({
            type: 'message',
            message: message,
            sender: username
        }));
        messageInput.value = '';
    }
}

function displayMessage(data) {
    const messagesDiv = document.getElementById('messages');
    const messageElement = document.createElement('div');

    if (data.type === 'system') {
        messageElement.className = 'system-message';
        messageElement.textContent = data.message;
    } else {
        messageElement.className = `message ${data.sender === username ? 'sent' : 'received'}`;
        messageElement.textContent = `${data.sender}: ${data.message}`;
    }

    messagesDiv.appendChild(messageElement);
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
}

// Video Call Functions
async function toggleVideoCall() {
    const videoContainer = document.getElementById('video-container');
    if (videoContainer.style.display === 'none') {
        await startVideoCall();
    } else {
        endCall();
    }
}

async function startVideoCall() {
    try {
        localStream = await navigator.mediaDevices.getUserMedia({
            video: true,
            audio: true
        });

        document.getElementById('local-video').srcObject = localStream;
        document.getElementById('video-container').style.display = 'block';
        document.getElementById('video-call-btn').textContent = 'End Video Call';

        // Send call request to all users in the room
        ws.send(JSON.stringify({
            type: 'call-request',
            sender: username
        }));

        isCallStarted = true;
    } catch (error) {
        console.error('Error starting video call:', error);
        alert('Error accessing camera and microphone. Please ensure you have granted the necessary permissions.');
    }
}

function handleUserJoined(data) {
    console.log('User joined:', data);
    // Add delay to ensure peer is ready
    if (isCallStarted && !isInitiator) {
        setTimeout(() => {
            initiateCall();
        }, 1000);
    }
}

function handleCallRequest(data) {
    console.log('Call request received:', data);
    if (!isCallStarted) {
        const accept = confirm(`${data.sender} wants to start a video call. Accept?`);
        if (accept) {
            startVideoCall();
        }
    }
}

async function initiateCall() {
    console.log('Initiating call...');
    isInitiator = true;
    
    if (!peerConnection) {
        createPeerConnection();
    }
    
    // Always add tracks to ensure they're properly added
    localStream.getTracks().forEach(track => {
        peerConnection.addTrack(track, localStream);
    });

    try {
        const offer = await peerConnection.createOffer();
        await peerConnection.setLocalDescription(offer);
        
        ws.send(JSON.stringify({
            type: 'video-offer',
            sdp: peerConnection.localDescription,
            sender: username
        }));
    } catch (error) {
        console.error('Error creating offer:', error);
    }
}

function createPeerConnection() {
    if (peerConnection) {
        peerConnection.close();
    }

    peerConnection = new RTCPeerConnection(configuration);

    peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
            console.log('Sending ICE candidate');
            ws.send(JSON.stringify({
                type: 'ice-candidate',
                candidate: event.candidate,
                sender: username
            }));
        }
    };

    peerConnection.ontrack = (event) => {
        console.log('Received remote track:', event);
        if (!event.streams[0]) {
            console.warn("No remote stream available in ontrack");
            return;
        }
        const remoteVideo = document.getElementById('remote-video');
        if (remoteVideo.srcObject !== event.streams[0]) {
            remoteVideo.srcObject = event.streams[0];
        }
    };

    // Add comprehensive connection state logging
    peerConnection.oniceconnectionstatechange = () => {
        console.log('ICE Connection State:', peerConnection.iceConnectionState);
        if (peerConnection.iceConnectionState === 'disconnected' || 
            peerConnection.iceConnectionState === 'failed' || 
            peerConnection.iceConnectionState === 'closed') {
            endCall();
        }
    };

    peerConnection.onconnectionstatechange = () => {
        console.log('Connection State:', peerConnection.connectionState);
    };

    peerConnection.onsignalingstatechange = () => {
        console.log('Signaling State:', peerConnection.signalingState);
    };

    return peerConnection;
}

async function handleVideoOffer(data) {
    console.log('Received video offer:', data);
    
    // Ensure the call is started and local stream is available
    if (!isCallStarted) {
        await startVideoCall();
    }
    
    // Create peer connection if it doesn't exist
    if (!peerConnection) {
        createPeerConnection();
    }
    
    // Always add tracks to ensure they're properly added
    localStream.getTracks().forEach(track => {
        peerConnection.addTrack(track, localStream);
    });
    
    try {
        // Set the remote description (offer) received from the initiator
        await peerConnection.setRemoteDescription(new RTCSessionDescription(data.sdp));
        remoteDescriptionSet = true;

        // Add queued ICE candidates
        for (let candidate of iceCandidateQueue) {
            await peerConnection.addIceCandidate(candidate);
        }
        iceCandidateQueue = [];
        
        // Create and set the local description (answer)
        const answer = await peerConnection.createAnswer();
        await peerConnection.setLocalDescription(answer);
        
        // Send the answer back to the initiator
        ws.send(JSON.stringify({
            type: 'video-answer',
            sdp: peerConnection.localDescription,
            sender: username
        }));
    } catch (error) {
        console.error('Error handling video offer:', error);
    }
}

async function handleVideoAnswer(data) {
    console.log('Received video answer:', data);
    try {
        if (peerConnection) {
            await peerConnection.setRemoteDescription(new RTCSessionDescription(data.sdp));
            remoteDescriptionSet = true;

            // Add queued ICE candidates
            for (let candidate of iceCandidateQueue) {
                await peerConnection.addIceCandidate(candidate);
            }
            iceCandidateQueue = [];
        }
    } catch (error) {
        console.error('Error handling video answer:', error);
    }
}

async function handleIceCandidate(data) {
    console.log('Received ICE candidate:', data);
    try {
        const candidate = new RTCIceCandidate(data.candidate);
        if (remoteDescriptionSet && peerConnection) {
            await peerConnection.addIceCandidate(candidate);
        } else {
            iceCandidateQueue.push(candidate);
        }
    } catch (error) {
        console.error('Error handling ICE candidate:', error);
    }
}

function endCall() {
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
        localStream = null;
    }

    if (peerConnection) {
        peerConnection.close();
        peerConnection = null;
    }

    document.getElementById('local-video').srcObject = null;
    document.getElementById('remote-video').srcObject = null;
    document.getElementById('video-container').style.display = 'none';
    document.getElementById('video-call-btn').textContent = 'Start Video Call';
    isInitiator = false;
    isCallStarted = false;
    remoteDescriptionSet = false;
    iceCandidateQueue = [];
}

function toggleVideo() {
    if (localStream) {
        const videoTrack = localStream.getVideoTracks()[0];
        if (videoTrack) {
            videoTrack.enabled = !videoTrack.enabled;
            isVideoEnabled = videoTrack.enabled;
            document.getElementById('toggle-video').textContent = 
                isVideoEnabled ? 'Toggle Video' : 'Enable Video';
        }
    }
}

function toggleAudio() {
    if (localStream) {
        const audioTrack = localStream.getAudioTracks()[0];
        if (audioTrack) {
            audioTrack.enabled = !audioTrack.enabled;
            isAudioEnabled = audioTrack.enabled;
            document.getElementById('toggle-audio').textContent = 
                isAudioEnabled ? 'Toggle Audio' : 'Enable Audio';
        }
    }
}

// Handle Enter key in message input
document.getElementById('message-input').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        sendMessage();
    }
}); 