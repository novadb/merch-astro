/** What a Visual Document (the page content) refers to, and how its links are rewritten; the components `Content.astro` and `ContentNode.astro` print it. */
import type { Image } from "./images";
import { cleanHtml, type Product } from "./products";
import type { Market, Region, Texts } from "./i18n";
import type { VNode } from "./site";

/** Everything a link or teaser in content can point at: pages and products, by object ID. */
export type Target = { url: string; title: string; image?: string };
/** What a component needs of the request: the region, its market and its texts. */
export type Ctx = { region: Region; market: Market; text: Texts };
/**
 * `products`: the products the document embeds as cards, `targets` the pages it links to or teases, and `images` the
 * picture URL (`/media/{md5}/original{ext}`) of each image object it embeds, all by object ID.
 */
export type ContentCtx = Ctx & { products: Record<number, Product>; targets: Record<number, Target>; images: Record<number, string> };

/** Object IDs a document refers to: embedded objects and links inside rich text. */
export function referencedIds(node: VNode | undefined, into = new Set<number>()): Set<number> {
  if (!node) return into;
  if (node.objectId && node.type === "object") into.add(node.objectId);
  for (const m of node.content?.matchAll(/objectId=(\d+)/g) ?? []) into.add(Number(m[1]));
  node.children?.forEach((child) => referencedIds(child, into));
  return into;
}

/** Object IDs of the images a document embeds. */
export function imageIds(node: VNode | undefined, into = new Set<number>()): Set<number> {
  if (!node) return into;
  if (node.objectId && node.type === "image") into.add(node.objectId);
  node.children?.forEach((child) => imageIds(child, into));
  return into;
}

/** Turns CMS links (`object?branch=…&objectId=N`) into site URLs and drops editor-only attributes. */
export function rewriteLinks(html: string, targets: Record<number, Target>): string {
  return cleanHtml(html)
    .replace(/href="\/?object\?branch=[^&"]+&amp;objectId=(\d+)"/g, (_, id) => `href="${targets[Number(id)]?.url ?? "#"}"`)
    .replace(/\sdata-nova-[a-z]+="[^"]*"/g, "");
}

/** The picture URL of each image a document embeds, by file object ID. */
export function documentImages(content: VNode | undefined, images: Map<number, Image>): Record<number, string> {
  const urls: Record<number, string> = {};
  for (const id of imageIds(content)) {
    const image = images.get(id);
    if (image) urls[id] = image.src;
  }
  return urls;
}

/** The pages a document links to or teases and the products it embeds, as targets by object ID. */
export function contentTargets(pages: { id: number; url: string; title: string; imageId?: number }[], products: Product[], images: Map<number, Image>): Record<number, Target> {
  const targets: Record<number, Target> = {};
  for (const p of pages) targets[p.id] = { url: p.url, title: p.title, image: p.imageId ? images.get(p.imageId)?.src : undefined };
  for (const p of products) targets[p.id] = { url: p.url, title: p.name, image: p.image?.src };
  return targets;
}
