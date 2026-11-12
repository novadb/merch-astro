/**
 * A POST to a page (filters, sorting, "Show more", search) is answered by the on-demand route under `/post`, because
 * the page's own route is pre-rendered and answers only a GET. `/api/…` stays where it is. Shared by the dev server
 * (`astro.config.mjs`) and the production server (`start.mjs`).
 */
export function routePost(req) {
  if (req.method === "POST" && !req.url.startsWith("/api/") && !req.url.startsWith("/post/")) req.url = `/post${req.url}`;
}
