FROM node:22-alpine
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev && npm cache clean --force
COPY server.js ./
ENV NODE_ENV=production
EXPOSE 8081
CMD ["node", "server.js"]
