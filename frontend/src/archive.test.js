// @vitest-environment jsdom
// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
const html = readFileSync('index.html', 'utf8');
const script = readFileSync('src/archive.js', 'utf8');
const sample = { id: 1, title: 'ABC123', category: 'DC-DC', vendor: 'TI', package: 'QFN', kind: 'manual', ext: 'pdf', note: '3 A' };
let requests;
let documents;
let analyze;
const response = (body) => Promise.resolve(new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } }));
const win = window;
beforeEach(async () => {
    requests = [];
    documents = [sample];
    analyze = () => response({ metadata: { title: 'Parsed123', category: 'LDO', intro: 'Output 3 A' } });
    document.documentElement.innerHTML = html.replace(/<script[\s\S]*?<\/script>/g, '');
    vi.stubGlobal('fetch', vi.fn(async (url, init) => {
        requests.push({ url, init });
        if (url.includes('/admin/'))
            return response({ authenticated: url.endsWith('/login') });
        if (url.endsWith('/analyze'))
            return analyze();
        if (url.endsWith('/ask'))
            return response({ answer: '3 A', sources: [{ title: 'ABC123' }], model: 'test-model' });
        if (url.endsWith('/bom-preview'))
            return response({ sheets: [{ name: 'Parts', rows: [['Part'], ['ABC123']] }] });
        if (init?.method === 'POST' || init?.method === 'PUT')
            return response({ file: sample, indexed: 1 });
        const kind = new URL(url).searchParams.get('kind');
        return response({ files: documents.filter(file => !kind || file.kind === kind) });
    }));
    window.eval(script);
    await vi.waitFor(() => expect(document.querySelector('.file-title')?.textContent).toBe('ABC123'));
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
async function login() {
    document.getElementById('adminUsername').value = 'existing-admin';
    document.getElementById('adminPassword').value = 'test-password';
    await win.loginAdmin();
}
async function chooseFile() {
    const file = new File(['ABC123 output current 3A'], 'TI-buck.txt', { type: 'text/plain' });
    Object.defineProperty(document.getElementById('fileInput'), 'files', { configurable: true, value: [file] });
    document.getElementById('fileInput').dispatchEvent(new Event('change'));
}
describe('V0.3 document library', () => {
    it('allows public preview and requires the existing account for management', async () => {
        expect(document.getElementById('manualUploadButton').hidden).toBe(true);
        win.openUploadModal();
        expect(document.getElementById('adminModal').classList.contains('show')).toBe(true);
        win.previewFile(1);
        expect(document.querySelector('iframe')?.src).toContain('/api/v03/files/1/preview');
        await login();
        expect(document.getElementById('manualUploadButton').hidden).toBe(false);
        const call = requests.find(call => call.url.endsWith('/admin/login'));
        expect(JSON.parse(call.init.body)).toEqual({ username: 'existing-admin', password: 'test-password' });
    });
    it('switches BOM filters and sends the other-board selection', async () => {
        documents = [{ ...sample, kind: 'bom', category: 'BOM', board_code: 'RD', main_chip: 'X2000' }];
        win.setLibraryKind('bom');
        await vi.waitFor(() => expect(document.getElementById('filterCategory').textContent).toContain('所有板型'));
        expect(document.getElementById('filterVendor').textContent).toContain('X2000');
        const category = document.getElementById('filterCategory');
        category.value = '__other__';
        category.dispatchEvent(new Event('change'));
        await vi.waitFor(() => expect(requests[requests.length - 1].url).toContain('board_code=__other__'));
        await win.previewFile(1);
        expect(document.querySelector('.bom-preview').textContent).toContain('ABC123');
    });
    it('extracts metadata before upload and submits confirmed fields', async () => {
        await login();
        await chooseFile();
        await vi.waitFor(() => expect(document.getElementById('metaName').value).toBe('Parsed123'));
        expect(document.getElementById('metaCategory').value).toBe('LDO');
        document.getElementById('metaVendor').value = 'Confirmed vendor';
        await win.simulateUpload();
        const call = requests.find(call => call.url.endsWith('/v03/files') && call.init?.method === 'POST');
        expect(call.init.body.get('vendor')).toBe('Confirmed vendor');
        expect(call.init.body.get('note')).toBe('Output 3 A');
    });
    it('preserves user edits made during metadata extraction', async () => {
        await login();
        let resolve;
        analyze = () => new Promise(done => { resolve = done; });
        await chooseFile();
        document.getElementById('metaName').value = 'User title';
        resolve(new Response(JSON.stringify({ metadata: { title: 'AI title', category: 'LDO' } })));
        await vi.waitFor(() => expect(document.getElementById('progressLabel').textContent).toContain('解析完成'));
        expect(document.getElementById('metaName').value).toBe('User title');
    });
    it('shows AI answers with model and document references', async () => {
        document.getElementById('chatInput').value = 'ABC123 输出电流';
        await win.askAI();
        expect(document.getElementById('messages').textContent).toContain('3 A');
        expect(document.getElementById('messages').textContent).toContain('test-model');
        expect(document.getElementById('messages').textContent).toContain('检索资料：ABC123');
    });
    it('retains failed uploads for retry when the service returns HTML', async () => {
        await login();
        await chooseFile();
        await vi.waitFor(() => expect(document.getElementById('progressLabel').textContent).toContain('解析完成'));
        const original = fetch;
        vi.stubGlobal('fetch', vi.fn((url, init) => url.endsWith('/v03/files') && init?.method === 'POST'
            ? Promise.resolve(new Response('<h1>Bad gateway</h1>', { status: 502 })) : original(url, init)));
        await win.simulateUpload();
        expect(document.getElementById('selectedFiles').textContent).toContain('1 个文件上传失败');
    });
});
