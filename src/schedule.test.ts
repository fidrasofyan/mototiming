import { expect, test } from 'bun:test';

import {
  formatScheduleRange,
  getActiveScheduleGroup,
  getScheduleTabNavigationIndex,
  groupScheduleBroadcasts,
  isCurrentScheduleBroadcast,
  isValidTimeZone,
  parseScheduleDate,
  selectScheduleEvent,
  type ScheduleEvent,
} from './schedule';

const now = new Date('2026-06-12T12:00:00Z');

test('selects the feed event by timing ID or broadcast event ID', () => {
  const events: ScheduleEvent[] = [
    { id: 'first', timing_id: 12 },
    { id: 'second', timing_id: 42 },
  ];

  expect(selectScheduleEvent(events, '42', now)?.id).toBe('second');
  expect(selectScheduleEvent(events, 'first', now)?.id).toBe('first');
});

test('chooses the current event, then the nearest upcoming event', () => {
  const events: ScheduleEvent[] = [
    { id: 'later', date_start: '2026-06-20T00:00:00Z', date_end: '2026-06-22T00:00:00Z' },
    { id: 'current', date_start: '2026-06-10T00:00:00Z', date_end: '2026-06-14T00:00:00Z' },
    { id: 'soon', date_start: '2026-06-15T00:00:00Z', date_end: '2026-06-17T00:00:00Z' },
  ];

  expect(selectScheduleEvent(events, undefined, now)?.id).toBe('current');
  expect(selectScheduleEvent([events[0]!, events[2]!], undefined, now)?.id).toBe('soon');
});

test('falls back to the latest dated event and ignores entries without dates', () => {
  const events: ScheduleEvent[] = [
    { id: 'undated' },
    { id: 'older', date_start: '2026-05-01T00:00:00Z', date_end: '2026-05-03T00:00:00Z' },
    { id: 'latest', date_start: '2026-06-01T00:00:00Z', date_end: '2026-06-03T00:00:00Z' },
  ];

  expect(selectScheduleEvent(events, undefined, now)?.id).toBe('latest');
  expect(selectScheduleEvent([{ id: 'undated' }], undefined, now)).toBeUndefined();
});

test('parses API timezone offsets with and without a colon', () => {
  expect(parseScheduleDate('2026-06-12T10:00:00+0100')?.toISOString()).toBe(
    '2026-06-12T09:00:00.000Z'
  );
  expect(parseScheduleDate('2026-06-12T10:00:00+01:00')?.toISOString()).toBe(
    '2026-06-12T09:00:00.000Z'
  );
  expect(parseScheduleDate('not a date')).toBeUndefined();
});

test('groups broadcasts by circuit day and keeps unscheduled entries readable', () => {
  const groups = groupScheduleBroadcasts({
    time_zone: 'Europe/Madrid',
    broadcasts: [
      { id: 'late', name: 'Race', date_start: '2026-06-12T14:00:00+0200' },
      { id: 'early', name: 'Practice', date_start: '2026-06-12T09:00:00+0200' },
      { id: 'tbd', name: 'Press conference' },
    ],
  });

  expect(groups).toHaveLength(2);
  expect(groups[0]?.broadcasts.map(({ id }) => id)).toEqual(['early', 'late']);
  expect(groups[1]?.label).toBe('Time to be announced');
  expect(groups[1]?.broadcasts[0]?.name).toBe('Press conference');

  const withoutCircuitZone = groupScheduleBroadcasts({
    broadcasts: [{ name: 'Session', date_start: '2026-06-12T10:00:00Z' }],
  });
  expect(withoutCircuitZone).toHaveLength(1);
  expect(withoutCircuitZone[0]?.broadcasts).toHaveLength(1);
});

test('defaults to the current circuit date and preserves an explicitly selected tab', () => {
  const groups = groupScheduleBroadcasts({
    time_zone: 'Europe/Madrid',
    broadcasts: [
      { id: 'saturday', name: 'Race', date_start: '2026-06-13T14:00:00+0200' },
      { id: 'friday', name: 'Practice', date_start: '2026-06-12T09:00:00+0200' },
      { id: 'tba', name: 'Press conference' },
    ],
  });

  expect(groups.map(({ key }) => key)).toEqual(['2026-06-12', '2026-06-13', 'unscheduled']);
  const nowBeforeMidnightUtc = new Date('2026-06-11T18:00:00Z');
  expect(
    getActiveScheduleGroup(groups, undefined, 'Asia/Kuala_Lumpur', nowBeforeMidnightUtc)?.key
  ).toBe('2026-06-12');
  expect(
    getActiveScheduleGroup(groups, '2026-06-13', 'Asia/Kuala_Lumpur', nowBeforeMidnightUtc)?.key
  ).toBe('2026-06-13');
  expect(getActiveScheduleGroup(groups, '2026-06-13')?.broadcasts.map(({ id }) => id)).toEqual([
    'saturday',
  ]);
  expect(getActiveScheduleGroup(groups, 'unscheduled')?.label).toBe('Time to be announced');

  const noUndatedBroadcasts = groupScheduleBroadcasts({
    broadcasts: [{ id: 'scheduled', date_start: '2026-06-12T09:00:00Z' }],
  });
  expect(noUndatedBroadcasts.some(({ key }) => key === 'unscheduled')).toBe(false);
});

