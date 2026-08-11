// Rounds to the cent, working around plain JS float subtraction artifacts
// (e.g. 30 - 5.3 === 24.699999999999996) that would otherwise leak into an
// input's max attribute or an error message and make a round number look
// like it's being rejected for missing some invisible fraction of a cent.
export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100
}
