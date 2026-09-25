FROM node:24-bookworm-slim AS build
WORKDIR /app
RUN corepack enable
COPY . .
RUN pnpm install --frozen-lockfile
RUN NEXT_STANDALONE=1 pnpm build
RUN cp -r apps/web/.next/static apps/web/.next/standalone/apps/web/.next/static && cp -r apps/web/public apps/web/.next/standalone/apps/web/public

FROM build AS runtime
ENV NODE_ENV=production
ENV PLAYWRIGHT_BROWSERS_PATH=/opt/browsers
RUN pnpm --filter @seo/crawler exec playwright install --with-deps chromium && chmod -R a+rX /opt/browsers
USER node
CMD ["node", "apps/api/dist/server.js"]
