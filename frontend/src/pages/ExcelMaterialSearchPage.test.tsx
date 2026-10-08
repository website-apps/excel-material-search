// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as api from "../services/api";
import type { ExcelIndexedFile } from "../types";
import ExcelMaterialSearchPage from "./ExcelMaterialSearchPage";

vi.mock("../services/api");

const files: ExcelIndexedFile[] = [
  { id: 1, file_name: "RD_X2000_alpha.xlsx", board_code: "RD", main_chip: "X2000", status: "ready" },
  { id: 2, file_name: "RD_X2000_beta.xlsx", board_code: "RD", main_chip: "X2000", status: "ready" },
  { id: 3, file_name: "PD_X1000_product.xlsx", board_code: "PD", main_chip: "X1000", status: "ready" },
  { id: 4, file_name: "unclassified.xlsx", board_code: "", main_chip: "", status: "ready" },
  { id: 5, file_name: "custom.xlsx", board_code: "", main_chip: "X3000", status: "ready" }
];

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(api.fetchExcelAdminSession).mockResolvedValue({ authenticated: true, role: "admin", username: "tester" });
  vi.mocked(api.fetchArchiveDocuments).mockResolvedValue([]);
  vi.mocked(api.fetchExcelFiles).mockResolvedValue(files);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

async function openBomLibrary() {
  render(<ExcelMaterialSearchPage onNavigate={() => undefined} />);
  await screen.findByText("管理中");
  fireEvent.click(screen.getByRole("tab", { name: "BOM" }));
  await screen.findByRole("heading", { name: files[0].file_name });
  return within(screen.getByRole("region", { name: "文件库" }));
}

describe("BOM library filters", () => {
  it("combines board, chip and filename filters without narrowing available options", async () => {
    const library = await openBomLibrary();
    const board = library.getByRole("combobox", { name: "板型筛选" });
    const chip = library.getByRole("combobox", { name: "主芯片筛选" });
    expect(within(chip).getAllByRole("option", { name: "X2000" })).toHaveLength(1);
    fireEvent.change(board, { target: { value: "RD" } });
    fireEvent.change(chip, { target: { value: "X2000" } });
    fireEvent.change(library.getByRole("searchbox", { name: "搜索文件库" }), { target: { value: "BETA" } });
    expect(library.getByRole("heading", { name: files[1].file_name })).toBeTruthy();
    expect(library.queryByRole("heading", { name: files[0].file_name })).toBeNull();
    expect(library.queryByRole("heading", { name: files[2].file_name })).toBeNull();
    expect(library.getByRole("heading", { name: "1 / 5 个文件" })).toBeTruthy();
    expect(within(chip).getByRole("option", { name: "X1000" })).toBeTruthy();
    expect(within(board).getByRole("option", { name: "PD · 产品板" })).toBeTruthy();
  });

  it("supports other boards and unidentified chips independently and together", async () => {
    const library = await openBomLibrary();
    fireEvent.change(library.getByRole("combobox", { name: "板型筛选" }), { target: { value: "__other__" } });
    expect(library.getByRole("heading", { name: files[3].file_name })).toBeTruthy();
    expect(library.getByRole("heading", { name: files[4].file_name })).toBeTruthy();
    expect(library.queryByRole("heading", { name: files[0].file_name })).toBeNull();
    fireEvent.change(library.getByRole("combobox", { name: "主芯片筛选" }), { target: { value: "__other__" } });
    expect(library.getByRole("heading", { name: files[3].file_name })).toBeTruthy();
    expect(library.queryByRole("heading", { name: files[4].file_name })).toBeNull();
  });

  it("shows an empty combination and restores files after resetting filters", async () => {
    const library = await openBomLibrary();
    const board = library.getByRole("combobox", { name: "板型筛选" });
    const chip = library.getByRole("combobox", { name: "主芯片筛选" });
    fireEvent.change(board, { target: { value: "RD" } });
    fireEvent.change(chip, { target: { value: "X1000" } });
    expect(library.getByText("未找到匹配文件")).toBeTruthy();
    expect(library.getByRole("heading", { name: "0 / 5 个文件" })).toBeTruthy();
    fireEvent.change(board, { target: { value: "" } });
    fireEvent.change(chip, { target: { value: "" } });
    expect(library.getAllByRole("article")).toHaveLength(5);
  });

  it("adds new filter options immediately after upload", async () => {
    const library = await openBomLibrary();
    vi.mocked(api.uploadExcelFiles).mockResolvedValue([
      { id: 6, file_name: "PD_X4000_new.xlsx", board_code: "PD", main_chip: "X4000", status: "ready" }
    ]);
    fireEvent.change(library.getByLabelText("选择 Excel 文件"), {
      target: { files: [new File(["test"], "PD_X4000_new.xlsx")] }
    });
    await library.findByRole("option", { name: "X4000" });
    fireEvent.change(library.getByRole("combobox", { name: "主芯片筛选" }), { target: { value: "X4000" } });
    expect(library.getByRole("heading", { name: "PD_X4000_new.xlsx" })).toBeTruthy();
    expect(library.getAllByRole("article")).toHaveLength(1);
  });

  it("clears hidden selections and selects only the filtered files for batch deletion", async () => {
    const library = await openBomLibrary();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    vi.mocked(api.deleteExcelFiles).mockResolvedValue(undefined);
    fireEvent.click(library.getByRole("checkbox", { name: `选择 ${files[0].file_name}` }));
    fireEvent.change(library.getByRole("combobox", { name: "板型筛选" }), { target: { value: "PD" } });
    expect((library.getByRole("button", { name: "批量删除" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(library.getByRole("checkbox", { name: "选择当前显示的文件" }));
    fireEvent.click(library.getByRole("button", { name: "批量删除" }));
    await waitFor(() => expect(api.deleteExcelFiles).toHaveBeenCalledWith([3]));
    await waitFor(() => expect((library.getByRole("combobox", { name: "板型筛选" }) as HTMLSelectElement).value).toBe(""));
    expect(library.getByRole("heading", { name: files[0].file_name })).toBeTruthy();
  });

  it("keeps the BOM library and its filters private for ordinary users", async () => {
    vi.mocked(api.fetchExcelAdminSession).mockResolvedValue({ authenticated: false, role: "user", username: null });
    render(<ExcelMaterialSearchPage onNavigate={() => undefined} />);
    await screen.findByRole("link", { name: "管理员登录" });
    fireEvent.click(screen.getByRole("tab", { name: "BOM" }));
    expect(screen.queryByRole("region", { name: "文件库" })).toBeNull();
    expect(screen.queryByRole("combobox", { name: "板型筛选" })).toBeNull();
    expect(api.fetchExcelFiles).not.toHaveBeenCalled();
    expect(screen.getByRole("textbox", { name: "物料号" })).toBeTruthy();
  });
});
