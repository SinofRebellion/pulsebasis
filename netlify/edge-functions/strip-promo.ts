// Removes the promotional HTML comment Netlify injects into *.netlify.app pages, so the page carries only our own markup.
export default async (_req: Request, context: any) => {
  const res: Response = await context.next();
  if (!(res.headers.get('content-type') || '').includes('text/html')) return res;
  const html = (await res.text()).replace(/<!--[\s\S]*?-->\s*/g, '');
  const h = new Headers(res.headers); h.delete('content-length'); h.delete('etag');
  return new Response(html, { status: res.status, headers: h });
};
export const config = { path: ['/', '/index.html', '/stats', '/stats.html'] };
