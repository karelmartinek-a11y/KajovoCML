export function nextDialogFocusIndex(itemCount: number, currentIndex: number, backwards: boolean): number | null {
  if (itemCount <= 0) return null;
  if (currentIndex < 0 || currentIndex >= itemCount) return backwards ? itemCount - 1 : 0;
  return backwards
    ? (currentIndex - 1 + itemCount) % itemCount
    : (currentIndex + 1) % itemCount;
}
