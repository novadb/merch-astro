/** What the search page shows for the posted fields: products (with the range's facets) and pages. */
import { loadProducts } from "./catalog";
import type { Ctx } from "./content";
import { MARKET, REGIONS, type Region } from "./i18n";
import { loadText } from "./labels";
import { rangeOf, searchFilter, type RangeData, type Sort } from "./products";
import { PRODUCT_SEARCH_FIELDS } from "./schema";
import { loadGroups, searchPages } from "./site";

export type SearchData = {
  ctx: Ctx;
  q: string;
  range: RangeData;
  groupNames: Map<number, string>;
  pages: { url: string; title: string }[];
  /** The region switch stays on the search page of each region. */
  alternates: Record<Region, string>;
};

/** The search for the posted fields: `q`, and the range's facets and sorting. Opened without a query, the page lists every product. */
export async function searchData(region: Region, form: URLSearchParams): Promise<SearchData> {
  const market = MARKET[region];
  const q = (form.get("q") ?? "").trim();
  const productFilter = searchFilter(q, PRODUCT_SEARCH_FIELDS);
  const [products, pages, groupNames, text] = await Promise.all([
    loadProducts(region, market, productFilter, productFilter ? "$score" : undefined),
    searchPages(region, q, 5),
    loadGroups(region),
    loadText(region),
  ]);
  const defaultSort: Sort = productFilter ? "relevance" : "name";
  return {
    ctx: { region, market, text },
    q,
    range: rangeOf(products, form, defaultSort),
    groupNames,
    pages: pages.map((p) => ({ url: p.url, title: p.title })),
    alternates: Object.fromEntries(REGIONS.map((r) => [r, `/${r}/search`])) as Record<Region, string>,
  };
}
