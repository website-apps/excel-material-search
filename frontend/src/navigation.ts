export function navigateApplication(path: string, update: (path: string) => void) {
  const base = "/apps/excel-material-search";
  if (path !== base && !path.startsWith(base + "/")) {
    window.location.assign(path);
    return;
  }
  window.history.pushState(null, "", path);
  update(path);
}
