FROM mcr.microsoft.com/playwright:v1.55.0-noble

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=optional

COPY server.mjs ./

ENV NODE_ENV=production
CMD ["npm", "start"]
