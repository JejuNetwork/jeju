export function formatCompactNumber(
  number: number,
  maximumFractionDigits = 1
): string {
  const formatter = Intl.NumberFormat("en", {
    notation: "compact",
    maximumFractionDigits,
  });
  return formatter.format(number);
}

export function formatNumber(
  number: number,
  maximumFractionDigits = 2
): string {
  const formatter = Intl.NumberFormat("en", {
    maximumFractionDigits,
  });
  return formatter.format(number);
}
