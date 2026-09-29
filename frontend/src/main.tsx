import React from "react";
import { createRoot } from "react-dom/client";
import ExcelAdminLoginPage from "./pages/ExcelAdminLoginPage";
import ExcelMaterialSearchPage from "./pages/ExcelMaterialSearchPage";
import "./inherited.css";
import "./shell.css";
import { navigateApplication } from "./navigation";

function App() {
  const [path, setPath] = React.useState(location.pathname);
  React.useEffect(() => {
    const update = () => setPath(location.pathname);
    window.addEventListener("popstate", update);
    return () => window.removeEventListener("popstate", update);
  }, []);
  function navigate(next: string) {
    navigateApplication(next, setPath);
  }
  return <main className="page">
    <nav className="app-navigation" aria-label="主站导航"><a href="/">AI 服务平台</a><a href="/apps">AI 应用</a></nav>
    {path.endsWith("/admin-login") ? <ExcelAdminLoginPage onNavigate={navigate} /> : <ExcelMaterialSearchPage onNavigate={navigate} />}
  </main>;
}

createRoot(document.getElementById("root")!).render(<App />);
