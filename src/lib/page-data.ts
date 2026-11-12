/** What a page or product at `/{region}/{path}` shows: read from NovaDB once, rendered by the route that pre-renders it and by the one that answers a posted form. */
import { documentImages, contentTargets, imageIds, referencedIds, type ContentCtx, type Target } from "./content";
import { alternatesOf, MARKET, OTHER_LANGUAGE_REGION, t, type Region } from "./i18n";
import { loadLabels } from "./labels";
import { imagesByIds } from "./images";
import { loadProducts, productByPath, productsByIds } from "./catalog";
import { rangeOf, type Product, type RangeData } from "./products";
import { PRODUCT } from "./schema";
import { breadcrumb, categoryPage, loadGroups, loadSite, type Page, type Site, type VNode } from "./site";

/** A page in the breadcrumb, named as in the navigation. */
const toCrumb = (p: { url: string; navTitle: string }): Target => ({ url: p.url, title: p.navTitle });

export type PageData = {
  region: Region;
  title: string;
  /** The clean URL, without region switch or query. */
  canonical: string;
  alternates: Partial<Record<Region, string>>;
  crumbs: Target[];
} & (
  | { kind: "page"; content?: VNode; ctx: ContentCtx; range?: RangeData; groupNames: Map<number, string> }
  | { kind: "product"; product: Product; groupName?: string; similar: Product[]; ctx: ContentCtx }
);

/** The region's texts, as every page prints them. */
export async function loadText(region: Region) {
  return t(await loadLabels(region), region);
}

/** The live range of a category page for the posted fields: the products of its groups; undefined for a page without one. */
async function pageRange(page: Page, region: Region, form: URLSearchParams): Promise<RangeData | undefined> {
  if (!page.groupRefs.length) return undefined;
  const products = await loadProducts(region, MARKET[region], `${PRODUCT.group} = ${page.groupRefs.join(", ")}`);
  return products.length ? rangeOf(products, form, "name") : undefined;
}

/** `path`: the URL below the region, without outer slashes ("" for the home page). Undefined: no page or product there. */
export async function loadPage(region: Region, path: string, form = new URLSearchParams()): Promise<PageData | undefined> {
  const [site, groups] = await Promise.all([loadSite(region), loadGroups(region)]);
  const page = site.byPath.get(path);
  if (page) return pageData(site, page, groups, region, form);
  const product = path ? await productByPath(region, MARKET[region], path) : undefined;
  return product && productData(site, groups, product, region);
}

async function pageData(site: Site, page: Page, groups: Map<number, string>, region: Region, form: URLSearchParams): Promise<PageData> {
  const market = MARKET[region];
  // An ID the content refers to is a page of the site, else a product.
  const refs = [...referencedIds(page.content)];
  const linked = refs.flatMap((ref) => site.pages.get(ref) ?? []);
  const wantedImages = imageIds(page.content); // plus the teaser picture of every page referred to
  for (const p of linked) if (p.imageId) wantedImages.add(p.imageId);
  // The other language's page tree is for the hreflang links of a page; a product has no use for it.
  const [embedded, range, images, otherSite, text] = await Promise.all([
    productsByIds(refs.filter((ref) => !site.pages.has(ref)), region, market),
    pageRange(page, region, form),
    imagesByIds([...wantedImages]),
    loadSite(OTHER_LANGUAGE_REGION[region]),
    loadText(region),
  ]);
  const base = { region, market, text };
  return {
    kind: "page", region,
    canonical: page.url,
    title: page.title,
    alternates: alternatesOf(region, page.path, otherSite.pages.get(page.id)?.path),
    crumbs: breadcrumb(site, page).map(toCrumb),
    content: page.content,
    ctx: {
      ...base,
      products: Object.fromEntries(embedded.map((p) => [p.id, p])),
      targets: contentTargets(linked, embedded, images),
      images: documentImages(page.content, images),
    },
    range,
    groupNames: groups,
  };
}

async function productData(site: Site, groups: Map<number, string>, product: Product, region: Region): Promise<PageData> {
  const market = MARKET[region];
  const [similar, [other], text] = await Promise.all([
    productsByIds(product.similar, region, market),
    productsByIds([product.id], OTHER_LANGUAGE_REGION[region], market),
    loadText(region),
  ]);
  const base = { region, market, text };
  const category = product.groupId ? categoryPage(site, product.groupId) : undefined;
  return {
    kind: "product", region,
    canonical: product.url,
    title: product.name,
    alternates: alternatesOf(region, product.path, other?.path),
    product,
    groupName: product.groupId ? groups.get(product.groupId) : undefined,
    similar,
    ctx: { ...base, products: {}, targets: {}, images: {} },
    crumbs: [...breadcrumb(site, category).map(toCrumb), { url: product.url, title: product.name }],
  };
}
