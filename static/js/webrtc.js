// WebRTC configuration
const peerConnections = {};
const mediaConstraints = {
    audio: true,
    video: {
        width: { ideal: 1280 },
        height: { ideal: 720 },
        facingMode: 'user'
    }
};

// ICE servers configuration with more STUN/TURN options for better connectivity
const iceServers = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' },
        { urls: 'stun:stun3.l.google.com:19302' },
        { urls: 'stun:stun4.l.google.com:19302' },
        { urls: 'stun:stun.stunprotocol.org:3478' },
        { 
            urls: 'turn:numb.viagenie.ca',
            username: 'webrtc@live.com',
            credential: 'muazkh'
        }
    ]
};

// Global variables
let socket;
let localStream;
let localVideo;
let screenStream;
let isScreenSharing = false;
let isAudioEnabled = true;
let isVideoEnabled = true;

// Debug function to log connection events
function logEvent(event, data) {
    const time = new Date().toLocaleTimeString();
    console.log(`[${time}] ${event}:`, data);
}

// Simple-peer for WebRTC handling
function createPeer(initiator, userId) {
    logEvent('Creating peer connection', { initiator, userId });
    
    const peer = new SimplePeer({
        initiator: initiator,
        stream: localStream,
        trickle: true,
        config: iceServers,
        sdpTransform: (sdp) => {
            logEvent('SDP Transform', { sdp });
            return sdp;
        }
    });

    // Handle signals
    peer.on('signal', data => {
        logEvent('Signaling', { to: userId, data });
        socket.emit('signal', {
            target: userId,
            signal: data
        });
    });

    // Handle incoming stream
    peer.on('stream', stream => {
        logEvent('Stream received', { from: userId });
        createRemoteVideo(userId, stream);
    });

    // Handle errors
    peer.on('error', err => {
        console.error('Peer connection error:', err);
        // Try to reconnect after error
        setTimeout(() => {
            if (peerConnections[userId]) {
                delete peerConnections[userId];
                const newPeer = createPeer(true, userId);
                peerConnections[userId] = newPeer;
            }
        }, 2000);
    });

    // Handle connection establishment
    peer.on('connect', () => {
        logEvent('Connected to peer', { userId });
        // Send a test message to confirm data channel works
        try {
            peer.send('connection-established');
        } catch (e) {
            console.warn('Could not send test message', e);
        }
    });

    // Handle close
    peer.on('close', () => {
        logEvent('Peer connection closed', { userId });
        if (peerConnections[userId]) {
            delete peerConnections[userId];
        }
    });

    peer.on('data', data => {
        logEvent('Data received', { from: userId, data: data.toString() });
    });

    return peer;
}

// Initialize WebRTC
function initWebRTC(roomId, userId, userName) {
    loadSimplePeerScript().then(() => {
        localVideo = document.getElementById('localVideo');
        
        // Connect to socket.io server with basic config
        socket = io.connect({
            reconnection: true
        });
        
        socket.on('connect', () => {
            logEvent('Connected to signaling server', {});
            
            // Join the room
            socket.emit('join', { room_id: roomId });
            
            // Setup event listeners
            setupSocketListeners(roomId, userId, userName);
            
            // Start local video
            initLocalStream();
        });

        socket.on('connect_error', (error) => {
            console.error('Connection error:', error);
            // Try to reconnect after a timeout
            setTimeout(() => {
                socket.connect();
            }, 5000);
        });

        socket.on('disconnect', (reason) => {
            console.warn('Disconnected from server:', reason);
        });
        
        // Set up control buttons
        setupControlButtons();
    }).catch(err => {
        console.error('Error loading SimplePeer:', err);
    });
}

// Load SimplePeer script dynamically
function loadSimplePeerScript() {
    return new Promise((resolve, reject) => {
        if (window.SimplePeer) {
            resolve();
            return;
        }

        const script = document.createElement('script');
        script.src = 'https://cdn.jsdelivr.net/npm/simple-peer@9/simplepeer.min.js';
        script.async = true;
        script.onload = () => resolve();
        script.onerror = reject;
        document.head.appendChild(script);
    });
}

// Initialize local media stream
async function initLocalStream() {
    try {
        localStream = await navigator.mediaDevices.getUserMedia(mediaConstraints);
        localVideo.srcObject = localStream;
        logEvent('Got local stream', {});
    } catch (e) {
        console.error('Error getting user media:', e);
        alert('Unable to access camera or microphone. Please check permissions.');
    }
}

