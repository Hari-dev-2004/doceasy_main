# DocEasy VideoCall

A simple video call application similar to Google Meet built with Flask, WebRTC (aiortc), SQLite, and TailwindCSS.

## Features

- Create and join video conference rooms
- Real-time video and audio communication
- Screen sharing functionality
- Room participant management
- Simple and intuitive UI

## Tech Stack

- **Frontend**: HTML, TailwindCSS, JavaScript
- **Backend**: Flask (Python)
- **Database**: SQLite
- **WebRTC**: aiortc (Python WebRTC library)
- **Real-time Communication**: Flask-SocketIO

## Installation

1. Clone the repository:
   ```
   git clone https://github.com/yourusername/doc-easy.git
   cd doc-easy
   ```

2. Create a virtual environment:
   ```
   python -m venv venv
   source venv/bin/activate  # On Windows: venv\Scripts\activate
   ```

3. Install the dependencies:
   ```
   pip install -r requirements.txt
   ```

4. Run the application:
   ```
   flask run
   ```
   Or for development with auto-reload:
   ```
   python app.py
   ```

5. Open your browser and navigate to `http://localhost:5000`

## Deployment on Render

This application is configured for deployment on Render:

1. Create a new Web Service on Render
2. Link your GitHub repository
3. Use the following settings:
   - Build Command: `chmod +x build.sh && ./build.sh`
   - Start Command: `gunicorn --worker-class eventlet -w 1 app:app`
   - Environment Variables:
     - `SECRET_KEY`: Your secure secret key
     - `ENVIRONMENT`: production
   - Advanced Settings:
     - Runtime Environment: Ubuntu
     - Choose a plan that supports custom Ubuntu packages (e.g., Standard)

## Project Structure

```
doc-easy/
│
├── app.py                 # Main application file
├── requirements.txt       # Python dependencies
├── build.sh               # Build script for Render deployment
├── render.yaml            # Render deployment configuration
│
├── static/                # Static assets
│   └── js/
│       └── webrtc.js      # WebRTC implementation
│
├── templates/             # HTML templates
│   ├── base.html          # Base template
│   ├── index.html         # Home page
│   └── room.html          # Video call room
│
└── migrations/            # Database migrations
```

## License

MIT License

## Author

Your Name

## Acknowledgements

- [Flask](https://flask.palletsprojects.com/)
- [aiortc](https://github.com/aiortc/aiortc)
- [TailwindCSS](https://tailwindcss.com/)
- [Socket.IO](https://socket.io/) 