test('falls back to the next date, latest past date, then the undated tab', () => {
  const upcomingGroups = groupScheduleBroadcasts({
    time_zone: 'UTC',
    broadcasts: [
      { id: 'later', date_start: '2026-06-15T09:00:00Z' },
      { id: 'next', date_start: '2026-06-13T09:00:00Z' },
    ],
  });
  expect(
    getActiveScheduleGroup(upcomingGroups, undefined, 'UTC', new Date('2026-06-12T12:00:00Z'))?.key
  ).toBe('2026-06-13');

  const pastGroups = groupScheduleBroadcasts({
    time_zone: 'UTC',
    broadcasts: [
      { id: 'older', date_start: '2026-06-10T09:00:00Z' },
      { id: 'latest', date_start: '2026-06-11T09:00:00Z' },
    ],
  });
  expect(
    getActiveScheduleGroup(pastGroups, undefined, 'UTC', new Date('2026-06-12T12:00:00Z'))?.key
  ).toBe('2026-06-11');

  const undatedGroups = groupScheduleBroadcasts({ broadcasts: [{ id: 'tba', name: 'TBA' }] });
  expect(
    getActiveScheduleGroup(undatedGroups, undefined, 'UTC', new Date('2026-06-12T12:00:00Z'))?.key
  ).toBe('unscheduled');
});

test('supports wrapping arrow navigation and Home/End tab shortcuts', () => {
  expect(getScheduleTabNavigationIndex('ArrowRight', 2, 3)).toBe(0);
  expect(getScheduleTabNavigationIndex('ArrowLeft', 0, 3)).toBe(2);
  expect(getScheduleTabNavigationIndex('Home', 2, 3)).toBe(0);
  expect(getScheduleTabNavigationIndex('End', 0, 3)).toBe(2);
  expect(getScheduleTabNavigationIndex('Enter', 0, 3)).toBeUndefined();
  expect(getScheduleTabNavigationIndex('ArrowRight', 0, 0)).toBeUndefined();
});

test('matches current sessions by short name, then by normalized name', () => {
  expect(
    isCurrentScheduleBroadcast(
      { shortname: 'FP1', category: { name: 'MotoGP™' } },
      { shortName: ' fp1 ', category: 'MotoGP' }
    )
  ).toBe(true);
  expect(
    isCurrentScheduleBroadcast(
      { name: 'Free-Practice Nr. 2' },
      { name: 'free practice nr 2', category: 'Moto2' }
    )
  ).toBe(true);
  expect(
    isCurrentScheduleBroadcast(
      { shortname: 'FP1', name: 'Free Practice', category: { name: 'MotoGP' } },
      { shortName: 'FP2', name: 'Free Practice', category: 'MotoGP' }
    )
  ).toBe(false);
});

test('does not match a different category or missing session identity', () => {
  const broadcast = { shortname: 'FP1', category: { name: 'Moto2' } };
  expect(isCurrentScheduleBroadcast(broadcast, { shortName: 'FP1', category: 'MotoGP' })).toBe(
    false
  );
  expect(isCurrentScheduleBroadcast({ shortname: 'FP1' }, undefined)).toBe(false);
  expect(isCurrentScheduleBroadcast({ shortname: 'FP1' }, {})).toBe(false);
  expect(isCurrentScheduleBroadcast({ shortname: 'FP1' }, { shortName: 'FP1' })).toBe(true);
});

test('formats time ranges when one or both endpoints are unavailable', () => {
  expect(formatScheduleRange(undefined, undefined, 'Invalid/Zone')).toBe('Time to be announced');
  expect(formatScheduleRange('2026-06-12T10:00:00Z', undefined, 'Invalid/Zone')).not.toBe('—');
  expect(formatScheduleRange('not a date', 'not a date')).toBe('Time to be announced');
  expect(isValidTimeZone('Europe/Madrid')).toBe(true);
  expect(isValidTimeZone('Invalid/Zone')).toBe(false);
  expect(isValidTimeZone(undefined)).toBe(false);
});
