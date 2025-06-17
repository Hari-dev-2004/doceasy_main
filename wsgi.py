from app import app, socketio

# This is the WSGI entry point that gunicorn will use
application = app

if __name__ == "__main__":
    socketio.run(app) 