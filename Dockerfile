FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --chown=node:node app/ ./app/
USER node
EXPOSE 8080 8081
HEALTHCHECK --interval=5s --timeout=3s --start-period=5s --retries=3 \
  CMD ["node", "app/healthcheck.mjs"]
CMD ["node", "app/server.mjs"]
