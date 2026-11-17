// Engine 3a: engagement quality gate. Pure rules with no network or database.
export interface Metrics {
  views: number;
  likes: number | null;     // null = hidden by the platform, never treated as zero
  comments: number | null;
  reach?: number | null;
  followers?: number | null;
}
export interface GateRules { minEngagementBps: number; minViews: number; requireDisclosure: boolean; requiredTags?: string[] }
export interface GateResult {
  result: 'PASS' | 'FAIL' | 'REVIEW';
  engagementBps: number | null;
  reasons: string[];
}

/** Required hashtags and @mentions not found in the caption. Case does not matter; #Lotus does not match #LotusDiwali. */
export function missingTags(caption: string | null, tags: string[]): string[] {
  const text = caption ?? '';
  return tags.filter((t) => {
    const esc = t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return !new RegExp(`(^|[^\\p{L}\\p{N}_])${esc}(?![\\p{L}\\p{N}_]|\\.[\\p{L}\\p{N}_])`, 'iu').test(text);
  });
}

const DISCLOSURE = /(^|[\s#])(ad|ads|sponsored|paidpartnership|paid partnership|partnership)\b/i;

/**
 * FAIL   = automatic rejection, zero pay.
 * REVIEW = payment frozen until a person looks at it.
 * No platform API tells us views are fake, so these are warning signs and not proof.
 * That is why suspected bots go to a person instead of being rejected outright.
 */
export function evaluateGate(
  m: Metrics, rules: GateRules, caption: string | null,
  history: { views: number }[] = [],
): GateResult {
  if (m.views < rules.minViews) {
    return { result: 'FAIL', engagementBps: null, reasons: [`Only ${m.views} views; minimum is ${rules.minViews}`] };
  }
  const review: string[] = [];
  let engagementBps: number | null = null;
  if (m.likes === null || m.comments === null) {
    review.push('Likes or comments are hidden, so engagement cannot be calculated');
  } else {
    engagementBps = m.views > 0 ? Math.floor(((m.likes + m.comments) * 10000) / m.views) : 0;
    if (engagementBps < rules.minEngagementBps) {
      return {
        result: 'FAIL', engagementBps,
        reasons: [`Engagement ${(engagementBps / 100).toFixed(2)}% is below the ${(rules.minEngagementBps / 100).toFixed(2)}% minimum`],
      };
    }
    if (engagementBps > 4000) review.push('Unusually high engagement (above 40%), possible bought likes');
    if (m.likes >= 1000 && m.comments === 0) review.push('Many likes but no comments');
  }
  if (m.followers && m.followers > 0 && m.views >= 5000 && m.views > m.followers * 50) {
    review.push('Views are over 50 times the follower count');
  }
  if (m.reach && m.reach > 0 && m.views > m.reach * 10) {
    review.push('Views are over 10 times the unique accounts reached');
  }
  if (history.length >= 2) {
    let biggestJump = 0;
    let prev = 0;
    for (const h of [...history, { views: m.views }]) {
      biggestJump = Math.max(biggestJump, h.views - prev);
      prev = h.views;
    }
    const first = history[0]!.views;
    if (m.views >= 5000 && first > 0 && biggestJump - first > m.views * 0.8) {
      review.push('Over 80% of views arrived in one sudden jump');
    }
  }
  const missing = missingTags(caption, rules.requiredTags ?? []);
  if (missing.length) review.push(`Caption is missing: ${missing.join(' ')}`);
  if (rules.requireDisclosure && !DISCLOSURE.test(caption ?? '')) {
    review.push('No sponsored-content label (such as #ad) found in the caption');
  }
  return review.length ? { result: 'REVIEW', engagementBps, reasons: review } : { result: 'PASS', engagementBps, reasons: [] };
}

export function parsePostUrl(raw: string): { platform: 'INSTAGRAM' | 'YOUTUBE'; key: string } | null {
  let u: URL;
  try { u = new URL(raw.trim()); } catch { return null; }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  const host = u.hostname.toLowerCase().replace(/^(www\.|m\.)/, '');
  const parts = u.pathname.split('/').filter(Boolean);
  if (host === 'instagram.com') {
    const i = parts.findIndex((p) => ['p', 'reel', 'reels', 'tv'].includes(p));
    const key = i >= 0 ? parts[i + 1] : undefined;
    return key && /^[\w-]+$/.test(key) ? { platform: 'INSTAGRAM', key } : null;
  }
  let id: string | null | undefined;
  if (host === 'youtu.be') id = parts[0];
  else if (host === 'youtube.com') {
    id = parts[0] === 'shorts' || parts[0] === 'live' ? parts[1] : u.searchParams.get('v');
  } else return null;
  return id && /^[\w-]{11}$/.test(id) ? { platform: 'YOUTUBE', key: id } : null;
}
