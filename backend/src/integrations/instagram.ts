// Instagram API with Instagram Login. Meta only shares post views with an app when the
// creator has connected their own professional (Business or Creator) account.
import { decrypt, env } from '../core.js';
import type { PostCheck, PostLookup, SocialProvider } from './types.js';

const ver = () => process.env.INSTAGRAM_API_VERSION || 'v25.0';
const GRAPH = 'https://graph.instagram.com';
const FIELDS = 'id,permalink,caption,timestamp,like_count,comments_count,media_product_type';
const MAX_PAGES = 10;

const shortcodeOf = (permalink: string) => permalink.split('/').filter(Boolean).pop();

async function getJson(url: string) {
  const res = await fetch(url);
  return { ok: res.ok, status: res.status, body: (await res.json().catch(() => ({}))) as any };
}

export const instagram: SocialProvider = {
  async fetchPost(q: PostLookup): Promise<PostCheck> {
    if (!q.accessTokenEnc) return { outcome: 'API_ERROR', detail: 'Creator has not connected Instagram' };
    try {
      const token = encodeURIComponent(decrypt(q.accessTokenEnc));
      let media: any = null;
      if (q.mediaId) {
        const r = await getJson(`${GRAPH}/${ver()}/${q.mediaId}?fields=${FIELDS}&access_token=${token}`);
        if (r.ok) media = r.body;
        else if (r.body?.error?.code === 190) return { outcome: 'API_ERROR', detail: 'Instagram connection expired; creator must reconnect' };
        else if (r.body?.error?.code === 100 || r.status === 404) return { outcome: 'NOT_FOUND', detail: 'Post has been deleted' };
        else return { outcome: 'API_ERROR', detail: `Instagram answered ${r.status}` };
      } else {
        // First check: walk the creator's own posts. A post absent from their account is
        // either someone else's or unpublished, and both are not payable.
        let next: string | null = `${GRAPH}/${ver()}/me/media?fields=${FIELDS}&limit=50&access_token=${token}`;
        for (let page = 0; next && page < MAX_PAGES && !media; page++) {
          const r: { ok: boolean; status: number; body: any } = await getJson(next);
          if (!r.ok) {
            return { outcome: 'API_ERROR', detail: r.body?.error?.code === 190 ? 'Instagram connection expired; creator must reconnect' : `Instagram answered ${r.status}` };
          }
          media = (r.body.data ?? []).find((m: any) => m.permalink && shortcodeOf(m.permalink) === q.key) ?? null;
          next = r.body.paging?.next ?? null;
        }
        if (!media) return { outcome: 'NOT_FOUND', detail: "Post not found on the creator's connected account" };
      }
      const ins = await getJson(`${GRAPH}/${ver()}/${media.id}/insights?metric=views,reach&access_token=${token}`);
      if (!ins.ok) return { outcome: 'API_ERROR', detail: `Instagram insights unavailable (${ins.status})` };
      const metric = (n: string): number | null => {
        const m = (ins.body.data ?? []).find((x: any) => x.name === n);
        const v = m?.values?.[0]?.value ?? m?.total_value?.value;
        return v === undefined ? null : Number(v);
      };
      const views = metric('views');
      if (views === null) return { outcome: 'API_ERROR', detail: 'Instagram returned no view count' };
      let followers: number | null = null;
      const me = await getJson(`${GRAPH}/${ver()}/me?fields=followers_count&access_token=${token}`);
      if (me.ok && me.body.followers_count !== undefined) followers = Number(me.body.followers_count);
      return {
        outcome: 'LIVE',
        mediaId: media.id,
        publishedAt: new Date(media.timestamp),
        caption: media.caption ?? null,
        metrics: {
          views,
          likes: media.like_count === undefined ? null : Number(media.like_count),
          comments: media.comments_count === undefined ? null : Number(media.comments_count),
          reach: metric('reach'),
          followers,
        },
      };
    } catch (e) {
      return { outcome: 'API_ERROR', detail: `Instagram unreachable: ${(e as Error).message}` };
    }
  },
};

export const instagramAuthorizeUrl = (state: string): string => {
  const p = new URLSearchParams({
    client_id: env('INSTAGRAM_APP_ID'), redirect_uri: env('INSTAGRAM_REDIRECT_URI'), response_type: 'code',
    scope: 'instagram_business_basic,instagram_business_manage_insights', state,
  });
  return `https://www.instagram.com/oauth/authorize?${p}`;
};

/** Swaps the one-time login code for a long-lived token and the account's details. */
export async function connectInstagram(code: string) {
  const short = await fetch('https://api.instagram.com/oauth/access_token', {
    method: 'POST',
    body: new URLSearchParams({
      client_id: env('INSTAGRAM_APP_ID'), client_secret: env('INSTAGRAM_APP_SECRET'),
      grant_type: 'authorization_code', redirect_uri: env('INSTAGRAM_REDIRECT_URI'), code,
    }),
  });
  if (!short.ok) throw new Error(`Instagram login failed (${short.status})`);
  const s = (await short.json()) as any;
  const longTok = await getJson(`${GRAPH}/access_token?grant_type=ig_exchange_token&client_secret=${encodeURIComponent(env('INSTAGRAM_APP_SECRET'))}&access_token=${encodeURIComponent(s.access_token)}`);
  if (!longTok.ok) throw new Error('Could not obtain a long-lived Instagram token');
  const token = longTok.body.access_token as string;
  const me = await getJson(`${GRAPH}/${ver()}/me?fields=user_id,username,followers_count,account_type&access_token=${encodeURIComponent(token)}`);
  if (!me.ok) throw new Error('Could not read the Instagram profile');
  return {
    token, expiresInSeconds: Number(longTok.body.expires_in ?? 0),
    externalId: String(me.body.user_id ?? me.body.id), handle: me.body.username as string,
    followers: me.body.followers_count === undefined ? null : Number(me.body.followers_count),
  };
}

/** Long-lived tokens last about 60 days. The nightly job refreshes them before they lapse. */
export async function refreshInstagramToken(tokenEnc: string) {
  const r = await getJson(`${GRAPH}/refresh_access_token?grant_type=ig_refresh_token&access_token=${encodeURIComponent(decrypt(tokenEnc))}`);
  if (!r.ok) throw new Error(`Token refresh failed (${r.status})`);
  return { token: r.body.access_token as string, expiresInSeconds: Number(r.body.expires_in ?? 0) };
}
