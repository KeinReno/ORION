/** Half the width of the «сегодня» badge over the timeline and the Gantt: it is centred on the day, so it is kept this far from the chart's left edge. */
export const TODAY_HALF_W = 28;

/** Room a week label («26 окт») takes to the right of its tick. */
const TICK_LABEL_W = 44;

/**
 * A week label starting at `tickX` would sit under the «сегодня» badge centred on `todayX`
 * (it used to print «сегодня 9 окт» over «19 окт»): the label is dropped, the grid line stays.
 */
export function coveredByToday(tickX: number, todayX: number): boolean {
  const badgeX = Math.max(todayX, TODAY_HALF_W);
  return tickX + TICK_LABEL_W > badgeX - TODAY_HALF_W && tickX < badgeX + TODAY_HALF_W;
}
