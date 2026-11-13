/**
 * The app: the on-demand routes (a posted form and `/api/suggest`), behind Caddy, which serves the built pages and
 * pictures itself (`Caddyfile`). A server of our own around the adapter's handler, because a POST to a page must reach
 * the route under `/post` (`post.mjs`) and the code comes from the builder's output, not from this image.
 */
import { createReadStream } from "node:fs";
import { cp, mkdir, readFile, rm } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { pathToFileURL } from "node:url";
import { routePost } from "./post.mjs";

const share = path.resolve(process.env.SHARE_DIR ?? "share");
const site = path.resolve(process.env.SITE_DIR ?? "site");
/** Names the code of this image; a build made by other code is not run (see below). */
const code = process.env.CODE_VERSION ?? "dev";
const port = Number(process.env.APP_PORT ?? 3001);
/** Only Caddy talks to the app: on localhost in a pod; `0.0.0.0` where it is another host (`compose.yaml`). */
const host = process.env.APP_HOST ?? "127.0.0.1";

// As the container's first process Node has no default handler for the platform's stop signal; the app may wait long for its build.
process.on("SIGTERM", () => process.exit(0));

/** The id of the newest build made by this image's code. The builder of a new image publishes its first build a while after the app starts. */
async function waitForBuild() {
  for (;;) {
    try {
      const current = JSON.parse(await readFile(path.join(share, "current.json"), "utf-8"));
      if (current.code === code) return current.id;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    console.log("waiting for a build of this version");
    await sleep(2000);
  }
}

// The server code of a build differs from the build of the same code before it, so the app runs one build from start
// to end: its own copy (the share's folder may be pruned, and a local disk is faster), imported once. It loads further
// files from that folder later. The copy lies inside the project: built code resolves its packages from there.
const id = await waitForBuild();
const build = path.join(site, "app", id);
await rm(path.join(site, "app"), { recursive: true, force: true });
await mkdir(build, { recursive: true });
await cp(path.join(share, "builds", id, "server"), path.join(build, "server"), { recursive: true });
await cp(path.join(share, "builds", id, "client", "404.html"), path.join(build, "client", "404.html"));
const { handler: ssr } = await import(pathToFileURL(path.join(build, "server", "entry.mjs")).href);

/** What no route answers: the built 404 page. */
function notFound(res) {
  res.writeHead(404, { "Content-Type": "text/html; charset=utf-8" });
  createReadStream(path.join(build, "client", "404.html"))
    .on("error", (error) => res.end(console.error("404 page:", error.message)))
    .pipe(res);
}

http.createServer((req, res) => {
  routePost(req);
  ssr(req, res, () => notFound(res));
}).listen(port, host, () => console.log(`app listening on ${host}:${port}`));
