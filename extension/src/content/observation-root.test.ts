// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import {
  lifecycleMutationNeedsReconnect,
  preferredObservationRoot
} from "./observation-root";

function childListRecord(addedNodes: Node[]): MutationRecord {
  return { addedNodes } as unknown as MutationRecord;
}

describe("route observation root lifecycle", () => {
  it("prefers the narrow provider route container over a generic main", () => {
    document.body.innerHTML =
      '<main><section class="mw-route-planning"></section></main>';

    expect(preferredObservationRoot(document).className).toBe(
      "mw-route-planning"
    );
  });

  it("detects when a SPA replaces the currently observed route container", () => {
    document.body.innerHTML =
      '<main><section class="mw-route-planning" id="old"></section></main>';
    const oldRoot = document.querySelector<HTMLElement>("#old");
    const replacement = document.createElement("section");
    replacement.className = "mw-route-planning";
    oldRoot?.replaceWith(replacement);

    expect(lifecycleMutationNeedsReconnect([], oldRoot)).toBe(true);
    expect(preferredObservationRoot(document)).toBe(replacement);
  });

  it("moves from a fallback main when a provider route container appears", () => {
    document.body.innerHTML = "<main></main>";
    const fallback = preferredObservationRoot(document);
    const routeRoot = document.createElement("div");
    routeRoot.className = "wm-routes";
    fallback.append(routeRoot);

    expect(
      lifecycleMutationNeedsReconnect(
        [childListRecord([routeRoot])],
        fallback
      )
    ).toBe(true);
  });
});
