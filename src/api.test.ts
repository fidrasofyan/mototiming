import { expect, test } from 'bun:test';

import {
  fetchLiveTiming,
  fetchLiveTimingResponse,
  fetchSchedule,
  fetchScheduleResponse,
} from './api';

test('browser helpers call only same-origin routes and disable caching', async () => {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const fetcher = async (input: RequestInfo | URL, init?: RequestInit) => {
    requests.push({ url: String(input), init });
    return String(input).includes('schedule')
      ? Response.json([{ id: 'event' }])
      : Response.json({ head: { event_id: '42' }, rider: {} });
  };

  await fetchLiveTiming({ fetcher });
  await fetchSchedule(2026, { fetcher });

  expect(requests.map(({ url }) => url)).toEqual([
    '/api/live-timing',
    '/api/schedule?seasonYear=2026',
  ]);
  expect(requests.every(({ init }) => init?.cache === 'no-store')).toBe(true);
});

test('browser helpers report HTTP and malformed response failures', async () => {
  await expect(
    fetchLiveTiming({ fetcher: async () => new Response('unavailable', { status: 503 }) })
  ).rejects.toThrow('Feed request failed (503)');
  await expect(fetchLiveTiming({ fetcher: async () => Response.json(null) })).rejects.toThrow(
    'The feed response was invalid'
  );
  await expect(
    fetchSchedule(2026, { fetcher: async () => new Response('unavailable', { status: 503 }) })
  ).rejects.toThrow('Schedule request failed (503)');
  await expect(
    fetchSchedule(2026, { fetcher: async () => Response.json({ events: [] }) })
  ).rejects.toThrow('The schedule response was invalid');
});

test('server proxy forwards both MotoGP endpoints with no-store response headers', async () => {
  const urls: string[] = [];
  const fetcher = async (input: RequestInfo | URL) => {
    urls.push(String(input));
    return Response.json({ ok: true });
  };

  const timing = await fetchLiveTimingResponse(fetcher);
  const schedule = await fetchScheduleResponse(2026, fetcher);

  expect(urls).toEqual([
    'https://api.motogp.pulselive.com/motogp/v1/timing-gateway/livetiming-lite',
    'https://api.motogp.pulselive.com/motogp/v1/events?seasonYear=2026',
  ]);
  expect(timing.status).toBe(200);
  expect(schedule.status).toBe(200);
  expect(timing.headers.get('Cache-Control')).toBe('no-store');
  expect(schedule.headers.get('Cache-Control')).toBe('no-store');
  expect(await timing.json()).toEqual({ ok: true });
  expect(await schedule.json()).toEqual({ ok: true });
});

test('server proxy converts non-2xx responses and network failures for both APIs to 502', async () => {
  const unavailable = async () => new Response('unavailable', { status: 503 });
  const timingFailure = await fetchLiveTimingResponse(unavailable);
  const scheduleFailure = await fetchScheduleResponse(2026, unavailable);
  expect(timingFailure.status).toBe(502);
  expect(await timingFailure.json()).toEqual({ error: 'MotoGP timing service returned 503' });
  expect(scheduleFailure.status).toBe(502);
  expect(await scheduleFailure.json()).toEqual({ error: 'MotoGP schedule service returned 503' });

  const networkError = async () => {
    throw new Error('network down');
  };
  const timingNetworkFailure = await fetchLiveTimingResponse(networkError);
  const scheduleNetworkFailure = await fetchScheduleResponse(2026, networkError);
  expect(await timingNetworkFailure.json()).toEqual({ error: 'network down' });
  expect(await scheduleNetworkFailure.json()).toEqual({ error: 'network down' });
});
