export type LapSample = { lap: number; timeMs: number };
export type LapChartPoint = LapSample & { x: number; y: number };

export const PRIMARY_SERIES_COLOR = '#e51d3e';
export const CHART_BACKGROUND = '#0d1014';
export const MIN_SERIES_LUMINANCE = 0.15;

export type SeriesStyle = { color: string; dash?: string };

const SERIES_DASHES = ['6 4', '2 3', '10 4 2 4'];

export function toggleComparisonRider(current: readonly string[], key: string, primaryKey: string) {
  if (key === primaryKey) return [...current];
  if (current.includes(key)) return current.filter((riderKey) => riderKey !== key);
  return [...current, key];
}

export function normalizeRiderColor(color?: string) {
  if (!color) return undefined;
  const normalized = color.trim().replace(/^#/, '');
  return /^[\da-f]{6}$/i.test(normalized) ? `#${normalized.toLowerCase()}` : undefined;
}

function linearChannel(value: number) {
  const channel = value / 255;
  return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
}

function hexChannels(hex: string) {
  return {
    red: parseInt(hex.slice(1, 3), 16),
    green: parseInt(hex.slice(3, 5), 16),
    blue: parseInt(hex.slice(5, 7), 16),
  };
}

export function relativeLuminance(color: string) {
  const { red, green, blue } = hexChannels(color);
  return 0.2126 * linearChannel(red) + 0.7152 * linearChannel(green) + 0.0722 * linearChannel(blue);
}

function mixWithWhite(hex: string, amount: number) {
  const { red, green, blue } = hexChannels(hex);
  return `#${[red, green, blue]
    .map((channel) =>
      Math.round(channel + (255 - channel) * amount)
        .toString(16)
        .padStart(2, '0')
    )
    .join('')}`;
}

export function ensureChartContrast(color: string) {
  let current = normalizeRiderColor(color) ?? color;
  for (let step = 0; step < 6 && relativeLuminance(current) < MIN_SERIES_LUMINANCE; step += 1) {
    current = mixWithWhite(current, 0.15);
  }
  return current;
}

function generatedSeriesColor(index: number) {
  return `hsl(${Math.round((index * 137.508) % 360)} 72% 62%)`;
}

export function resolveSeriesStyles(
  riders: readonly { key: string; color?: string }[],
  primaryKey?: string
) {
  const styles = new Map<string, SeriesStyle>();
  const uses = new Map<string, number>();
  const ordered = primaryKey
    ? [...riders].sort((a, b) => (a.key === primaryKey ? -1 : b.key === primaryKey ? 1 : 0))
    : riders;

  ordered.forEach(({ key, color }, index) => {
    const base =
      key === primaryKey
        ? PRIMARY_SERIES_COLOR
        : ensureChartContrast(normalizeRiderColor(color) ?? generatedSeriesColor(index));
    const usesSoFar = uses.get(base) ?? 0;
    uses.set(base, usesSoFar + 1);
    styles.set(
      key,
      usesSoFar === 0
        ? { color: base }
        : { color: base, dash: SERIES_DASHES[(usesSoFar - 1) % SERIES_DASHES.length] }
    );
  });

  return styles;
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
