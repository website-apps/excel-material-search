import { afterEach, expect, it, vi } from "vitest";
import { archiveDocumentDownloadUrl, fetchExcelAdminSession, loginExcelAdmin, queryArchiveDocuments } from "./api";

afterEach(() => vi.unstubAllGlobals());

it("keeps login and API requests under the application's cookie path", async () => {
  const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ role: "admin" })));
  vi.stubGlobal("fetch", fetch);
  await loginExcelAdmin("maintainer", "test-password");
  expect(fetch.mock.calls[0][0]).toBe("/apps/excel-material-search/api/admin/login");
  expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ username: "maintainer", password: "test-password" });
  fetch.mockResolvedValue(new Response(JSON.stringify({ role: "admin" })));
  await fetchExcelAdminSession();
  expect(fetch.mock.calls[1][0]).toBe("/apps/excel-material-search/api/admin/session");
  expect(archiveDocumentDownloadUrl(3)).toBe("/apps/excel-material-search/api/documents/3/download");
});

it("surfaces permission errors from the server", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: "login required" }), { status: 401 })));
  await expect(queryArchiveDocuments("part", "manual")).rejects.toThrow("login required");
});
