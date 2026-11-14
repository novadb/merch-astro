# Nova Merchandising — Astro

The demo site of NovaDB as CMS and PIM in one, built with Astro 7 in TypeScript: **every page and product is built to
HTML ahead of time** from NovaDB's Delivery API (branch `merchDemo`), plain `fetch`, no NovaDB package, no UI framework.
Three parts run it, each on its own (three Kubernetes Deployments, or `compose.yaml`): **Caddy** receives every request
and serves the pages and pictures as files, without any logic of ours; a small **app** (Node, Astro's server) answers
what needs a request: a posted filter or search and the typeahead's JSON; a **builder** watches the branch, makes every
picture the pages show and builds the pages again whenever the branch changes. The Delivery login never leaves the app
and the builder. Caddy and the app scale alone; there is one builder.

Everything works without JavaScript: filters, sorting, "Show more" and search are real POST forms that the server
answers with the page itself. With JavaScript, the one shared script (`src/scripts/site.js`, the same file as in the
other demos without client components) applies filters in place, loads more cards while scrolling, offers the typeahead
and starts Shopify's own Buy Button and cart.

## Run

```bash
cp .env.example .env      # then fill in the Delivery login and SITE_URL
docker compose up --build # http://localhost:4002 (podman compose works the same)
```

`.env` holds `NOVA_DELIVERY_URL`, `NOVA_DELIVERY_USER` and `NOVA_DELIVERY_PASSWORD` (the Delivery API login of your
NovaDB instance) and `SITE_URL`, the origin the site is reached at (`http://localhost:4002` here). Optional:
`DEMO_BRANCH` (default `merchDemo`), `SHOPIFY_DOMAIN` and `SHOPIFY_STOREFRONT_TOKEN` (public Buy Button token; without
them there is no cart), and for the builder `POLL_SECONDS` and `QUIET_SECONDS` (30 each). The site answers once the
first build is done (about 15 s).

For editing, `npm install` and `npm run dev` render every request live, without a build and without Caddy; `/` is
Caddy's redirect by language, so the dev server starts at `/de/`.
`uv run scripts/refresh-container.py` rebuilds the image and starts the three containers anew. Checks:
`npm run typecheck`, `npm run build`.

## Test

The site passes the shared Playwright behaviour suite of the Nova Merchandising demos (Firefox) but for the test named
under "Deviations": run it from its checkout with `BASE_URL=http://localhost:4002 npx playwright test`. The tests tagged
`@shopify` (buy button, cart) need the Shopify variables.

## How a request is answered

1. **Caddy** (`Caddyfile`) redirects `/uk/shop/` to `/uk/shop` (one URL per page) and serves a GET from files in its own
   folder, compressed: the pages, `/_astro/…`, the pictures of `/media` and the 404 page. That is every GET:
   `/uk/shop/t-shirts` and `/media/<md5>/400.jpg.webp` are files, what is none is a 404 (the built `404.html`), and `/`
   is a redirect by the first tag of `Accept-Language` (`de` to `/de/`, British English and its neighbours to `/uk/`,
   else `/us/`). It never reads the shared volume and never asks the app for a GET.
2. Every POST and `/api/*` go to the **app** (`scripts/start.mjs`, port 3001; `APP_ADDRESS` for Caddy): the adapter's
   handler with the routes `api/suggest` and those under `src/pages/post/`. A POST to `/uk/shop/t-shirts` is moved to
   `/post/uk/shop/t-shirts` (`scripts/post.mjs`), because the page's own route is pre-rendered and answers only a GET.
   The routes `media/…` are for the dev server only: the builder makes the pictures itself.
3. A page is `src/pages/[region]/[...path].astro`: `getStaticPaths` lists every page and product of the three regions,
   `loadPage` reads its data, `PageView.astro` prints it. The POST route prints the same component with the posted
   filters.
4. The **builder** (`scripts/watch.mjs`) builds when `changeTrackingVersion` of `updateInfo` has moved and stayed still
   for 30 s (a build takes about 7 s; a failed one leaves the last good pages). Before it publishes the build it makes
   every picture the pages show, in its own process with the code of its image (`src/lib/media.ts`): each is written to
   `media/` on the **shared volume**, as `{md5}/original{ext}` and `{md5}/{width}{ext}.webp`. A picture's name is its
   content, so it is made once, ever. A picture NovaDB does not have is logged and the build goes on; any other error
   (network, disk) stops the build, and the next poll builds again. Then it copies the build to the share
   (`builds/{id}`) and writes `current.json` last: a page goes live only when its pictures are on the share.
   The build also leaves a report, `/_build.json`, that Caddy serves with the pages, for people and for scripts. It is
   the build's last file, written after the pictures: the build's `id` (the one `current.json` names once it is
   published, so a script can tell which build a pod serves), when the change was noticed and the build done, how long
   `astro build` and the pictures took, per kind of file (HTML, CSS, JavaScript, other) how many there are and how many
   are added, updated or removed compared with the build before, for the pictures (originals and scaled copies) how
   many there are, are added or are removed, how many this build made and how many a page shows that NovaDB does not
   have, and the paths of the files that changed. Nothing links to it and `robots.txt` keeps crawlers out; anyone who
   knows the address can read it. A script that waits for an edit in NovaDB to go live polls `changeCount`.
5. Each Caddy pod has a **sync** process (`scripts/sync.mjs`): it follows `current.json`, copies the build and the new
   pictures into the pod's own folder and swaps the symlink `current` there. A pod's Caddy starts when that first copy is
   complete, so no pod takes requests without its files, and the shared volume is never in the path of a request.

## Operation

| Part | Replicas | Reads | Writes |
|---|---|---|---|
| `web` (Caddy, sidecar `sync`) | any number | its own folder | its own folder (the sidecar) |
| `app` | any number | the share (the server code of the build of its version, once at its start) | nothing |
| `builder` | exactly one | NovaDB | `media/`, `builds/` and `current.json` on the share |

- **The share** is one volume that all three mount (`ReadWriteMany`), small: a few builds and the pictures (about 20 MB).
- **A new version of the code** starts an app only when the builder of that version has published its first build
  (`CODE_VERSION`): until then the old apps answer.
- **TLS.** Behind a proxy that ends TLS, Caddy answers plain HTTP for the site's host name (`SITE_ADDRESS`, for example
  `http://astro.example.com:8080`). Given the bare host name instead, Caddy gets a certificate from Let's Encrypt
  itself; `CADDY_STORAGE` is then a folder every Caddy shares, so only one asks and all use the certificate, and the
  `email` setting goes in a file under `/etc/caddy/tls/`.
