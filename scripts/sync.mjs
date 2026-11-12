/**
 * Keeps the folder Caddy serves (`SITE_DIR`, local to its pod) equal to what the builder publishes in the shared
 * folder (`SHARE_DIR`): the pages of the build the pointer file names, `_astro` of every build, and the pictures. Caddy
 * reads local files only, so the shared folder is never in the path of a request. `SITE_DIR/current` appears when the
 * first copy is complete; the container's startup probe waits for it, so no pod takes requests without its pages.
 */
import { cp, mkdir, readdir, readFile, rename, rm, symlink } from "node:fs/promises";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

const share = path.resolve(process.env.SHARE_DIR ?? "share");
const site = path.resolve(process.env.SITE_DIR ?? "site");
const POLL_MS = Number(process.env.SYNC_SECONDS ?? 5) * 1000;
/** Pictures made while no build changed (the API makes any that is asked for) are picked up this often. */
const MEDIA_MS = Number(process.env.MEDIA_SYNC_SECONDS ?? 60) * 1000;

/** The id of the build the pointer file names, undefined while there is none. */
async function published() {
  try {
    return JSON.parse(await readFile(path.join(share, "current.json"), "utf-8")).id;
  } catch (error) {
    if (error.code === "ENOENT") return undefined;
    throw error;
  }
}

/** Copies `source` to `target` through a temporary folder and a rename: Caddy never finds half of it. */
async function copyWhole(source, target, options = {}) {
  const temp = path.join(site, "tmp", path.basename(target));
  await rm(temp, { recursive: true, force: true });
  await mkdir(path.dirname(temp), { recursive: true });
  await mkdir(path.dirname(target), { recursive: true });
  await cp(source, temp, { recursive: true, ...options });
  await rename(temp, target);
}

/**
 * Copies the pictures the share has and this pod lacks. A name is a picture's content, so a file there is never
 * copied again. The modification time is kept: Caddy builds its ETag from it, and all pods must give the same one.
 */
async function copyMedia() {
  const from = path.join(share, "media");
  const to = path.join(site, "media");
  // `.meta` and `.tmp` are the API's own; only the pictures are served
  for (const entry of await readdir(from, { withFileTypes: true }).catch(() => [])) {
    if (entry.name.startsWith(".")) continue;
    const folder = entry.isDirectory() ? entry.name : "";
    for (const name of entry.isDirectory() ? await readdir(path.join(from, folder)) : [entry.name]) {
      const target = path.join(to, folder, name);
      if (!(await readdir(path.join(to, folder)).catch(() => [])).includes(name)) {
        await copyWhole(path.join(from, folder, name), target, { preserveTimestamps: true });
      }
    }
  }
}

/** Copies the build `id`: its pages next to the earlier ones, its `_astro` files into the folder all builds share, then makes it `current`. */
async function copyBuild(id) {
  await copyMedia();
  const client = path.join(share, "builds", id, "client");
  await copyWhole(client, path.join(site, "builds", id), { filter: (file) => path.relative(client, file) !== "_astro" });
  // The names are hashes of the content: a file that is there is the same file.
  await cp(path.join(client, "_astro"), path.join(site, "assets", "_astro"), { recursive: true, force: false, errorOnExist: false });
  const link = path.join(site, "current");
  await rm(`${link}.new`, { force: true });
  await symlink(path.relative(site, path.join(site, "builds", id)), `${link}.new`);
  await rename(`${link}.new`, link); // atomic: there is no moment without a current build
  for (const name of await readdir(path.join(site, "builds"))) {
    if (name !== id) await rm(path.join(site, "builds", name), { recursive: true, force: true });
  }
  console.log(`serving build ${id}`);
}

// As the container's first process Node has no default handler for the platform's stop signal.
process.on("SIGTERM", () => process.exit(0));

await mkdir(site, { recursive: true });
let serving;
let mediaAt = Date.now();
for (;;) {
  try {
    const id = await published();
    if (id && id !== serving) {
      await copyBuild(id);
      serving = id;
      mediaAt = Date.now();
    } else if (Date.now() - mediaAt >= MEDIA_MS) {
      await copyMedia();
      mediaAt = Date.now();
    }
  } catch (error) {
    // The share may be briefly unreachable, or a build pruned while it was copied: the next round starts over.
    console.error("sync failed:", error.message);
  }
  await sleep(POLL_MS);
}
