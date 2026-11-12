# AGENTS.md

Single source of truth for coding agents here; `CLAUDE.md` only imports it. A line stays only if an agent would decide wrongly without it.

## Project

"Nova Merchandising": a demo website that shows NovaDB as CMS and PIM in one. Every page, product, price, picture and UI text comes from NovaDB's Delivery API. Stack: Astro 7 with `@astrojs/node`, TypeScript, plain `fetch`, no NovaDB package and no UI framework.

The idea of this demo: a site on NovaDB is mostly files. Every page, product and picture is made ahead of time and served by Caddy, which takes all the load; a small Node API answers what needs a request (a posted filter or search, the typeahead); a builder builds again when the branch changes. Three parts that scale apart. Everything works without JavaScript; the shared `src/scripts/site.js` adds in-place filters, endless scrolling, typeahead and cart.

Agencies and developers read this code to learn how the stack works with NovaDB, then change it for their own project. Measure every change against that: a short path from URL to HTML, no layer of our own; the NovaDB code in the open, one place per concern; everything else in the smallest form that is right in concept; idiomatic Astro and TypeScript.

The same site exists in other stacks and must look and behave identically, but where a pre-built site cannot (README, "Deviations"): HTML structure, CSS classes, label keys, routes and shared files are a contract, checked by the shared Playwright suite. Change none alone.

Non-goals: client-side navigation, a UI framework, NovaDB writes, a database, query strings, our own cart.

## Commands and gates

- Run: `docker compose up --build` (http://localhost:4002), the Delivery login and `SITE_URL` in `.env` (`.env.example`); it answers after the first build. `npm run dev` renders every request live, for editing.
- `npm run typecheck` (`astro check`), `npm run build`, `docker build .`
- Local container (podman): `uv run scripts/refresh-container.py` after every completed change.
- Tests: the shared Playwright suite, from its checkout: `BASE_URL=http://localhost:4002 npx playwright test` (Firefox). The tests tagged `@shopify` need the Shopify variables.
- Done means: typecheck, build and `docker build` pass and the suite is green against the real Delivery API, but for the test named under "Deviations" in the README. Report each gate.
- Check a changed page with `curl` too: the pre-rendered file and a POST's answer are two renders of one component.

## NovaDB

Before touching `src/lib/` or the content components read `NOVADB.md`: the model and the Delivery API's concepts (identifiers, `lang`, `props`, variants, references, Visual Document, files, search). The wire protocol is in the product documentation it links. `README.md` lists which file does what.

- Read-only; branch `merchDemo`.
- Every NovaDB name (branch, types, attributes, market variants) is an API identifier and stands only in `src/lib/schema.ts`. An unavoidable numeric ID goes there too, as a named constant.
- A missing `props` key means unset or untranslated: omit it, never fall back to another language or `displayName`.
- Never print or log `NOVA_DELIVERY_URL/USER/PASSWORD`; they are `astro:env` secrets and never reach the browser: pictures go through the `/media` proxy.
- `src/lib/delivery.ts` caches responses for 60 s, in the process that reads (the builder, the server). A pre-rendered page is as fresh as its last build; a posted range, a search and a suggestion read live (60 s cache).
- A UI text is a `merchLabel` object in NovaDB: a new text is a new label there plus its key in `src/lib/i18n.ts`. The name of a product attribute is not a label: it is the name of the attribute's definition (`ATTRIBUTE_TEXT`). A missing text prints `⟦key⟧` and fails the suite.

## Rules

- Fix the cause, not the symptom: no swallowed exception, fallback value or retry that hides a defect. Missing configuration or data fails loudly (`astro:env` validates the secrets).
- Never weaken, skip or work around a test.
- Change only what the task needs; list unrelated findings at the end (`file:line`).
- Ask before adding a dependency or touching `Dockerfile`, `compose.yaml` or `Caddyfile`.
- Comments say why the code is this way (a constraint of NovaDB, the framework, browser or contract) or what a name stands for, true for a reader who never saw an earlier version. A declaration other files use gets a doc comment when name and type leave something open (a unit, what a missing value means); a file header or one comment for a group may cover several. Never what the code plainly does or how it changed: that goes in the pull request. No TODO, no commented-out code; test names likewise.

## Where the code does not say why

- Two kinds of route. `src/pages/[region]/…` are pre-rendered (`getStaticPaths` lists every page and product); `prerender = false` routes run on demand: `post/`, `api/`, `media/`, `/`. A new CMS page or product has its URL after the next build; an on-demand fallback page would be a second renderer of every page.
- A POST to a page's own URL is answered by the route of the same path under `src/pages/post/`: `scripts/post.mjs` moves it there, in the production server and in the dev server. The adapter's own server would answer it with the page's file, and Astro's middleware never runs for a path only a pre-rendered route knows.
- `scripts/watch.mjs` (builder, one) builds in `site/builds/`, copies the build to the shared folder `SHARE_DIR` (`builds/{id}`), last writes `current.json`, then fetches every `/media` URL of the pages from the API: each picture is made once. `scripts/sync.mjs` (beside each Caddy) copies build and pictures into Caddy's own folder and swaps its symlink `current`; Caddy never reads the share (keep the `route` block of the `Caddyfile`: Caddy's own order puts the proxy first). `scripts/start.mjs` (the API) waits for a build of its own `CODE_VERSION`, copies `server/` and imports it once: a build's server code differs from the next one's. `site/` stays inside the project: built code resolves its packages there.
- `src/lib/media.ts` lays its cache out like the URLs (`{md5}{ext}`, `{width}/{md5}{ext}`, meta in `.meta`) so Caddy can serve it; temporary files go to `.tmp` under unique names (every pod is process 1).
- The builder polls `updateInfo` (`changeTrackingVersion` moves with every transaction of any branch: a needless build is normal, a missed one a bug).
- `SITE_URL` is required: pre-rendered pages hold it in their canonical and hreflang URLs, so they cannot follow `X-Forwarded-*`. The 404 page is one file for the whole site, in English.
- The site writes no query string and reads none (a foreign one is ignored): filters, sorting and search are POST forms answered with the page itself, so a filtered view has no URL of its own, on purpose.
- `Range.astro` renders `section#range` with `data-autosubmit`; `site.js` replaces that section by the same section of the POST's answer and reuses cards by their HTML. Keep the markup of the card, the facets and the "Show more" button as it is.
- `src/styles/site.css`, `src/scripts/site.js`, `NOVADB.md` and everything in `public/` (`favicon.svg`, `novadb.svg`, `github.svg`, `robots.txt`, the fonts) are shared files, kept identical from outside this repository: never adapt them. `site.css` is also the CMS editor's stylesheet. Only how they reach the browser (Astro bundles the two under `src/`) is this demo's own.
- Page content is made from a closed set of components (classes `merch*`): compose them before asking for a new one.
- The shop is Shopify's own Buy Button and cart, started by `site.js` from a product's `data-shopify-product` and the two meta tags of `Layout.astro`. Without `SHOPIFY_DOMAIN` and `SHOPIFY_STOREFRONT_TOKEN` there is silently no cart: keep both in `.env`.

