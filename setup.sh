#!/usr/bin/env bash
set -eu
if ! command -v ffmpeg >/dev/null; then
  sudo apt-get update
  sudo apt-get install -y ffmpeg
fi
if ! python3 -m venv .venv; then
  sudo apt-get update
  sudo apt-get install -y python3-venv
  python3 -m venv .venv
fi
.venv/bin/python -m pip install --upgrade 'yt-dlp[default]'
npm install
if [ ! -e .env ]; then cp .env.example .env; fi
