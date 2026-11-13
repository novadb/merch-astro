# Nova Merchandising — Astro demo: the image of the builder and the app. Caddy, the third container, is the official
# image with this folder's `Caddyfile` (`compose.yaml`, README "How a request is answered").
FROM node:24-alpine
ENV NODE_ENV=production
WORKDIR /app
RUN chown node:node /app
USER node
COPY --chown=node:node package.json package-lock.json ./
RUN npm ci
COPY --chown=node:node . .
# `site`: where a build runs, the app keeps its copy of the server code and Caddy's copy of the pages lies. `share`: the
# folder the builder publishes the pages and pictures in; a volume shared by the containers is mounted here.
RUN mkdir site share
EXPOSE 3001
# NOVA_DELIVERY_URL/USER/PASSWORD, DEMO_BRANCH, SHOPIFY_* and SITE_URL come from the environment (the
# platform's secrets). The builder runs the same image with `node scripts/watch.mjs`.
CMD ["node", "scripts/start.mjs"]