- **Scaling locally:** `docker compose up --scale app=2`.

## Where things are

| Path | What |
|---|---|
| `NOVADB.md` | how the site reads NovaDB: the model, the Delivery API's concepts, what the site decided |
| `src/lib/schema.ts` | every NovaDB name (branch, types, attributes, market variants) as API identifiers: the one place to change |
| `src/lib/delivery.ts` | Delivery API client: Basic auth from the environment, 60 s cache |
| `src/lib/i18n.ts`, `labels.ts` | regions (`de`, `uk`, `us`: content language, market, currency) and the UI texts, read from NovaDB's labels |
| `src/lib/site.ts` | page tree, URLs from `merchPageUrlSegment` + parent page, breadcrumb, category page of a group |
| `src/lib/products.ts`, `catalog.ts` | the product type, full-text filter, facets (counted on the server), sorting; reading products |
| `src/lib/content.ts`, `page-data.ts`, `search.ts` | a page's Visual Document resolved for rendering; what a page, a product and the search page show |
| `src/lib/images.ts`, `media.ts`, `src/pages/media/` | picture URLs by content address and their `srcset`; the store the builder makes the pictures with (a disk cache laid out like the URLs, scaled WebP variants with `sharp`), and the route that serves it to the dev server |
| `src/lib/request.ts`, `seo.ts`, `sizes.ts` | region and posted fields of a request; canonical and hreflang URLs; the pictures' `sizes` |
| `src/pages/[region]/` | the pre-rendered pages, products and the empty search |
| `src/pages/post/`, `api/suggest.ts`, `404.astro` | the answers to a posted form, the typeahead's JSON and the 404 page |
| `src/layouts/Layout.astro` | document, header, region switch, footer |
| `src/components/` | `PageView`, `SearchView`, `Content`/`ContentNode` (the Visual Document), `Range`, `Facet`, `ProductCard`, `ProductDetail`, `SearchForm`, `Crumbs` |
| `src/styles/site.css`, `src/scripts/site.js`, `public/` | the stylesheet, the client script, fonts, icons, `robots.txt`: the same files in every demo |
| `Caddyfile`, `compose.yaml`, `Dockerfile` | the web server in front; the parts and their volumes; the image of the app, the builder and the sync |
| `scripts/start.mjs`, `watch.mjs`, `sync.mjs`, `post.mjs` | the app's server, the builder, Caddy's copy of the files, the rule that moves a POST |
| `astro.config.mjs` | the adapter, the environment variables (validated at start and build), the dev server's POST rule |

## Load times

Median of 30 requests with `curl` against the local containers (one machine, no compression asked, so sizes are
the raw HTML, Caddy in front):

| URL | This demo (time to first byte, HTML) | Reference (time to first byte, HTML) |
|---|---|---|
| `/de/` | 1.3 ms, 20 KB | 8.0 ms, 51 KB |
| `/uk/shop/t-shirts` | 1.5 ms, 23 KB | 8.9 ms, 49 KB |
| `/uk/shop/t-shirts/we-build-value` | 1.1 ms, 8 KB | 5.9 ms, 19 KB |
| a posted filter on `/uk/shop/t-shirts` | 4.0 ms | 6.0 ms |

