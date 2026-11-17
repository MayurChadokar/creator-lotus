// Runs the backend as a Netlify function at /api/*.
import serverless from 'serverless-http';

let handler: ReturnType<typeof serverless> | null = null;

async function getHandler() {
  if (!handler) {
    if (!process.env.DATABASE_URL && !process.env.MYSQL_URL) throw new Error('DATABASE_URL must point to a MySQL 8 database');
    process.env.DB_POOL_SIZE ??= '3';
    const { buildApp } = await import('../../backend/src/app.ts');
    handler = serverless(buildApp(), {
      binary: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'text/csv', 'text/csv; charset=utf-8'],
    });
  }
  return handler;
}

export default async (req: Request, context: { ip?: string }) => {
  const h = await getHandler();
  const url = new URL(req.url);
  const headers: Record<string, string> = {};
  req.headers.forEach((v, k) => { headers[k] = v; });
  if (context.ip) headers['x-forwarded-for'] = context.ip;
  const event = {
    httpMethod: req.method,
    path: url.pathname.replace(/^\/api/, '') || '/',
    headers,
    queryStringParameters: Object.fromEntries(url.searchParams),
    body: req.method === 'GET' || req.method === 'HEAD' ? null : await req.text(),
    isBase64Encoded: false,
    requestContext: { identity: { sourceIp: context.ip } },
  };
  const r = (await h(event as never, {} as never)) as { statusCode: number; headers?: Record<string, string>; multiValueHeaders?: Record<string, string[]>; body: string; isBase64Encoded?: boolean };
  const out = new Headers();
  for (const [k, v] of Object.entries(r.headers ?? {})) out.set(k, String(v));
  for (const [k, vs] of Object.entries(r.multiValueHeaders ?? {})) for (const v of vs) out.append(k, v);
  const body = r.isBase64Encoded ? Buffer.from(r.body, 'base64') : r.body;
  return new Response(r.statusCode === 204 ? null : body, { status: r.statusCode, headers: out });
};

export const config = { path: '/api/*' };
