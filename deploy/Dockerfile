# API GameOfLife sur la VM Oracle (Always Free, 1 Go de RAM).
# Le code est compilé sur le PC (npm run build) : la VM installe seulement les dépendances d'exécution.
FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production \
    NODE_OPTIONS=--max-old-space-size=220
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force
COPY dist ./dist
COPY drizzle ./drizzle
USER node
EXPOSE 3000
HEALTHCHECK --interval=60s --timeout=5s --retries=3 \
  CMD node -e "fetch('http://localhost:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/index.js"]
