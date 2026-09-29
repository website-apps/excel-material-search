export interface ErrorResponse {
  error: string;
}

export interface ExcelIndexedFile {
  id?: number;
  file_name: string;
  status: "ready" | "indexing" | "failed";
  sheet_count?: number;
  indexed_cell_count?: number;
  error?: string | null;
  created_at?: string;
}

export interface ExcelIndexMatch {
  file_id: number;
  file_name: string;
  created_at: string;
  sheet_name: string;
  row_number: number;
  cell_address: string;
  field_name: string | null;
  raw_value: string;
  row_context: Record<string, string>;
}

export interface ExcelFilesResponse {
  files: ExcelIndexedFile[];
}

export interface ExcelQueryResponse {
  query: string;
  matches: ExcelIndexMatch[];
}

export type ArchiveDocumentKind = "manual" | "bom";

export interface ArchiveDocument {
  id: number;
  title: string;
  kind: ArchiveDocumentKind;
  category: string;
  package: string;
  vendor: string;
  remark: string;
  note: string;
  board_code: string;
  board_type: string;
  main_chip: string;
  board_name: string;
  original_name: string;
  extension: string;
  mime_type: string;
  size_bytes: number;
  size: string;
  status: "ready" | "empty" | "failed" | "indexing";
  error: string | null;
  created_at: string;
  file_modified_at: string;
}

export interface ArchiveDocumentsResponse {
  documents: ArchiveDocument[];
}

export interface ArchiveUploadFailure {
  original_name: string;
  status: "failed";
  error: string;
}

export type ArchiveUploadResult = ArchiveDocument | ArchiveUploadFailure;

export interface ArchiveUploadResponse {
  documents: ArchiveUploadResult[];
}

export interface ArchiveManualMatch {
  document_id: number;
  title: string;
  file_name: string;
  category: string;
  vendor: string;
  excerpt: string;
  created_at: string;
}

export interface ArchiveQueryResponse {
  query: string;
  matches: ExcelIndexMatch[] | ArchiveManualMatch[];
}

export interface ArchiveWorkbookSheet {
  name: string;
  rows: string[][];
}

export interface ArchiveWorkbookPreviewResponse {
  title: string;
  sheets: ArchiveWorkbookSheet[];
}

export interface ExcelAccessSessionResponse {
  authenticated: boolean;
  role: "user" | "admin";
  username: string | null;
}

