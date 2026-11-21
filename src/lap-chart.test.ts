import { expect, test } from 'bun:test';

import {
  CHART_BACKGROUND,
  MIN_SERIES_LUMINANCE,
  PRIMARY_SERIES_COLOR,
  createLapChartPath,
  ensureChartContrast,
  formatLapTimeDifference,
  getLapChartDomain,
  normalizeRiderColor,
  relativeLuminance,
  resolveSeriesStyles,
  toggleComparisonRider,
  getLapTimeDifference,
  type LapChartPoint,
} from './lap-chart';

test('toggles any number of comparison riders and ignores the primary rider', () => {
  const primary = 'rider-1';
  let selected: string[] = [];
  for (let index = 2; index <= 21; index += 1) {
    selected = toggleComparisonRider(selected, `rider-${index}`, primary);
  }

  expect(selected).toHaveLength(20);
  expect(selected[0]).toBe('rider-2');
  expect(selected.at(-1)).toBe('rider-21');
  expect(toggleComparisonRider(selected, primary, primary)).toEqual(selected);
  expect(toggleComparisonRider(selected, 'rider-3', primary)).not.toContain('rider-3');
});

test('normalizes feed rider colors and rejects unusable values', () => {
  expect(normalizeRiderColor('ff6600')).toBe('#ff6600');
  expect(normalizeRiderColor('#0C368C')).toBe('#0c368c');
  expect(normalizeRiderColor(' red ')).toBeUndefined();
  expect(normalizeRiderColor('#fff')).toBeUndefined();
  expect(normalizeRiderColor(undefined)).toBeUndefined();
});

test('lifts dark rider colors to a readable contrast on the chart background', () => {
  expect(ensureChartContrast('#ff6600')).toBe('#ff6600');

  const lifted = ensureChartContrast('#0c368c');
  expect(relativeLuminance(lifted)).toBeGreaterThanOrEqual(MIN_SERIES_LUMINANCE);
  expect(relativeLuminance(lifted)).toBeGreaterThan(relativeLuminance('#0c368c'));
  expect(relativeLuminance(CHART_BACKGROUND)).toBeLessThan(MIN_SERIES_LUMINANCE);
});

test('assigns feed colors, dashes duplicates, and generates colors when missing', () => {
  const styles = resolveSeriesStyles(
    [
      { key: 'primary', color: 'e51d3e' },
      { key: 'rider-a', color: 'ff6600' },
      { key: 'rider-b', color: '#FF6600' },
      { key: 'rider-c' },
      { key: 'rider-d' },
    ],
    'primary'
  );

  expect(styles.get('primary')).toEqual({ color: PRIMARY_SERIES_COLOR });
  expect(styles.get('rider-a')).toEqual({ color: '#ff6600' });
  expect(styles.get('rider-b')?.dash).toBe('6 4');
  expect(styles.get('rider-c')?.color).not.toBe(styles.get('rider-d')?.color);
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
