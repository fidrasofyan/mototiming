import { serve } from 'bun';

import { fetchLiveTimingResponse, fetchScheduleResponse } from './api';
import index from './index.html';

const server = serve({
  port: Number(process.env.PORT || 3000),
  routes: {
    '/api/live-timing': {
      GET() {
        return fetchLiveTimingResponse();
      },
    },

    '/api/schedule': {
      async GET(request) {
        const requestedYear = Number(new URL(request.url).searchParams.get('seasonYear'));
        const seasonYear =
          Number.isInteger(requestedYear) && requestedYear >= 2000 && requestedYear <= 2100
            ? requestedYear
            : new Date().getFullYear();
        return fetchScheduleResponse(seasonYear);
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
