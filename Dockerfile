FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
RUN mkdir -p /data && chmod 755 /data
ENV DATA_DIR=/data
EXPOSE 3000
CMD ["sh", "scripts/start.sh"]
