FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --omit=dev && npm cache clean --force
COPY server.js ./
COPY lib ./lib
COPY public ./public
COPY bin ./bin
ENV NODE_ENV=production
# 512MB heap cap: a 400-page PDF peaks at ~90MB, so this is 5x headroom and still
# leaves the OOM killer out of the picture on a 4GB box.
ENV NODE_OPTIONS=--max-old-space-size=512
EXPOSE 8082
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s \
  CMD wget -qO- http://127.0.0.1:8082/healthz || exit 1
CMD ["node","server.js"]
