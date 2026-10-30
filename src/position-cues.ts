export const POSITION_CUE_DURATION = 15_000;
export const POSITION_FLASH_DURATION = 3_000;

export type TimerScheduler<Handle> = {
  setTimeout: (callback: () => void, duration: number) => Handle;
  clearTimeout: (handle: Handle) => void;
};

export function scheduleRiderExpiry<Handle>(
  timers: Map<string, Handle>,
  key: string,
  duration: number,
  expire: () => void,
  scheduler: TimerScheduler<Handle>
) {
  const existing = timers.get(key);
  if (existing !== undefined) scheduler.clearTimeout(existing);

  let handle: Handle;
  handle = scheduler.setTimeout(() => {
    if (timers.get(key) !== handle) return;
    timers.delete(key);
    expire();
  }, duration);
  timers.set(key, handle);
}
