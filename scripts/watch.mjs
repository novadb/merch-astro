/**
 * Builds the pre-rendered pages from NovaDB and builds them again whenever the branch changes, then publishes the build
 * in the shared folder (`SHARE_DIR`): `builds/{id}` and, last, the pointer file `current`, which `scripts/sync.mjs`
 * (Caddy's copy) and `scripts/start.mjs` (the API) follow. Then it has every picture the pages show made once
 * (`media/`, see `src/lib/media.ts`). The Delivery API reports a change as the counter `changeTrackingVersion` of
 * `GET branches/{branch}/updateInfo` (a 304 for as long as it stands still). The counter moves with every transaction of
 * any branch of the instance, so this may build without need and never misses a change. NovaDB can push the same news as
 * the NATS subject `nova.delivery.update`; that is reachable only inside the instance's cluster, so this polls.
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { cp, mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

const { NOVA_DELIVERY_URL, NOVA_DELIVERY_USER, NOVA_DELIVERY_PASSWORD, DEMO_BRANCH = "merchDemo" } = process.env;
if (!NOVA_DELIVERY_URL || !NOVA_DELIVERY_USER || !NOVA_DELIVERY_PASSWORD) throw new Error("NOVA_DELIVERY_URL, NOVA_DELIVERY_USER and NOVA_DELIVERY_PASSWORD are not set (see README, \"Run\")");

const POLL_MS = Number(process.env.POLL_SECONDS ?? 30) * 1000;
/** A change is built only after this long without a newer one, so an editing session causes one build. */
const QUIET_MS = Number(process.env.QUIET_SECONDS ?? 30) * 1000;

/** Where the build runs: inside the project, because the built server code finds its packages from there. */
const site = path.resolve(process.env.SITE_DIR ?? "site");
const share = path.resolve(process.env.SHARE_DIR ?? "share");
/** Names the code of this image: an API only runs the server code of a build made by the same code (`start.mjs`). */
const code = process.env.CODE_VERSION ?? "dev";
/** The API, which makes the pictures. */
const apiUrl = process.env.API_URL ?? "http://127.0.0.1:3001";
/** Builds kept on the share besides the current one, and how long a build stays that a copy may be reading. */
const KEEP_BUILDS = 3;
const KEEP_MS = 10 * 60 * 1000;
const authorization = "Basic " + Buffer.from(`${NOVA_DELIVERY_USER}:${NOVA_DELIVERY_PASSWORD}`).toString("base64");
const astro = path.resolve("node_modules/astro/bin/astro.mjs");

let etag;
/** `changeTrackingVersion` of the branch; undefined while it is unchanged since the last call or the API cannot be reached (logged). */
async function changeVersion() {
  const res = await fetch(new URL(`branches/${DEMO_BRANCH}/updateInfo`, NOVA_DELIVERY_URL), {
    headers: { Authorization: authorization, Accept: "application/json", ...(etag && { "If-None-Match": etag }) },
  }).catch((error) => console.warn("updateInfo unreachable:", error.cause?.code ?? error.message));
  if (!res || res.status === 304) return undefined;
  if (!res.ok) return void console.warn(`updateInfo answered ${res.status}`);
  etag = res.headers.get("ETag") ?? undefined;
  return (await res.json()).changeTrackingVersion;
}

/** Builds into a folder of its own below `site/builds`; returns its name, `{version}-{time}`, the build's id, and how long `astro build` took. */
async function build(version) {
  const id = `${version}-${Date.now()}`;
  const out = path.join(site, "builds", id);
  const started = Date.now();
  await new Promise((resolve, reject) =>
    spawn(process.execPath, [astro, "build"], { env: { ...process.env, BUILD_OUT: out }, stdio: "inherit" })
      .on("exit", (status) => (status === 0 ? resolve() : reject(new Error(`astro build exited with ${status}`)))),
  );
  return { id, seconds: (Date.now() - started) / 1000 };
}

/** Linked from nowhere, and `robots.txt` asks crawlers to stay out: a page for whoever knows the address. */
const INFO_FILE = "_build-info.txt";

/** Writes what a build made into a text file that is served with the pages: the files by kind, the pictures the pages show, when, and how long it took. */
async function writeInfo(client, { version, seconds, names }) {
  const count = { html: 0, css: 0, js: 0 };
  const walk = async (dir) => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) await walk(path.join(dir, entry.name));
      else count[{ ".html": "html", ".css": "css", ".js": "js", ".mjs": "js" }[path.extname(entry.name)]]++;
    }
  };
  await walk(client);
  const variants = names.filter((name) => name.includes("/")).length;
  const lines = [
    `built         ${new Date().toISOString()}`,
    `build time    ${seconds.toFixed(1)} s (astro build, from NovaDB's data to the files)`,
    `change count  ${version} (changeTrackingVersion of branch ${DEMO_BRANCH})`,
    `code version  ${code}`,
    "",
    `html pages    ${count.html}`,
    `css files     ${count.css}`,
    `js files      ${count.js}`,
    `pictures      ${names.length - variants} originals the pages show`,
    `variants      ${variants} scaled copies (WebP, made once per picture and width after the build)`,
  ];
  await writeFile(path.join(client, INFO_FILE), `${lines.join("\n")}\n`);
}

