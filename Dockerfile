FROM node:20

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY *.js start.sh ./
COPY public ./public
# Snapshot of the local database; copied onto the volume on first boot only.
COPY exchange.db ./seed-exchange.db

EXPOSE 3000
CMD ["bash", "start.sh"]
