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
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { copyFile, mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { BRANCH } from "../src/lib/schema.ts";

const { NOVA_DELIVERY_URL, NOVA_DELIVERY_USER, NOVA_DELIVERY_PASSWORD, DEMO_BRANCH = BRANCH } = process.env;
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
const REPORT_FILE = "_build.json";

const KINDS = { ".html": "html", ".css": "css", ".js": "js", ".mjs": "js" };

/** Every file below `dir` by its path (with `/`) and a hash of its content, but for the report, which differs with every build. */
async function fingerprints(dir) {
  const files = new Map();
  const walk = async (folder) => {
    for (const entry of await readdir(folder, { withFileTypes: true })) {
      const file = path.join(folder, entry.name);
      if (entry.isDirectory()) await walk(file);
      else if (entry.name !== REPORT_FILE) files.set(path.relative(dir, file).split(path.sep).join("/"), createHash("sha256").update(await readFile(file)).digest("hex"));
    }
  };
  await walk(dir);
  return files;
}

/** What `now` has that `before` lacks (added), has changed (updated) and has lost (removed), as sorted lists of keys. */
function compare(now, before) {
  const diff = { added: [], updated: [], removed: [] };
  for (const [key, hash] of now) {
    if (!before.has(key)) diff.added.push(key);
    else if (before.get(key) !== hash) diff.updated.push(key);
  }
  for (const key of before.keys()) if (!now.has(key)) diff.removed.push(key);
  for (const list of Object.values(diff)) list.sort();
  return diff;
}

/** The pages and files of the build the pointer file names, undefined while there is none (or it was pruned). */
async function published() {
  try {
    const { id } = JSON.parse(await readFile(path.join(share, "current.json"), "utf-8"));
    const client = path.join(share, "builds", id, "client");
    return existsSync(client) ? { id, client } : undefined;
  } catch (error) {
    if (error.code === "ENOENT") return undefined;
    throw error;
  }
}

/**
 * Writes what a build made into a JSON file that is served with the pages, for people and for scripts: when the change
 * was noticed and the build done, how long it took, and per kind of file (and for the pictures the pages show) how many
 * there are and how many are new, changed or gone compared with the build before. Pictures are named by their content,
 * so one is never changed; a new picture is made after the build (`makeMedia`).
 */
async function writeReport(client, { version, detected, seconds, names, previous }) {
  const now = await fingerprints(client);
  const before = previous ? await fingerprints(previous.client) : new Map();
  const changes = compare(now, before);
  const kinds = {};
  const count = (file, field) => {
    const kind = (kinds[KINDS[path.extname(file)] ?? "other"] ??= { total: 0, added: 0, updated: 0, removed: 0 });
    kind[field]++;
  };
  for (const file of now.keys()) count(file, "total");
  for (const [change, files] of Object.entries(changes)) for (const file of files) count(file, change);

  // an original is `{md5}/original{ext}`, a variant `{md5}/{width}{ext}.webp`
  const earlier = previous ? await mediaOf(previous.client) : [];
  const pictures = {};
  for (const [kind, isKind] of [["originals", (name) => name.includes("/original.")], ["variants", (name) => !name.includes("/original.")]]) {
    const shown = names.filter(isKind);
    const was = new Set(earlier.filter(isKind));
    pictures[kind] = { total: shown.length, added: shown.filter((name) => !was.has(name)).length, removed: was.size - shown.filter((name) => was.has(name)).length };
  }
  const report = {
    built: new Date().toISOString(),
    detected: detected.toISOString(),
    buildSeconds: Number(seconds.toFixed(1)),
    branch: DEMO_BRANCH,
    changeCount: version,
    previousChangeCount: previous ? Number(previous.id.slice(0, previous.id.lastIndexOf("-"))) : null,
    codeVersion: code,
    files: kinds,
    pictures,
    changes,
  };
  await writeFile(path.join(client, REPORT_FILE), `${JSON.stringify(report, null, 2)}\n`);
}

/** Writes `file` through a temporary file and a rename: a reader sees the old content or the new, never half. */
async function writeAtomic(file, content) {
  await writeFile(`${file}.tmp`, content);
  await rename(`${file}.tmp`, file);
}

/** Copies a folder file by file. Not `fs.cp`: it sets the mode of every copy, which the SMB share of a cluster refuses (EPERM); `copyFile` tolerates that. */
async function copyTree(from, to) {
  await mkdir(to, { recursive: true });
  await Promise.all((await readdir(from, { withFileTypes: true })).map((entry) =>
    entry.isDirectory() ? copyTree(path.join(from, entry.name), path.join(to, entry.name)) : copyFile(path.join(from, entry.name), path.join(to, entry.name)),
  ));
}

/** Copies the build to the share, then points the pointer file at it: whoever reads the pointer finds all of the build. */
async function publish(id) {
  const target = path.join(share, "builds", id);
  await rm(`${target}.partial`, { recursive: true, force: true });
  await copyTree(path.join(site, "builds", id), `${target}.partial`);
  await rename(`${target}.partial`, target);
  await writeAtomic(path.join(share, "current.json"), JSON.stringify({ id, code }));
  await rm(path.join(site, "builds", id), { recursive: true, force: true });
}

/** The time in an id (`{version}-{time}`). */
const builtAt = (id) => Number(id.slice(id.lastIndexOf("-") + 1));

/** Removes builds from the share, but the newest few and everything a copy may still be reading; also the leftovers of copies that failed halfway. */
async function prune(current) {
  const builds = path.join(share, "builds");
  const names = await readdir(builds);
  const ids = names.filter((name) => !name.endsWith(".partial")).sort((a, b) => builtAt(b) - builtAt(a));
  for (const name of [...ids.slice(KEEP_BUILDS), ...names.filter((name) => name.endsWith(".partial"))]) {
    if (name !== current && Date.now() - builtAt(name.replace(/\.partial$/, "")) > KEEP_MS) await rm(path.join(builds, name), { recursive: true, force: true });
  }
}

/** Every `/media/...` URL the pages in `client` mention (`src`, `srcset`, the texts of the page), without the `/media/`. */
async function mediaOf(client) {
  const names = new Set();
  const found = /\/media\/([0-9a-f-]{32,36}\/(?:original|\d+)\.[a-z0-9]{1,5}(?:\.webp)?)/g;
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
    const detected = new Date();
    if (built !== undefined) {
      console.log(`branch changed (${seen}); waiting ${QUIET_MS / 1000} s for more`);
      await sleep(QUIET_MS);
    }
    const version = (await changeVersion()) ?? seen;
    try {
      const previous = await published();
      const { id, seconds } = await build(version);
      const client = path.join(site, "builds", id, "client");
      const names = await mediaOf(client);
      await writeReport(client, { version, detected, seconds, names, previous });
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
