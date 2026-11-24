import type { Item } from "../types";

/** Items plus any HTTP validator the adapter can persist for a conditional request. */
export interface SourceResult {
  items: Item[];
  etag?: string;
}
