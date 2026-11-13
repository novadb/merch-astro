import { tmpdir } from "node:os";
import path from "node:path";
import type { APIRoute } from "astro";
import { deliveryFetch, instanceUrl } from "../../../lib/delivery";
import { MEDIA_WIDTHS } from "../../../lib/images";
import { FILE_NAME, mediaStore } from "../../../lib/media";

export const prerender = false;

/** Only `npm run dev` asks this route: in production the builder makes the pictures (`scripts/watch.mjs`) and Caddy serves them. */
const { serveOriginal, serveScaled } = mediaStore(path.join(tmpdir(), "nova-media"), (p) => deliveryFetch(instanceUrl(p)));

const notFound = () => new Response("Not found", { status: 404 });

/**
 * GET /media/{md5}/original{ext}: the file `files/{md5}{ext}`.
 * GET /media/{md5}/{width}{ext}.webp: the same file scaled to one of `MEDIA_WIDTHS` as WebP. SVG stays vector: it has no variant.
 * The name keeps the extension because NovaDB serves a file only under it. Neither can change under its name.
 */
export const GET: APIRoute = ({ params, request }) => {
  const { md5, file } = params as { md5: string; file: string };
  const original = file.match(/^original(\.[a-z0-9]{1,5})$/);
  if (original) return FILE_NAME.test(md5 + original[1]) ? serveOriginal(md5, original[1], request) : notFound();

  const variant = file.match(/^(\d+)(\.[a-z0-9]{1,5})\.webp$/);
  const width = MEDIA_WIDTHS.find((w) => String(w) === variant?.[1]); // not `Number()`: it would also read `0x190` and `4e2` as 400
  if (!variant || !width || variant[2] === ".svg" || !FILE_NAME.test(md5 + variant[2])) return notFound();
  return serveScaled(md5, variant[2], width, request);
};
