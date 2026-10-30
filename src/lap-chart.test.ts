import { expect, test } from 'bun:test';

import {
  MAX_COMPARISON_RIDERS,
  createLapChartPath,
  formatLapTimeDifference,
  getLapChartDomain,
  toggleComparisonRider,
  getLapTimeDifference,
  type LapChartPoint,
} from './lap-chart';

test('limits comparisons to four additional riders and ignores the primary rider', () => {
  const primary = 'rider-1';
  let selected: string[] = [];
  for (let index = 2; index <= 6; index += 1) {
    selected = toggleComparisonRider(selected, `rider-${index}`, primary);
  }

  expect(MAX_COMPARISON_RIDERS).toBe(4);
  expect(selected).toEqual(['rider-2', 'rider-3', 'rider-4', 'rider-5']);
  expect(toggleComparisonRider(selected, primary, primary)).toEqual(selected);
  expect(toggleComparisonRider(selected, 'rider-3', primary)).toEqual([
    'rider-2',
    'rider-4',
    'rider-5',
  ]);
});

test('computes one lap and time domain across all rider series', () => {
  expect(
    getLapChartDomain([
      [
        { lap: 4, timeMs: 98_100 },
        { lap: 5, timeMs: 97_500 },
      ],
      [
        { lap: 3, timeMs: 99_000 },
        { lap: 5, timeMs: 96_900 },
      ],
    ])
  ).toEqual({ minLap: 3, maxLap: 5, minTime: 96_900, maxTime: 99_000 });
});

test('starts a new path segment after missing lap samples', () => {
  const points: LapChartPoint[] = [
    { lap: 2, timeMs: 98_000, x: 0, y: 20 },
    { lap: 3, timeMs: 97_000, x: 10, y: 30 },
    { lap: 5, timeMs: 96_000, x: 30, y: 40 },
  ];

  expect(createLapChartPath(points)).toBe('M 0 20 L 10 30 M 30 40');
});

test('calculates signed same-lap differences against the primary rider', () => {
  const primary = [
    { lap: 5, timeMs: 97_200 },
    { lap: 6, timeMs: 97_000 },
    { lap: 7, timeMs: 96_800 },
  ];

  const slower = getLapTimeDifference(primary, { lap: 5, timeMs: 97_450 });
  const faster = getLapTimeDifference(primary, { lap: 6, timeMs: 96_900 });
  const equal = getLapTimeDifference(primary, { lap: 7, timeMs: 96_800 });

  expect(slower).toBe(250);
  expect(formatLapTimeDifference(slower!)).toBe('+0.250s');
  expect(faster).toBe(-100);
  expect(formatLapTimeDifference(faster!)).toBe('−0.100s');
  expect(equal).toBe(0);
  expect(formatLapTimeDifference(equal!)).toBe('0.000s');
});

test('omits the difference when the primary rider has no sample for that lap', () => {
  expect(getLapTimeDifference([{ lap: 3, timeMs: 97_000 }], { lap: 4, timeMs: 98_000 })).toBe(
    undefined
  );
  expect(getLapTimeDifference(undefined, { lap: 4, timeMs: 98_000 })).toBeUndefined();
});