A page has no database or API call on the way, and a picture is a file too, so both are as fast as the disk and the network; a posted filter costs what
it costs in every demo (the range is filtered and counted on the server).

## Deviations

From the shared contract (the reference's HTML and behaviour), because most pages are files:

- **Pages are as fresh as the last build.** A change in NovaDB reaches the pre-rendered pages after the poll (30 s), the
  quiet time (30 s) and a build (about 7 s). A new page or product has its URL only then; until then it is a 404. A
  posted range, a search and the suggestions read the Delivery API live (60 s cache), so they can be newer than the page around them.
- **`SITE_URL` is required, and the canonical origin does not follow the ingress headers.** A built page holds its
  canonical and hreflang URLs; there is no request to read a host from. The shared suite's test "the canonical origin
  follows the ingress headers" does not apply.
- **A picture is a file the builder made before the page that shows it goes live, and Caddy never asks the app for a
  static asset.** Until a picture has reached Caddy's folder (after the build, at most `MEDIA_SYNC_SECONDS`, 60 by
  default) it is a 404; a scaled variant that is missing is answered with the original, which the browser keeps for 15
  minutes. The same holds for pages and
  `/_astro/…`: a missing one is Caddy's own 404, and `/` is a redirect Caddy answers itself.
- **One 404 page.** `404.html` is built once, in English, for `/de/…` too.
- **Astro's markup.** Pages carry no framework markup: the HTML is the same as the shared structure but for
  whitespace and attribute order, which Astro serialises its own way. Fingerprinted file names (`/_astro/…`) are the
  bundler's.

## On Cloudflare

The three parts above exist because Caddy, a small server and a builder are what it takes to serve files, answer a POST
and build again on a plain Kubernetes cluster. On Cloudflare the same site needs one Worker with static assets, one
bucket and a schedule. This is a description, not a second demo: nothing here has been run, and the open questions
below are the ones to answer first.

| Here | On Cloudflare |
|---|---|
| Caddy with the sidecar `sync`: pages, `/_astro/…` and the 404 page as files | [Workers Static Assets](https://developers.cloudflare.com/workers/static-assets/): a request that matches a file is answered with it, and the Worker runs only when none does. `html_handling = "auto-trailing-slash"` serves `de/shop.html` as `/de/shop` and `de/index.html` as `/de/`, which is the Caddyfile's one-URL-per-page rule |
| `app`: a POST to a page's URL, `POST /api/suggest` | The same Worker (`@astrojs/cloudflare`): on-demand routes under `src/pages/post/` and `api/`, as today. `run_worker_first` takes route patterns with `!` exclusions, so the Worker can take `/api/*` first |
| `/` leads to the region by `Accept-Language` | A small handler in the Worker, `run_worker_first = ["/"]`; a static redirect rule cannot look at a header |
| `builder`: polls `updateInfo`, builds, publishes on the shared volume | A cron trigger of the Worker reads `updateInfo`, keeps `changeTrackingVersion` and the time of its last change in KV, and starts a build when it has been still for the quiet time. The build is `astro build` followed by `wrangler deploy`; where it runs (the platform's own builds or a pipeline) is open |
| Pictures made by the builder with `sharp`, kept on the shared volume | A Worker route for `/media/{md5}/…`: the original is fetched from NovaDB once and kept in R2; a scaled copy is made once with the [Images binding](https://developers.cloudflare.com/images/optimization/binding/) (`transform({ width })`, `output({ format: "image/webp", quality: 80 })`) and kept in R2 as well. A build has no disk that outlives it, so the pictures do not belong in it |

**What falls away:** the shared volume and `current.json`, the sync process and its symlink swap, `CODE_VERSION` (a
deployment is one version of pages and server code together), the Caddyfile, the images and the TLS settings.

**What stays:** the pages are as fresh as the last build, `SITE_URL` fixes the origin of canonical and hreflang URLs, a new
page or product has its URL after the next build, and a posted range, a search and the suggestions read the Delivery
API live. The Delivery login is a Worker secret.

**Open, to check before anyone builds this:**

- Does a POST to a path that also has a file reach the Worker? The documentation describes routing by path and does not
  say what a method changes. With the Node adapter it does not (see "How a request is answered"); if the Cloudflare
  answer is the same, the Worker moves the POST to `/post/…` as `scripts/post.mjs` does.
- How `not_found_handling` serves the 404 page, and so whether each region can have its own, which would remove the
  "One 404 page" deviation.
- Whether the Images binding keeps an animated picture animated, never enlarges, and applies quality 80 as the contract
  asks; its documentation names width, format and quality, not these.
- Whether a build can be started from the cron trigger's side without a pipeline of our own.
- The cost of a posted filter in a Worker's CPU time: the facets are counted over the whole range on every request.
