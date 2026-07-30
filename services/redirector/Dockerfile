FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY server.js logger.js ./
ENV NODE_ENV=production
EXPOSE 8081
CMD ["node", "server.js"]
