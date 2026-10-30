import { useEffect, useLayoutEffect, useRef, useState } from 'react';

import {
  MAX_COMPARISON_RIDERS,
  createLapChartPath,
  formatLapTimeDifference,
  getLapChartDomain,
  getLapTimeDifference,
  toggleComparisonRider,
  type LapSample,
} from './lap-chart';
import {
  createPaceHistory,
  getExcludedPaceRiderKeys,
  loadPaceHistory,
  parseLapTimeMilliseconds,
  rankPaceHistory,
  recordPaceLaps,
  savePaceHistory,
  type PaceHistory,
} from './pace-ranking';
import {
  POSITION_CUE_DURATION,
  POSITION_FLASH_DURATION,
  scheduleRiderExpiry,
} from './position-cues';

export { parseLapTimeMilliseconds } from './pace-ranking';

type TimingRider = {
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

type TimingHead = {
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

type LiveTiming = {
  head?: TimingHead;
  rider?: Record<string, TimingRider>;
};

type ConnectionState = 'connecting' | 'connected' | 'stale';
type RiderFilter = 'all' | 'favorites';
type PositionChange = { direction: 'up' | 'down'; places: number };
type PositionSnapshot = { sessionKey?: string; positions: Map<string, number> };
type PendingFlip = {
  firstTops: Map<string, number>;
};
type SelectedRider = { key: string; rider: TimingRider };
type LapHistoryOption = SelectedRider & { laps: LapSample[] };

const POLL_INTERVAL = 3_000;
const FAVORITES_STORAGE_KEY = 'mototiming:favorites:v1';

function normalize(value?: string) {
  return (
    value
      ?.trim()
      .toUpperCase()
      .replace(/[\s_-]+/g, '') ?? ''
  );
}

function isFinished(head?: TimingHead) {
  const status = normalize(head?.session_status_id);
  const name = normalize(head?.session_status_name);
  return [status, name].some((value) =>
    ['F', 'FINISHED', 'ENDED', 'END', 'COMPLETED', 'CANCELLED'].includes(value)
  );
}

function isExplicitlyLive(head?: TimingHead) {
  const status = normalize(head?.session_status_id);
  const name = normalize(head?.session_status_name);
  return [status, name].some((value) => ['L', 'LIVE', 'INPROGRESS', 'STARTED'].includes(value));
}

function validColor(color?: string) {
  if (!color) return undefined;
  const normalized = color.replace(/^#/, '');
  return /^[\da-f]{6}$/i.test(normalized) ? `#${normalized}` : undefined;
}

function riderName(rider: TimingRider) {
  const fullName = [rider.rider_name, rider.rider_surname].filter(Boolean).join(' ');
  return fullName || rider.rider_shortname || 'Unknown rider';
}

function validPosition(rider: TimingRider) {
  const position = rider.pos;
  return typeof position === 'number' && Number.isFinite(position) && position > 0
    ? position
    : undefined;
}

function riderKey(rider: TimingRider, index: number) {
  if (rider.rider_id !== undefined) return `id:${rider.rider_id}`;
  if (rider.rider_number) return `number:${rider.rider_number}`;
  const name = [rider.rider_name, rider.rider_surname].filter(Boolean).join(' ');
  return name ? `name:${name}` : `unknown:${index}`;
}

export function favoriteRiderKey(rider: TimingRider) {
  if (rider.rider_id !== undefined) return `id:${rider.rider_id}`;
  const number = rider.rider_number?.trim().toLowerCase() ?? '';
  const name = [rider.rider_name, rider.rider_surname]
    .filter(Boolean)
    .join(' ')
    .trim()
    .toLowerCase();
  return number || name ? `fallback:${number}:${name}` : undefined;
}

export function toggleFavoriteKey(current: ReadonlySet<string>, key: string) {
  const next = new Set(current);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  return next;
}

export function filterFavoriteRiders(
  riders: TimingRider[],
  favorites: ReadonlySet<string>,
  filter: RiderFilter
) {
  return riders
    .map((rider, index) => ({ rider, index }))
    .filter(({ rider }) => {
      if (filter === 'all') return true;
      const key = favoriteRiderKey(rider);
      return key !== undefined && favorites.has(key);
    });
}

export function parseFavoriteKeys(value: string | null) {
  if (!value) return new Set<string>();
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed)
      ? new Set(parsed.filter((key): key is string => typeof key === 'string'))
      : new Set<string>();
  } catch {
    return new Set<string>();
  }
}

function loadFavoriteKeys() {
  if (typeof window === 'undefined') return new Set<string>();
  try {
    return parseFavoriteKeys(window.localStorage.getItem(FAVORITES_STORAGE_KEY));
  } catch {
    return new Set<string>();
  }
}

function saveFavoriteKeys(keys: Set<string>) {
  try {
    window.localStorage.setItem(FAVORITES_STORAGE_KEY, JSON.stringify([...keys]));
  } catch {
    // Keep the in-memory favorite state usable when browser storage is unavailable.
  }
}

function formatGap(value?: string) {
  if (!value || value === '-' || value === '—') return '—';
  if (/^0(?:\.0+)?$/.test(value)) return '—';
  return value.startsWith('+') ? value : `+${value}`;
}

function formatTime(value?: string) {
  return value || '—';
}

export function formatLapMilliseconds(milliseconds: number) {
  const minutes = Math.floor(milliseconds / 60_000);
  const seconds = ((milliseconds % 60_000) / 1_000).toFixed(3).padStart(6, '0');
  return `${minutes}'${seconds}`;
}

export function positionLapTimeLabels(points: Array<{ x: number; y: number }>) {
  const candidates = [-12, 18, -26, 34, -40, 48];
  const placed: Array<{ x: number; y: number }> = [];

  return points.map((point) => {
    const labelY = candidates
      .map((offset) => point.y + offset)
      .find(
        (y) =>
          y >= 12 &&
          y <= 260 &&
          placed.every((label) => Math.abs(label.x - point.x) >= 52 || Math.abs(label.y - y) >= 14)
      );
    const y = labelY ?? Math.max(12, point.y - 12);
    placed.push({ x: point.x, y });
    return y;
  });
}

function LapHistoryDialog({
  selected,
  laps,
  riderOptions,
  comparisonKeys,
  onToggleComparison,
  onClose,
}: {
  selected: SelectedRider | null;
  laps: LapSample[];
  riderOptions: LapHistoryOption[];
  comparisonKeys: string[];
  onToggleComparison: (key: string, checked: boolean) => void;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [activePoint, setActivePoint] = useState<{
    riderKey: string;
    pointKey: string;
    riderLabel: string;
    lap: number;
    timeMs: number;
    differenceMs: number | undefined;
    x: number;
    y: number;
    color: string;
  } | null>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (selected && !dialog.open) dialog.showModal();
    else if (!selected && dialog.open) dialog.close();
  }, [selected]);

  const chartWidth = 720;
  const chartHeight = 300;
  const plot = { left: 62, right: 18, top: 18, bottom: 55 };
  const plotWidth = chartWidth - plot.left - plot.right;
  const plotHeight = chartHeight - plot.top - plot.bottom;
  const comparisonColors = ['#48b1ff', '#e0b864', '#58d68d', '#ba8bff'];
  const series = selected
    ? [
        { ...selected, laps, color: '#e51d3e', primary: true },
        ...comparisonKeys.flatMap((key, index) => {
          const option = riderOptions.find((rider) => rider.key === key);
          return option
            ? [{ ...option, color: comparisonColors[index] ?? '#48b1ff', primary: false }]
            : [];
        }),
      ]
    : [];
  const domain = getLapChartDomain(series.map(({ laps: samples }) => samples));
  const range = Math.max((domain?.maxTime ?? 0) - (domain?.minTime ?? 0), 1_000);
  const minTime = domain?.minTime ?? 0;
  const maxTime = domain?.maxTime ?? 0;
  const paddedMin = minTime - range * 0.12;
  const paddedMax = maxTime + range * 0.12;
  const firstLap = domain?.minLap ?? 0;
  const lastLap = domain?.maxLap ?? 0;
  const lapTicks = domain
    ? Array.from({ length: domain.maxLap - domain.minLap + 1 }, (_, index) => domain.minLap + index)
    : [];
  const lapX = (lap: number) =>
    plot.left +
    (firstLap === lastLap ? plotWidth / 2 : ((lap - firstLap) / (lastLap - firstLap)) * plotWidth);
  const plottedSeries = series.map((entry) => {
    const points = entry.laps.map((sample) => ({
      ...sample,
      x: lapX(sample.lap),
      y: plot.top + ((paddedMax - sample.timeMs) / (paddedMax - paddedMin)) * plotHeight,
    }));
    return {
      ...entry,
      points,
      path: createLapChartPath(points),
      labelYs: entry.primary ? positionLapTimeLabels(points) : [],
    };
  });
  const renderedSeries = [
    ...plottedSeries.filter((entry) => !entry.primary),
    ...plottedSeries.filter((entry) => entry.primary),
  ];
  const hasPoints = plottedSeries.some(({ points }) => points.length > 0);
  const visibleActivePoint =
    activePoint && plottedSeries.some((entry) => entry.key === activePoint.riderKey)
      ? activePoint
      : null;
  const tooltipX = visibleActivePoint
    ? Math.max(4, Math.min(visibleActivePoint.x - 125, chartWidth - 254))
    : 0;
  const tooltipY = visibleActivePoint
    ? visibleActivePoint.y - 34 < plot.top
      ? visibleActivePoint.y + 12
      : visibleActivePoint.y - 34
    : 0;

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="lap-history-title"
      onCancel={onClose}
      onClose={onClose}
      className="m-auto w-[min(96vw,960px)] max-w-none rounded-xl border border-[#303640] bg-[#11151a] p-0 text-[#eceef2] shadow-2xl backdrop:bg-black/75"
    >
      {selected && (
        <section className="p-5 sm:p-7">
          <header className="mb-5 flex items-start justify-between gap-4">
            <div>
              <div className="mb-1 text-[9px] font-extrabold tracking-[.16em] text-[#8d96a2]">
                LAP TIME HISTORY
              </div>
              <h2 id="lap-history-title" className="m-0 text-xl font-semibold">
                {selected.rider.rider_number ? `#${selected.rider.rider_number} ` : ''}
                {riderName(selected.rider)}
              </h2>
              <p className="mt-1 mb-0 text-xs text-[#8d96a2]">
                {laps.length} {laps.length === 1 ? 'lap' : 'laps'} observed this session
              </p>
            </div>
            <button
              type="button"
              onClick={() => dialogRef.current?.close()}
              aria-label="Close lap history"
              className="grid size-9 shrink-0 place-items-center rounded-md border border-[#343b46] text-lg text-[#aeb6c1] hover:bg-[#20252c] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#e0b864]"
            >
              ×
            </button>
          </header>

          <details className="mb-4 rounded-lg border border-[#282e37] bg-[#0d1014]">
            <summary className="cursor-pointer px-3 py-2 text-xs font-semibold text-[#cbd1d9]">
              Compare riders{' '}
              <span className="ml-1 text-[#8d96a2]">
                ({comparisonKeys.length}/{MAX_COMPARISON_RIDERS})
              </span>
            </summary>
            <fieldset className="grid max-h-48 gap-1 overflow-y-auto border-0 border-t border-[#282e37] p-3 sm:grid-cols-2">
              <legend className="sr-only">Choose riders to compare</legend>
              {riderOptions
                .filter((option) => option.key !== selected.key)
                .map((option) => {
                  const checked = comparisonKeys.includes(option.key);
                  return (
                    <label
                      key={option.key}
                      className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-xs text-[#cbd1d9] hover:bg-[#191e25]"
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={!checked && comparisonKeys.length >= MAX_COMPARISON_RIDERS}
                        onChange={(event) =>
                          onToggleComparison(option.key, event.currentTarget.checked)
                        }
                        className="accent-[#e51d3e]"
                      />
                      <span className="font-bold text-[#aeb6c1] tabular-nums">
                        {option.rider.rider_number ? `#${option.rider.rider_number}` : '—'}
                      </span>
                      <span className="truncate">{riderName(option.rider)}</span>
                      {option.laps.length === 0 && (
                        <span className="ml-auto shrink-0 text-[10px] text-[#77808b]">
                          No laps yet
                        </span>
                      )}
                    </label>
                  );
                })}
            </fieldset>
          </details>

          {!hasPoints ? (
            <div className="grid min-h-48 place-items-center rounded-lg border border-[#282e37] bg-[#0d1014] px-5 text-center text-sm text-[#9ca4ae]">
              Lap history will appear as this dashboard observes completed laps.
            </div>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-[#282e37] bg-[#0d1014] p-2 sm:p-4">
              <svg
                className="h-auto w-full min-w-[520px]"
                viewBox={`0 0 ${chartWidth} ${chartHeight}`}
                role="group"
                aria-label={`Lap time graph for ${riderName(selected.rider)}`}
              >
                {[0, 1, 2, 3].map((line) => {
                  const y = plot.top + (line / 3) * plotHeight;
                  const time = paddedMax - (line / 3) * (paddedMax - paddedMin);
                  return (
                    <g key={line}>
                      <line
                        x1={plot.left}
                        x2={chartWidth - plot.right}
                        y1={y}
                        y2={y}
                        stroke="#252b33"
                      />
                      <text
                        x={plot.left - 9}
                        y={y + 4}
                        fill="#8d96a2"
                        textAnchor="end"
                        fontSize="11"
                      >
                        {formatLapMilliseconds(Math.round(time))}
                      </text>
                    </g>
                  );
                })}
                {renderedSeries.map((entry) => (
                  <g key={entry.key}>
                    {entry.path && (
                      <path
                        d={entry.path}
                        fill="none"
                        stroke={entry.color}
                        strokeWidth={entry.primary ? '3' : '2.5'}
                        strokeLinejoin="round"
                        strokeLinecap="round"
                      />
                    )}
                    {entry.points.map((point, index) => {
                      const pointKey = `${entry.key}:${point.lap}`;
                      const differenceMs = entry.primary
                        ? undefined
                        : getLapTimeDifference(laps, point);
                      const label = `${riderName(entry.rider)} · Lap ${point.lap} · ${formatLapMilliseconds(point.timeMs)}${differenceMs === undefined ? '' : ` · difference ${formatLapTimeDifference(differenceMs)} vs selected rider`}`;
                      const tooltipRiderLabel = entry.rider.rider_number
                        ? `#${entry.rider.rider_number}`
                        : entry.rider.rider_shortname || riderName(entry.rider);
                      return (
                        <g key={pointKey}>
                          <circle
                            cx={point.x}
                            cy={point.y}
                            r={entry.primary ? '4' : '6'}
                            fill={entry.color}
                            stroke="#11151a"
                            strokeWidth={entry.primary ? '1.5' : '2'}
                            tabIndex={0}
                            role="img"
                            aria-label={label}
                            onMouseEnter={() => {
                              if (!entry.primary)
                                setActivePoint({
                                  riderKey: entry.key,
                                  pointKey,
                                  riderLabel: tooltipRiderLabel,
                                  lap: point.lap,
                                  timeMs: point.timeMs,
                                  differenceMs,
                                  x: point.x,
                                  y: point.y,
                                  color: entry.color,
                                });
                            }}
                            onMouseLeave={() =>
                              setActivePoint((current) =>
                                current?.pointKey === pointKey ? null : current
                              )
                            }
                            onFocus={() => {
                              if (!entry.primary)
                                setActivePoint({
                                  riderKey: entry.key,
                                  pointKey,
                                  riderLabel: tooltipRiderLabel,
                                  lap: point.lap,
                                  timeMs: point.timeMs,
                                  differenceMs,
                                  x: point.x,
                                  y: point.y,
                                  color: entry.color,
                                });
                            }}
                            onBlur={() =>
                              setActivePoint((current) =>
                                current?.pointKey === pointKey ? null : current
                              )
                            }
                            className="cursor-pointer focus-visible:stroke-white focus-visible:stroke-[3px]"
                          >
                            <title>{label}</title>
                          </circle>
                          {entry.primary && (
                            <text
                              x={
                                entry.points.length > 1 && index === 0
                                  ? point.x + 8
                                  : entry.points.length > 1 && index === entry.points.length - 1
                                    ? point.x - 8
                                    : point.x
                              }
                              y={entry.labelYs[index]}
                              fill="#d6dae0"
                              textAnchor={
                                entry.points.length > 1 && index === 0
                                  ? 'start'
                                  : entry.points.length > 1 && index === entry.points.length - 1
                                    ? 'end'
                                    : 'middle'
                              }
                              fontSize="10"
                              stroke="#0d1014"
                              strokeWidth="3"
                              paintOrder="stroke"
                            >
                              {formatLapMilliseconds(point.timeMs)}
                            </text>
                          )}
                        </g>
                      );
                    })}
                  </g>
                ))}
                {lapTicks.map((lap) => (
                  <text
                    key={lap}
                    x={lapX(lap)}
                    y={chartHeight - 28}
                    fill="#aeb6c1"
                    textAnchor="middle"
                    fontSize="11"
                  >
                    L{lap}
                  </text>
                ))}
                {visibleActivePoint && (
                  <g pointerEvents="none" aria-hidden="true">
                    <rect
                      x={tooltipX}
                      y={tooltipY}
                      width="250"
                      height="26"
                      rx="5"
                      fill="#20252c"
                      stroke={visibleActivePoint.color}
                    />
                    <text x={tooltipX + 9} y={tooltipY + 17} fill="#f0f2f5" fontSize="10">
                      {`${visibleActivePoint.riderLabel} · L${visibleActivePoint.lap} · ${formatLapMilliseconds(visibleActivePoint.timeMs)}${visibleActivePoint.differenceMs === undefined ? '' : ` · Δ ${formatLapTimeDifference(visibleActivePoint.differenceMs)}`}`}
                    </text>
                  </g>
                )}
                <text
                  x={chartWidth / 2}
                  y={chartHeight - 6}
                  fill="#8d96a2"
                  textAnchor="middle"
                  fontSize="10"
                >
                  LAP
                </text>
              </svg>
              <div
                className="mt-2 flex flex-wrap gap-x-4 gap-y-1 px-2 text-[10px] text-[#cbd1d9]"
                aria-label="Compared riders"
              >
                {plottedSeries.map((entry) => (
                  <span key={entry.key} className="inline-flex items-center gap-1.5">
                    <i
                      className="inline-block size-2 rounded-full"
                      style={{ backgroundColor: entry.color }}
                    />
                    {entry.rider.rider_number ? `#${entry.rider.rider_number} ` : ''}
                    {riderName(entry.rider)}
                  </span>
                ))}
              </div>
              <p className="sr-only" aria-live="polite">
                {visibleActivePoint
                  ? `${visibleActivePoint.riderLabel}, lap ${visibleActivePoint.lap}, ${formatLapMilliseconds(visibleActivePoint.timeMs)}${visibleActivePoint.differenceMs === undefined ? '' : `, difference ${formatLapTimeDifference(visibleActivePoint.differenceMs)} versus selected rider`}`
                  : ''}
              </p>
            </div>
          )}
          {comparisonKeys.length > 0 && hasPoints && (
            <p className="mt-2 mb-0 text-[10px] text-[#858d98]">
              Δ vs selected rider on the same lap: positive is slower; negative is faster.
            </p>
          )}
        </section>
      )}
    </dialog>
  );
}

export function fastestLastLapMilliseconds(riders: Array<{ last_lap_time?: string }>) {
  return riders.reduce<number | undefined>((fastest, rider) => {
    const lapTime = parseLapTimeMilliseconds(rider.last_lap_time);
    return lapTime !== undefined && (fastest === undefined || lapTime < fastest)
      ? lapTime
      : fastest;
  }, undefined);
}

export function formatRemaining(value?: string) {
  const remaining = value?.trim();
  if (!remaining) return undefined;
  if (/^\d+:\d{2}(?::\d{2})?$/.test(remaining)) return remaining;
  if (!/^-?\d+(?:\.\d+)?$/.test(remaining)) return remaining;

  const totalSeconds = Math.floor(Math.abs(Number(remaining)));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = String(totalSeconds % 60).padStart(2, '0');
  return `${Number(remaining) < 0 ? '-' : ''}${minutes}:${seconds}`;
}

export function App() {
  const [timing, setTiming] = useState<LiveTiming | null>(null);
  const [favorites, setFavorites] = useState<Set<string>>(loadFavoriteKeys);
  const [riderFilter, setRiderFilter] = useState<RiderFilter>('all');
  const [connection, setConnection] = useState<ConnectionState>('connecting');
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [clock, setClock] = useState(() => new Date());
  const [errorMessage, setErrorMessage] = useState('');
  const [selectedRider, setSelectedRider] = useState<SelectedRider | null>(null);
  const [comparisonRiderKeys, setComparisonRiderKeys] = useState<string[]>([]);
  const [lapHistoryByRider, setLapHistoryByRider] = useState<
    Record<string, Array<{ lap: number; timeMs: number }>>
  >({});
  const requestInFlight = useRef(false);
  const positionSnapshot = useRef<PositionSnapshot | null>(null);
  const rowElements = useRef(new Map<string, HTMLTableRowElement>());
  const pendingFlip = useRef<PendingFlip | null>(null);
  const [positionChanges, setPositionChanges] = useState<Map<string, PositionChange>>(new Map());
  const [positionFlashes, setPositionFlashes] = useState<Set<string>>(new Set());
  const paceHistory = useRef<PaceHistory | null>(null);
  const [paceRanks, setPaceRanks] = useState<Map<string, number>>(new Map());
  const flipFrame = useRef<number | null>(null);
  const flipCleanup = useRef<number | null>(null);
  const cueTimers = useRef(new Map<string, number>());
  const flashTimers = useRef(new Map<string, number>());

  useEffect(() => {
    let mounted = true;

    const refresh = async () => {
      if (requestInFlight.current) return;
      requestInFlight.current = true;
      try {
        const response = await fetch('/api/live-timing', { cache: 'no-store' });
        if (!response.ok) throw new Error(`Feed request failed (${response.status})`);
        const data = (await response.json()) as LiveTiming;
        if (!mounted) return;
        const nextRiders = Object.values(data.rider ?? {}).sort((a, b) => {
          const aPosition = validPosition(a) ?? Number.MAX_SAFE_INTEGER;
          const bPosition = validPosition(b) ?? Number.MAX_SAFE_INTEGER;
          return aPosition - bPosition;
        });
        const sessionKey =
          [data.head?.session_id, data.head?.event_shortname, data.head?.session_shortname]
            .filter(Boolean)
            .join(':') || undefined;
        let history = paceHistory.current;
        if (history === null) {
          history = createPaceHistory(sessionKey);
          if (sessionKey) {
            try {
              history = loadPaceHistory(window.localStorage, sessionKey);
            } catch {
              // Continue building pace history in memory when local storage is unavailable.
            }
          }
        } else if (history.sessionKey !== sessionKey) {
          if (history.sessionKey) {
            setSelectedRider(null);
            setComparisonRiderKeys([]);
          }
          history = createPaceHistory(sessionKey);
        }
        history = recordPaceLaps(
          history,
          nextRiders.map((rider, index) => ({
            key: riderKey(rider, index),
            lastLap: rider.last_lap,
            lastLapTime: rider.last_lap_time,
          }))
        );
        paceHistory.current = history;
        setLapHistoryByRider(
          Object.fromEntries(
            Object.entries(history.riders).map(([key, entry]) => [key, entry.lapHistory ?? []])
          )
        );
        const excludedPaceRiderKeys = getExcludedPaceRiderKeys(
          nextRiders.map((rider, index) => ({
            key: riderKey(rider, index),
            statusName: rider.status_name,
          }))
        );
        setPaceRanks(rankPaceHistory(history, excludedPaceRiderKeys));
        if (sessionKey) {
          try {
            savePaceHistory(window.localStorage, history);
          } catch {
            // In-memory pace history remains available when local storage is unavailable.
          }
        }
        const previous = positionSnapshot.current;
        const isSameSession = Boolean(sessionKey && previous?.sessionKey === sessionKey);
        const changes = new Map<string, PositionChange>();
        if (previous && isSameSession) {
          nextRiders.forEach((rider, index) => {
            const key = riderKey(rider, index);
            const oldPosition = previous.positions.get(key);
            const newPosition = validPosition(rider);
            if (
              oldPosition === undefined ||
              newPosition === undefined ||
              oldPosition === newPosition
            )
              return;
            changes.set(key, {
              direction: newPosition < oldPosition ? 'up' : 'down',
              places: Math.abs(oldPosition - newPosition),
            });
          });
        }

        if (changes.size > 0) {
          const firstTops = new Map<string, number>();
          rowElements.current.forEach((element, key) =>
            firstTops.set(key, element.getBoundingClientRect().top)
          );
          pendingFlip.current = { firstTops };
        } else {
          pendingFlip.current = null;
        }
        changes.forEach((change, key) => {
          setPositionChanges((current) => new Map(current).set(key, change));
          scheduleRiderExpiry(
            cueTimers.current,
            key,
            POSITION_CUE_DURATION,
            () => {
              setPositionChanges((current) => {
                const next = new Map(current);
                next.delete(key);
                return next;
              });
            },
            {
              setTimeout: (callback, duration) => window.setTimeout(callback, duration),
              clearTimeout: (timer) => window.clearTimeout(timer),
            }
          );

          setPositionFlashes((current) => new Set(current).add(key));
          scheduleRiderExpiry(
            flashTimers.current,
            key,
            POSITION_FLASH_DURATION,
            () => {
              setPositionFlashes((current) => {
                const next = new Set(current);
                next.delete(key);
                return next;
              });
            },
            {
              setTimeout: (callback, duration) => window.setTimeout(callback, duration),
              clearTimeout: (timer) => window.clearTimeout(timer),
            }
          );
        });
        const positions = new Map<string, number>();
        nextRiders.forEach((rider, index) => {
          const position = validPosition(rider);
          if (position !== undefined) positions.set(riderKey(rider, index), position);
        });
        positionSnapshot.current = { sessionKey, positions };
        setTiming(data);
        setLastUpdated(new Date());
        setConnection('connected');
        setErrorMessage('');
      } catch (error) {
        if (!mounted) return;
        setConnection('stale');
        setErrorMessage(error instanceof Error ? error.message : 'Unable to reach timing feed');
      } finally {
        requestInFlight.current = false;
      }
    };

    void refresh();
    const interval = window.setInterval(refresh, POLL_INTERVAL);
    const clockInterval = window.setInterval(() => setClock(new Date()), 1_000);
    return () => {
      mounted = false;
      window.clearInterval(interval);
      window.clearInterval(clockInterval);
    };
  }, []);

  useLayoutEffect(() => {
    const pending = pendingFlip.current;
    pendingFlip.current = null;
    if (!pending || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    if (flipFrame.current !== null) window.cancelAnimationFrame(flipFrame.current);
    if (flipCleanup.current !== null) window.clearTimeout(flipCleanup.current);
    const movedRows: HTMLTableRowElement[] = [];
    rowElements.current.forEach((element, key) => {
      const firstTop = pending.firstTops.get(key);
      if (firstTop === undefined) return;
      const delta = firstTop - element.getBoundingClientRect().top;
      if (Math.abs(delta) < 1) return;
      element.style.transition = 'none';
      element.style.transform = `translateY(${delta}px)`;
      movedRows.push(element);
    });
    if (movedRows.length === 0) return;

    movedRows[0]?.getBoundingClientRect();
    flipFrame.current = window.requestAnimationFrame(() => {
      for (const element of movedRows) {
        element.style.transition = 'transform 350ms cubic-bezier(0.2, 0.75, 0.25, 1)';
        element.style.transform = 'translateY(0)';
      }
      flipCleanup.current = window.setTimeout(() => {
        for (const element of movedRows) {
          element.style.transition = '';
          element.style.transform = '';
        }
        flipCleanup.current = null;
      }, 380);
      flipFrame.current = null;
    });
  }, [timing]);

  useEffect(
    () => () => {
      if (flipFrame.current !== null) window.cancelAnimationFrame(flipFrame.current);
      if (flipCleanup.current !== null) window.clearTimeout(flipCleanup.current);
      cueTimers.current.forEach((timer) => window.clearTimeout(timer));
      flashTimers.current.forEach((timer) => window.clearTimeout(timer));
      cueTimers.current.clear();
      flashTimers.current.clear();
      rowElements.current.forEach((element) => {
        element.style.transition = '';
        element.style.transform = '';
      });
    },
    []
  );

  const head = timing?.head;
  const riders = Object.values(timing?.rider ?? {}).sort((a, b) => {
    const aPosition = validPosition(a) ?? Number.MAX_SAFE_INTEGER;
    const bPosition = validPosition(b) ?? Number.MAX_SAFE_INTEGER;
    return aPosition - bPosition;
  });
  const comparisonOptions: LapHistoryOption[] = riders.map((rider, index) => {
    const key = riderKey(rider, index);
    return { key, rider, laps: lapHistoryByRider[key] ?? [] };
  });
  const fastestLastLap = fastestLastLapMilliseconds(riders);
  const visibleRiders = filterFavoriteRiders(riders, favorites, riderFilter);
  const openRiderHistory = (key: string, rider: TimingRider) => {
    setComparisonRiderKeys([]);
    setSelectedRider({ key, rider });
  };
  const toggleComparison = (key: string, checked: boolean) => {
    setComparisonRiderKeys((current) =>
      checked
        ? toggleComparisonRider(current, key, selectedRider?.key ?? '')
        : current.filter((riderKey) => riderKey !== key)
    );
  };
  const closeRiderHistory = () => {
    setSelectedRider(null);
    setComparisonRiderKeys([]);
  };
  const toggleFavorite = (key: string) => {
    const next = toggleFavoriteKey(favorites, key);
    setFavorites(next);
    saveFavoriteKeys(next);
  };
  const finished = isFinished(head);
  const hasSession = Boolean(
    head && (head.session_id || head.session_shortname || head.session_name)
  );
  const hasTimingRows = riders.length > 0;
  const showUnavailable = !hasSession || !hasTimingRows;
  const explicitlyLive = isExplicitlyLive(head);
  const sessionShortName = head?.session_shortname?.trim();
  const sessionName = head?.session_name?.trim();
  const sessionLabel = sessionShortName || sessionName || 'Live session';
  const sessionDetail =
    sessionShortName && sessionName && sessionShortName.toLowerCase() !== sessionName.toLowerCase()
      ? sessionName
      : undefined;
  const remaining = formatRemaining(head?.remaining);
  const eventName = head?.event_tv_name?.replace(/[™©]/g, '').trim();
  const connectionLabel =
    connection === 'connected'
      ? 'Feed connected'
      : connection === 'stale'
        ? 'Connection lost'
        : 'Connecting';
  const emptyTitle = finished
    ? 'Session complete'
    : connection === 'connecting'
      ? 'Connecting to timing feed'
      : connection === 'stale'
        ? 'Timing feed unavailable'
        : 'No live session right now';
  const emptyDescription = finished
    ? 'The live timing feed has ended for this session.'
    : connection === 'connecting'
      ? 'Checking for an active MotoGP session…'
      : connection === 'stale'
        ? 'The timing service could not be reached. We’ll keep checking automatically.'
        : 'Live timing will appear here when a session is underway.';

  return (
    <main className="mx-auto min-h-screen max-w-[1600px] bg-[radial-gradient(ellipse_at_84%_0%,rgba(112,20,40,0.13),transparent_29rem)] px-4 pb-7 sm:px-7 sm:pb-9 lg:px-14 lg:pb-11">
      <header className="flex h-[66px] items-center justify-between border-b border-[#1b2027] sm:h-[78px]">
        <a
          className="inline-flex items-center gap-3 text-inherit no-underline"
          href="#top"
          aria-label="MotoTiming home"
        >
          <span
            className="grid size-[33px] place-items-center rounded-[9px] border border-[#e51d3e]/25 bg-[#e51d3e]/10 text-[#e51d3e] sm:size-[37px]"
            aria-hidden="true"
          >
            <svg className="size-[25px]" viewBox="0 0 40 40" fill="none">
              <path d="M5 25.5 12.7 12h5.1l-7.7 13.5H5Z" fill="currentColor" />
              <path d="M15 25.5 22.7 12h5.1l-7.7 13.5H15Z" fill="currentColor" opacity=".7" />
              <path d="M25 25.5 32.7 12H38l-7.7 13.5H25Z" fill="currentColor" opacity=".45" />
            </svg>
          </span>
          <span className="flex flex-col gap-[3px]">
            <strong className="text-xs font-extrabold tracking-[.105em] sm:text-sm">
              MOTO<span className="font-medium text-[#a9afb8]">TIMING</span>
            </strong>
            <small className="text-[8px] font-bold tracking-[.2em] text-[#6f7782]">
              RACE CONTROL
            </small>
          </span>
        </a>
        <div className="flex items-center gap-[11px] text-[#a0a7b0] sm:gap-5">
          <span
            className={`inline-flex items-center gap-2 text-[0px] font-semibold tracking-[.025em] sm:text-[11px] ${connection === 'stale' ? 'text-[#efb8bd]' : ''}`}
          >
            <i
              className={`inline-block size-2 rounded-full ${connection === 'connected' ? 'bg-[#56d69a] shadow-[0_0_11px_rgba(86,214,154,.65)]' : connection === 'stale' ? 'bg-[#e51d3e]' : 'animate-pulse bg-[#e0b864] motion-reduce:animate-none'}`}
            />
            {connectionLabel}
          </span>
          <span className="h-[18px] w-px bg-[#2a3039]" />
          <time
            className="flex items-center gap-[5px] text-[10px] text-[#e2e5e9] tabular-nums sm:gap-2 sm:text-xs"
            dateTime={clock.toISOString()}
          >
            {clock.toLocaleTimeString([], {
              hour: '2-digit',
              minute: '2-digit',
              hour12: false,
            })}
            <small className="text-[8px] tracking-[.14em] text-[#69717c]">LOCAL</small>
          </time>
        </div>
      </header>

      <section
        className="relative mt-[17px] flex min-h-0 flex-col items-stretch gap-[23px] overflow-hidden rounded-[14px] border border-[#282e37] bg-[linear-gradient(112deg,#171b21_0%,#111419_51%,#181319_100%)] p-[25px_21px_20px] before:absolute before:inset-y-0 before:left-0 before:w-1 before:bg-[#e51d3e] sm:mt-[26px] sm:min-h-[230px] sm:flex-row sm:items-center sm:justify-between sm:gap-6 sm:p-8 lg:px-[42px]"
        id="top"
      >
        <div className="relative z-10">
          <div className="flex items-center gap-2.5 text-[10px] font-extrabold tracking-[.16em] text-[#c7cbd2]">
            <span className="h-0.5 w-[18px] bg-[#e51d3e]" />
            {head?.category || 'MOTOGP'}
            <span className="text-[#6e7681]">/</span>LIVE TIMING
          </div>
          <h1 className="my-3 max-w-[720px] text-[27px] leading-[1.1] font-semibold tracking-[-.04em] text-[#f4f5f7] sm:my-[14px] sm:text-[clamp(26px,3vw,38px)]">
            {eventName || 'Race timing'}
          </h1>
          <div className="flex items-start gap-[9px] text-[10px] leading-relaxed text-[#a0a8b2] sm:items-center sm:text-xs">
            <span
              className="grid size-5 shrink-0 place-items-center text-[#d1d5db]"
              aria-hidden="true"
            >
              <svg className="size-5" viewBox="0 0 24 24" fill="none">
                <path
                  d="M8 5.5 5.8 8l1.6 3.2-2 2.1 1.3 4.2 4 1.1 2.8-2.2 3.8.2 2-2.5-1.8-3-3.2-.4-1.7-2.8-4.6-1.4Z"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinejoin="round"
                />
                <path
                  d="m9 8 2.3 2.1-.7 2.2 2.8 1.4"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                />
              </svg>
            </span>
            <span>{head?.circuit_name || 'Waiting for circuit data'}</span>
            {head?.event_shortname && (
              <>
                <span className="text-[#505762]">·</span>
                <span>{head.event_shortname}</span>
              </>
            )}
          </div>
        </div>
        <div className="relative z-10 grid min-w-0 grid-cols-[1fr_auto] items-center gap-x-[14px] gap-y-[7px] rounded-[10px] border border-[#30343d] bg-[rgba(8,10,13,.32)] px-[15px] py-[13px] sm:block sm:min-w-[215px] sm:px-[22px] sm:py-5">
          <div className="col-start-1 text-[9px] font-bold tracking-[.16em] text-[#858d98]">
            CURRENT SESSION
          </div>
          <div className="col-start-1 min-w-0 sm:my-[9px]">
            <div className="text-sm font-semibold text-[#f3f3f5] sm:text-[17px]">
              {sessionLabel}
            </div>
            {sessionDetail && (
              <div className="mt-0.5 text-[10px] text-[#a0a8b2] sm:text-xs">{sessionDetail}</div>
            )}
          </div>
          {remaining && (
            <div className="col-start-1 flex items-center gap-2 text-[9px] font-bold tracking-[.08em] text-[#858d98]">
              REMAINING{' '}
              <span className="font-mono text-[11px] font-semibold tracking-normal text-[#d6dae0]">
                {remaining}
              </span>
            </div>
          )}
          <div
            className={`col-start-2 ${sessionDetail || remaining ? 'row-span-3' : 'row-span-2'} flex items-center gap-[7px] border-0 pt-0 text-[8px] font-extrabold tracking-[.09em] sm:border-t sm:border-[#2c3038] sm:pt-3 sm:text-[9px]`}
          >
            <i
              className={`inline-block size-[7px] rounded-full ${explicitlyLive && !finished ? 'animate-pulse bg-[#e51d3e] shadow-[0_0_10px_rgba(229,29,62,.7)] motion-reduce:animate-none' : 'bg-[#78808b]'}`}
            />
            <span className={explicitlyLive && !finished ? 'text-[#f18495]' : 'text-[#89919d]'}>
              {finished ? 'SESSION ENDED' : explicitlyLive ? 'LIVE SESSION' : 'STATUS UNCONFIRMED'}
            </span>
          </div>
        </div>
        <div
          className="pointer-events-none absolute -right-[9%] -bottom-[115px] text-[350px] leading-[.8] font-black text-white/[.018] italic sm:right-[25%] sm:bottom-[-130px] sm:text-[440px]"
          aria-hidden="true"
        >
          M
        </div>
      </section>

      <section className="mt-[27px] sm:mt-9" aria-labelledby="timing-heading">
        <div className="mb-[18px] flex items-end justify-between gap-5">
          <div>
            <div className="mb-[7px] text-[9px] font-extrabold tracking-[.18em] text-[#777f8a]">
              ON TRACK
            </div>
            <h2
              className="m-0 text-xl font-semibold tracking-[-.03em] text-[#f0f1f4] sm:text-[22px]"
              id="timing-heading"
            >
              Timing tower
            </h2>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-[9px] text-right text-[9px] text-[#89919c] sm:gap-[17px] sm:text-[10px]">
            <span className="flex items-baseline gap-[5px] text-[7px] font-extrabold tracking-[.1em] sm:gap-[7px] sm:text-[8px]">
              <strong className="text-[15px] font-semibold tracking-[-.03em] text-[#eef0f3] tabular-nums sm:text-[17px]">
                {String(visibleRiders.length).padStart(2, '0')}
              </strong>{' '}
              RIDERS
            </span>
            <div
              className="inline-flex rounded-md border border-[#303640] bg-[#11151a] p-[2px]"
              role="group"
              aria-label="Filter riders"
            >
              <button
                type="button"
                aria-pressed={riderFilter === 'all'}
                onClick={() => setRiderFilter('all')}
                className={`rounded px-2 py-1 text-[8px] font-bold transition-colors ${riderFilter === 'all' ? 'bg-[#2a3039] text-[#f0f2f5]' : 'text-[#89919c] hover:text-[#dce0e5]'}`}
              >
                All
              </button>
              <button
                type="button"
                aria-pressed={riderFilter === 'favorites'}
                onClick={() => setRiderFilter('favorites')}
                className={`rounded px-2 py-1 text-[8px] font-bold transition-colors ${riderFilter === 'favorites' ? 'bg-[#2a3039] text-[#f0f2f5]' : 'text-[#89919c] hover:text-[#dce0e5]'}`}
              >
                Favorites
              </button>
            </div>
            <span className="max-w-[94px] leading-[1.35] tabular-nums sm:max-w-none">
              <span className="mr-[3px] inline-block align-[-1px] text-[15px] text-[#aeb5bf] sm:mr-[7px]">
                ↻
              </span>
              {lastUpdated
                ? `Updated ${lastUpdated.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })}`
                : 'Waiting for feed'}
            </span>
          </div>
        </div>

        {connection === 'stale' && (
          <div className="mb-3 flex min-h-[42px] items-center gap-2.5 rounded-[7px] border border-[rgba(199,92,105,.28)] bg-[rgba(127,34,48,.13)] px-[13px] py-[9px] text-[9px] leading-[1.45] text-[#e9b8be] sm:text-[10px]">
            <span className="grid size-[17px] shrink-0 place-items-center rounded-full border border-[#96515b] text-[10px] font-extrabold text-[#eea0aa]">
              !
            </span>
            <span>
              {timing
                ? 'Showing the last received timing data. Reconnecting…'
                : `Unable to connect to the live timing feed${errorMessage ? `: ${errorMessage}` : '.'}`}
            </span>
            {timing && lastUpdated && (
              <span className="ml-auto hidden text-[9px] text-[#b7858b] tabular-nums sm:inline">
                Last update{' '}
                {lastUpdated.toLocaleTimeString([], {
                  hour: '2-digit',
                  minute: '2-digit',
                  second: '2-digit',
                  hour12: false,
                })}
              </span>
            )}
          </div>
        )}

        {showUnavailable ? (
          <div className="flex min-h-[280px] flex-col items-center justify-center rounded-[11px] border border-[#282e37] bg-[linear-gradient(145deg,#111419,#0e1115)] p-[25px_18px] text-center sm:min-h-[315px] sm:p-8">
            <span
              className="mb-4 grid size-[50px] place-items-center rounded-[13px] border border-[#323842] bg-[#171b21] text-[#9ca4ae]"
              aria-hidden="true"
            >
              <svg className="size-7" viewBox="0 0 48 48" fill="none">
                <circle cx="24" cy="24" r="17" stroke="currentColor" strokeWidth="1.5" />
                <path
                  d="M17 24h14M24 17v14"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                />
                <path d="m11.5 11.5 25 25" stroke="currentColor" strokeWidth="1.5" />
              </svg>
            </span>
            <div className="text-base font-semibold text-[#eceef2]">{emptyTitle}</div>
            <p className="mt-2 mb-5 max-w-[380px] text-[11px] leading-relaxed text-[#838b96]">
              {emptyDescription}
            </p>
            <span className="flex items-center gap-[7px] text-[8px] font-bold tracking-[.11em] text-[#67707b]">
              <i className="inline-block size-[5px] rounded-full bg-[#db5268]" />
              AUTO-REFRESHING EVERY 3 SECONDS
            </span>
          </div>
        ) : (
          <>
            <div className="[scrollbar-color:#343b46_#101318] overflow-auto rounded-[11px] border border-[#282e37] bg-[#101318]">
              {riderFilter === 'favorites' && visibleRiders.length === 0 ? (
                <div
                  className="flex min-h-[120px] flex-col items-center justify-center gap-2 px-4 text-center"
                  role="status"
                >
                  <span className="text-xl text-[#e0b864]" aria-hidden="true">
                    ☆
                  </span>
                  <span className="text-xs font-semibold text-[#d6dae0]">
                    {favorites.size === 0
                      ? 'No favorite riders yet'
                      : 'No favorite riders in this session'}
                  </span>
                  <span className="text-[10px] text-[#89919c]">
                    Star a rider to add them to your favorites.
                  </span>
                </div>
              ) : (
                <table className="w-full min-w-[1058px] table-fixed border-collapse text-left">
                  <thead className="bg-[#15191f]">
                    <tr>
                      <th className="h-[32px] w-[68px] border-b border-[#2a3038] pr-1.5 pl-2 text-[10px] font-extrabold tracking-[.12em] text-[#a0a8b2]">
                        POS
                      </th>
                      <th className="h-[32px] w-[190px] border-b border-[#2a3038] px-1.5 text-[10px] font-extrabold tracking-[.12em] text-[#a0a8b2]">
                        RIDER
                      </th>
                      <th className="h-[32px] w-[100px] border-b border-[#2a3038] px-1.5 text-[10px] font-extrabold tracking-[.12em] text-[#a0a8b2]">
                        LAP TIME
                      </th>
                      <th className="h-[32px] w-[100px] border-b border-[#2a3038] px-1.5 text-[10px] font-extrabold tracking-[.12em] text-[#a0a8b2]">
                        LAST LAP TIME
                      </th>
                      <th className="h-[32px] w-[58px] border-b border-[#2a3038] px-1.5 text-[10px] font-extrabold tracking-[.12em] text-[#a0a8b2]">
                        PACE
                      </th>
                      <th className="h-[32px] w-[70px] border-b border-[#2a3038] px-1.5 text-[10px] font-extrabold tracking-[.12em] text-[#a0a8b2]">
                        GAP FIRST
                      </th>
                      <th className="h-[32px] w-[70px] border-b border-[#2a3038] px-1.5 text-[10px] font-extrabold tracking-[.12em] text-[#a0a8b2]">
                        GAP PREV
                      </th>
                      <th className="h-[32px] w-[60px] border-b border-[#2a3038] px-1.5 text-[10px] font-extrabold tracking-[.12em] text-[#a0a8b2]">
                        LAPS
                      </th>
                      <th className="h-[32px] w-[78px] border-b border-[#2a3038] px-1.5 text-[10px] font-extrabold tracking-[.12em] text-[#a0a8b2]">
                        STATUS
                      </th>
                      <th className="h-[32px] w-[190px] border-b border-[#2a3038] px-1.5 text-[10px] font-extrabold tracking-[.12em] text-[#a0a8b2]">
                        TEAM
                      </th>
                      <th className="h-[32px] w-[74px] border-b border-[#2a3038] px-1.5 text-[10px] font-extrabold tracking-[.12em] text-[#a0a8b2]">
                        BIKE
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleRiders.map(({ rider, index }) => {
                      const color = validColor(rider.color);
                      const position = validPosition(rider);
                      const key = riderKey(rider, index);
                      const favoriteKey = favoriteRiderKey(rider);
                      const isFavorite = favoriteKey !== undefined && favorites.has(favoriteKey);
                      const lastLapTime = parseLapTimeMilliseconds(rider.last_lap_time);
                      const isFastestLastLap =
                        lastLapTime !== undefined && lastLapTime === fastestLastLap;
                      const paceRank = paceRanks.get(key);
                      const positionChange = positionChanges.get(key);
                      const positionFlash = positionFlashes.has(key);
                      return (
                        <tr
                          ref={(element) => {
                            if (element) rowElements.current.set(key, element);
                            else rowElements.current.delete(key);
                          }}
                          key={key}
                          tabIndex={0}
                          aria-label={`Show lap history for ${riderName(rider)}`}
                          aria-haspopup="dialog"
                          onClick={() => openRiderHistory(key, rider)}
                          onKeyDown={(event) => {
                            if (event.target !== event.currentTarget) return;
                            if (event.key === 'Enter' || event.key === ' ') {
                              event.preventDefault();
                              openRiderHistory(key, rider);
                            }
                          }}
                          className="focus-visible:outline-inset h-[30px] cursor-pointer border-b border-[#20252c] transition-colors hover:bg-[#161a20] focus-visible:outline-2 focus-visible:outline-[#e0b864]"
                        >
                          <td
                            className={`py-0 pr-1.5 pl-2 text-[12px] whitespace-nowrap text-[#dce0e5] ${positionFlash && positionChange ? (positionChange.direction === 'up' ? 'animate-[position-up_700ms_ease-out] motion-reduce:animate-none' : 'animate-[position-down_700ms_ease-out] motion-reduce:animate-none') : ''}`}
                          >
                            <span className="text-sm font-bold tabular-nums">
                              {position === undefined ? '—' : position}
                            </span>
                            {positionChange && (
                              <span
                                className={`ml-1.5 inline-flex items-center gap-[2px] text-[10px] font-bold ${positionChange.direction === 'up' ? 'text-[#56d69a]' : 'text-[#ef7888]'}`}
                                aria-label={`Moved ${positionChange.direction} ${positionChange.places} ${positionChange.places === 1 ? 'place' : 'places'}`}
                              >
                                <svg
                                  aria-hidden="true"
                                  className="size-3 shrink-0 fill-current"
                                  viewBox="0 0 12 12"
                                >
                                  <path
                                    d={
                                      positionChange.direction === 'up'
                                        ? 'M6 0 12 6H8.25V12h-4.5V6H0L6 0Z'
                                        : 'm6 12 6-6H8.25V0h-4.5v6H0l6 6Z'
                                    }
                                  />
                                </svg>
                                {positionChange.places > 1 ? positionChange.places : ''}
                              </span>
                            )}
                          </td>
                          <td className="px-1.5 py-0 text-xs whitespace-nowrap text-[#d5d9df]">
                            <div className="flex min-w-0 items-center gap-1">
                              <button
                                type="button"
                                disabled={!favoriteKey}
                                aria-pressed={isFavorite}
                                aria-label={
                                  favoriteKey
                                    ? `${isFavorite ? 'Remove' : 'Add'} ${riderName(rider)} ${isFavorite ? 'from' : 'to'} favorites`
                                    : `Favorite unavailable for ${riderName(rider)}`
                                }
                                title={
                                  favoriteKey
                                    ? `${isFavorite ? 'Remove' : 'Add'} ${riderName(rider)} ${isFavorite ? 'from' : 'to'} favorites`
                                    : 'Rider identity unavailable'
                                }
                                onClick={(event) => {
                                  event.stopPropagation();
                                  if (favoriteKey) toggleFavorite(favoriteKey);
                                }}
                                className={`grid size-6 shrink-0 place-items-center rounded transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#e0b864] disabled:cursor-not-allowed ${isFavorite ? 'text-[#e0b864]' : 'text-[#606975] hover:text-[#b1bac5]'}`}
                              >
                                <svg
                                  className="size-[15px]"
                                  viewBox="0 0 20 20"
                                  fill="none"
                                  aria-hidden="true"
                                >
                                  <path
                                    d="m10 2.4 2.3 4.7 5.2.8-3.8 3.7.9 5.2-4.6-2.5-4.6 2.5.9-5.2-3.8-3.7 5.2-.8L10 2.4Z"
                                    fill={isFavorite ? 'currentColor' : 'none'}
                                    stroke="currentColor"
                                    strokeWidth="1.4"
                                    strokeLinejoin="round"
                                  />
                                </svg>
                              </button>
                              <span
                                className="grid size-[24px] shrink-0 place-items-center overflow-hidden rounded-md bg-[#292e36] text-xs font-extrabold text-[#e9ebee] tabular-nums"
                                style={
                                  color
                                    ? {
                                        backgroundColor: color,
                                        color: validColor(rider.text_color) || '#fff',
                                      }
                                    : undefined
                                }
                              >
                                {rider.rider_number || '—'}
                              </span>
                              <strong className="min-w-0 overflow-hidden text-[14px] font-semibold text-ellipsis text-[#eef0f3]">
                                {riderName(rider)}
                              </strong>
                            </div>
                          </td>
                          <td className="px-1.5 py-0 text-[14px] font-semibold whitespace-nowrap text-[#f3f4f6] tabular-nums">
                            {formatTime(rider.lap_time)}
                          </td>
                          <td
                            className={`px-1.5 py-0 text-[14px] font-semibold whitespace-nowrap tabular-nums ${isFastestLastLap ? 'text-[#ff6178]' : 'text-[#d6dae0]'}`}
                          >
                            {formatTime(rider.last_lap_time)}
                          </td>
                          <td className="px-1.5 py-0 text-[14px] font-semibold whitespace-nowrap text-[#d6dae0] tabular-nums">
                            {paceRank ?? '—'}
                          </td>
                          <td className="px-1.5 py-0 text-[14px] font-semibold whitespace-nowrap text-[#cbd1d9] tabular-nums">
                            {formatGap(rider.gap_first)}
                          </td>
                          <td className="px-1.5 py-0 text-[14px] font-semibold whitespace-nowrap text-[#cbd1d9] tabular-nums">
                            {formatGap(rider.gap_prev)}
                          </td>
                          <td className="px-1.5 py-0 text-[14px] font-semibold whitespace-nowrap text-[#e5e8ec] tabular-nums">
                            {rider.num_lap ?? '—'}
                            <small className="text-[11px] font-semibold text-[#a0a8b2]"> L</small>
                          </td>
                          <td className="px-1.5 py-0 text-left whitespace-nowrap">
                            {rider.on_pit ? (
                              <span className="inline-block rounded border border-[#81683c] bg-[rgba(160,117,39,.15)] px-2 py-[5px] text-[10px] font-extrabold tracking-[.1em] text-[#f0d08a]">
                                PIT
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-[6px] text-[10px] font-extrabold tracking-[.08em] text-[#b3bbc5]">
                                <i className="inline-block size-[5px] rounded-full bg-[#87919d]" />
                                TRACK
                              </span>
                            )}
                          </td>
                          <td className="px-1.5 py-0 whitespace-nowrap text-[#d5d9df]">
                            <div className="flex min-w-0 items-center gap-[6px]">
                              <span
                                className="h-7 w-[3px] shrink-0 rounded-[3px] bg-[#58616e]"
                                style={color ? { backgroundColor: color } : undefined}
                              />
                              <strong className="min-w-0 overflow-hidden text-[11px] font-semibold text-ellipsis text-[#e0e3e8]">
                                {rider.team_name || '—'}
                              </strong>
                            </div>
                          </td>
                          <td className="px-1.5 py-0 text-[12px] font-semibold whitespace-nowrap text-[#d0d5dc]">
                            {rider.bike_name || '—'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </>
        )}
        <footer className="flex justify-between gap-3 px-[3px] py-[13px] text-[7px] font-bold tracking-[.11em] text-[#626b76] sm:text-[8px]">
          <span className="inline-flex items-center gap-[7px]">
            <i className="inline-block size-[5px] rounded-full bg-[#707984]" />
            TIMING DATA PROVIDED BY MOTOGP
          </span>
          <span>UPDATES EVERY 3 SEC</span>
        </footer>
      </section>
      <LapHistoryDialog
        selected={selectedRider}
        laps={selectedRider ? (lapHistoryByRider[selectedRider.key] ?? []) : []}
        riderOptions={comparisonOptions}
        comparisonKeys={comparisonRiderKeys}
        onToggleComparison={toggleComparison}
        onClose={closeRiderHistory}
      />
      <div className="mt-[14px] h-px bg-[linear-gradient(90deg,transparent,#292e36_20%,#292e36_80%,transparent)]" />
    </main>
  );
}

export default App;
