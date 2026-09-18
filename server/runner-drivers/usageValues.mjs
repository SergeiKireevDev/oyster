/** Driver usage accepts numeric strings; analytics intentionally has a stricter policy. */
export function nonNegativeUsageNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : 0;
}
