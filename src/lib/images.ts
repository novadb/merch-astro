/** Picture URLs of the media proxy (`src/lib/media.ts`), their scaled variants (`srcset`), and the image objects they come from. */
import { list, type NovaObject } from "./delivery";
import { IMAGE, TYPE } from "./schema";

/** `src`: the file by content address, `/media/{md5}{extension}`. */
export type Image = { src: string };

/** Widths of the scaled variants (`/media/{width}/{md5}{ext}`): a fixed list, so the cache cannot be filled with arbitrary sizes. */
export const MEDIA_WIDTHS = [400, 800, 1200, 1600];

/** The file name of a picture URL `/media/{md5}{ext}` that has scaled variants (`/media/{width}/{md5}{ext}`): not SVG, which is vector, nor a URL that is not a media file. */
function scalable(src: string): string | undefined {
  const name = src.match(/^\/media\/([^/]+)$/)?.[1];
  return name?.endsWith(".svg") ? undefined : name;
}

/** `srcset` of a picture URL: all its scaled variants; undefined for SVG and for a URL that is not a media file. */
export function srcSet(src: string): string | undefined {
  const name = scalable(src);
  return name && MEDIA_WIDTHS.map((w) => `/media/${w}/${name} ${w}w`).join(", ");
}

/** The smallest scaled variant of a picture URL, for small pictures such as the typeahead's; SVG stays as it is. */
export function smallSrc(src: string): string {
  const name = scalable(src);
  return name ? `/media/${MEDIA_WIDTHS[0]}/${name}` : src;
}

/**
 * Images by file object ID from objects the API delivered (the `refs` of a read with `resolve`): a content object only
 * holds the file object's ID, and the hash that names the file is on that object. An image without hash or extension has no file and is left out.
 */
export function toImages(objs: NovaObject[]): Map<number, Image> {
  const images = new Map<number, Image>();
  for (const { meta, props } of objs) {
    if (!props[IMAGE.md5] || !props[IMAGE.extension]) continue;
    images.set(meta.id, { src: `/media/${props[IMAGE.md5]}${props[IMAGE.extension]}` });
  }
  return images;
}

/** The images of pages and documents, whose IDs are known beforehand (a document node names its image by ID). The type is language-neutral, `en-US` only satisfies the request. */
export async function imagesByIds(ids: number[]): Promise<Map<number, Image>> {
  if (!ids.length) return new Map();
  return toImages((await list(TYPE.image, { lang: "en-US", filter: `meta.id = ${ids.join(", ")}` })).objs);
}
