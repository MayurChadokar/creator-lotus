import type { Metrics } from '../engines/qualityGate.js';

export interface PostCheck {
  outcome: 'LIVE' | 'NOT_FOUND' | 'NOT_OWNER' | 'API_ERROR';
  detail?: string;
  metrics?: Metrics;
  publishedAt?: Date;
  caption?: string | null;
  mediaId?: string;
}
export interface PostLookup {
  key: string;
  mediaId: string | null;
  accountExternalId: string;
  accessTokenEnc: string | null;
}
export interface SocialProvider { fetchPost(q: PostLookup): Promise<PostCheck> }

