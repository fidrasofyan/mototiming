import type { ScheduleEvent } from './schedule';

export type TimingRider = {
  rider_id?: number;
  order?: number;
  rider_number?: string;
  rider_name?: string;
  rider_surname?: string;
  rider_shortname?: string;
  color?: string;
  text_color?: string;
  pos?: number;
  lap_time?: string;
  num_lap?: number;
  last_lap_time?: string;
  last_lap?: number;
  team_name?: string;
  bike_name?: string;
  gap_first?: string;
  gap_prev?: string;
  on_pit?: boolean;
  status_name?: string;
};

export type TimingHead = {
  event_id?: string;
  category?: string;
  circuit_name?: string;
  event_tv_name?: string;
  event_shortname?: string;
  date_formated?: string;
  session_name?: string;
  session_shortname?: string;
  session_status_id?: string;
  session_status_name?: string;
  session_id?: string;
  remaining?: string;
};

export type LiveTiming = {
  head?: TimingHead;
  rider?: Record<string, TimingRider>;
};

export type ScheduleResponse = ScheduleEvent[];
export type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

const MOTOGP_API_BASE = 'https://api.motogp.pulselive.com/motogp/v1';
const LIVE_TIMING_URL = `${MOTOGP_API_BASE}/timing-gateway/livetiming-lite`;

type BrowserRequestOptions = { signal?: AbortSignal; fetcher?: FetchLike };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function requestBrowserJson<T>(
  url: string,
  failureLabel: string,
  isValid: (payload: unknown) => payload is T,
  { signal, fetcher = fetch }: BrowserRequestOptions = {}
) {
  const response = await fetcher(url, { cache: 'no-store', signal });
  if (!response.ok) throw new Error(`${failureLabel} request failed (${response.status})`);
  const payload: unknown = await response.json();
  if (!isValid(payload)) throw new Error(`The ${failureLabel.toLowerCase()} response was invalid`);
  return payload;
}

function isLiveTiming(value: unknown): value is LiveTiming {
  return isRecord(value);
}

function isScheduleResponse(value: unknown): value is ScheduleResponse {
  return Array.isArray(value);
}

export function fetchLiveTiming(options?: BrowserRequestOptions) {
  return requestBrowserJson('/api/live-timing', 'Feed', isLiveTiming, options);
}

export function fetchSchedule(seasonYear: number, options?: BrowserRequestOptions) {
  return requestBrowserJson(
    `/api/schedule?seasonYear=${encodeURIComponent(seasonYear)}`,
    'Schedule',
    isScheduleResponse,
    options
  );
}

async function fetchMotoGpResponse(
  url: string,
  service: 'timing' | 'schedule',
  fetcher: FetchLike
) {
  try {
    const response = await fetcher(url, {
      headers: { accept: 'application/json' },
      cache: 'no-store',
      signal: AbortSignal.timeout(8_000),
    });

    if (!response.ok) {
      return Response.json(
        { error: `MotoGP ${service} service returned ${response.status}` },
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
    const fallback = `Unable to reach MotoGP ${service} service`;
    const message = error instanceof Error ? error.message : fallback;
    return Response.json(
      { error: message },
      { status: 502, headers: { 'Cache-Control': 'no-store' } }
    );
  }
}

export function fetchLiveTimingResponse(fetcher: FetchLike = fetch) {
  return fetchMotoGpResponse(LIVE_TIMING_URL, 'timing', fetcher);
}

export function fetchScheduleResponse(seasonYear: number, fetcher: FetchLike = fetch) {
  return fetchMotoGpResponse(
    `${MOTOGP_API_BASE}/events?seasonYear=${encodeURIComponent(seasonYear)}`,
    'schedule',
    fetcher
  );
}

export type { ScheduleEvent } from './schedule';
