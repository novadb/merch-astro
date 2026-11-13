import type { APIRoute } from "astro";
import { loadProducts } from "../../lib/catalog";
import { formatPrice, MARKET } from "../../lib/i18n";
import { smallSrc } from "../../lib/images";
import { searchFilter } from "../../lib/products";
import { formOf, regionOf } from "../../lib/request";
import { PRODUCT_SEARCH_FIELDS } from "../../lib/schema";
import { searchPages } from "../../lib/site";

export const prerender = false;

/** The typeahead's answer: up to 5 products and 3 pages. */
type Suggestions = {
  products: { name: string; url: string; image: string | null; price: string }[];
  pages: { title: string; url: string }[];
};

/** POST /api/suggest with the form fields `lang` and `q` → `Suggestions` (JSON) for the typeahead of `site.js`. An unknown `lang` is a 404. */
export const POST: APIRoute = async ({ request }) => {
  const form = await formOf(request);
  if (form instanceof Response) return form;
  const region = regionOf(form.get("lang"));
  if (!region) return new Response(null, { status: 404 });
  const q = (form.get("q") ?? "").trim();
  const productFilter = q.length >= 2 ? searchFilter(q, PRODUCT_SEARCH_FIELDS) : undefined;
  if (!productFilter) return Response.json({ products: [], pages: [] } satisfies Suggestions);

  const market = MARKET[region];
  const [products, pages] = await Promise.all([loadProducts(region, market, productFilter, "$score", 5), searchPages(region, q, 3)]);
  return Response.json({
    products: products.map((p) => ({ name: p.name, url: p.url, image: p.image ? smallSrc(p.image.src) : null, price: formatPrice(p.price, market, region) })),
    pages: pages.map((p) => ({ title: p.title, url: p.url })),
  } satisfies Suggestions);
};
