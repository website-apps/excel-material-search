import { FormEvent, useState } from "react";

import { fetchExcelAdminSession, loginExcelAdmin } from "../services/api";

type ExcelAdminLoginPageProps = {
  onNavigate: (path: string) => void;
};

export default function ExcelAdminLoginPage(props: ExcelAdminLoginPageProps) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setErrorMessage("");

    try {
      await loginExcelAdmin(username.trim(), password);
      const access = await fetchExcelAdminSession();
      if (access.role !== "admin") {
        setErrorMessage("当前账号没有 Excel 管理权限");
        return;
      }
      props.onNavigate("/apps/excel-material-search");
    } catch (error) {
      const message = error instanceof Error ? error.message : "登录失败";
      setErrorMessage(message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="content ai-app-admin-login-page">
      <section className="card admin-login-card ai-app-admin-login-card">
        <h1>器件资料库管理员登录</h1>
        <p className="description">登录后可上传、查看和维护器件资料与 BOM 文件库。</p>
        <form className="form" onSubmit={handleSubmit}>
          <label htmlFor="excel-admin-username">账号</label>
          <input
            id="excel-admin-username"
            type="text"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            required
          />

          <label htmlFor="excel-admin-password">密码</label>
          <input
            id="excel-admin-password"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
          />

          <button type="submit" disabled={submitting}>
            {submitting ? "登录中..." : "登录"}
          </button>
        </form>
        {errorMessage ? <p className="alert error">{errorMessage}</p> : null}
        <a
          className="ai-app-admin-back-link"
          href="/apps/excel-material-search"
          onClick={(event) => {
            event.preventDefault();
            props.onNavigate("/apps/excel-material-search");
          }}
        >
          返回器件资料检索
        </a>
      </section>
    </section>
  );
}
