// Pure helpers for the Wombkeepers provider content (data/wombkeepers.json).
// No DOM, no store (tests/wombkeepers.test.js). The content is display only:
// nothing here reads it into a threshold, alert or badge. The one derivation
// is bandFor() — which "When to call" band is open by default — and it takes
// the week from dates.summary(), the same number the pill shows.

const isIOS = (ua) => /iPad|iPhone|iPod/.test(ua || '') || (/Macintosh/.test(ua || '') && /Mobile/.test(ua || ''));

/** 'tel:+16022010865' from any phone string ('602-201-0865' → US +1). Null when there's nothing to dial. */
export function telHref(phone) {
  const raw = String(phone || '').trim();
  if (!raw) return null;
  const d = raw.replace(/\D/g, '');
  if (raw.startsWith('+')) return `tel:+${d}`;
  if (d.length === 10) return `tel:+1${d}`;
  if (d.length === 11 && d[0] === '1') return `tel:+${d}`;
  return d.length >= 7 ? `tel:${d}` : null;
}

/** An sms: link with a prefilled body — iOS reads '&body=', everything else '?body='. */
export function smsHref(tel, body, ua = globalThis.navigator?.userAgent) {
  const base = `sms:${tel}`;
  if (!body) return base;
  return `${base}${isIOS(ua) ? '&' : '?'}body=${encodeURIComponent(body)}`;
}

/** The platform's maps app for an address: Apple Maps on iOS, Google Maps elsewhere. */
export function mapsHref(address, ua = globalThis.navigator?.userAgent) {
  const q = encodeURIComponent(String(address || '').trim());
  if (!q) return null;
  return isIOS(ua) ? `https://maps.apple.com/?q=${q}` : `https://www.google.com/maps/search/?api=1&query=${q}`;
}

/**
 * Index of the "When to call" band for a gestational week (whole weeks):
 * fromWeek <= week < toWeek; past the last band stays on the last one.
 * Display only — it picks which band is expanded, nothing else.
 */
export function bandFor(week, bands) {
  if (!Array.isArray(bands) || !bands.length || !Number.isFinite(week)) return -1;
  const i = bands.findIndex((b) => week >= b.fromWeek && week < b.toWeek);
  if (i !== -1) return i;
  return week >= bands[bands.length - 1].toWeek ? bands.length - 1 : 0;
}

/** Pinned contacts first, then the file's order. */
export const sortContacts = (contacts) => (contacts || []).map((c, i) => ({ c, i }))
  .sort((a, b) => (b.c.pinned ? 1 : 0) - (a.c.pinned ? 1 : 0) || a.i - b.i).map((x) => x.c);

/** 'Wombkeepers Pregnancy Guide 2025–26, p.14' — the attribution line on every rendered block. */
export const attribution = (pages) => `Wombkeepers Pregnancy Guide 2025–26, ${String(pages || '').trim()}`;
