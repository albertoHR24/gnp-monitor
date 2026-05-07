FROM mcr.microsoft.com/playwright:v1.59.1-noble

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV HEADLESS=true
ENV BROWSER_CHANNEL=
ENV PROFILE_DIR=/app/data/profile

RUN mkdir -p /app/data/profile

CMD ["npm", "start"]
