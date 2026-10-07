import { parseSeed } from './rng';

/** Track seed from the page URL (e.g. https://…/#482113), if there is one. */
export function seedFromUrl(): number | null {
  return typeof location === 'undefined' ? null : parseSeed(location.hash);
}

/** Keep the URL pointing at the current track, without adding browser history entries. */
export function setUrlSeed(seed: number): void {
  try { history.replaceState(null, '', `#${seed}`); } catch { /* not in a browser */ }
}

export function trackLink(seed: number): string {
  return `${location.origin}${location.pathname}#${seed}`;
}

/** Copy a link to this track; resolves false if the clipboard isn't available. */
export async function copyTrackLink(seed: number): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(trackLink(seed));
    return true;
  } catch {
    return false;
  }
}
