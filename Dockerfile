FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY --from=build /app/server-dist ./server-dist
COPY --from=build /app/fixtures ./fixtures
COPY --from=build /app/vendor ./vendor
COPY --from=build /app/LICENSE /app/LICENSE-APACHE-2.0 /app/THIRD_PARTY_NOTICES.md ./
USER node
EXPOSE 4173
CMD ["npm", "start"]
