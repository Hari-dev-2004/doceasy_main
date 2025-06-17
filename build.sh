#!/usr/bin/env bash
# Exit on error
set -o errexit

# Install FFmpeg dependencies
apt-get update -y
apt-get install -y --no-install-recommends \
    ffmpeg \
    libavformat-dev \
    libavcodec-dev \
    libavdevice-dev \
    libavutil-dev \
    libavfilter-dev \
    libswscale-dev \
    libswresample-dev \
    pkg-config

# Install Python dependencies
pip install -r requirements.txt 