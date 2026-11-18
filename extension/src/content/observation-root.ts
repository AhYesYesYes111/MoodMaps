export const ROUTE_OBSERVATION_ROOT_SELECTOR =
  '.mw-route-planning, .wm-routes, #dir_container, .dir-panel, [class*="DirectionIndexContent_directionIndexPage__"]';

export function isRouteObservationRoot(element: Element): boolean {
  return element.matches(ROUTE_OBSERVATION_ROOT_SELECTOR);
}

export function preferredObservationRoot(doc: Document): HTMLElement {
  return (
    doc.querySelector<HTMLElement>(ROUTE_OBSERVATION_ROOT_SELECTOR) ??
    doc.querySelector<HTMLElement>('[role="main"], main') ??
    doc.body ??
    doc.documentElement
  );
}

function addedNodeContainsRouteRoot(node: Node): boolean {
  return (
    node instanceof Element &&
    (isRouteObservationRoot(node) ||
      node.querySelector(ROUTE_OBSERVATION_ROOT_SELECTOR) !== null)
  );
}

export function lifecycleMutationNeedsReconnect(
  records: readonly MutationRecord[],
  currentRoot: HTMLElement | null
): boolean {
  if (!currentRoot?.isConnected) return true;
  if (isRouteObservationRoot(currentRoot)) return false;
  return records.some((record) =>
    Array.from(record.addedNodes).some(addedNodeContainsRouteRoot)
  );
}