// Set up socket event listeners
function setupSocketListeners(roomId, userId, userName) {
    // When a new user joins the room
    socket.on('user-joined', async (data) => {
        logEvent('User joined', data);
        
        // Update participant list
        addParticipantToList(data.user_id, data.user_name);
        
        // Small delay to ensure everything is ready
        setTimeout(() => {
            // Create peer connection as initiator
            const peer = createPeer(true, data.user_id);
            peerConnections[data.user_id] = peer;
        }, 1000);
    });
    
    // When receiving a signal
    socket.on('signal', data => {
        logEvent('Signal received', { from: data.user_id });
        const fromUserId = data.user_id;
        const signal = data.signal;

        // If we don't have a connection to this user yet, create one as non-initiator
        if (!peerConnections[fromUserId]) {
            logEvent('Creating non-initiator peer', { for: fromUserId });
            peerConnections[fromUserId] = createPeer(false, fromUserId);
        }

        // Signal the peer
        try {
            if (peerConnections[fromUserId] && !peerConnections[fromUserId].destroyed) {
                peerConnections[fromUserId].signal(signal);
            } else {
                logEvent('Peer connection destroyed or invalid', { for: fromUserId });
                // Recreate peer connection
                delete peerConnections[fromUserId];
                peerConnections[fromUserId] = createPeer(false, fromUserId);
                peerConnections[fromUserId].signal(signal);
            }
        } catch (e) {
            console.error('Error signaling peer:', e);
        }
    });
    
    // When a user leaves the room
    socket.on('user-left', (data) => {
        logEvent('User left', data);
        
        // Remove video element
        const videoElement = document.getElementById(`video-${data.user_id}`);
        if (videoElement) {
            videoElement.parentElement.remove();
        }
        
        // Remove from participant list
        removeParticipantFromList(data.user_id);
        
        // Close peer connection
        if (peerConnections[data.user_id]) {
            peerConnections[data.user_id].destroy();
            delete peerConnections[data.user_id];
        }
    });
}

// Create video element for remote peer
function createRemoteVideo(userId, stream) {
    logEvent('Creating remote video element', { for: userId });
    const videoGrid = document.getElementById('videoGrid');
    
    // Check if video already exists
    if (document.getElementById(`video-${userId}`)) {
        const videoElement = document.getElementById(`video-${userId}`);
        if (videoElement.srcObject !== stream) {
            videoElement.srcObject = stream;
            logEvent('Updated existing video stream', { for: userId });
        }
        return;
    }
    
    // Get user name from participant list
    const participantElement = document.querySelector(`#participantsList li[data-user-id="${userId}"]`);
    let userName = 'Unknown';
    if (participantElement) {
        userName = participantElement.textContent;
    }
    
    // Create new video container
    const videoContainer = document.createElement('div');
    videoContainer.className = 'video-container';
    
    // Create video element
    const videoElement = document.createElement('video');
    videoElement.id = `video-${userId}`;
    videoElement.autoplay = true;
    videoElement.playsInline = true;
    
    // Ensure the stream is properly set
    videoElement.srcObject = stream;
    videoElement.onloadedmetadata = () => {
        videoElement.play().catch(e => {
            console.error('Error playing video:', e);
        });
    };
    
    // Create name label
    const nameLabel = document.createElement('div');
    nameLabel.className = 'video-name';
    nameLabel.textContent = userName;
    
    videoContainer.appendChild(videoElement);
    videoContainer.appendChild(nameLabel);
    videoGrid.appendChild(videoContainer);
    
    logEvent('Remote video added', { for: userId });
}

// Add participant to list
function addParticipantToList(userId, userName) {
    const participantsList = document.getElementById('participantsList');
    
    // Check if participant already exists
    if (document.querySelector(`#participantsList li[data-user-id="${userId}"]`)) {
        return;
    }
    
    // Create list item
    const listItem = document.createElement('li');
    listItem.className = 'py-2';
    listItem.setAttribute('data-user-id', userId);
    listItem.textContent = userName;
    
    participantsList.appendChild(listItem);
    
    // Update participant count
    updateParticipantCount();
}

// Remove participant from list
function removeParticipantFromList(userId) {
    const participantElement = document.querySelector(`#participantsList li[data-user-id="${userId}"]`);
    if (participantElement) {
        participantElement.remove();
        updateParticipantCount();
    }
}

// Update participant count
function updateParticipantCount() {
    const count = document.querySelectorAll('#participantsList li').length;
    document.getElementById('participantsCount').textContent = count;
}

