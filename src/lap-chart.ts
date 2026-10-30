export type LapSample = { lap: number; timeMs: number };
export type LapChartPoint = LapSample & { x: number; y: number };

export const MAX_COMPARISON_RIDERS = 4;

export function toggleComparisonRider(current: readonly string[], key: string, primaryKey: string) {
  if (key === primaryKey) return [...current];
  if (current.includes(key)) return current.filter((riderKey) => riderKey !== key);
  if (current.length >= MAX_COMPARISON_RIDERS) return [...current];
  return [...current, key];
}

export function getLapChartDomain(series: readonly LapSample[][]) {
  const samples = series.flat();
  if (samples.length === 0) return undefined;
  return {
    minLap: Math.min(...samples.map(({ lap }) => lap)),
    maxLap: Math.max(...samples.map(({ lap }) => lap)),
    minTime: Math.min(...samples.map(({ timeMs }) => timeMs)),
    maxTime: Math.max(...samples.map(({ timeMs }) => timeMs)),
  };
}

export function createLapChartPath(points: readonly LapChartPoint[]) {
  return points
    .map((point, index) => {
      const previous = points[index - 1];
      const command = !previous || point.lap !== previous.lap + 1 ? 'M' : 'L';
      return `${command} ${point.x} ${point.y}`;
    })
    .join(' ');
}

export function getLapTimeDifference(
  primaryLaps: readonly LapSample[] | undefined,
  comparisonLap: LapSample
) {
  if (!primaryLaps) return undefined;
  const primaryLap = primaryLaps.find((sample) => sample.lap === comparisonLap.lap);
  if (!primaryLap) return undefined;
  return comparisonLap.timeMs - primaryLap.timeMs;
}

export function formatLapTimeDifference(differenceMs: number) {
  if (differenceMs === 0) return '0.000s';
  const sign = differenceMs > 0 ? '+' : '−';
  return `${sign}${(Math.abs(differenceMs) / 1_000).toFixed(3)}s`;
}
