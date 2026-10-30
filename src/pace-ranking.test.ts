import { expect, test } from 'bun:test';

import {
  PACE_HISTORY_STORAGE_KEY,
  PACE_LAP_WINDOW,
  createPaceHistory,
  getExcludedPaceRiderKeys,
  loadPaceHistory,
  parseLapTimeMilliseconds,
  rankPaceHistory,
  recordPaceLaps,
  savePaceHistory,
  type PaceHistoryStorage,
} from './pace-ranking';

function createMemoryStorage(): PaceHistoryStorage & { values: Map<string, string> } {
  const values = new Map<string, string>();
  return {
    values,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
}

function addLap(
  history: ReturnType<typeof createPaceHistory>,
  key: string,
  lap: number,
  time: string
) {
  return recordPaceLaps(history, [{ key, lastLap: lap, lastLapTime: time }]);
}

test('records each completed lap once and retains only the latest three samples', () => {
  let history = createPaceHistory('event:session');
  history = addLap(history, 'rider-1', 1, "1'45.000");
  history = addLap(history, 'rider-1', 1, "1'45.000");
  history = addLap(history, 'rider-1', 2, "1'44.000");
  history = addLap(history, 'rider-1', 3, "1'43.000");
  history = addLap(history, 'rider-1', 4, "1'42.000");

  expect(history.riders['rider-1']?.lapTimesMs).toEqual([104_000, 103_000, 102_000]);
  expect(history.riders['rider-1']?.lapHistory).toEqual([
    { lap: 2, timeMs: 104_000 },
    { lap: 3, timeMs: 103_000 },
    { lap: 4, timeMs: 102_000 },
  ]);
  expect(PACE_LAP_WINDOW).toBe(3);
});

test('replaces a corrected lap and omits invalid lap samples from graph history', () => {
  let history = createPaceHistory('event:session');
  history = addLap(history, 'rider-1', 1, '—');
  history = addLap(history, 'rider-1', 2, "1'44.000");
  history = recordPaceLaps(history, [{ key: 'rider-1', lastLap: 2, lastLapTime: "1'43.500" }]);
  history = addLap(history, 'rider-1', 3, 'unavailable');

  expect(history.riders['rider-1']?.lapHistory).toEqual([{ lap: 2, timeMs: 103_500 }]);
});

test('keeps graph history scoped to the session when the rider lap counter regresses', () => {
  let history = createPaceHistory('event:session');
  history = addLap(history, 'rider-1', 2, "1'44.000");
  history = addLap(history, 'rider-1', 3, "1'43.000");
  history = addLap(history, 'rider-1', 1, "1'50.000");

  expect(history.riders['rider-1']?.lapHistory).toEqual([{ lap: 3, timeMs: 103_000 }]);
});

test('uses changed lap times to deduplicate when the lap counter is unavailable', () => {
  let history = createPaceHistory('event:session');
  history = recordPaceLaps(history, [{ key: 'rider-1', lastLapTime: "1'45.000" }]);
  history = recordPaceLaps(history, [{ key: 'rider-1', lastLapTime: "1'45.000" }]);
  history = recordPaceLaps(history, [{ key: 'rider-1', lastLapTime: "1'44.000" }]);

  expect(history.riders['rider-1']?.lapTimesMs).toEqual([105_000, 104_000]);
});

test('ignores missing and invalid completed lap times', () => {
  let history = createPaceHistory('event:session');
  history = recordPaceLaps(history, [
    { key: 'rider-1', lastLap: 1, lastLapTime: '—' },
    { key: 'rider-2', lastLap: 1 },
  ]);

  expect(history.riders['rider-1']?.lapTimesMs).toEqual([]);
  expect(history.riders['rider-2']?.lapTimesMs).toEqual([]);
  expect(rankPaceHistory(history).size).toBe(0);
});

test('does not recount a fallback sample when a lap counter becomes available', () => {
  let history = createPaceHistory('event:session');
  history = recordPaceLaps(history, [{ key: 'rider-1', lastLapTime: "1'45.000" }]);
  history = recordPaceLaps(history, [{ key: 'rider-1', lastLap: 4, lastLapTime: "1'45.000" }]);
  history = addLap(history, 'rider-1', 5, "1'44.000");

  expect(history.riders['rider-1']?.lapTimesMs).toEqual([105_000, 104_000]);
});

test('restores pace history only for the matching session and tolerates storage errors', () => {
  const storage = createMemoryStorage();
  const history = addLap(createPaceHistory('event:session'), 'rider-1', 1, "1'45.000");
  savePaceHistory(storage, history);

  expect(storage.values.has(PACE_HISTORY_STORAGE_KEY)).toBe(true);
  expect(loadPaceHistory(storage, 'event:session')).toEqual(history);
  expect(loadPaceHistory(storage, 'other-session')).toEqual(createPaceHistory('other-session'));

  const throwingStorage: PaceHistoryStorage = {
    getItem: () => {
      throw new Error('storage unavailable');
    },
    setItem: () => {
      throw new Error('storage unavailable');
    },
  };
  expect(loadPaceHistory(throwingStorage, 'event:session')).toEqual(
    createPaceHistory('event:session')
  );
  expect(() => savePaceHistory(throwingStorage, history)).not.toThrow();
});

test('ranks three-lap averages with shared ties and leaves incomplete histories unranked', () => {
  let history = createPaceHistory('event:session');
  history = addLap(history, 'rider-1', 1, "1'40.000");
  history = addLap(history, 'rider-2', 1, "1'41.000");
  history = addLap(history, 'rider-3', 1, "1'40.100");
  history = addLap(history, 'rider-4', 1, "1'39.000");
  history = addLap(history, 'rider-1', 2, "1'40.000");
  history = addLap(history, 'rider-2', 2, "1'39.000");
  history = addLap(history, 'rider-3', 2, "1'40.100");
  history = addLap(history, 'rider-4', 2, "1'39.000");
  history = addLap(history, 'rider-1', 3, "1'40.000");
  history = addLap(history, 'rider-2', 3, "1'40.000");
  history = addLap(history, 'rider-3', 3, "1'40.100");

  expect([...rankPaceHistory(history)]).toEqual([
    ['rider-1', 1],
    ['rider-2', 1],
    ['rider-3', 3],
  ]);
  expect(parseLapTimeMilliseconds('not a lap time')).toBeUndefined();
});

test('excludes selected status riders without changing their saved lap samples', () => {
  let history = createPaceHistory('event:session');
  for (let lap = 1; lap <= 3; lap += 1) {
    history = addLap(history, 'leader', lap, "1'40.000");
    history = addLap(history, 'retired-rider', lap, "1'42.000");
    history = addLap(history, 'other-rider', lap, "1'44.000");
  }

  const samplesBeforeExclusion = [...history.riders['retired-rider']!.lapTimesMs];
  for (const statusName of ['RT', 'NC', 'DNF', 'DNS', 'DSQ', 'WD', 'DNQ']) {
    const excludedKeys = getExcludedPaceRiderKeys([{ key: 'retired-rider', statusName }]);
    const ranksWhileExcluded = rankPaceHistory(history, excludedKeys);
    expect([...ranksWhileExcluded]).toEqual([
      ['leader', 1],
      ['other-rider', 2],
    ]);
    expect(history.riders['retired-rider']?.lapTimesMs).toEqual(samplesBeforeExclusion);
  }

  const ranksAfterStatusClears = rankPaceHistory(history, getExcludedPaceRiderKeys([]));
  expect(ranksAfterStatusClears.has('retired-rider')).toBe(true);
  expect([...rankPaceHistory(history)]).toEqual([
    ['leader', 1],
    ['retired-rider', 2],
    ['other-rider', 3],
  ]);
});

test('matches excluded statuses case-insensitively and ignores other statuses', () => {
  const excludedKeys = getExcludedPaceRiderKeys([
    { key: 'retired', statusName: ' rt ' },
    { key: 'not-classified', statusName: ' nC ' },
    { key: 'did-not-finish', statusName: ' dnf ' },
    { key: 'did-not-start', statusName: ' dns ' },
    { key: 'disqualified', statusName: ' dsq ' },
    { key: 'withdrawn', statusName: ' wd ' },
    { key: 'did-not-qualify', statusName: ' dnq ' },
    { key: 'classified', statusName: 'CL' },
    { key: 'missing' },
    { key: 'unlisted', statusName: 'PIT' },
  ]);

  expect(excludedKeys).toEqual(
    new Set([
      'retired',
      'not-classified',
      'did-not-finish',
      'did-not-start',
      'disqualified',
      'withdrawn',
      'did-not-qualify',
    ])
  );
});

test('restores pace history only for the matching session and ignores legacy stale markers', () => {
  const storage = createMemoryStorage();
  let history = createPaceHistory('event:session');
  for (let lap = 1; lap <= 3; lap += 1) {
    history = addLap(history, 'leader', lap, "1'40.000");
    history = addLap(history, 'rider-2', lap, "1'42.000");
  }
  savePaceHistory(storage, history);

  const savedValue = storage.values.get(PACE_HISTORY_STORAGE_KEY);
  expect(savedValue).toBeDefined();
  const savedHistory = JSON.parse(savedValue!) as {
    riders: Record<string, Record<string, unknown>>;
  };
  savedHistory.riders['rider-2']!.paceStale = true;
  storage.values.set(PACE_HISTORY_STORAGE_KEY, JSON.stringify(savedHistory));
  const restored = loadPaceHistory(storage, 'event:session');
  expect([...rankPaceHistory(restored)]).toEqual([
    ['leader', 1],
    ['rider-2', 2],
  ]);
  expect(loadPaceHistory(storage, 'other-session')).toEqual(createPaceHistory('other-session'));
});