## Git

- Branch from a fresh `origin/main` as `feature/<id>-<slug>` or `bugfix/<id>-<slug>` (`<id>` is the number of the work item, the slug lower-case words). `main` changes only by pull request, completed as **squash merge** with the source branch deleted; direct and force pushes to `main` are rejected.
- **Title and description of the PR are the one public commit message.** Write them with the skill `pr-text` (title up to 60 characters, description optional, up to three lines), check them with `scripts/check-pr-text.py`, get the user's approval, and set the merge commit message explicitly to that text.
- The PR needs a review, a linked work item, resolved comments, a green build.
- Everything on `main` is public and mirrored read-only to GitHub (never push there): no addresses, accounts, tracker numbers or secrets in files or commit messages. No tags, no version numbers.
- Pushing, merging and tagging need explicit approval.

## Deployment

Three parts (`compose.yaml`): `web` (official Caddy image, `Caddyfile`, the public port; `sync` beside it; `SITE_ADDRESS` is its host name), `api` and `builder` (this `Dockerfile`: `scripts/start.mjs`, `scripts/watch.mjs`; `scripts/sync.mjs`). Builder and API share one volume (`SHARE_DIR`, `MEDIA_CACHE_DIR` in it); Caddy reaches the API at `API_ADDRESS`. Caddy and the API run in any number, the builder once. Nothing must be kept; hosting is the operator's choice. It needs its environment (see NovaDB) from the platform's secrets, with `SITE_URL` set to the public origin. Never push images, deploy or change DNS without explicit approval.
