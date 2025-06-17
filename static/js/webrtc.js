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

// Initialize WebRTC
function initWebRTC(roomId, userId, userName) {
    localVideo = document.getElementById('localVideo');
    
    // Connect to socket.io server
    socket = io.connect();
    
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
        
        // Create peer connection for the new user
        const peerConnection = createPeerConnection(data.user_id);
        
        // Add local stream to peer connection
        localStream.getTracks().forEach(track => {
            peerConnection.addTrack(track, localStream);
        });
        
        // Create and send offer
        try {
            const offer = await peerConnection.createOffer();
            await peerConnection.setLocalDescription(offer);
            
            // Send offer to the new user
            sendOffer(data.user_id, peerConnection.localDescription);
        } catch (e) {
            console.error('Error creating offer:', e);
        }
    });
    
    // When receiving an offer
    socket.on('offer', async (data) => {
        console.log('Received offer from:', data.from);
        
        // Create peer connection if it doesn't exist
        if (!peerConnections[data.from]) {
            peerConnections[data.from] = createPeerConnection(data.from);
            
            // Add local stream to peer connection
            localStream.getTracks().forEach(track => {
                peerConnections[data.from].addTrack(track, localStream);
            });
        }
        
        const peerConnection = peerConnections[data.from];
        
        try {
            // Set remote description (the offer)
            await peerConnection.setRemoteDescription(new RTCSessionDescription(data.offer));
            
            // Create answer
            const answer = await peerConnection.createAnswer();
            await peerConnection.setLocalDescription(answer);
            
            // Send answer
            sendAnswer(data.from, peerConnection.localDescription);
        } catch (e) {
            console.error('Error handling offer:', e);
        }
    });
    
    // When receiving an answer
    socket.on('answer', async (data) => {
        console.log('Received answer from:', data.from);
        
        const peerConnection = peerConnections[data.from];
        if (peerConnection) {
            try {
                await peerConnection.setRemoteDescription(new RTCSessionDescription(data.answer));
            } catch (e) {
                console.error('Error handling answer:', e);
            }
        }
    });
    
    // When receiving ICE candidates
    socket.on('ice-candidate', async (data) => {
        console.log('Received ICE candidate from:', data.from);
        
        const peerConnection = peerConnections[data.from];
        if (peerConnection) {
            try {
                await peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
            } catch (e) {
                console.error('Error adding ICE candidate:', e);
            }
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
            peerConnections[data.user_id].close();
            delete peerConnections[data.user_id];
        }
    });
}

// Create RTCPeerConnection
function createPeerConnection(userId) {
    const peerConnection = new RTCPeerConnection(iceServers);
    
    peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
            sendIceCandidate(userId, event.candidate);
        }
    };
    
    peerConnection.ontrack = (event) => {
        if (event.streams && event.streams[0]) {
            createRemoteVideo(userId, event.streams[0]);
        }
    };
    
    peerConnections[userId] = peerConnection;
    return peerConnection;
}

// Send offer to peer
function sendOffer(userId, offer) {
    fetch('/api/offer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            target: userId,
            offer: offer
        })
    }).catch(e => console.error('Error sending offer:', e));
}

// Send answer to peer
function sendAnswer(userId, answer) {
    fetch('/api/answer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            target: userId,
            answer: answer
        })
    }).catch(e => console.error('Error sending answer:', e));
}

// Send ICE candidate to peer
function sendIceCandidate(userId, candidate) {
    fetch('/api/ice-candidate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            target: userId,
            candidate: candidate
        })
    }).catch(e => console.error('Error sending ICE candidate:', e));
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
                        const sender = peerConnections[userId]
                            .getSenders()
                            .find(s => s.track && s.track.kind === 'video');
                            
                        if (sender) {
                            sender.replaceTrack(videoTrack);
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
                const sender = peerConnections[userId]
                    .getSenders()
                    .find(s => s.track && s.track.kind === 'video');
                    
                if (sender) {
                    sender.replaceTrack(videoTrack);
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