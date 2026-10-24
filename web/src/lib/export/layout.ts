/**
 * Pack painted chunks onto pages without cutting a staff system in half.
 *
 * alphaTab lays the score out as horizontal systems (one row of notation and
 * tab). Each system is one or more SVG chunks. A page break is only allowed
 * between those chunks, and any chunk a system overlaps stays on the same page.
 * A system taller than the page is scaled down to fit on a page of its own
 * rather than sliced.
 */

export interface Box {
  /** Top edge, increasing downward (alphaTab's coordinate system). */
  y: number;
  height: number;
}

export interface Placed<T> {
  top: number;
  bottom: number;
  /** 1, or smaller when a single system is taller than the page. */
  scale: number;
  items: T[];
}

function span(items: Box[]): { top: number; bottom: number } {
  let top = Infinity;
  let bottom = -Infinity;
  for (const item of items) {
    top = Math.min(top, item.y);
    bottom = Math.max(bottom, item.y + item.height);
  }
  return { top, bottom };
}

/** True when the intervals share more than a hairline. Touching edges do not count. */
function overlaps(a: Box, b: Box): boolean {
  return Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y) > 1;
}

function asBox(items: Box[]): Box {
  const box = span(items);
  return { y: box.top, height: box.bottom - box.top };
}

/**
 * Align each system with the chunks it was painted in.
 *
 * alphaTab 1.8 reports every system after the first about 10 px lower than the
 * chunk that holds it, so its bounds spill into the next chunk and `paginate`
 * would glue every system together. A system takes the span of the chunks that
 * lie mostly inside it; one that matches no chunk keeps its own bounds.
 */
export function snapSystems(chunks: Box[], systems: Box[]): Box[] {
  return systems.map((system) => {
    const owned = chunks.filter((chunk) => {
      const shared =
        Math.min(chunk.y + chunk.height, system.y + system.height) - Math.max(chunk.y, system.y);
      return shared > chunk.height / 2;
    });
    return owned.length ? asBox(owned) : system;
  });
}

/**
 * Group `items` into pages of at most `contentHeight`.
 * `systems` are the staff rows that must stay intact.
 */
export function paginate<T extends Box>(
  items: T[],
  systems: Box[],
  contentHeight: number,
): Placed<T>[] {
  const ordered = [...items].sort((left, right) => left.y - right.y);
  const blocks: T[][] = [];
  let index = 0;
  while (index < ordered.length) {
    let end = index;
    let grew = true;
    while (grew) {
      grew = false;
      const block = asBox(ordered.slice(index, end + 1));
      for (const system of systems) {
        if (!overlaps(block, system)) continue;
        for (let cursor = end + 1; cursor < ordered.length; cursor += 1) {
          if (!overlaps(ordered[cursor], system)) continue;
          end = cursor;
          grew = true;
        }
      }
    }
    blocks.push(ordered.slice(index, end + 1));
    index = end + 1;
  }

  const holdsSystem = (block: T[]) => systems.some((system) => overlaps(asBox(block), system));
  const glued: T[][] = [];
  let leading: T[] = [];
  for (const block of blocks) {
    if (!holdsSystem(block)) {
      // A tuning label or footer is not a staff. Keep it with the system it introduces,
      // or with the system it follows when it comes after the music.
      if (glued.length === 0) leading.push(...block);
      else glued[glued.length - 1].push(...block);
      continue;
    }
    glued.push([...leading, ...block]);
    leading = [];
  }
  if (leading.length) {
    if (glued.length) glued[glued.length - 1].push(...leading);
    else glued.push(leading);
  }

  const heightOf = (group: T[]) => (group.length ? asBox(group).height : 0);
  const pages: Placed<T>[] = [];
  let current: T[] = [];
  for (const block of glued) {
    if (current.length && heightOf([...current, ...block]) > contentHeight + 0.5) {
      const box = span(current);
      pages.push({ top: box.top, bottom: box.bottom, scale: 1, items: current });
      current = [];
    }
    if (!current.length && heightOf(block) > contentHeight + 0.5) {
      const box = span(block);
      pages.push({
        top: box.top,
        bottom: box.bottom,
        scale: contentHeight / (box.bottom - box.top),
        items: block,
      });
      continue;
    }
    current = [...current, ...block];
  }
  if (current.length) {
    const box = span(current);
    pages.push({ top: box.top, bottom: box.bottom, scale: 1, items: current });
  }
  return pages;
}
