// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import ArchiveFilter from "./ArchiveFilter";

afterEach(cleanup);
const options = [{ value: "", label: "所有板型", count: 22 }, { value: "PD", label: "PD · 产品板", count: 5 }, { value: "__other__", label: "其他", count: 17 }];

it("opens a styled list with counts and selects an option", () => {
  const change = vi.fn();
  render(<ArchiveFilter label="板型筛选" icon={null} value="" options={options} onChange={change} />);
  const trigger = screen.getByRole("combobox", { name: "板型筛选" });
  fireEvent.click(trigger);
  expect(screen.getByRole("option", { name: "所有板型" }).getAttribute("aria-selected")).toBe("true");
  expect(screen.getByText("17")).toBeTruthy();
  fireEvent.click(screen.getByRole("option", { name: "PD · 产品板" }));
  expect(change).toHaveBeenCalledWith("PD");
  expect(trigger.getAttribute("aria-expanded")).toBe("false");
  expect(document.activeElement).toBe(trigger);
});

it("supports keyboard selection, Escape, Tab and outside clicks", () => {
  const change = vi.fn();
  render(<ArchiveFilter label="板型筛选" icon={null} value="" options={options} onChange={change} />);
  const trigger = screen.getByRole("combobox");
  fireEvent.keyDown(trigger, { key: "ArrowDown" });
  fireEvent.keyDown(trigger, { key: "End" });
  fireEvent.keyDown(trigger, { key: "Enter" });
  expect(change).toHaveBeenCalledWith("__other__");
  for (const key of ["Escape", "Tab"]) {
    fireEvent.click(trigger);
    fireEvent.keyDown(trigger, { key });
    expect(screen.queryByRole("listbox")).toBeNull();
  }
  fireEvent.click(trigger);
  fireEvent.pointerDown(document.body);
  expect(screen.queryByRole("listbox")).toBeNull();
});
