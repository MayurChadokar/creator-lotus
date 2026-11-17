// One place that decides which outside services are in use. Tests swap in simulators here.
import { instagram } from './instagram.js';
import type { SocialProvider } from './types.js';
import { youtube } from './youtube.js';

export const providers: { INSTAGRAM: SocialProvider; YOUTUBE: SocialProvider } = { INSTAGRAM: instagram, YOUTUBE: youtube };
