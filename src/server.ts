import { serve } from 'bun';

import index from './index.html';

const MOTOGP_LIVE_TIMING_URL =
  'https://api.motogp.pulselive.com/motogp/v1/timing-gateway/livetiming-lite';

const server = serve({
  port: Number(process.env.PORT || 3000),
  routes: {
    '/api/live-timing': {
      async GET() {
        try {
          const response = await fetch(MOTOGP_LIVE_TIMING_URL, {
            headers: { accept: 'application/json' },
            cache: 'no-store',
            signal: AbortSignal.timeout(8_000),
          });

          if (!response.ok) {
            return Response.json(
              { error: `MotoGP timing service returned ${response.status}` },
              { status: 502, headers: { 'Cache-Control': 'no-store' } }
            );
          }

          return new Response(response.body, {
            status: 200,
            headers: {
              'Content-Type': response.headers.get('Content-Type') || 'application/json',
              'Cache-Control': 'no-store',
            },
          });
        } catch (error) {
          const message =
            error instanceof Error ? error.message : 'Unable to reach MotoGP timing service';
          return Response.json(
            { error: message },
            { status: 502, headers: { 'Cache-Control': 'no-store' } }
          );
        }
      },
    },

    // Serve index.html for all unmatched routes.
    '/*': index,
  },

  development: process.env.NODE_ENV !== 'production' && {
    // Enable browser hot reloading in development
    hmr: true,

    // Echo console logs from the browser to the server
    console: true,
  },
});

console.log(`🚀 Server running at ${server.url}`);