// Setup control buttons
function setupControlButtons() {
    // Toggle video
    const toggleVideoBtn = document.getElementById('toggleVideoBtn');
    if (toggleVideoBtn) {
        toggleVideoBtn.addEventListener('click', () => {
            isVideoEnabled = !isVideoEnabled;
            
            // Toggle local video tracks
            localStream.getVideoTracks().forEach(track => {
                track.enabled = isVideoEnabled;
            });
            
            // Update button appearance
            toggleVideoBtn.classList.toggle('bg-red-600', !isVideoEnabled);
            toggleVideoBtn.classList.toggle('bg-blue-600', isVideoEnabled);
        });
    }
    
    // Toggle audio
    const toggleAudioBtn = document.getElementById('toggleAudioBtn');
    if (toggleAudioBtn) {
        toggleAudioBtn.addEventListener('click', () => {
            isAudioEnabled = !isAudioEnabled;
            
            // Toggle local audio tracks
            localStream.getAudioTracks().forEach(track => {
                track.enabled = isAudioEnabled;
            });
            
            // Update button appearance
            toggleAudioBtn.classList.toggle('bg-red-600', !isAudioEnabled);
            toggleAudioBtn.classList.toggle('bg-blue-600', isAudioEnabled);
        });
    }
    
    // Toggle screen sharing
    const toggleScreenShareBtn = document.getElementById('toggleScreenShareBtn');
    if (toggleScreenShareBtn) {
        toggleScreenShareBtn.addEventListener('click', async () => {
            if (isScreenSharing) {
                // Stop screen sharing
                stopScreenSharing();
                toggleScreenShareBtn.classList.remove('bg-red-600');
                toggleScreenShareBtn.classList.add('bg-green-600');
            } else {
                // Start screen sharing
                try {
                    screenStream = await navigator.mediaDevices.getDisplayMedia({
                        video: true
                    });
                    
                    // Replace video track with screen track
                    const videoTrack = screenStream.getVideoTracks()[0];
                    
                    // Replace track in all peer connections
                    for (const userId in peerConnections) {
                        if (peerConnections[userId] && !peerConnections[userId].destroyed) {
                            try {
                                peerConnections[userId].replaceTrack(
                                    localStream.getVideoTracks()[0],
                                    videoTrack,
                                    localStream
                                );
                            } catch (e) {
                                console.error('Error replacing track:', e);
                            }
                        }
                    }
                    
                    // Show screen share in local video
                    localVideo.srcObject = screenStream;
                    
                    // Listen for the end of screen sharing
                    videoTrack.onended = () => {
                        stopScreenSharing();
                        toggleScreenShareBtn.classList.remove('bg-red-600');
                        toggleScreenShareBtn.classList.add('bg-green-600');
                    };
                    
                    isScreenSharing = true;
                    toggleScreenShareBtn.classList.remove('bg-green-600');
                    toggleScreenShareBtn.classList.add('bg-red-600');
                } catch (e) {
                    console.error('Error starting screen sharing:', e);
                }
            }
        });
    }
}

// Stop screen sharing
function stopScreenSharing() {
    if (screenStream) {
        screenStream.getTracks().forEach(track => track.stop());
        screenStream = null;
    }
    
    // Restore camera as video source
    if (localStream) {
        const videoTrack = localStream.getVideoTracks()[0];
        
        if (videoTrack) {
            // Replace track in all peer connections
            for (const userId in peerConnections) {
                if (peerConnections[userId] && !peerConnections[userId].destroyed && peerConnections[userId].replaceTrack) {
                    try {
                        const senders = peerConnections[userId].getSenders();
                        const sender = senders.find(s => s.track && s.track.kind === 'video');
                        if (sender) {
                            sender.replaceTrack(videoTrack);
                        }
                    } catch (e) {
                        console.error('Error replacing track during screen share stop:', e);
                    }
                }
            }
            
            // Show camera in local video
            localVideo.srcObject = localStream;
        }
    }
    
    isScreenSharing = false;
}

// Force reconnection of all peers
function reconnectAllPeers() {
    logEvent('Force reconnecting all peers', {});
    
    // Close all existing connections
    for (const userId in peerConnections) {
        if (peerConnections[userId]) {
            try {
                peerConnections[userId].destroy();
            } catch (e) {
                console.error('Error destroying peer connection:', e);
            }
            delete peerConnections[userId];
        }
    }
    
    // Get room ID and emit rejoin event
    const roomId = document.querySelector('meta[name="room-id"]').getAttribute('content');
    socket.emit('join', { room_id: roomId });
}

// Add a reconnection button
window.addEventListener('load', () => {
    const controlsDiv = document.querySelector('.flex.space-x-2');
    if (controlsDiv) {
        const reconnectBtn = document.createElement('button');
        reconnectBtn.id = 'reconnectBtn';
        reconnectBtn.className = 'px-3 py-1 bg-yellow-600 hover:bg-yellow-700 rounded text-sm';
        reconnectBtn.textContent = 'Reconnect';
        reconnectBtn.addEventListener('click', reconnectAllPeers);
        controlsDiv.appendChild(reconnectBtn);
    }
});

// Export the initWebRTC function
window.initWebRTC = initWebRTC; 