import os
import json
import uuid
import logging
from datetime import datetime

from flask import Flask, render_template, request, jsonify, redirect, url_for, session
from flask_sqlalchemy import SQLAlchemy
from flask_migrate import Migrate
from flask_cors import CORS
from flask_socketio import SocketIO, emit, join_room, leave_room

# Configure logging
logging.basicConfig(
    level=logging.DEBUG,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Initialize Flask app
app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('SECRET_KEY', 'default_secret_key')
app.config['SQLALCHEMY_DATABASE_URI'] = os.environ.get('DATABASE_URL', 'sqlite:///videocall.db')
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False

# Initialize extensions
db = SQLAlchemy(app)
migrate = Migrate(app, db)
# Initialize SocketIO with more compatible settings
socketio = SocketIO(
    app, 
    cors_allowed_origins="*",
    ping_timeout=60,
    ping_interval=25,
    manage_session=False,
    logger=True,
    engineio_logger=True
)
CORS(app)

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
    try:
        # Check if user is authenticated
        if 'user_id' not in session:
            logger.warning("User not in session, redirecting to index")
            return redirect(url_for('index'))
        
        # Get room data
        room = Room.query.get(room_id)
        if not room:
            logger.warning(f"Room {room_id} not found, redirecting to index")
            return redirect(url_for('index'))
        
        # Get participants
        participants = Participant.query.filter_by(room_id=room_id).all()
        
        # If current user is not in participants, add them
        participant_ids = [p.id for p in participants]
        if session['user_id'] not in participant_ids:
            logger.info(f"Adding user {session['user_id']} to room {room_id}")
            participant = Participant(
                id=session['user_id'], 
                name=session['user_name'], 
                room_id=room_id
            )
            db.session.add(participant)
            db.session.commit()
            participants = Participant.query.filter_by(room_id=room_id).all()
        
        logger.info(f"User {session['user_id']} joined room {room_id} with {len(participants)} participants")
        
        return render_template('room.html', 
                              room=room.to_dict(), 
                              participants=[p.to_dict() for p in participants],
                              current_user={"id": session['user_id'], "name": session['user_name']})
    except Exception as e:
        logger.error(f"Error accessing room {room_id}: {str(e)}")
        return redirect(url_for('index'))

@app.route('/api/rooms')
def get_rooms():
    rooms = Room.query.all()
    return jsonify([room.to_dict() for room in rooms])

@app.route('/api/room/<room_id>/participants')
def get_participants(room_id):
    participants = Participant.query.filter_by(room_id=room_id).all()
    return jsonify([participant.to_dict() for participant in participants])

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

@socketio.on('signal')
def handle_signal(data):
    target_id = data.get('target')
    user_id = session.get('user_id')
    signal_data = data.get('signal')
    
    if target_id and user_id and signal_data:
        emit('signal', {
            'user_id': user_id,
            'signal': signal_data
        }, room=target_id)
        logger.info(f"Signal sent from {user_id} to {target_id}")

# Create database tables
with app.app_context():
    db.create_all()

# Start the server
if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    if os.environ.get('ENVIRONMENT') == 'production':
        socketio.run(app, host='0.0.0.0', port=port, ssl_context='adhoc')
    else:
        socketio.run(app, host='0.0.0.0', port=port, debug=True) 