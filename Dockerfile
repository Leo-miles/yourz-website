FROM node:24-bookworm-slim
WORKDIR /app
COPY yourz-app-source.zip /tmp/yourz-app-source.zip
RUN apt-get update && apt-get install -y --no-install-recommends unzip \
    && unzip -q /tmp/yourz-app-source.zip -d /app \
    && rm /tmp/yourz-app-source.zip \
    && mkdir -p /app/data \
    && chown -R node:node /app
USER node
ENV NODE_ENV=production PORT=3000 DATABASE_PATH=/app/data/factory.sqlite
EXPOSE 3000
CMD ["node", "server.cjs"]
