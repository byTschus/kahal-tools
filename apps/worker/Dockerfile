# Schlankes Image für den Podcast-Worker (Alpine + ffmpeg + yt-dlp)
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json tsconfig.json ./
RUN npm install --no-audit --no-fund
COPY src ./src
RUN npx tsc -p tsconfig.json

FROM node:22-alpine
RUN apk add --no-cache ffmpeg python3 ca-certificates tini \
  && python3 -m venv /opt/ytdlp \
  && /opt/ytdlp/bin/pip install --no-cache-dir "yt-dlp[default]" \
  && chown -R node:node /opt/ytdlp \
  && mkdir -p /data /tmp/kahal && chown node:node /data /tmp/kahal
# venv zuerst im PATH -> "pip" und "yt-dlp" zeigen auf die venv (Updates ohne root möglich)
ENV PATH="/opt/ytdlp/bin:$PATH" \
    NODE_ENV=production \
    TMP_DIR=/tmp/kahal
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund && npm cache clean --force
COPY --from=build /app/dist ./dist
USER node
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/index.js"]
