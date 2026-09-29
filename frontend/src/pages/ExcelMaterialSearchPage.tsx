import { ChangeEvent, FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { Download, Eye, FileText, LogOut, Pencil, RefreshCw, Search, Table2, Trash2, Upload, X } from "lucide-react";

import {
  archiveDocumentDownloadUrl,
  archiveDocumentPreviewUrl,
  deleteArchiveDocument,
  deleteArchiveDocuments,
  deleteExcelFile,
  deleteExcelFiles,
  fetchArchiveDocuments,
  fetchArchiveWorkbookPreview,
  fetchExcelAdminSession,
  fetchExcelFiles,
  queryArchiveDocuments,
  queryExcelIndex,
  reindexArchiveDocuments,
  updateArchiveDocument,
  uploadArchiveDocuments,
  uploadExcelFiles,
  logoutExcelAdmin
} from "../services/api";
import type {
  ArchiveDocument,
  ArchiveDocumentKind,
  ArchiveManualMatch,
  ArchiveUploadResult,
  ArchiveWorkbookPreviewResponse,
  ExcelIndexedFile,
  ExcelIndexMatch,
  ExcelAccessSessionResponse
} from "../types";

const dateFormatter = new Intl.DateTimeFormat("zh-CN", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23"
});

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : dateFormatter.format(date);
}

function formatUploadTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  const parts: Record<string, string> = {};
  dateFormatter.formatToParts(date).forEach((part) => {
    parts[part.type] = part.value;
  });
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
}

function isFailure(result: ArchiveUploadResult): result is Extract<ArchiveUploadResult, { status: "failed" }> {
  return result.status === "failed" && !("id" in result);
}

function documentSubtitle(document: ArchiveDocument) {
  return [document.category, document.vendor, document.package].filter(Boolean).join(" · ") || "待补充资料标签";
}

function mergeFiles(current: ExcelIndexedFile[], incoming: ExcelIndexedFile[]) {
  const byName = new Map(current.map((file) => [file.file_name, file]));
  incoming.forEach((file) => byName.set(file.file_name, file));
  return Array.from(byName.values());
}

function sortMatchesByUploadTime(matches: ExcelIndexMatch[]) {
  return matches
    .map((match, index) => ({ match, index, uploadedAt: Date.parse(match.created_at) }))
    .sort((left, right) => {
      const leftUploadedAt = Number.isNaN(left.uploadedAt)
        ? Number.NEGATIVE_INFINITY
        : left.uploadedAt;
      const rightUploadedAt = Number.isNaN(right.uploadedAt)
        ? Number.NEGATIVE_INFINITY
        : right.uploadedAt;
      return rightUploadedAt - leftUploadedAt || left.index - right.index;
    })
    .map(({ match }) => match);
}

function MatchItem(props: { match: ExcelIndexMatch }) {
  const { match } = props;
  return (
    <article className="ai-app-match-item">
      <div className="ai-app-match-heading">
        <strong>{match.file_name}</strong>
        <time dateTime={match.created_at}>上传于 {formatUploadTime(match.created_at)}</time>
      </div>
      <span>
        {match.field_name || "未知字段"}：{match.raw_value}
      </span>
    </article>
  );
}

type PreviewState =
  | { document: ArchiveDocument; mode: "frame" }
  | { document: ArchiveDocument; mode: "text"; content: string }
  | { document: ArchiveDocument; mode: "workbook"; workbook: ArchiveWorkbookPreviewResponse }
  | { document: ArchiveDocument; mode: "unsupported" };

type EditState = {
  document: ArchiveDocument;
  title: string;
  category: string;
  package: string;
  vendor: string;
  remark: string;
  note: string;
};

type PanelProps = {
  isAdmin: boolean;
  onError: (message: string | null) => void;
};

