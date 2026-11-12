import node from "@astrojs/node";
import { defineConfig, envField } from "astro/config";
import { routePost } from "./scripts/post.mjs";

const secret = (optional = false) => envField.string({ context: "server", access: "secret", optional });

export default defineConfig({
  // Pages are pre-rendered; a route that sets `prerender = false` is answered on demand by `scripts/start.mjs`.
  adapter: node({ mode: "middleware" }),
  integrations: [{ name: "post-to-page", hooks: { "astro:server:setup": ({ server }) => server.middlewares.use((req, _res, next) => (routePost(req), next())) } }],
  // `scripts/watch.mjs` builds into a folder of its own and swaps it in under the running server.
  outDir: process.env.BUILD_OUT ?? "./dist",
  // The pages' own URLs end in no slash and a region's home page in one (`/de/`): `scripts/start.mjs` redirects to that form.
  trailingSlash: "ignore",
  // The stylesheet is one file under a hashed name, as in every demo.
  build: { inlineStylesheets: "never" },
  env: {
    validateSecrets: true,
    schema: {
      NOVA_DELIVERY_URL: secret(),
      NOVA_DELIVERY_USER: secret(),
      NOVA_DELIVERY_PASSWORD: secret(),
      // Not `NOVA_BRANCH`: shells often export that for other work.
      DEMO_BRANCH: envField.string({ context: "server", access: "secret", default: "merchDemo" }),
      SHOPIFY_DOMAIN: secret(true),
      SHOPIFY_STOREFRONT_TOKEN: secret(true),
      // The public origin: pre-rendered pages carry it in their canonical and hreflang URLs, so it is needed at build time.
      SITE_URL: secret(),
      MEDIA_CACHE_DIR: secret(true),
    },
  },
  // The site has no state-changing request, only searches and filters posted as forms, and behind the ingress the Origin
  // (https) never equals the request's own URL (http): the origin check would refuse every one of them.
  security: { checkOrigin: false },
  telemetry: false,
});