/** Writes `file` through a temporary file and a rename: a reader sees the old content or the new, never half. */
async function writeAtomic(file, content) {
  await writeFile(`${file}.tmp`, content);
  await rename(`${file}.tmp`, file);
}

/** Copies the build to the share, then points the pointer file at it: whoever reads the pointer finds all of the build. */
async function publish(id) {
  const target = path.join(share, "builds", id);
  await rm(`${target}.partial`, { recursive: true, force: true });
  await cp(path.join(site, "builds", id), `${target}.partial`, { recursive: true });
  await rename(`${target}.partial`, target);
  await writeAtomic(path.join(share, "current.json"), JSON.stringify({ id, code }));
  await rm(path.join(site, "builds", id), { recursive: true, force: true });
}

/** The time in an id (`{version}-{time}`). */
const builtAt = (id) => Number(id.slice(id.lastIndexOf("-") + 1));

/** Removes builds from the share, but the newest few and everything a copy may still be reading. */
async function prune(current) {
  const builds = path.join(share, "builds");
  const ids = (await readdir(builds)).filter((name) => !name.endsWith(".partial")).sort((a, b) => builtAt(b) - builtAt(a));
  for (const id of ids.slice(KEEP_BUILDS)) {
    if (id !== current && Date.now() - builtAt(id) > KEEP_MS) await rm(path.join(builds, id), { recursive: true, force: true });
  }
}

/** Every `/media/...` URL the pages in `client` mention (`src`, `srcset`, the texts of the page), without the `/media/`. */
async function mediaOf(client) {
  const names = new Set();
  const found = /\/media\/((?:\d+\/)?[0-9a-f-]{32,36}\.[a-z0-9]{1,5})/g;
  const walk = async (dir) => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(file);
      else if (entry.name.endsWith(".html")) for (const [, name] of (await readFile(file, "utf-8")).matchAll(found)) names.add(name);
    }
  };
  await walk(client);
  return [...names];
}

/**
 * Has the API make each picture of the pages that the shared folder lacks, four at a time: a picture's name is its
 * content, so each is made once, here, and ever after only found. Until the API is up (a new pod starts after the first build) it asks again.
 */
async function makeMedia(names) {
  const todo = names.filter((name) => !existsSync(path.join(share, "media", name)) || !existsSync(path.join(share, "media", ".meta", `${name}.json`)));
  let made = 0;
  let missing = 0;
  const deadline = Date.now() + 10 * 60 * 1000;
  const queue = [...todo];
  await Promise.all(Array.from({ length: 4 }, async () => {
    for (let name = queue.shift(); name; name = queue.shift()) {
      for (;;) {
        const res = await fetch(`${apiUrl}/media/${name}`).catch(() => undefined);
        await res?.body?.cancel();
        if (res?.ok) made++;
        else if (res?.status === 404) missing++;
        else if (Date.now() < deadline) { await sleep(5000); continue; }
        break;
      }
    }
  }));
  console.log(`pictures: ${made} made, ${missing} not in NovaDB, ${todo.length - made - missing} failed, ${names.length - todo.length} there already`);
}

// As the container's first process Node has no default handler for the platform's stop signal.
process.on("SIGTERM", () => process.exit(0));

await mkdir(path.join(site, "builds"), { recursive: true });
await mkdir(path.join(share, "builds"), { recursive: true });
let built;
for (;;) {
  const seen = await changeVersion();
  if (seen !== undefined && seen !== built) {
    if (built !== undefined) {
      console.log(`branch changed (${seen}); waiting ${QUIET_MS / 1000} s for more`);
      await sleep(QUIET_MS);
    }
    const version = (await changeVersion()) ?? seen;
    try {
      const { id, seconds } = await build(version);
      const client = path.join(site, "builds", id, "client");
      const names = await mediaOf(client);
      await writeInfo(client, { version, seconds, names });
      await publish(id);
      built = version;
      await prune(id);
      console.log(`built version ${version}`);
      await makeMedia(names);
    } catch (error) {
      // The pages of the last good build stay; the next poll tries again.
      console.error("build failed:", error.message);
      etag = undefined;
    }
  }
  await sleep(POLL_MS);
}