export default function ExcelMaterialSearchPage(props: { onNavigate: (path: string) => void }) {
  const [kind, setKind] = useState<ArchiveDocumentKind>("manual");
  const [access, setAccess] = useState<ExcelAccessSessionResponse | null>(null);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isAdmin = access?.role === "admin";

  useEffect(() => {
    let active = true;
    fetchExcelAdminSession()
      .then((loadedAccess) => {
        if (active) {
          setAccess(loadedAccess);
        }
      })
      .catch((requestError: Error) => {
        if (active) {
          setAccess({ authenticated: false, role: "user", username: null });
          setError(requestError.message);
        }
      });
    return () => {
      active = false;
    };
  }, []);

  function changeKind(nextKind: ArchiveDocumentKind) {
    setKind(nextKind);
    setError(null);
  }

  async function handleLogout() {
    if (isLoggingOut) return;
    setIsLoggingOut(true);
    try {
      await logoutExcelAdmin();
      setAccess({ authenticated: false, role: "user", username: null });
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "退出管理失败");
    } finally {
      setIsLoggingOut(false);
    }
  }

  return (
    <section className="archive-workspace" aria-label="器件资料与 BOM 检索工作台">
      <div className="ai-app-breadcrumb" aria-label="当前位置">
        <a href="/apps" onClick={(event) => { event.preventDefault(); props.onNavigate("/apps"); }}>AI 应用</a>
        <span aria-hidden="true">/</span>
        <span>器件资料与 BOM 检索</span>
      </div>

      <header className="archive-header">
        <div>
          <p className="section-kicker">SPEC ARCHIVE · HARDWARE DESK</p>
          <h1>器件资料与 BOM 检索</h1>
          <p>把器件手册和工程 BOM 放在同一张工作台上，先看资料，再定位物料。</p>
        </div>
        <div className="archive-header-actions">
          {isAdmin ? (
            <>
              <span className="ai-app-management-badge"><span aria-hidden="true">●</span> 管理中</span>
              <button className="ai-app-logout-button" type="button" onClick={handleLogout} disabled={isLoggingOut}>
                <LogOut aria-hidden="true" size={15} /> {isLoggingOut ? "退出中" : "退出管理"}
              </button>
            </>
          ) : access ? (
            <a className="ai-app-admin-login-link" href="/apps/excel-material-search/admin-login" onClick={(event) => { event.preventDefault(); props.onNavigate("/apps/excel-material-search/admin-login"); }}>
              管理员登录
            </a>
          ) : null}
        </div>
      </header>

      {error ? <p className="ai-app-alert error">{error}</p> : null}

      <div className="archive-library-tabs" role="tablist" aria-label="资料库类型">
        <button className={kind === "manual" ? "active" : ""} role="tab" aria-selected={kind === "manual"} onClick={() => changeKind("manual")} type="button">
          <FileText aria-hidden="true" size={17} /> 器件资料
        </button>
        <button className={kind === "bom" ? "active" : ""} role="tab" aria-selected={kind === "bom"} onClick={() => changeKind("bom")} type="button">
          <Table2 aria-hidden="true" size={17} /> BOM
        </button>
      </div>

      {kind === "manual" ? (
        <ManualArchivePanel isAdmin={isAdmin} onError={setError} />
      ) : (
        <BomMaterialPanel isAdmin={isAdmin} onError={setError} />
      )}
    </section>
  );
}

