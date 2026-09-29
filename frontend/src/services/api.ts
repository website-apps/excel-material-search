import type { ErrorResponse, ExcelIndexedFile, ExcelIndexMatch, ExcelFilesResponse, ExcelQueryResponse, ArchiveDocumentKind, ArchiveDocument, ArchiveDocumentsResponse, ArchiveUploadFailure, ArchiveUploadResult, ArchiveUploadResponse, ArchiveManualMatch, ArchiveQueryResponse, ArchiveWorkbookSheet, ArchiveWorkbookPreviewResponse, ExcelAccessSessionResponse } from "../types";

async function readJsonResponse<T>(response: Response): Promise<T> {
  const responseText = await response.text();
  let payload: T | ErrorResponse;
  try {
    payload = JSON.parse(responseText) as T | ErrorResponse;
  } catch (error) {
    throw new Error("服务返回了非 JSON 响应，请检查后端接口或查看服务日志");
  }

  if (!response.ok) {
    const error = payload as ErrorResponse;
    throw new Error(error.error || "请求失败");
  }
  return payload as T;
}

export async function fetchExcelFiles(): Promise<ExcelIndexedFile[]> {
  const response = await fetch("/apps/excel-material-search/api/files", {
    method: "GET"
  });
  const payload = await readJsonResponse<ExcelFilesResponse>(response);
  return payload.files;
}

export async function fetchExcelAdminSession(): Promise<ExcelAccessSessionResponse> {
  const response = await fetch("/apps/excel-material-search/api/admin/session", {
    method: "GET"
  });
  return readJsonResponse<ExcelAccessSessionResponse>(response);
}

export async function loginExcelAdmin(
  username: string,
  password: string
): Promise<ExcelAccessSessionResponse> {
  const response = await fetch("/apps/excel-material-search/api/admin/login", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ username, password })
  });
  return readJsonResponse<ExcelAccessSessionResponse>(response);
}

export async function logoutExcelAdmin(): Promise<ExcelAccessSessionResponse> {
  const response = await fetch("/apps/excel-material-search/api/admin/logout", {
    method: "POST"
  });
  return readJsonResponse<ExcelAccessSessionResponse>(response);
}

export async function uploadExcelFiles(files: File[]): Promise<ExcelIndexedFile[]> {
  const formData = new FormData();
  files.forEach((file) => formData.append("files", file));

  const response = await fetch("/apps/excel-material-search/api/files", {
    method: "POST",
    body: formData
  });
  const payload = await readJsonResponse<ExcelFilesResponse>(response);
  return payload.files;
}

export async function deleteExcelFile(fileId: number): Promise<void> {
  const response = await fetch(`/apps/excel-material-search/api/files/${fileId}`, {
    method: "DELETE"
  });
  await readJsonResponse<{ file: { id: number; file_name: string } }>(response);
}

export async function deleteExcelFiles(fileIds: number[]): Promise<void> {
  const response = await fetch("/apps/excel-material-search/api/files", {
    method: "DELETE",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ file_ids: fileIds })
  });
  await readJsonResponse<{ files: Array<{ id: number; file_name: string }> }>(response);
}

export async function queryExcelIndex(query: string): Promise<ExcelQueryResponse> {
  const response = await fetch("/apps/excel-material-search/api/query", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ query })
  });
  return readJsonResponse<ExcelQueryResponse>(response);
}

export async function fetchArchiveDocuments(params: {
  query?: string;
  kind?: ArchiveDocumentKind;
  category?: string;
  vendor?: string;
  boardCode?: string;
  mainChip?: string;
} = {}): Promise<ArchiveDocument[]> {
  const search = new URLSearchParams();
  if (params.query) search.set("q", params.query);
  if (params.kind) search.set("kind", params.kind);
  if (params.category) search.set("category", params.category);
  if (params.vendor) search.set("vendor", params.vendor);
  if (params.boardCode) search.set("board_code", params.boardCode);
  if (params.mainChip) search.set("main_chip", params.mainChip);
  const query = search.toString();
  const response = await fetch(
    `/apps/excel-material-search/api/documents${query ? `?${query}` : ""}`,
    { method: "GET" }
  );
  const payload = await readJsonResponse<ArchiveDocumentsResponse>(response);
  return payload.documents;
}

export async function uploadArchiveDocuments(
  files: File[],
  kind: ArchiveDocumentKind,
  metadata: Record<string, string> = {}
): Promise<ArchiveUploadResult[]> {
  const formData = new FormData();
  files.forEach((file) => formData.append("files", file));
  formData.append("kind", kind);
  Object.entries(metadata).forEach(([key, value]) => formData.append(key, value));
  const response = await fetch("/apps/excel-material-search/api/documents", {
    method: "POST",
    body: formData
  });
  const payload = await readJsonResponse<ArchiveUploadResponse>(response);
  return payload.documents;
}

export async function updateArchiveDocument(
  documentId: number,
  fields: Partial<Pick<ArchiveDocument, "title" | "category" | "package" | "vendor" | "remark" | "note" | "board_type" | "main_chip" | "board_name">>
): Promise<ArchiveDocument> {
  const response = await fetch(`/apps/excel-material-search/api/documents/${documentId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(fields)
  });
  const payload = await readJsonResponse<{ document: ArchiveDocument }>(response);
  return payload.document;
}

export async function deleteArchiveDocument(documentId: number): Promise<void> {
  const response = await fetch(`/apps/excel-material-search/api/documents/${documentId}`, {
    method: "DELETE"
  });
  await readJsonResponse<{ document: { id: number } }>(response);
}

export async function deleteArchiveDocuments(documentIds: number[]): Promise<void> {
  const response = await fetch("/apps/excel-material-search/api/documents", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ document_ids: documentIds })
  });
  await readJsonResponse<{ documents: Array<{ id: number }> }>(response);
}

export async function reindexArchiveDocuments(): Promise<number> {
  const response = await fetch("/apps/excel-material-search/api/documents/reindex", {
    method: "POST"
  });
  const payload = await readJsonResponse<{ indexed: number }>(response);
  return payload.indexed;
}

export async function queryArchiveDocuments(
  query: string,
  kind: ArchiveDocumentKind
): Promise<ArchiveQueryResponse> {
  const response = await fetch("/apps/excel-material-search/api/query", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, kind })
  });
  return readJsonResponse<ArchiveQueryResponse>(response);
}

export async function fetchArchiveWorkbookPreview(
  documentId: number
): Promise<ArchiveWorkbookPreviewResponse> {
  const response = await fetch(
    `/apps/excel-material-search/api/documents/${documentId}/workbook-preview`,
    { method: "GET" }
  );
  return readJsonResponse<ArchiveWorkbookPreviewResponse>(response);
}

export function archiveDocumentDownloadUrl(documentId: number): string {
  return `/apps/excel-material-search/api/documents/${documentId}/download`;
}

export function archiveDocumentPreviewUrl(documentId: number): string {
  return `/apps/excel-material-search/api/documents/${documentId}/preview`;
}

