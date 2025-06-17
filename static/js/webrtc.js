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

// ICE servers configuration
const iceServers = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' },
        { urls: 'stun:stun3.l.google.com:19302' },
        { urls: 'stun:stun4.l.google.com:19302' }
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

// Simple-peer for WebRTC handling
function createPeer(initiator, userId) {
    const peer = new SimplePeer({
        initiator: initiator,
        stream: localStream,
        trickle: true,
        config: iceServers,
        reconnectTimer: 1000,
        iceTransportPolicy: 'all',
        sdpTransform: (sdp) => {
            // Set high priority for audio to improve call quality
            return sdp.replace('a=group:BUNDLE 0 1', 'a=group:BUNDLE 1 0');
        }
    });

    // Handle signals
    peer.on('signal', data => {
        socket.emit('signal', {
            target: userId,
            signal: data
        });
    });

    // Handle incoming stream
    peer.on('stream', stream => {
        createRemoteVideo(userId, stream);
    });

    // Handle errors
    peer.on('error', err => {
        console.error('Peer error:', err);
    });

    // Handle close
    peer.on('close', () => {
        console.log('Peer connection closed with', userId);
        if (peerConnections[userId]) {
            delete peerConnections[userId];
        }
    });

    return peer;
}

// Initialize WebRTC
function initWebRTC(roomId, userId, userName) {
    loadSimplePeerScript().then(() => {
        localVideo = document.getElementById('localVideo');
        
            // Connect to socket.io server with reliability options
    socket = io.connect({
        reconnection: true,
        reconnectionAttempts: 5,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 5000,
        timeout: 20000,
        transports: ['websocket']
    });
        
        socket.on('connect', () => {
            console.log('Connected to socket.io server');
            
            // Join the room
            socket.emit('join', { room_id: roomId });
            
            // Setup event listeners
            setupSocketListeners(roomId, userId, userName);
            
            // Start local video
            initLocalStream();
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
        console.log('Got local stream');
    } catch (e) {
        console.error('Error getting user media:', e);
        alert('Unable to access camera or microphone. Please check permissions.');
    }
}

// Set up socket event listeners
function setupSocketListeners(roomId, userId, userName) {
    // When a new user joins the room
    socket.on('user-joined', async (data) => {
        console.log('User joined:', data);
        
        // Update participant list
        addParticipantToList(data.user_id, data.user_name);
        
        // Create peer connection as initiator
        const peer = createPeer(true, data.user_id);
        peerConnections[data.user_id] = peer;
    });
    
    // When receiving a signal
    socket.on('signal', data => {
        const fromUserId = data.user_id;
        const signal = data.signal;

        // If we don't have a connection to this user yet, create one as non-initiator
        if (!peerConnections[fromUserId]) {
            peerConnections[fromUserId] = createPeer(false, fromUserId);
        }

        // Signal the peer
        try {
            peerConnections[fromUserId].signal(signal);
        } catch (e) {
            console.error('Error signaling peer:', e);
        }
    });
    
    // When a user leaves the room
    socket.on('user-left', (data) => {
        console.log('User left:', data);
        
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
    const videoGrid = document.getElementById('videoGrid');
    
    // Check if video already exists
    if (document.getElementById(`video-${userId}`)) {
        const videoElement = document.getElementById(`video-${userId}`);
        videoElement.srcObject = stream;
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
    videoElement.srcObject = stream;
    
    // Create name label
    const nameLabel = document.createElement('div');
    nameLabel.className = 'video-name';
    nameLabel.textContent = userName;
    
    videoContainer.appendChild(videoElement);
    videoContainer.appendChild(nameLabel);
    videoGrid.appendChild(videoContainer);
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
                        peerConnections[userId].replaceTrack(
                            localStream.getVideoTracks()[0],
                            videoTrack,
                            localStream
                        );
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
                if (peerConnections[userId].replaceTrack) {
                    const senders = peerConnections[userId].getSenders();
                    const sender = senders.find(s => s.track && s.track.kind === 'video');
                    if (sender) {
                        sender.replaceTrack(videoTrack);
                    }
                }
            }
            
            // Show camera in local video
            localVideo.srcObject = localStream;
        }
    }
    
    isScreenSharing = false;
}

// Export the initWebRTC function
window.initWebRTC = initWebRTC; 