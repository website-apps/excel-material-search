// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
const html = readFileSync('index.html', 'utf8');
const script = readFileSync('src/archive.js', 'utf8');
const sample = { id: 1, title: 'ABC123', category: 'DC-DC', vendor: 'TI', package: 'QFN', kind: 'manual', ext: 'pdf', note: '3 A' };
let requests;
let documents;
let analyze;
let mainChipNames;
const response = (body, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }));
const win = window;
beforeEach(async () => {
    requests = [];
    documents = [sample];
    mainChipNames = [];
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
        if (url.includes('/v03/main-chips')) {
            const counts = new Map();
            documents.filter(file => file.kind === 'bom' && file.main_chip).forEach(file => counts.set(file.main_chip, (counts.get(file.main_chip) || 0) + 1));
            const chips = [...new Set([...mainChipNames, ...counts.keys()])].sort().map(name => ({ name, bom_count: counts.get(name) || 0 }));
            if (init?.method === 'POST') {
                const { name } = JSON.parse(init.body);
                if (chips.some(chip => chip.name === name)) return response({ error: '该型号已存在，无需重复添加' }, 409);
                mainChipNames.push(name);
                return response({ chip: { name, bom_count: 0 } }, 201);
            }
            if (init?.method === 'DELETE') {
                const name = decodeURIComponent(url.split('/main-chips/')[1]);
                if (counts.get(name)) return response({ error: '该型号已被 BOM 使用' }, 422);
                mainChipNames = mainChipNames.filter(value => value !== name);
                return response({ ok: true });
            }
            return response({ chips });
        }
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
        await win.setLibraryKind('bom');
        await vi.waitFor(() => expect(document.getElementById('filterCategory').textContent).toContain('所有板型'));
        expect(document.getElementById('filterVendor').textContent).toContain('X2000');
        const category = document.getElementById('filterCategory');
        category.value = '__other__';
        category.dispatchEvent(new Event('change'));
        await vi.waitFor(() => expect(requests[requests.length - 1].url).toContain('board_code=__other__'));
        await win.previewFile(1);
        expect(document.querySelector('.bom-preview').textContent).toContain('ABC123');
    });
    it('shows DB validation boards in filters and retains the type when editing', async () => {
        documents = [{ ...sample, kind: 'bom', category: 'BOM', board_code: 'DB', board_type: '验证板', main_chip: 'X2600' }];
        await win.setLibraryKind('bom');
        await vi.waitFor(() => expect(document.querySelector('.file-meta').textContent).toContain('板型：DB · 验证板'));
        const category = document.getElementById('filterCategory');
        expect(category.querySelector('option[value="DB"]').textContent).toBe('DB · 验证板');
        category.value = 'DB';
        category.dispatchEvent(new Event('change'));
        await vi.waitFor(() => expect(requests.at(-1).url).toContain('board_code=DB'));
        await login();
        win.editFile(1);
        expect(document.getElementById('editBoardType').value).toBe('验证板');
        await win.saveEditFile();
        const call = requests.find(call => call.init?.method === 'PUT');
        expect(JSON.parse(call.init.body)).toMatchObject({ board_type: '验证板', main_chip: 'X2600' });
    });
    it('only exposes chip management to administrators in the BOM library', async () => {
        expect(document.getElementById('manageChipsButton').hidden).toBe(true);
        await win.openChipManager();
        expect(document.getElementById('adminModal').classList.contains('show')).toBe(true);
        expect(document.getElementById('chipManagerModal').classList.contains('show')).toBe(false);
        await login();
        expect(document.getElementById('manageChipsButton').hidden).toBe(true);
        await win.setLibraryKind('bom');
        expect(document.getElementById('manageChipsButton').hidden).toBe(false);
    });
    it('adds a model before uploading any BOM and shares it with filters and editing', async () => {
        await login();
        await win.setLibraryKind('bom');
        await win.openChipManager();
        expect(document.getElementById('chipCatalogList').textContent).toContain('暂无型号');
        document.getElementById('newMainChip').value = ' x4000 ';
        await win.addMainChip();
        expect(document.getElementById('newMainChip').value).toBe('');
        expect(document.getElementById('chipCatalogList').textContent).toContain('X4000');
        expect(document.getElementById('chipCatalogList').textContent).toContain('尚未关联 BOM');
        expect(document.querySelector('#filterVendor option[value="X4000"]')).not.toBeNull();
        expect(document.querySelector('#mainChipOptions option[value="X4000"]')).not.toBeNull();
        const call = requests.find(call => call.url.endsWith('/main-chips') && call.init?.method === 'POST');
        expect(JSON.parse(call.init.body)).toEqual({ name: 'X4000' });
        document.getElementById('newMainChip').value = 'x4000';
        await win.addMainChip();
        expect(document.getElementById('chipManagerError').textContent).toContain('已存在');
        expect(document.getElementById('chipManagerError').hidden).toBe(false);
        expect(mainChipNames).toEqual(['X4000']);
        document.getElementById('chipManagerModal').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        expect(document.getElementById('chipManagerModal').classList.contains('show')).toBe(false);
        expect(document.activeElement).toBe(document.getElementById('manageChipsButton'));
    });
    it('shows usage counts and only removes unused catalog models', async () => {
        mainChipNames = ['X4000'];
        documents = [{ ...sample, kind: 'bom', main_chip: 'X2600' }];
        await login();
        await win.setLibraryKind('bom');
        await win.openChipManager();
        expect(document.getElementById('chipCatalogList').textContent).toContain('1 份 BOM');
        expect(document.querySelector('button[data-chip="X2600"]')).toBeNull();
        document.querySelector('button[data-chip="X4000"]').click();
        await vi.waitFor(() => expect(document.getElementById('toast').textContent).toBe('已移除型号 X4000'));
        await vi.waitFor(() => expect(document.querySelector('#filterVendor option[value="X4000"]')).toBeNull());
        expect(document.querySelector('#mainChipOptions option[value="X4000"]')).toBeNull();
        expect(document.querySelector('#filterVendor option[value="X2600"]')).not.toBeNull();
        expect(mainChipNames).toEqual([]);
    });
    it('retains the model input and permits retry after a failed add', async () => {
        await login();
        await win.setLibraryKind('bom');
        await win.openChipManager();
        const original = fetch;
        vi.stubGlobal('fetch', vi.fn((url, init) => url.endsWith('/main-chips') && init?.method === 'POST'
            ? Promise.resolve(new Response('<h1>Bad gateway</h1>', { status: 502 })) : original(url, init)));
        document.getElementById('newMainChip').value = 'X5000';
        await win.addMainChip();
        expect(document.getElementById('newMainChip').value).toBe('X5000');
        expect(document.getElementById('chipManagerError').textContent).toContain('502');
        expect(document.getElementById('addMainChipButton').disabled).toBe(false);
        expect(mainChipNames).toEqual([]);
    });
    it('defaults to newest and keeps chronological order across categories', async () => {
        expect(document.getElementById('sortOrder').value).toBe('newest');
        expect(requests.at(-1).url).toContain('sort=newest');
        documents = [
            { ...sample, id: 2, title: 'New manual', category: 'LDO', created_at: '2026-10-08T00:00:00Z' },
            { ...sample, title: 'Old manual', category: 'DC-DC', created_at: '2026-10-07T00:00:00Z' }
        ];
        await win.setLibraryKind('manual');
        const titles = () => [...document.querySelectorAll('.file-title')].map(node => node.textContent);
        await vi.waitFor(() => expect(titles()).toEqual(['New manual', 'Old manual']));
        expect(document.querySelector('time').textContent).toContain('上传于');
        expect(document.querySelector('time').dateTime).toBe('2026-10-08T00:00:00Z');
        expect(document.querySelector('.file-category').textContent).toBe('LDO');
        documents.reverse();
        const sort = document.getElementById('sortOrder');
        sort.value = 'oldest';
        sort.dispatchEvent(new Event('change'));
        await vi.waitFor(() => expect(titles()).toEqual(['Old manual', 'New manual']));
        expect(requests.at(-1).url).toContain('sort=oldest');
        document.getElementById('filterCategory').value = 'LDO';
        document.getElementById('filterCategory').dispatchEvent(new Event('change'));
        await vi.waitFor(() => expect(requests.at(-1).url).toContain('category=LDO'));
        expect(requests.at(-1).url).toContain('sort=oldest');
        await win.setLibraryKind('bom');
        await vi.waitFor(() => expect(requests.at(-1).url).toContain('kind=bom&sort=oldest'));
    });
    it('displays BOM modification time with upload time as fallback', async () => {
        documents = [
            { ...sample, kind: 'bom', file_modified_at: '2026-10-06T12:00:00Z', created_at: '2026-10-08T00:00:00Z' },
            { ...sample, id: 2, kind: 'bom', created_at: '2026-10-07T00:00:00Z' }
        ];
        await win.setLibraryKind('bom');
        await vi.waitFor(() => expect(document.querySelectorAll('time')).toHaveLength(2));
        const times = document.querySelectorAll('time');
        expect(times[0].textContent).toContain('修改于');
        expect(times[0].dateTime).toBe('2026-10-06T12:00:00Z');
        expect(times[1].textContent).toContain('上传于');
        expect(times[1].dateTime).toBe('2026-10-07T00:00:00Z');
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
    it('identifies vendor, package and summary instead of showing unlabeled badges', () => {
        const metadata = document.querySelector('.file-meta');
        expect(metadata.textContent).toContain('厂商：TI');
        expect(metadata.textContent).toContain('封装：QFN');
        expect(metadata.textContent).toContain('简介：3 A');
        expect(metadata.querySelectorAll('.badge').length).toBe(0);
    });
    it('hides empty metadata placeholders and keeps a clear empty state', async () => {
        documents = [{ ...sample, category: '未分类', vendor: '—', package: '', note: '—' }];
        await win.setLibraryKind('manual');
        await vi.waitFor(() => expect(document.querySelector('.file-meta').textContent).toBe('资料信息待补充'));
        expect(document.querySelector('.file-meta').textContent).not.toContain('—');
        expect(document.querySelector('.file-meta').textContent).not.toContain('|');
    });
    it('shows board labels and one clear message for missing BOM metadata', async () => {
        documents = [{ ...sample, kind: 'bom', category: 'BOM', board_code: 'PD', board_type: '产品板', main_chip: 'X2000' }];
        await win.setLibraryKind('bom');
        await vi.waitFor(() => expect(document.querySelector('.file-meta').textContent).toContain('主芯片：X2000'));
        expect(document.querySelector('.file-meta').textContent).toContain('板型：PD · 产品板');
        documents = [{ ...sample, kind: 'bom', category: 'BOM', board_code: '', main_chip: '' }];
        await win.setLibraryKind('bom');
        await vi.waitFor(() => expect(document.querySelector('.file-meta').textContent).toBe('板型与主芯片未填写'));
    });

    it('does not call filename fallback a successful content extraction', async () => {
        await login();
        analyze = () => response({ metadata: { title: 'Filename fallback' }, warning: '未能提取正文' });
        await chooseFile();
        await vi.waitFor(() => expect(document.getElementById('progressLabel').textContent).toContain('1 个文件需补充信息'));
        expect(document.getElementById('toast').textContent).toContain('1 个未提取成功');
    });

});
