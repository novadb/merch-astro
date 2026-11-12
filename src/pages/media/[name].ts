import type { APIRoute } from "astro";
import { FILE_NAME, serveMedia } from "../../lib/media";

export const prerender = false;

/** GET /media/{md5}{ext}: the file `files/{md5}{ext}`, unchangeable under this name. */
export const GET: APIRoute = ({ params, request }) => {
  const name = params.name!;
  if (!FILE_NAME.test(name)) return new Response("Not found", { status: 404 });
  return serveMedia(name, request);
};
