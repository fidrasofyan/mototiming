import { expect, test } from 'bun:test';

import {
  POSITION_CUE_DURATION,
  POSITION_FLASH_DURATION,
  scheduleRiderExpiry,
  type TimerScheduler,
} from './position-cues';

function createFakeScheduler(): TimerScheduler<number> & { advanceBy: (duration: number) => void } {
  let now = 0;
  let nextHandle = 0;
  const scheduled = new Map<number, { expiresAt: number; callback: () => void }>();

  return {
    setTimeout(callback, duration) {
      const handle = ++nextHandle;
      scheduled.set(handle, { expiresAt: now + duration, callback });
      return handle;
    },
    clearTimeout(handle) {
      scheduled.delete(handle);
    },
    advanceBy(duration) {
      const target = now + duration;
      while (true) {
        const due = [...scheduled.entries()]
          .filter(([, timer]) => timer.expiresAt <= target)
          .sort(([, a], [, b]) => a.expiresAt - b.expiresAt)[0];
        if (!due) break;
        const [handle, timer] = due;
        scheduled.delete(handle);
        now = timer.expiresAt;
        timer.callback();
      }
      now = target;
    },
  };
}

test('position cues expire after their configured duration and reset independently per rider', () => {
  const scheduler = createFakeScheduler();
  const timers = new Map<string, number>();
  const expired: string[] = [];

  scheduleRiderExpiry(
    timers,
    'rider-1',
    POSITION_CUE_DURATION,
    () => expired.push('rider-1'),
    scheduler
  );
  scheduleRiderExpiry(
    timers,
    'rider-2',
    POSITION_CUE_DURATION,
    () => expired.push('rider-2'),
    scheduler
  );
  scheduler.advanceBy(POSITION_CUE_DURATION - 1_000);
  scheduleRiderExpiry(
    timers,
    'rider-1',
    POSITION_CUE_DURATION,
    () => expired.push('rider-1'),
    scheduler
  );

  scheduler.advanceBy(1_000);
  expect(expired).toEqual(['rider-2']);
  expect(timers.has('rider-1')).toBe(true);

  scheduler.advanceBy(POSITION_CUE_DURATION - 1_000);
  expect(expired).toEqual(['rider-2', 'rider-1']);
  expect(timers.size).toBe(0);
});

test('position flash expires after its configured duration', () => {
  const scheduler = createFakeScheduler();
  const timers = new Map<string, number>();
  let expired = false;

  scheduleRiderExpiry(
    timers,
    'rider-1',
    POSITION_FLASH_DURATION,
    () => (expired = true),
    scheduler
  );
  scheduler.advanceBy(POSITION_FLASH_DURATION - 1);
  expect(expired).toBe(false);

  scheduler.advanceBy(1);
  expect(expired).toBe(true);
  expect(timers.size).toBe(0);
});
