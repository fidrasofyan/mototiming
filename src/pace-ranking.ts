export const PACE_LAP_WINDOW = 3;
export const PACE_HISTORY_STORAGE_KEY = 'mototiming:pace-history:v1';

export type PaceHistoryEntry = {
  lastLap?: number;
  lastLapTime?: string;
  sampledLap?: number;
  lapTimesMs: number[];
  lapHistory: Array<{ lap: number; timeMs: number }>;
};

export type PaceHistory = {
  sessionKey?: string;
  riders: Record<string, PaceHistoryEntry>;
};

export type PaceLapObservation = {
  key: string;
  lastLap?: number;
  lastLapTime?: string;
};

export type PaceHistoryStorage = {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
};

export function parseLapTimeMilliseconds(value?: string) {
  const match = value?.trim().match(/^(\d+)[’'′:](\d{1,2}(?:\.\d+)?)$/);
  if (!match) return undefined;

  const minutes = Number(match[1]);
  const seconds = Number(match[2]);
  if (seconds >= 60) return undefined;

  const totalMilliseconds = minutes * 60_000 + Math.round(seconds * 1_000);
  return Number.isSafeInteger(totalMilliseconds) && totalMilliseconds > 0
    ? totalMilliseconds
    : undefined;
}

export function createPaceHistory(sessionKey?: string): PaceHistory {
  return { sessionKey, riders: {} };
}

export function parsePaceHistory(value: string | null, sessionKey: string) {
  if (!value) return undefined;

  try {
    const parsed: unknown = JSON.parse(value);
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      !('sessionKey' in parsed) ||
      parsed.sessionKey !== sessionKey ||
      !('riders' in parsed) ||
      typeof parsed.riders !== 'object' ||
      parsed.riders === null
    )
      return undefined;

    const riders: PaceHistory['riders'] = Object.create(null);
    Object.entries(parsed.riders).forEach(([key, entry]) => {
      if (typeof entry !== 'object' || entry === null || !('lapTimesMs' in entry)) return;
      const lapTimesMs = Array.isArray(entry.lapTimesMs)
        ? (entry.lapTimesMs as unknown[])
            .filter(
              (lapTime: unknown): lapTime is number =>
                typeof lapTime === 'number' && Number.isSafeInteger(lapTime) && lapTime > 0
            )
            .slice(-PACE_LAP_WINDOW)
        : [];
      riders[key] = {
        lapTimesMs,
        lapHistory:
          'lapHistory' in entry && Array.isArray(entry.lapHistory)
            ? entry.lapHistory
                .filter(
                  (sample: unknown): sample is { lap: number; timeMs: number } =>
                    typeof sample === 'object' &&
                    sample !== null &&
                    'lap' in sample &&
                    typeof sample.lap === 'number' &&
                    Number.isSafeInteger(sample.lap) &&
                    sample.lap > 0 &&
                    'timeMs' in sample &&
                    typeof sample.timeMs === 'number' &&
                    Number.isSafeInteger(sample.timeMs) &&
                    sample.timeMs > 0
                )
                .sort(
                  (a: { lap: number; timeMs: number }, b: { lap: number; timeMs: number }) =>
                    a.lap - b.lap
                )
            : [],
        lastLap:
          'lastLap' in entry &&
          typeof entry.lastLap === 'number' &&
          Number.isSafeInteger(entry.lastLap) &&
          entry.lastLap >= 0
            ? entry.lastLap
            : undefined,
        lastLapTime:
          'lastLapTime' in entry && typeof entry.lastLapTime === 'string'
            ? entry.lastLapTime
            : undefined,
        sampledLap:
          'sampledLap' in entry &&
          typeof entry.sampledLap === 'number' &&
          Number.isSafeInteger(entry.sampledLap) &&
          entry.sampledLap >= 0
            ? entry.sampledLap
            : undefined,
      };
    });
    return { sessionKey, riders } satisfies PaceHistory;
  } catch {
    return undefined;
  }
}

export function loadPaceHistory(storage: PaceHistoryStorage, sessionKey: string) {
  try {
    return (
      parsePaceHistory(storage.getItem(PACE_HISTORY_STORAGE_KEY), sessionKey) ??
      createPaceHistory(sessionKey)
    );
  } catch {
    return createPaceHistory(sessionKey);
  }
}

export function savePaceHistory(storage: PaceHistoryStorage, history: PaceHistory) {
  if (!history.sessionKey) return;
  try {
    storage.setItem(PACE_HISTORY_STORAGE_KEY, JSON.stringify(history));
  } catch {
    // Keep pace tracking usable in memory when browser storage is unavailable.
  }
}

const PACE_EXCLUDED_STATUSES = new Set(['RT', 'NC', 'DNF', 'DNS', 'DSQ', 'WD', 'DNQ']);

export function getExcludedPaceRiderKeys(observations: { key: string; statusName?: string }[]) {
  return new Set(
    observations
      .filter(({ statusName }) =>
        PACE_EXCLUDED_STATUSES.has(statusName?.trim().toUpperCase() ?? '')
      )
      .map(({ key }) => key)
  );
}

export function recordPaceLaps(history: PaceHistory, observations: PaceLapObservation[]) {
  const riders = { ...history.riders };

  observations.forEach(({ key, lastLap, lastLapTime }) => {
    const previous = riders[key] ?? { lapTimesMs: [], lapHistory: [] };
    const samples = [...previous.lapTimesMs].slice(-PACE_LAP_WINDOW);
    const lapHistory = [...(previous.lapHistory ?? [])];
    const lapTime = parseLapTimeMilliseconds(lastLapTime);
    const validLapCounter =
      typeof lastLap === 'number' && Number.isSafeInteger(lastLap) && lastLap >= 0;
    let sampledLap = previous.sampledLap;

    if (validLapCounter) {
      if (previous.lastLap !== undefined && lastLap < previous.lastLap) {
        samples.length = 0;
        if (lapTime !== undefined) samples.push(lapTime);
        sampledLap = lapTime === undefined ? undefined : lastLap;
      } else if (previous.lastLap === undefined) {
        if (lapTime !== undefined && lastLapTime !== previous.lastLapTime) {
          samples.push(lapTime);
          sampledLap = lastLap;
        } else if (lapTime !== undefined && lastLapTime === previous.lastLapTime) {
          sampledLap = lastLap;
        }
      } else if (lastLap > previous.lastLap) {
        if (lapTime !== undefined) {
          samples.push(lapTime);
          sampledLap = lastLap;
          const existingIndex = lapHistory.findIndex((sample) => sample.lap === lastLap);
          if (existingIndex >= 0) lapHistory[existingIndex] = { lap: lastLap, timeMs: lapTime };
          else lapHistory.push({ lap: lastLap, timeMs: lapTime });
        } else {
          sampledLap = undefined;
        }
      } else if (
        lastLap === previous.lastLap &&
        lapTime !== undefined &&
        lastLapTime !== previous.lastLapTime
      ) {
        if (sampledLap === lastLap && samples.length > 0) {
          samples[samples.length - 1] = lapTime;
          const existingIndex = lapHistory.findIndex((sample) => sample.lap === lastLap);
          if (existingIndex >= 0) lapHistory[existingIndex] = { lap: lastLap, timeMs: lapTime };
        } else {
          samples.push(lapTime);
          sampledLap = lastLap;
          const existingIndex = lapHistory.findIndex((sample) => sample.lap === lastLap);
          if (existingIndex >= 0) lapHistory[existingIndex] = { lap: lastLap, timeMs: lapTime };
          else lapHistory.push({ lap: lastLap, timeMs: lapTime });
        }
      } else if (
        sampledLap === undefined &&
        lapTime !== undefined &&
        lastLapTime === previous.lastLapTime
      ) {
        sampledLap = lastLap;
      }
    } else if (lapTime !== undefined && lastLapTime !== previous.lastLapTime) {
      samples.push(lapTime);
      sampledLap = undefined;
    }

    riders[key] = {
      lastLap: validLapCounter ? lastLap : previous.lastLap,
      lastLapTime,
      sampledLap,
      lapTimesMs: samples.slice(-PACE_LAP_WINDOW),
      lapHistory,
    };
  });

  return { ...history, riders };
}

export function rankPaceHistory(history: PaceHistory, excludedRiderKeys?: ReadonlySet<string>) {
  const averages = Object.entries(history.riders)
    .filter(
      ([key, entry]) => entry.lapTimesMs.length === PACE_LAP_WINDOW && !excludedRiderKeys?.has(key)
    )
    .map(([key, entry]) => ({
      key,
      total: entry.lapTimesMs.reduce((sum, lapTime) => sum + lapTime, 0),
    }))
    .sort((a, b) => a.total - b.total);
  const ranks = new Map<string, number>();
  let rank = 0;
  let previousTotal: number | undefined;

  averages.forEach(({ key, total }, index) => {
    if (previousTotal !== total) rank = index + 1;
    ranks.set(key, rank);
    previousTotal = total;
  });

  return ranks;
}
