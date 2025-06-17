import os
import json
import uuid
import asyncio
import logging
from pathlib import Path
from datetime import datetime
from threading import Thread

from flask import Flask, render_template, request, jsonify, redirect, url_for, session
from flask_sqlalchemy import SQLAlchemy
from flask_migrate import Migrate
from flask_cors import CORS
from flask_socketio import SocketIO, emit, join_room, leave_room

import ssl
from aiohttp import web
from aiortc import RTCPeerConnection, RTCSessionDescription, MediaStreamTrack, RTCIceCandidate
from aiortc.contrib.media import MediaRelay

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Initialize Flask app
app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('SECRET_KEY', 'default_secret_key')
app.config['SQLALCHEMY_DATABASE_URI'] = os.environ.get('DATABASE_URL', 'sqlite:///videocall.db')
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False

# Initialize extensions
db = SQLAlchemy(app)
migrate = Migrate(app, db)
socketio = SocketIO(app, cors_allowed_origins="*")
CORS(app)

# WebRTC setup
relay = MediaRelay()
peer_connections = {}
ice_candidates = {}

# Define models
class Room(db.Model):
    id = db.Column(db.String(36), primary_key=True)
    name = db.Column(db.String(100), nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    host_id = db.Column(db.String(36), nullable=False)
    
    def to_dict(self):
        return {
            'id': self.id,
            'name': self.name,
            'created_at': self.created_at.isoformat(),
            'host_id': self.host_id
        }

class Participant(db.Model):
    id = db.Column(db.String(36), primary_key=True)
    name = db.Column(db.String(100), nullable=False)
    room_id = db.Column(db.String(36), db.ForeignKey('room.id'), nullable=False)
    joined_at = db.Column(db.DateTime, default=datetime.utcnow)
    
    def to_dict(self):
        return {
            'id': self.id,
            'name': self.name,
            'room_id': self.room_id,
            'joined_at': self.joined_at.isoformat()
        }

# WebRTC signaling handlers
async def process_offer(pc, offer, user_id, room_id):
    await pc.setRemoteDescription(RTCSessionDescription(sdp=offer["sdp"], type=offer["type"]))
    answer = await pc.createAnswer()
    await pc.setLocalDescription(answer)
    
    return {"sdp": pc.localDescription.sdp, "type": pc.localDescription.type}

# Flask routes
@app.route('/')
def index():
    return render_template('index.html')

@app.route('/create-room', methods=['POST'])
def create_room():
    data = request.json
    room_name = data.get('room_name')
    user_name = data.get('user_name')
    
    if not room_name or not user_name:
        return jsonify({"error": "Room name and user name are required"}), 400
    
    room_id = str(uuid.uuid4())
    user_id = str(uuid.uuid4())
    
    room = Room(id=room_id, name=room_name, host_id=user_id)
    participant = Participant(id=user_id, name=user_name, room_id=room_id)
    
    db.session.add(room)
    db.session.add(participant)
    db.session.commit()
    
    session['user_id'] = user_id
    session['user_name'] = user_name
    session['room_id'] = room_id
    
    return jsonify({"room_id": room_id, "user_id": user_id})

@app.route('/join-room', methods=['POST'])
def join_room_endpoint():
    data = request.json
    room_id = data.get('room_id')
    user_name = data.get('user_name')
    
    if not room_id or not user_name:
        return jsonify({"error": "Room ID and user name are required"}), 400
    
    room = Room.query.get(room_id)
    if not room:
        return jsonify({"error": "Room not found"}), 404
    
    user_id = str(uuid.uuid4())
    participant = Participant(id=user_id, name=user_name, room_id=room_id)
    
    db.session.add(participant)
    db.session.commit()
    
    session['user_id'] = user_id
    session['user_name'] = user_name
    session['room_id'] = room_id
    
    return jsonify({"room_id": room_id, "user_id": user_id})

@app.route('/room/<room_id>')
def room(room_id):
    if 'user_id' not in session:
        return redirect(url_for('index'))
    
    room = Room.query.get(room_id)
    if not room:
        return redirect(url_for('index'))
    
    participants = Participant.query.filter_by(room_id=room_id).all()
    
    return render_template('room.html', 
                          room=room.to_dict(), 
                          participants=[p.to_dict() for p in participants],
                          current_user={"id": session['user_id'], "name": session['user_name']})

@app.route('/api/rooms')
def get_rooms():
    rooms = Room.query.all()
    return jsonify([room.to_dict() for room in rooms])

@app.route('/api/room/<room_id>/participants')
def get_participants(room_id):
    participants = Participant.query.filter_by(room_id=room_id).all()
    return jsonify([participant.to_dict() for participant in participants])

# WebRTC signaling endpoints
@app.route('/api/offer', methods=['POST'])
def handle_offer():
    data = request.json
    offer = data.get('offer')
    target_id = data.get('target')
    user_id = session.get('user_id')
    room_id = session.get('room_id')
    
    if not offer or not target_id or not user_id or not room_id:
        return jsonify({"error": "Invalid request"}), 400
    
    socketio.emit('offer', {
        'offer': offer,
        'from': user_id
    }, room=target_id)
    
    return jsonify({"success": True})

@app.route('/api/answer', methods=['POST'])
def handle_answer():
    data = request.json
    answer = data.get('answer')
    target_id = data.get('target')
    user_id = session.get('user_id')
    
    if not answer or not target_id or not user_id:
        return jsonify({"error": "Invalid request"}), 400
    
    socketio.emit('answer', {
        'answer': answer,
        'from': user_id
    }, room=target_id)
    
    return jsonify({"success": True})

@app.route('/api/ice-candidate', methods=['POST'])
def handle_ice_candidate():
    data = request.json
    candidate = data.get('candidate')
    target_id = data.get('target')
    user_id = session.get('user_id')
    
    if not candidate or not target_id or not user_id:
        return jsonify({"error": "Invalid request"}), 400
    
    socketio.emit('ice-candidate', {
        'candidate': candidate,
        'from': user_id
    }, room=target_id)
    
    return jsonify({"success": True})

# Socket.IO events
@socketio.on('connect')
def handle_connect():
    user_id = session.get('user_id')
    if user_id:
        join_room(user_id)
        logger.info(f"User {user_id} connected")

@socketio.on('join')
def handle_join(data):
    room_id = data.get('room_id')
    user_id = session.get('user_id')
    user_name = session.get('user_name')
    
    if room_id and user_id:
        join_room(room_id)
        emit('user-joined', {
            'user_id': user_id,
            'user_name': user_name
        }, room=room_id, include_self=False)
        
        logger.info(f"User {user_id} joined room {room_id}")

@socketio.on('leave')
def handle_leave(data):
    room_id = data.get('room_id')
    user_id = session.get('user_id')
    
    if room_id and user_id:
        emit('user-left', {
            'user_id': user_id
        }, room=room_id, include_self=False)
        
        leave_room(room_id)
        logger.info(f"User {user_id} left room {room_id}")

# Create database tables
with app.app_context():
    db.create_all()

# Start the server with SSL if in production
if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    if os.environ.get('ENVIRONMENT') == 'production':
        socketio.run(app, host='0.0.0.0', port=port, ssl_context='adhoc')
    else:
        socketio.run(app, host='0.0.0.0', port=port, debug=True) 