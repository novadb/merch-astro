import type { APIRoute } from "astro";
import { MEDIA_WIDTHS } from "../../../lib/images";
import { FILE_NAME, serveScaled } from "../../../lib/media";

export const prerender = false;

/** GET /media/{width}/{md5}{ext}: the file `files/{md5}{ext}` scaled to one of `MEDIA_WIDTHS` as WebP; unchangeable under this name. SVG stays vector: it has no scaled variant. */
export const GET: APIRoute = ({ params, request }) => {
  const name = params.name!;
  const width = MEDIA_WIDTHS.find((w) => String(w) === params.width); // not `Number()`: it would also read `0x190` and `4e2` as 400
  if (!width || !FILE_NAME.test(name) || name.endsWith(".svg")) return new Response("Not found", { status: 404 });
  return serveScaled(name, width, request);
};
