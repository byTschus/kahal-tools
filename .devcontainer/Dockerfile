FROM node:22-bookworm

# ffmpeg + yt-dlp, damit der Podcast-Worker auch direkt im Dev-Container getestet werden kann
RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg python3 python3-pip git default-mysql-client \
  && pip3 install --break-system-packages --no-cache-dir "yt-dlp[default]" \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /workspace
