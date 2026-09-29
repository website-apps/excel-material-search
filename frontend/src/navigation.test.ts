import { afterEach, expect, it, vi } from "vitest";
import { navigateApplication } from "./navigation";

afterEach(() => vi.unstubAllGlobals());

it("returns to the main website when navigating outside this application", () => {
  const assign = vi.fn();
  const pushState = vi.fn();
  const update = vi.fn();
  vi.stubGlobal("window", { location: { assign }, history: { pushState } });
  navigateApplication("/apps", update);
  expect(assign).toHaveBeenCalledWith("/apps");
  expect(pushState).not.toHaveBeenCalled();
  expect(update).not.toHaveBeenCalled();
  navigateApplication("/apps/excel-material-search/admin-login", update);
  expect(pushState).toHaveBeenCalledWith(null, "", "/apps/excel-material-search/admin-login");
  expect(update).toHaveBeenCalledWith("/apps/excel-material-search/admin-login");
});
