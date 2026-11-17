import { env } from './core.js';
import { buildApp } from './app.js';
const port = Number(env('PORT', '4000'));
buildApp().listen(port, () => console.log(`Backend running on port ${port}`));