function ManualArchivePanel(props: PanelProps) {
  const { isAdmin } = props;
  const setError = props.onError;
  const [documents, setDocuments] = useState<ArchiveDocument[]>([]);
  const [libraryQuery, setLibraryQuery] = useState("");
  const [category, setCategory] = useState("");
  const [vendor, setVendor] = useState("");
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<ArchiveManualMatch[]>([]);
  const [hasSearched, setHasSearched] = useState(false);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isReindexing, setIsReindexing] = useState(false);
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const [editing, setEditing] = useState<EditState | null>(null);
  const manualInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    let active = true;
    fetchArchiveDocuments({ kind: "manual" })
      .then((loadedDocuments) => {
        if (active) {
          setDocuments(loadedDocuments);
          setSelectedIds([]);
        }
      })
      .catch((requestError: Error) => {
        if (active) {
          setError(requestError.message);
        }
      });
    return () => {
      active = false;
    };
  }, [setError]);

  const visibleDocuments = useMemo(() => {
    const normalizedQuery = libraryQuery.trim().toLocaleLowerCase();
    return documents.filter((document) => {
      if (category && document.category !== category) return false;
      if (vendor && document.vendor !== vendor) return false;
      if (!normalizedQuery) return true;
      return `${document.title} ${document.original_name} ${documentSubtitle(document)}`
        .toLocaleLowerCase()
        .includes(normalizedQuery);
    });
  }, [category, documents, libraryQuery, vendor]);

  const filterOptions = useMemo(() => ({
    categories: [...new Set(documents.map((document) => document.category).filter(Boolean))].sort(),
    vendors: [...new Set(documents.map((document) => document.vendor).filter(Boolean))].sort()
  }), [documents]);

  async function refreshDocuments() {
    const loaded = await fetchArchiveDocuments({ kind: "manual" });
    setDocuments(loaded);
    setSelectedIds([]);
  }

  async function handleUpload(event: ChangeEvent<HTMLInputElement>) {
    const selected = Array.from(event.target.files || []);
    event.target.value = "";
    if (!selected.length || isUploading) return;
    setIsUploading(true);
    setError(null);
    try {
      const results = await uploadArchiveDocuments(selected, "manual");
      const failures = results.filter(isFailure);
      if (failures.length) {
        setError(failures.map((failure) => `${failure.original_name}：${failure.error}`).join("；"));
      }
      await refreshDocuments();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "资料上传失败");
    } finally {
      setIsUploading(false);
    }
  }

  async function submitQuery(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = query.trim();
    if (!value) {
      setError("请输入型号、厂商或技术关键词");
      return;
    }
    setIsSearching(true);
    setHasSearched(true);
    setError(null);
    try {
      const result = await queryArchiveDocuments(value, "manual");
      setMatches(result.matches as ArchiveManualMatch[]);
    } catch (requestError) {
      setMatches([]);
      setError(requestError instanceof Error ? requestError.message : "查询失败");
    } finally {
      setIsSearching(false);
    }
  }

  async function handlePreview(document: ArchiveDocument) {
    setError(null);
    const extension = document.extension.toLowerCase();
    if (["xls", "xlsx", "xlsm", "xltx", "xltm"].includes(extension)) {
      setPreview({ document, mode: "workbook", workbook: { title: document.title, sheets: [] } });
      try {
        const workbook = await fetchArchiveWorkbookPreview(document.id);
        setPreview({ document, mode: "workbook", workbook });
      } catch (requestError) {
        setPreview(null);
        setError(requestError instanceof Error ? requestError.message : "工作簿预览失败");
      }
      return;
    }
    if (extension === "pdf") {
      setPreview({ document, mode: "frame" });
      return;
    }
    if (["txt", "md"].includes(extension)) {
      try {
        const response = await fetch(archiveDocumentPreviewUrl(document.id));
        if (!response.ok) throw new Error("文本预览失败");
        setPreview({ document, mode: "text", content: await response.text() });
      } catch (requestError) {
        setError(requestError instanceof Error ? requestError.message : "文本预览失败");
      }
      return;
    }
    setPreview({ document, mode: "unsupported" });
  }

  function openEdit(document: ArchiveDocument) {
    setEditing({
      document,
      title: document.title,
      category: document.category === "未分类" ? "" : document.category,
      package: document.package,
      vendor: document.vendor,
      remark: document.remark,
      note: document.note
    });
  }

  async function saveEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editing) return;
    setIsDeleting(true);
    setError(null);
    try {
      await updateArchiveDocument(editing.document.id, {
        title: editing.title,
        category: editing.category,
        package: editing.package,
        vendor: editing.vendor,
        remark: editing.remark,
        note: editing.note
      });
      await refreshDocuments();
      setEditing(null);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "保存标签失败");
    } finally {
      setIsDeleting(false);
    }
  }

  async function removeDocument(document: ArchiveDocument) {
    if (!isAdmin || isDeleting || !window.confirm(`确定删除“${document.original_name}”吗？删除后需要重新上传。`)) return;
    setIsDeleting(true);
    setError(null);
    try {
      await deleteArchiveDocument(document.id);
      setDocuments((current) => current.filter((item) => item.id !== document.id));
      setMatches((current) => current.filter((match) => match.document_id !== document.id));
      setSelectedIds((current) => current.filter((id) => id !== document.id));
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "删除失败");
    } finally {
      setIsDeleting(false);
    }
  }

  async function removeSelected() {
    if (!isAdmin || !selectedIds.length || isDeleting || !window.confirm(`确定删除选中的 ${selectedIds.length} 个资料吗？`)) return;
    setIsDeleting(true);
    setError(null);
    try {
      await deleteArchiveDocuments(selectedIds);
      const selected = new Set(selectedIds);
      setDocuments((current) => current.filter((item) => !selected.has(item.id)));
      setMatches((current) => current.filter((match) => !selected.has(match.document_id)));
      setSelectedIds([]);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "批量删除失败");
    } finally {
      setIsDeleting(false);
    }
  }

  async function handleReindex() {
    if (!isAdmin || isReindexing) return;
    setIsReindexing(true);
    setError(null);
    try {
      await reindexArchiveDocuments();
      await refreshDocuments();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "重建索引失败");
    } finally {
      setIsReindexing(false);
    }
  }

  const readyCount = documents.filter((document) => document.status === "ready").length;
  const allVisibleSelected = visibleDocuments.length > 0 && visibleDocuments.every((document) => selectedIds.includes(document.id));

  function toggleDocument(documentId: number) {
    setSelectedIds((current) => current.includes(documentId) ? current.filter((id) => id !== documentId) : [...current, documentId]);
  }

  function toggleAllVisible() {
    const visibleIds = visibleDocuments.map((document) => document.id);
    setSelectedIds((current) => allVisibleSelected ? current.filter((id) => !visibleIds.includes(id)) : Array.from(new Set([...current, ...visibleIds])));
  }

  return (
    <>
      <section className="archive-library" aria-label="资料库">
        <div className="archive-library-topline">
          <span className="archive-library-count">{visibleDocuments.length} 个资料 · {readyCount} 个已索引</span>
          <div className="archive-library-actions">
            {isAdmin ? (
              <>
                <button className="archive-quiet-button" type="button" disabled={isReindexing} onClick={handleReindex}>
                  <RefreshCw aria-hidden="true" size={14} className={isReindexing ? "archive-spin" : ""} /> 重建索引
                </button>
                <button className="archive-primary-button" type="button" disabled={isUploading} onClick={() => manualInputRef.current?.click()}>
                  <Upload aria-hidden="true" size={15} /> {isUploading ? "上传中" : "上传器件资料"}
                </button>
              </>
            ) : null}
          </div>
        </div>

        <div className="archive-filter-row">
          <label className="archive-search-field">
            <Search aria-hidden="true" size={17} />
            <span className="sr-only">搜索当前资料库</span>
            <input type="search" aria-label="搜索当前资料库" placeholder="搜索型号、厂商、技术关键词…" value={libraryQuery} onChange={(event) => setLibraryQuery(event.target.value)} />
          </label>
          <select aria-label="分类筛选" value={category} onChange={(event) => setCategory(event.target.value)}>
            <option value="">所有分类</option>
            {filterOptions.categories.map((option) => <option key={option} value={option}>{option}</option>)}
          </select>
          <select aria-label="厂商筛选" value={vendor} onChange={(event) => setVendor(event.target.value)}>
            <option value="">所有厂商</option>
            {filterOptions.vendors.map((option) => <option key={option} value={option}>{option}</option>)}
          </select>
        </div>

        {isAdmin && visibleDocuments.length ? (
          <div className="archive-selection-toolbar">
            <label><input type="checkbox" aria-label="选择当前显示的资料" checked={allVisibleSelected} onChange={toggleAllVisible} /> 全选当前结果</label>
            <button type="button" className="archive-danger-button" disabled={!selectedIds.length || isDeleting} onClick={removeSelected}><Trash2 aria-hidden="true" size={14} /> 删除选中{selectedIds.length ? ` (${selectedIds.length})` : ""}</button>
          </div>
        ) : null}

        {visibleDocuments.length ? (
          <div className="archive-document-list">
            {visibleDocuments.map((document) => (
              <article className={`archive-document-row ${isAdmin ? "with-check" : "without-check"}`} key={document.id}>
                {isAdmin ? <label className="archive-document-check"><input type="checkbox" aria-label={`选择 ${document.original_name}`} checked={selectedIds.includes(document.id)} onChange={() => toggleDocument(document.id)} /></label> : null}
                <div className="archive-document-icon" aria-hidden="true"><FileText size={18} /></div>
                <div className="archive-document-copy">
                  <h2>{document.title}</h2>
                  <p>{documentSubtitle(document)}</p>
                  <small>{document.original_name} · {document.size} · 更新于 {formatDate(document.file_modified_at || document.created_at)}</small>
                </div>
                <span className={`archive-status ${document.status}`}>{document.status === "ready" ? "已索引" : document.status === "empty" ? "无正文" : document.status === "failed" ? "失败" : "处理中"}</span>
                <div className="archive-document-actions">
                  <button type="button" aria-label={`预览 ${document.original_name}`} title="预览" onClick={() => handlePreview(document)}><Eye aria-hidden="true" size={16} /></button>
                  <a href={archiveDocumentDownloadUrl(document.id)} aria-label={`下载 ${document.original_name}`} title="下载"><Download aria-hidden="true" size={16} /></a>
                  {isAdmin ? <button type="button" aria-label={`编辑 ${document.original_name}`} title="编辑" onClick={() => openEdit(document)}><Pencil aria-hidden="true" size={16} /></button> : null}
                  {isAdmin ? <button className="danger" type="button" aria-label={`删除 ${document.original_name}`} title="删除" onClick={() => removeDocument(document)}><Trash2 aria-hidden="true" size={16} /></button> : null}
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className="archive-empty-library"><span className="archive-empty-mark">DOC</span><strong>{documents.length ? "没有符合筛选条件的资料" : "资料库还是空的"}</strong><p>{isAdmin ? "上传后，文件会自动建立可检索索引。" : "管理员上传资料后，这里会显示可检索文件。"}</p></div>
        )}
        <input ref={manualInputRef} className="ai-app-file-input" type="file" multiple accept=".pdf,.docx,.xls,.xlsx,.xlsm,.xltx,.xltm,.txt,.md" aria-label="选择器件资料文件" onChange={handleUpload} />
      </section>

      <form className="archive-query-panel" aria-label="资料查询" onSubmit={submitQuery}>
        <div className="archive-query-heading"><div><span>器件资料全文检索</span><h2>搜索型号、厂商、封装和正文技术关键词</h2></div><span className="archive-query-hint">资料范围内匹配</span></div>
        <div className="archive-query-controls"><input aria-label="资料关键词" value={query} onChange={(event) => { setQuery(event.target.value); setMatches([]); setHasSearched(false); setError(null); }} placeholder="例如 G2257Q51U、输入电压、低功耗" /><button type="submit" disabled={isSearching}>{isSearching ? "查询中" : "开始检索"}</button></div>
        <p>只返回当前器件资料库中出现的文件名、元数据或正文内容。</p>
      </form>

      <section className="archive-results-panel" aria-label="检索结果">
        <div className="archive-query-heading"><div><span>检索结果</span><h2>{hasSearched ? `${query.trim()} · ${matches.length} 个命中` : "输入内容开始检索"}</h2></div><span className="archive-query-hint">器件资料</span></div>
        {!hasSearched ? <div className="archive-result-intro"><span>01</span><div><strong>从资料出发，快速找到可用信息</strong><p>先在资料库中筛选文件，再用关键词检索正文。</p></div></div> : matches.length ? <div className="archive-match-list">{matches.map((match, index) => <article className="archive-match-card" key={`${match.document_id}-${index}`}><div><strong>{match.title}</strong><span>{match.category}{match.vendor ? ` · ${match.vendor}` : ""}</span></div><p>{match.excerpt || "命中文件元数据"}</p><time>{formatDate(match.created_at)}</time></article>)}</div> : <div className="archive-empty-results"><span>⌕</span><strong>没有找到匹配内容</strong><p>请检查型号是否完整，或确认资料库已经包含该文件。</p></div>}
      </section>

      {preview ? <div className="archive-modal-backdrop" role="presentation" onClick={() => setPreview(null)}><section className="archive-modal archive-preview-modal" role="dialog" aria-modal="true" aria-labelledby="archive-preview-title" onClick={(event) => event.stopPropagation()}><header><div><span>DOCUMENT VIEW</span><h2 id="archive-preview-title">{preview.document.title}</h2></div><button type="button" aria-label="关闭预览" onClick={() => setPreview(null)}><X aria-hidden="true" size={18} /></button></header><div className="archive-preview-body">{preview.mode === "frame" ? <iframe title={`${preview.document.title} 预览`} src={archiveDocumentPreviewUrl(preview.document.id)} /> : preview.mode === "text" ? <pre>{preview.content}</pre> : preview.mode === "unsupported" ? <div className="archive-empty-results"><strong>暂不支持在线预览</strong><p>请下载文件后查看。</p></div> : preview.workbook.sheets.length ? <div className="archive-workbook-preview">{preview.workbook.sheets.map((sheet) => <section key={sheet.name}><h3>{sheet.name}</h3><div className="archive-table-scroll"><table><tbody>{sheet.rows.map((row, rowIndex) => <tr key={rowIndex}>{row.map((cell, cellIndex) => rowIndex === 0 ? <th key={cellIndex}>{cell}</th> : <td key={cellIndex}>{cell}</td>)}</tr>)}</tbody></table></div></section>)}</div> : <div className="archive-empty-results"><strong>正在读取工作簿…</strong></div>}</div></section></div> : null}

      {editing ? <div className="archive-modal-backdrop" role="presentation" onClick={() => setEditing(null)}><section className="archive-modal archive-edit-modal" role="dialog" aria-modal="true" aria-labelledby="archive-edit-title" onClick={(event) => event.stopPropagation()}><header><div><span>METADATA</span><h2 id="archive-edit-title">编辑资料标签</h2></div><button type="button" aria-label="关闭编辑" onClick={() => setEditing(null)}><X aria-hidden="true" size={18} /></button></header><form onSubmit={saveEdit}><div className="archive-edit-grid"><label>标题<input value={editing.title} onChange={(event) => setEditing({ ...editing, title: event.target.value })} required /></label><label>分类<input value={editing.category} onChange={(event) => setEditing({ ...editing, category: event.target.value })} /></label><label>厂商<input value={editing.vendor} onChange={(event) => setEditing({ ...editing, vendor: event.target.value })} /></label><label>封装<input value={editing.package} onChange={(event) => setEditing({ ...editing, package: event.target.value })} /></label><label>备注<textarea value={editing.remark} onChange={(event) => setEditing({ ...editing, remark: event.target.value })} /></label><label>简介<textarea value={editing.note} onChange={(event) => setEditing({ ...editing, note: event.target.value })} /></label></div><footer><button type="button" className="archive-quiet-button" onClick={() => setEditing(null)}>取消</button><button type="submit" className="archive-primary-button" disabled={isDeleting}>{isDeleting ? "保存中" : "保存修改"}</button></footer></form></section></div> : null}
    </>
  );
}

function BomMaterialPanel(props: PanelProps) {
  const { isAdmin } = props;
  const setError = props.onError;
  const [query, setQuery] = useState("");
  const [fileQuery, setFileQuery] = useState("");
  const [files, setFiles] = useState<ExcelIndexedFile[]>([]);
  const [matches, setMatches] = useState<ExcelIndexMatch[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [deletingFileId, setDeletingFileId] = useState<number | null>(null);
  const [selectedFileIds, setSelectedFileIds] = useState<number[]>([]);
  const [isBatchDeleting, setIsBatchDeleting] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!isAdmin) {
      setFiles([]);
      setSelectedFileIds([]);
      return;
    }

    let active = true;
    fetchExcelFiles()
      .then((loadedFiles) => {
        if (active) {
          setFiles(loadedFiles);
        }
      })
      .catch((requestError: Error) => {
        if (active) {
          setError(requestError.message);
        }
      });

    return () => {
      active = false;
    };
  }, [isAdmin, setError]);

  async function handleUpload(event: ChangeEvent<HTMLInputElement>) {
    const selectedFiles = Array.from(event.target.files || []);
    event.target.value = "";
    if (!selectedFiles.length) {
      return;
    }

    setIsUploading(true);
    setError(null);
    try {
      const indexedFiles = await uploadExcelFiles(selectedFiles);
      setFiles((current) => mergeFiles(current, indexedFiles));
      const failedFiles = indexedFiles.filter((file) => file.status === "failed");
      if (failedFiles.length) {
        setError(failedFiles.map((file) => `${file.file_name}：${file.error || "解析失败"}`).join("；"));
      }
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Excel 上传失败");
    } finally {
      setIsUploading(false);
    }
  }

  async function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = query.trim();
    if (!value) {
      setError("请输入要查询的物料号或字段值");
      return;
    }

    setIsSearching(true);
    setHasSearched(true);
    setError(null);
    try {
      const result = await queryExcelIndex(value);
      setMatches(sortMatchesByUploadTime(result.matches));
    } catch (requestError) {
      setMatches([]);
      setError(requestError instanceof Error ? requestError.message : "查询失败");
    } finally {
      setIsSearching(false);
    }
  }

  async function handleDelete(file: ExcelIndexedFile) {
    if (file.id == null || deletingFileId !== null || isBatchDeleting) {
      return;
    }
    const confirmed = window.confirm(
      `确定删除“${file.file_name}”吗？删除后将从索引库中移除，之后需要重新上传。`
    );
    if (!confirmed) {
      return;
    }

    setDeletingFileId(file.id);
    setError(null);
    try {
      await deleteExcelFile(file.id);
      setFiles((current) => current.filter((currentFile) => currentFile.id !== file.id));
      setMatches((current) => current.filter((match) => match.file_id !== file.id));
      setSelectedFileIds((current) => current.filter((fileId) => fileId !== file.id));
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Excel 删除失败");
    } finally {
      setDeletingFileId(null);
    }
  }

  function toggleFileSelection(fileId: number) {
    setSelectedFileIds((current) =>
      current.includes(fileId)
        ? current.filter((selectedFileId) => selectedFileId !== fileId)
        : [...current, fileId]
    );
  }

  async function handleBatchDelete() {
    if (!selectedFileIds.length || deletingFileId !== null || isBatchDeleting) {
      return;
    }
    const confirmed = window.confirm(
      `确定删除选中的 ${selectedFileIds.length} 个文件吗？删除后需要重新上传。`
    );
    if (!confirmed) {
      return;
    }

    const fileIds = [...selectedFileIds];
    const fileIdSet = new Set(fileIds);
    setIsBatchDeleting(true);
    setError(null);
    try {
      await deleteExcelFiles(fileIds);
      setFiles((current) => current.filter((file) => file.id == null || !fileIdSet.has(file.id)));
      setMatches((current) => current.filter((match) => !fileIdSet.has(match.file_id)));
      setSelectedFileIds([]);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Excel 批量删除失败");
    } finally {
      setIsBatchDeleting(false);
    }
  }

  const readyFileCount = files.filter((file) => file.status === "ready").length;
  const normalizedFileQuery = fileQuery.trim().toLocaleLowerCase();
  const filteredFiles = normalizedFileQuery
    ? files.filter((file) => file.file_name.toLocaleLowerCase().includes(normalizedFileQuery))
    : files;
  const visibleFileIds = filteredFiles.flatMap((file) => (file.id == null ? [] : [file.id]));
  const allVisibleFilesSelected =
    visibleFileIds.length > 0 && visibleFileIds.every((fileId) => selectedFileIds.includes(fileId));

  function toggleVisibleFiles() {
    setSelectedFileIds((current) => {
      if (allVisibleFilesSelected) {
        return current.filter((fileId) => !visibleFileIds.includes(fileId));
      }
      return Array.from(new Set([...current, ...visibleFileIds]));
    });
  }

  return (
    <>
      {isAdmin ? <section className="ai-app-files" aria-label="文件库">
        <div className="ai-app-panel-heading">
          <div>
            <span>文件库</span>
            <h2>{files.length} 个文件</h2>
          </div>
          <div className="ai-app-file-heading-actions">
            <span className="ai-app-muted">
              {readyFileCount ? `${readyFileCount} 个已建立索引` : "未建立索引"}
            </span>
            <div className="ai-app-upload-control">
              <input
                ref={fileInputRef}
                aria-label="选择 Excel 文件"
                className="ai-app-file-input"
                type="file"
                multiple
                accept=".xlsx,.xlsm,.xltx,.xltm"
                onChange={handleUpload}
              />
              <button
                className="ai-app-upload-button"
                type="button"
                disabled={isUploading}
                onClick={() => fileInputRef.current?.click()}
              >
                <span aria-hidden="true">＋</span>
                {isUploading ? "正在解析" : "上传 Excel"}
              </button>
            </div>
          </div>
        </div>
        {files.length ? (
          <>
            <div className="ai-app-file-search">
              <input
                type="search"
                aria-label="搜索文件库"
                placeholder="搜索文件名"
                value={fileQuery}
                onChange={(event) => setFileQuery(event.target.value)}
              />
              <div className="ai-app-file-batch-actions">
                <label className="ai-app-file-select-all">
                  <input
                    type="checkbox"
                    aria-label="选择当前显示的文件"
                    checked={allVisibleFilesSelected}
                    disabled={!visibleFileIds.length || deletingFileId !== null || isBatchDeleting}
                    onChange={toggleVisibleFiles}
                  />
                  <span>全选</span>
                </label>
                <button
                  className="ai-app-file-batch-delete"
                  type="button"
                  aria-label="批量删除"
                  disabled={!selectedFileIds.length || deletingFileId !== null || isBatchDeleting}
                  onClick={handleBatchDelete}
                >
                  {isBatchDeleting ? "删除中" : `批量删除${selectedFileIds.length ? ` (${selectedFileIds.length})` : ""}`}
                </button>
              </div>
            </div>
            {filteredFiles.length ? (
              <div className="ai-app-file-list">
                {filteredFiles.map((file) => {
                  const isDeleting = deletingFileId === file.id;
                  return (
                    <article className="ai-app-file-row" key={file.id ?? file.file_name}>
                      {file.id != null ? (
                        <label className="ai-app-file-select">
                          <input
                            type="checkbox"
                            aria-label={`选择 ${file.file_name}`}
                            checked={selectedFileIds.includes(file.id)}
                            disabled={deletingFileId !== null || isBatchDeleting}
                            onChange={() => toggleFileSelection(file.id as number)}
                          />
                        </label>
                      ) : null}
                      <div className="ai-app-file-main">
                        <h3>{file.file_name}</h3>
                      </div>
                      <div className="ai-app-file-actions">
                        <span className={`ai-app-file-status ${file.status}`}>
                          {file.status === "ready" ? "已完成" : file.status === "failed" ? "失败" : "解析中"}
                        </span>
                        {file.id != null ? (
                          <button
                            className="ai-app-file-delete"
                            type="button"
                            aria-label={`删除 ${file.file_name}`}
                            title={`删除 ${file.file_name}`}
                            disabled={deletingFileId !== null || isBatchDeleting}
                            onClick={() => handleDelete(file)}
                          >
                            {isDeleting ? "删除中" : "删除"}
                          </button>
                        ) : null}
                      </div>
                    </article>
                  );
                })}
              </div>
            ) : (
              <div className="ai-app-file-filter-empty">未找到匹配文件</div>
            )}
          </>
        ) : (
          <div className="ai-app-file-empty">
            <strong>还没有上传文件</strong>
            <p>支持 .xlsx、.xlsm、.xltx 和 .xltm 文件。</p>
          </div>
        )}
      </section> : null}

      <form className="ai-app-search ai-app-composer" aria-label="AI 对话输入" onSubmit={submitSearch}>
        <label htmlFor="material-number">物料号</label>
        <div className="ai-app-search-controls">
          <input
            id="material-number"
            name="material-number"
            placeholder="输入要查找的物料号，例如 WPM3401"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setMatches([]);
              setHasSearched(false);
              setError(null);
            }}
          />
          <button className="ai-app-search-button" type="submit" disabled={isSearching}>
            {isSearching ? "查询中" : "发送"}
          </button>
        </div>
        <p>优先精确匹配，未找到时按包含内容匹配；Reference、位号和 Designator 类字段不会参与匹配。</p>
      </form>

      <section className="ai-app-results ai-app-chat-panel" aria-label="AI 对话">
        <div className="ai-app-panel-heading">
          <div>
            <span>查询结果</span>
            <h2>{hasSearched ? `${query.trim()} · ${matches.length} 个命中` : "输入物料号开始查询"}</h2>
          </div>
          <span className="ai-app-muted">精确优先</span>
        </div>
        {!hasSearched ? (
          <div className="ai-app-chat-intro">
            <span className="ai-app-chat-avatar" aria-hidden="true">
              AI
            </span>
            <div>
              <strong>我可以帮你查找物料号</strong>
              <p>文件库建立索引后，我会列出命中的文件和匹配内容。</p>
            </div>
          </div>
        ) : matches.length ? (
          <div className="ai-app-match-list">
            {matches.map((match, index) => (
              <MatchItem key={`${match.file_id}-${match.cell_address}-${index}`} match={match} />
            ))}
          </div>
        ) : (
          <div className="ai-app-empty-state">
            <span className="ai-app-empty-icon" aria-hidden="true">
              ⌕
            </span>
            <strong>没有找到匹配内容</strong>
            <p>请检查物料号是否完整，或确认文件库中已包含该字段。</p>
          </div>
        )}
      </section>
    </>
  );
}
