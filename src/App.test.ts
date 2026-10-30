import { expect, test } from 'bun:test';

import {
  fastestLastLapMilliseconds,
  favoriteRiderKey,
  filterFavoriteRiders,
  formatLapMilliseconds,
  formatRemaining,
  parseLapTimeMilliseconds,
  parseFavoriteKeys,
  positionLapTimeLabels,
  toggleFavoriteKey,
} from './App';

test('formats numeric remaining seconds as mm:ss', () => {
  expect(formatRemaining('772')).toBe('12:52');
  expect(formatRemaining('65')).toBe('1:05');
  expect(formatRemaining('0')).toBe('0:00');
});

test('preserves clock strings and other nonnumeric values', () => {
  expect(formatRemaining('12:52')).toBe('12:52');
  expect(formatRemaining('01:12:52')).toBe('01:12:52');
  expect(formatRemaining('Time TBD')).toBe('Time TBD');
});

test('omits missing or blank remaining values', () => {
  expect(formatRemaining(undefined)).toBeUndefined();
  expect(formatRemaining('  ')).toBeUndefined();
});

test('parses valid lap-time strings and ignores invalid or unavailable values', () => {
  expect(parseLapTimeMilliseconds("1'47.617")).toBe(107_617);
  expect(parseLapTimeMilliseconds('1:47.617')).toBe(107_617);
  expect(parseLapTimeMilliseconds(undefined)).toBeUndefined();
  expect(parseLapTimeMilliseconds('—')).toBeUndefined();
  expect(parseLapTimeMilliseconds("1'60.000")).toBeUndefined();
  expect(parseLapTimeMilliseconds("0'00.000")).toBeUndefined();
});

test('formats lap time labels in minutes, seconds, and milliseconds', () => {
  expect(formatLapMilliseconds(83_456)).toBe("1'23.456");
  expect(formatLapMilliseconds(107_000)).toBe("1'47.000");
});

test('offsets labels for nearby points with similar lap times', () => {
  const labelYs = positionLapTimeLabels([
    { x: 100, y: 130 },
    { x: 135, y: 131 },
    { x: 170, y: 129 },
  ]);

  expect(labelYs).toHaveLength(3);
  expect(new Set(labelYs).size).toBe(3);
  expect(labelYs.every((y) => y >= 12 && y <= 260)).toBe(true);
});

test('finds the fastest last lap across all riders and handles ties', () => {
  const riders = [
    { rider_id: 1, last_lap_time: "1'48.000" },
    { rider_id: 2, last_lap_time: "1'47.500" },
    { rider_id: 3, last_lap_time: "1'47.500" },
    { rider_id: 4, last_lap_time: '—' },
  ];
  const fastest = fastestLastLapMilliseconds(riders);
  const favorites = filterFavoriteRiders(riders, new Set(['id:1']), 'favorites');

  expect(fastest).toBe(107_500);
  expect(favorites.map(({ rider }) => rider.rider_id)).toEqual([1]);
  expect(fastestLastLapMilliseconds(favorites.map(({ rider }) => rider))).toBe(108_000);
  expect(fastestLastLapMilliseconds([{ last_lap_time: '—' }])).toBeUndefined();
});

test('keys favorites by rider ID and uses a stable number/name fallback', () => {
  expect(favoriteRiderKey({ rider_id: 12, rider_number: '7' })).toBe('id:12');
  expect(favoriteRiderKey({ rider_number: ' 7 ', rider_name: 'Alex', rider_surname: 'Rins' })).toBe(
    'fallback:7:alex rins'
  );
  expect(favoriteRiderKey({})).toBeUndefined();
});

test('loads valid saved favorites and ignores malformed storage data', () => {
  expect(parseFavoriteKeys('["id:12","fallback:7:alex rins","id:12"]')).toEqual(
    new Set(['id:12', 'fallback:7:alex rins'])
  );
  expect(parseFavoriteKeys('not json')).toEqual(new Set());
  expect(parseFavoriteKeys('{"favorite":"id:12"}')).toEqual(new Set());
  expect(parseFavoriteKeys(null)).toEqual(new Set());
});

test('toggles favorites without mutating the saved set', () => {
  const original = new Set(['id:12']);
  const added = toggleFavoriteKey(original, 'id:42');
  expect(added).toEqual(new Set(['id:12', 'id:42']));
  expect(original).toEqual(new Set(['id:12']));
  expect(toggleFavoriteKey(added, 'id:12')).toEqual(new Set(['id:42']));
});

test('filters to favorites while preserving the provided rider order', () => {
  const riders = [
    { rider_id: 1, rider_number: '1' },
    { rider_id: 2, rider_number: '2' },
    { rider_id: 3, rider_number: '3' },
  ];
  expect(
    filterFavoriteRiders(riders, new Set(['id:1', 'id:3']), 'favorites').map(
      ({ rider }) => rider.rider_id
    )
  ).toEqual([1, 3]);
  expect(filterFavoriteRiders(riders, new Set(), 'all').map(({ rider }) => rider.rider_id)).toEqual(
    [1, 2, 3]
  );
});
