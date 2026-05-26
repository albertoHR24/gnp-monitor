FROM mcr.microsoft.com/playwright:v1.50.0-noble

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

ENV NODE_ENV=production
ENV PORT=3000
ENV DATA_DIR=/data
ENV HOST=0.0.0.0
ENV HEADLESS=true
ENV BROWSER_CHANNEL=

RUN mkdir -p /data/browser-profile /data/logs /data/screenshots

EXPOSE 3000

CMD ["npm", "start"]
