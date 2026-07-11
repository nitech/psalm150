export const WEB_RESULT_PREFIX = "__web__";

export function webResultId(index: number): string {
  return `${WEB_RESULT_PREFIX}${index}`;
}

export function isWebResultId(file: string): boolean {
  return file.startsWith(WEB_RESULT_PREFIX);
}

export function webResultIndex(file: string): number {
  return Number.parseInt(file.slice(WEB_RESULT_PREFIX.length), 10);
}
