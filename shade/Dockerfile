# Build context: the repo root (the agent reuses shared/ and api/_relayer.mjs).
FROM node:22-alpine@sha256:92d51e5f20b7ff58faa5a969af1a1cec6cbec3fbff7e0f523242b9b5c85ad887
WORKDIR /app
COPY shade/package.json shade/package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts
COPY shared/btc.mjs shared/package.json ./node_modules/@pusaka/shared/
COPY api/_relayer.mjs ./api/
COPY shade/agent.mjs ./shade/
ENV NODE_ENV=production
CMD ["node", "shade/agent.mjs"]
