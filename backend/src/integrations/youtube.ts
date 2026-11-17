import { env } from '../core.js';
import type { PostCheck, PostLookup, SocialProvider } from './types.js';

const BASE = 'https://www.googleapis.com/youtube/v3';

export const youtube: SocialProvider = {
  async fetchPost(q: PostLookup): Promise<PostCheck> {
    try {
      const key = env('YOUTUBE_API_KEY');
      const res = await fetch(`${BASE}/videos?part=snippet,statistics,status&id=${encodeURIComponent(q.key)}&key=${key}`);
      if (!res.ok) return { outcome: 'API_ERROR', detail: `YouTube answered ${res.status}` };
      const data = (await res.json()) as any;
      const v = data.items?.[0];
      if (!v) return { outcome: 'NOT_FOUND', detail: 'Video does not exist or has been removed' };
      if (v.status?.privacyStatus === 'private') return { outcome: 'NOT_FOUND', detail: 'Video is private' };
      if (v.snippet.channelId !== q.accountExternalId) {
        return { outcome: 'NOT_OWNER', detail: "Video is not on the creator's connected channel" };
      }
      if (v.statistics?.viewCount === undefined) return { outcome: 'API_ERROR', detail: 'YouTube returned no view count' };
      let followers: number | null = null;
      const ch = await fetch(`${BASE}/channels?part=statistics&id=${encodeURIComponent(q.accountExternalId)}&key=${key}`);
      if (ch.ok) {
        const n = ((await ch.json()) as any).items?.[0]?.statistics?.subscriberCount;
        if (n !== undefined) followers = Number(n);
      }
      return {
        outcome: 'LIVE',
        publishedAt: new Date(v.snippet.publishedAt),
        caption: `${v.snippet.title ?? ''}\n${v.snippet.description ?? ''}`,
        metrics: {
          views: Number(v.statistics.viewCount),
          likes: v.statistics.likeCount === undefined ? null : Number(v.statistics.likeCount),
          comments: v.statistics.commentCount === undefined ? null : Number(v.statistics.commentCount),
          followers,
        },
      };
    } catch (e) {
      return { outcome: 'API_ERROR', detail: `YouTube unreachable: ${(e as Error).message}` };
    }
  },
};

/** Turns a creator's @handle into their permanent channel id. */
export async function resolveChannel(handle: string): Promise<{ id: string; title: string; description: string; followers: number | null } | null> {
  const clean = handle.replace(/^@/, '');
  const res = await fetch(`${BASE}/channels?part=snippet,statistics&forHandle=${encodeURIComponent(clean)}&key=${env('YOUTUBE_API_KEY')}`);
  if (!res.ok) throw new Error(`YouTube answered ${res.status}`);
  const c = ((await res.json()) as any).items?.[0];
  if (!c) return null;
  const n = c.statistics?.subscriberCount;
  return { id: c.id, title: c.snippet?.title ?? clean, description: c.snippet?.description ?? '', followers: n === undefined ? null : Number(n) };
}
