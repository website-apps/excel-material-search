(function(){
  const API_BASE = `${window.location.origin}/apps/excel-material-search/api/v03`;
  const vendors = [
    'Rockchip','Sony','TI','NXP','ST','ON','Vishay','Murata','TDK','Samsung',
    'Micron','Realtek','Intel','Microchip','Infineon','Maxim','ADI','Renesas',
    'ON Semiconductor','Nexperia','Diodes Inc','Lattice','Xilinx','Altera',
    'Cypress','Broadcom','Qualcomm','MediaTek','Allwinner','Amlogic','ESP',
    'HiSilicon','Hisilicon','Hynix','Winbond','Macronix','GigaDevice'
  ];
  const categories = [
    '阻容','电感','晶体','线圈','变压器','单片机/微控制器','逻辑器件','二极管',
    '三极管/MOS管','TVS/保险丝','DC-DC','LDO','电源管理','通信接口芯片','时钟和定时',
    '存储器','传感器','继电器','蜂鸣器','电机驱动','运算放大器','比较器',
    'WIFI芯片/模组','以太网PHY芯片','马达','连接器','端子','按键/开关','ADC/DAC',
    'LED驱动','光耦','显示屏','显示屏驱动芯片','摄像头','摄像头驱动芯片'
  ];
  let files = [];
  let pendingFiles = [];
  let currentPendingIndex = 0;
  let searchTerm = '';
  let uploadInProgress = false;
  let analysisInProgress = false;
  let activeKind = 'manual';
  let previewBomSheets = [];
  let isAdmin = false;
  let editingFileId = null;
  let listRequest = 0;
  let analysisGeneration = 0;

  function escapeHtml(str) {
    return String(str).replace(/[\u0026\u003c\u003e"']/g, m => ({'\u0026':'\u0026amp;','\u003c':'\u0026lt;','\u003e':'\u0026gt;','"':'\u0026quot;',"'":'\u0026#39;'}[m]));
  }
  function highlight(text, term) {
    if (!term) return escapeHtml(text);
    const re = new RegExp('(' + escapeRegExp(term) + ')', 'ig');
    return escapeHtml(text).replace(re, '\u003cspan class="highlight"\u003e$1\u003c/span\u003e');
  }
  function escapeRegExp(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$\u0026'); }
  function highlightTerms(text) {
    const terms = [...new Set(searchTerm.trim().split(/[\s,，;；/]+/).filter(value => value.length > 0))]
      .sort((a, b) => b.length - a.length);
    if (!terms.length) return escapeHtml(text);
    const re = new RegExp('(' + terms.map(escapeRegExp).join('|') + ')', 'ig');
    return String(text).split(re).map((part, index) => index % 2 ? `<span class="highlight">${escapeHtml(part)}</span>` : escapeHtml(part)).join('');
  }
  function toast(msg) {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.classList.add('show');
    setTimeout(() => t.classList.remove('show'), 2800);
  }
  function apiUrl(path) {
    const auth = { '/auth/status': 'session', '/auth/login': 'login', '/auth/logout': 'logout' };
    return auth[path] ? `${window.location.origin}/apps/excel-material-search/api/admin/${auth[path]}` : API_BASE + path;
  }
  async function responseData(res) {
    const data = await res.json().catch(() => ({ error: `服务暂时不可用（HTTP ${res.status}），请稍后重试` }));
    if (!res.ok || data.error) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
  }
  async function reindexFiles() {
    if (!requireAdminUI()) return;
    try {
      toast('正在重建索引…');
      const data = await responseData(await fetch(apiUrl('/files/reindex'), { method: 'POST' }));
      await loadFiles(); toast(`已重建 ${data.indexed} 个文件的索引`);
    } catch (error) { toast(error.message); }
  }
  window.reindexFiles = reindexFiles;

  function updateAdminUI() {
    document.body.classList.toggle('is-admin', isAdmin);
    document.getElementById('manualUploadButton').hidden = !isAdmin;
    document.getElementById('bomUploadButton').hidden = !isAdmin;
    const button = document.getElementById('adminButton');
    button.textContent = isAdmin ? '退出管理员' : '管理员登录';
    button.className = isAdmin ? 'btn btn-primary' : 'btn btn-ghost';
  }

  async function loadAuthStatus() {
    try {
      const res = await fetch(apiUrl('/auth/status'));
      const data = await responseData(res);
      isAdmin = Boolean(data.authenticated);
      updateAdminUI();
    } catch (error) { console.warn('Unable to load admin status', error); }
  }

  function requireAdminUI() {
    if (isAdmin) return true;
    toast('此操作需要管理员登录');
    openAdminModal();
    return false;
  }

  function setFilterOptions(selectId, allLabel, values) {
    const select = document.getElementById(selectId);
    const selected = select.value;
    select.replaceChildren();
    const allOption = document.createElement('option');
    allOption.value = '';
    allOption.textContent = allLabel;
    select.appendChild(allOption);
    values.forEach(value => {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = value;
      select.appendChild(option);
    });
    select.value = values.includes(selected) ? selected : '';
  }

  function addOtherFilterOption(selectId) {
    const select = document.getElementById(selectId);
    const option = document.createElement('option');
    option.value = '__other__';
    option.textContent = '其他';
    select.appendChild(option);
  }

  async function refreshFilterOptions() {
    try {
      const kind = activeKind;
      const selectedCategory = document.getElementById('filterCategory').value;
      const selectedVendor = document.getElementById('filterVendor').value;
      const res = await fetch(apiUrl('/files?kind=' + kind));
      if (!res.ok) await responseData(res);
      const data = await responseData(res);
      if (kind !== activeKind) return;
      const allFiles = data.files || [];
      const unique = values => [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b, 'zh-CN'));
      if (activeKind === 'bom') {
        setFilterOptions('filterCategory', '所有板型', unique(allFiles.map(file => file.board_code)));
        setFilterOptions('filterVendor', '所有主芯片', unique(allFiles.map(file => file.main_chip)));
        addOtherFilterOption('filterCategory');
        addOtherFilterOption('filterVendor');
        if (selectedCategory === '__other__') document.getElementById('filterCategory').value = '__other__';
        if (selectedVendor === '__other__') document.getElementById('filterVendor').value = '__other__';
      } else {
        setFilterOptions('filterCategory', '所有分类', unique(allFiles.map(file => file.category)));
        setFilterOptions('filterVendor', '所有厂商', unique(allFiles.map(file => file.vendor).filter(vendor => vendor !== '—')));
      }
    } catch (error) {
      console.warn('Unable to refresh filter options', error);
    }
  }

  async function loadFiles() {
    const requestId = ++listRequest;
    const q = document.getElementById('searchInput').value.trim();
    const cat = document.getElementById('filterCategory').value;
    const ven = document.getElementById('filterVendor').value;
    const params = new URLSearchParams();
    if (q) params.append('q', q);
    if (activeKind === 'bom') {
      if (cat) params.append('board_code', cat);
      if (ven) params.append('main_chip', ven);
    } else {
      if (cat) params.append('category', cat);
      if (ven) params.append('vendor', ven);
    }
    params.append('kind', activeKind);
    try {
      const res = await fetch(apiUrl('/files?' + params.toString()));
      if (!res.ok) await responseData(res);
      const data = await responseData(res);
      if (requestId !== listRequest) return;
      files = data.files || [];
      searchTerm = q;
      renderFiles();
    } catch (err) {
      console.error(err);
      toast('加载文档库失败：' + err.message);
    }
  }

  function setLibraryKind(kind) {
    activeKind = kind;
    listRequest++;
    document.querySelectorAll('.library-tab').forEach(button => button.classList.toggle('active', button.dataset.kind === kind));
    document.getElementById('searchInput').value = '';
    document.getElementById('filterCategory').value = '';
    document.getElementById('filterVendor').value = '';
    refreshFilterOptions().then(loadFiles);
  }

  function metadataValue(value) {
    const text = String(value ?? '').trim();
    return /^[-—–]+$/.test(text) ? '' : text;
  }

  function renderMetadata(file) {
    const fields = file.kind === 'bom'
      ? [['板型', file.board_type ? `${file.board_code ? file.board_code + ' · ' : ''}${file.board_type}` : file.board_code],
         ['主芯片', file.main_chip], ['板卡', file.board_name]]
      : [['厂商', file.vendor], ['封装', file.package]];
    const attributes = fields.filter(([, value]) => metadataValue(value)).map(([label, value]) =>
      `<span class="meta-field"><span class="meta-label">${label}：</span>${highlightTerms(metadataValue(value))}</span>`).join('');
    const note = file.kind === 'bom' ? '' : metadataValue(file.note) || metadataValue(file.keywords);
    const summary = note ? `<div class="file-summary" title="${escapeHtml(note)}"><span class="meta-label">简介：</span>${highlightTerms(note)}</div>` : '';
    if (!attributes && !summary) return `<span class="metadata-empty">${file.kind === 'bom' ? '板型与主芯片未填写' : '资料信息待补充'}</span>`;
    return `${attributes ? `<div class="file-attributes">${attributes}</div>` : ''}${summary}`;
  }

  function renderFiles() {
    const container = document.getElementById('fileList');
    document.getElementById('resultCount').textContent = '共 ' + files.length + ' 个文件';
    if (!files.length) {
      container.innerHTML = '\u003cdiv class="no-match"\u003e没有匹配的文件，请上传新文档或调整搜索条件。\u003c/div\u003e';
      return;
    }
    const grouped = {};
    files.forEach(f => { const g = f.category || '未分类'; (grouped[g] = grouped[g] || []).push(f); });
    const order = categories.filter(c => grouped[c]).concat(Object.keys(grouped).filter(c => !categories.includes(c)));
    container.innerHTML = order.map(c => {
      const items = grouped[c].map(f => {
        const details = renderMetadata(f);
        return `
        \u003cdiv class="file-item"\u003e
          \u003cdiv class="file-info"\u003e
            \u003cdiv class="file-title"\u003e${highlightTerms(f.title)}\u003c/div\u003e
            \u003cdiv class="file-meta"\u003e${details}\u003c/div\u003e
          \u003c/div\u003e
          \u003cdiv class="file-actions"\u003e
            \u003cbutton class="icon-btn" onclick="previewFile(${f.id})" title="预览"\u003e
              \u003csvg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"\u003e\u003cpath d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/\u003e\u003ccircle cx="12" cy="12" r="3"/\u003e\u003c/svg\u003e
            \u003c/button\u003e
            \u003cbutton class="icon-btn" onclick="downloadFile(${f.id})" title="下载"\u003e
              \u003csvg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"\u003e\u003cpath d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/\u003e\u003cpolyline points="7 10 12 15 17 10"/\u003e\u003cline x1="12" y1="15" x2="12" y2="3"/\u003e\u003c/svg\u003e
            \u003c/button\u003e
            \u003cbutton class="icon-btn admin-only" onclick="editFile(${f.id})" title="编辑标签"\u003e✎\u003c/button\u003e
            \u003cbutton class="icon-btn danger admin-only" onclick="deleteFile(${f.id})" title="删除"\u003e
              \u003csvg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"\u003e\u003cpolyline points="3 6 5 6 21 6"/\u003e\u003cpath d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/\u003e\u003c/svg\u003e
            \u003c/button\u003e
          \u003c/div\u003e
        \u003c/div\u003e
      `;
      }).join('');
      return `
        \u003cdiv class="file-group"\u003e
          \u003cdiv class="file-group-title"\u003e${escapeHtml(c)}\u003c/div\u003e
          \u003cdiv class="file-group-items"\u003e${items}\u003c/div\u003e
        \u003c/div\u003e
      `;
    }).join('');
  }

  function inferCategory(name) {
    const n = name.toLowerCase();
    const map = [
      [/imx|ov\d|sensor|camera/, '摄像头'], [/rk\d+|allwinner|amlogic|esp32|stm32|mcu|microcontroller/, '单片机/微控制器'],
      [/tps|pmic|buck|boost|ldo|power|regulator/, '电源管理'], [/usb|can|rs485|rs232|eth|ethernet|phy|wifi|bluetooth|lte|nb-iot/, '通信接口芯片'],
      [/sdram|ddr|emmc|nor flash|nand|memory/, '存储器'], [/opamp|operational|放大器/, '运算放大器'],
      [/mosfet|igbt|bipolar|transistor/, '三极管/MOS管'], [/diode|rectifier|schottky/, '二极管'],
      [/tvs|fuse|protection/, 'TVS/保险丝'], [/crystal|oscillator|时钟|timer/, '时钟和定时'],
      [/led driver|led驱动/, 'LED驱动'], [/motor|马达|步进|drv/, '马达'], [/relay/, '继电器'],
      [/connector|端子|接头/, '连接器'], [/switch|按键|button/, '按键/开关'], [/adc|dac|a\/d|d\/a/, 'ADC/DAC'],
      [/optocoupler|光耦|optical/, '光耦'], [/display|lcd|oled|screen|屏/, '显示屏'], [/driver|驱动芯片/, '显示屏驱动芯片'],
      [/buzzer|蜂鸣器/, '蜂鸣器'], [/resistor|capacitor|rc|电容|电阻/, '阻容'], [/inductor|电感/, '电感'],
      [/transformer|变压器/, '变压器'], [/coil|线圈/, '线圈']
    ];
    for (const [re, cat] of map) if (re.test(n)) return cat;
    return '';
  }
  function inferVendor(name) { const n = name.toLowerCase(); for (const v of vendors) if (n.includes(v.toLowerCase())) return v; return ''; }
  const packagePatterns = [
    [/\bsop8?\b/, 'SOP8'], [/\bsop16?\b/, 'SOP16'], [/\bqfn\b/, 'QFN'], [/\bbga\b/, 'BGA'],
    [/\blqfp\b/, 'LQFP'], [/\bto-220\b/, 'TO-220'], [/\bto-92\b/, 'TO-92'], [/\b0805\b/, '0805'],
    [/\b0603\b/, '0603'], [/\b0402\b/, '0402'], [/\b1206\b/, '1206'], [/\bsot-23\b/, 'SOT-23'],
    [/\bsot-89\b/, 'SOT-89'], [/\bdfn\b/, 'DFN'], [/\blga\b/, 'LGA']
  ];
  function inferPackage(name) { const n = name.toLowerCase(); for (const [re, pkg] of packagePatterns) if (re.test(n)) return pkg; return ''; }
  function normalizePackageInput(input) { return String(input || '').split(/[,，;；/]+/).map(part => part.trim().toUpperCase().replace(/\s+/g, '-')).filter(Boolean).join(' / '); }

  function buildPendingFile(file) {
    const name = file.name;
    const title = name.replace(/\.[^.]+$/, '').replace(/[_-]/g, ' ').trim();
    return {
      file, title,
      category: inferCategory(name),
      package: normalizePackageInput(inferPackage(name)),
      vendor: inferVendor(name),
      remark: '',
      note: ''
    };
  }

  function setProgress(label, completed, total) {
    const progress = document.getElementById('analysisProgress');
    const percent = total ? Math.round((completed / total) * 100) : 0;
    document.getElementById('progressLabel').textContent = `${label} ${completed} / ${total}`;
    document.getElementById('progressPercent').textContent = `${percent}%`;
    document.getElementById('progressFill').style.width = `${percent}%`;
    progress.classList.add('show');
  }

  function hideProgress() {
    document.getElementById('analysisProgress').classList.remove('show');
  }

  function updateSelectedFiles() {
    const input = document.getElementById('fileInput');
    const sel = document.getElementById('selectedFiles');
    const dz = document.getElementById('dropzone');
    const nav = document.getElementById('pendingNav');
    if (input.files && input.files.length > 0) {
      const names = Array.from(input.files).map(f => f.name);
      sel.innerHTML = `\u003cstrong\u003e已选择 ${names.length} 个文件：\u003c/strong\u003e\u003cbr\u003e${names.map(n => '· ' + escapeHtml(n)).join('\u003cbr\u003e')}`;
      dz.classList.add('has-files');
      pendingFiles = Array.from(input.files).map(f => buildPendingFile(f));
      currentPendingIndex = 0;
      nav.style.display = 'flex';
      renderPendingEditor();
      toast('正在提取文件正文并自动填写元数据…');
      analyzePendingFiles();
    } else {
      sel.innerHTML = ''; dz.classList.remove('has-files'); pendingFiles = []; currentPendingIndex = 0; nav.style.display = 'none'; clearMetaForm(); hideProgress();
    }
  }

  function applyExtractedMetadata(pf, metadata) {
    if (metadata.title) pf.title = metadata.title;
    if (metadata.category && categories.includes(metadata.category)) pf.category = metadata.category;
    if (metadata.package) pf.package = normalizePackageInput(metadata.package);
    if (metadata.vendor) pf.vendor = metadata.vendor;
    if (metadata.intro) pf.note = metadata.intro;
  }

  async function analyzePendingFiles() {
    if (!pendingFiles.length) return;
    const generation = ++analysisGeneration;
    const batch = pendingFiles;
    analysisInProgress = true;
    const total = pendingFiles.length;
    let nextIndex = 0;
    let completed = 0;
    let analyzed = 0;
    if (generation === analysisGeneration) setProgress('正在解析文档', completed, total);

    const worker = async () => {
      while (nextIndex < total && generation === analysisGeneration) {
        const index = nextIndex++;
        const pf = batch[index];
        const initial = { ...pf };
        const formData = new FormData();
        formData.append('file', pf.file);
        try {
          const res = await fetch(apiUrl('/files/analyze'), { method: 'POST', body: formData });
          const data = await responseData(res);
          if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
          if (generation !== analysisGeneration) return;
          if (currentPendingIndex === index) saveCurrentPendingMeta();
          const extracted = data.metadata || {};
          const fields = { title: 'title', category: 'category', package: 'package', vendor: 'vendor', intro: 'note' };
          Object.entries(fields).forEach(([key, field]) => { if (pf[field] !== initial[field]) delete extracted[key]; });
          applyExtractedMetadata(pf, extracted);
          if (!data.warning && Object.keys(data.metadata || {}).length) analyzed++;
          if (currentPendingIndex === index) renderPendingEditor();
        } catch (error) {
          console.warn('Metadata analysis failed for ' + pf.file.name, error);
        } finally {
          completed++;
          if (generation === analysisGeneration) setProgress('正在解析文档', completed, total);
        }
      }
    };

    await Promise.all(Array.from({ length: Math.min(2, total) }, worker));
    if (generation !== analysisGeneration) return;
    analysisInProgress = false;
    setProgress(analyzed === total ? '解析完成' : `解析完成，${total - analyzed} 个文件需补充信息`, total, total);
    toast(analyzed === total ? `已从正文自动填写 ${analyzed} 个文件的信息，请确认后上传` : `已提取 ${analyzed} 个文件；${total - analyzed} 个未提取成功，请检查并补充信息`);
  }

  function renderPendingEditor() {
    if (!pendingFiles.length) return;
    const pf = pendingFiles[currentPendingIndex];
    document.getElementById('pendingTitle').textContent = `文件 ${currentPendingIndex + 1} / ${pendingFiles.length}`;
    document.getElementById('pendingName').textContent = pf.file.name;
    document.getElementById('metaName').value = pf.title;
    document.getElementById('metaCategory').value = pf.category;
    document.getElementById('metaPackage').value = pf.package || '';
    document.getElementById('metaVendor').value = pf.vendor || '';
    document.getElementById('metaRemark').value = pf.remark || '';
    document.getElementById('metaIntro').value = pf.note || '';
  }
  function saveCurrentPendingMeta() {
    if (!pendingFiles.length) return;
    const pf = pendingFiles[currentPendingIndex];
    pf.title = document.getElementById('metaName').value || pf.title;
    pf.category = document.getElementById('metaCategory').value;
    pf.package = normalizePackageInput(document.getElementById('metaPackage').value);
    pf.vendor = document.getElementById('metaVendor').value;
    pf.remark = document.getElementById('metaRemark').value;
    pf.note = document.getElementById('metaIntro').value;
  }
  function clearMetaForm() { ['metaName','metaCategory','metaPackage','metaVendor','metaRemark','metaIntro'].forEach(id => document.getElementById(id).value = ''); }
  function prevPending() { if (!pendingFiles.length || currentPendingIndex <= 0) return; saveCurrentPendingMeta(); currentPendingIndex--; renderPendingEditor(); }
  function nextPending() { if (!pendingFiles.length || currentPendingIndex >= pendingFiles.length - 1) return; saveCurrentPendingMeta(); currentPendingIndex++; renderPendingEditor(); }

  async function simulateUpload() {
    if (!requireAdminUI() || uploadInProgress) return;
    if (analysisInProgress) { toast('文档仍在自动解析，请等待进度完成后再上传'); return; }
    const nav = document.getElementById('pendingNav');
    saveCurrentPendingMeta();
    if (!pendingFiles.length) { toast('请先选择文件'); return; }
    uploadInProgress = true;
    const total = pendingFiles.length;
    const btn = document.querySelector('.actions .btn-primary');
    const oldText = btn.innerHTML;
    btn.innerHTML = '\u003cspan class="spinner"\u003e\u003c/span\u003e 上传中…';
    btn.disabled = true;
    const failed = [];
    let ok = 0;
    let completed = 0;
    setProgress('正在上传文档', completed, total);
    for (const pf of pendingFiles) {
      const fd = new FormData();
      fd.append('file', pf.file);
      fd.append('kind', 'manual');
      fd.append('title', pf.title || pf.file.name.replace(/\.[^.]+$/, ''));
      fd.append('category', pf.category || '未分类');
      fd.append('package', pf.package || '');
      fd.append('vendor', pf.vendor || '');
      fd.append('remark', pf.remark || '');
      fd.append('note', pf.note || '');
      try {
        const res = await fetch(apiUrl('/files'), { method: 'POST', body: fd });
        if (!res.ok) await responseData(res);
        ok++;
      } catch (err) {
        console.error('upload failed', pf.file.name, err);
        failed.push(pf);
        toast('上传失败：' + pf.file.name + '：' + err.message);
      } finally {
        completed++;
        setProgress('正在上传文档', completed, total);
      }
    }
    uploadInProgress = false;
    btn.innerHTML = oldText; btn.disabled = false;
    pendingFiles = failed; currentPendingIndex = 0;
    if (failed.length) {
      nav.style.display = 'flex'; renderPendingEditor();
      document.getElementById('selectedFiles').textContent = `剩余 ${failed.length} 个文件上传失败，可以重试`;
    } else {
      nav.style.display = 'none'; document.getElementById('selectedFiles').innerHTML = '';
      document.getElementById('dropzone').classList.remove('has-files');
      document.getElementById('fileInput').value = ''; clearMetaForm(); closeUploadModal();
      setLibraryKind('manual');
    }
    await refreshFilterOptions();
    await loadFiles();
    toast('已上传 ' + ok + ' / ' + total + ' 个文件');
  }

  function openAdminModal() {
    if (isAdmin) return logoutAdmin();
    document.getElementById('adminPassword').value = '';
    document.getElementById('adminModal').classList.add('show');
    setTimeout(() => document.getElementById('adminPassword').focus(), 0);
  }

  function closeAdminModal(e) { if (e && e.target !== document.getElementById('adminModal')) return; document.getElementById('adminModal').classList.remove('show'); }

  async function loginAdmin() {
    const password = document.getElementById('adminPassword').value;
    try {
      const res = await fetch(apiUrl('/auth/login'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: document.getElementById('adminUsername').value.trim(), password }) });
      const data = await responseData(res);
      if (!res.ok) throw new Error(data.error || '登录失败');
      isAdmin = true; updateAdminUI(); closeAdminModal(); renderFiles(); toast('管理员登录成功');
    } catch (error) { toast(error.message); }
  }

  async function logoutAdmin() {
    await fetch(apiUrl('/auth/logout'), { method: 'POST' });
    isAdmin = false; updateAdminUI(); renderFiles(); toast('已退出管理员');
  }

  function editFile(id) {
    if (!requireAdminUI()) return;
    const file = files.find(item => item.id === id);
    if (!file) return;
    editingFileId = id;

    if (file.kind === 'bom') {
      document.getElementById('editBoardType').value = file.board_type || '';
      document.getElementById('editMainChip').value = file.main_chip || '';
      document.getElementById('editBoardName').value = file.board_name || '';
      document.getElementById('bomEditModal').classList.add('show');
      return;
    }

    document.getElementById('editTitle').value = file.title || '';
    document.getElementById('editCategory').value = file.category || '';
    document.getElementById('editVendor').value = file.vendor === '—' ? '' : (file.vendor || '');
    document.getElementById('editPackage').value = file.package || '';
    document.getElementById('editRemark').value = file.remark || '';
    document.getElementById('editNote').value = file.note === '—' ? '' : (file.note || '');
    document.getElementById('editModal').classList.add('show');
  }

  function closeEditModal(e) { if (e && e.target !== document.getElementById('editModal')) return; document.getElementById('editModal').classList.remove('show'); }
  function closeBomEditModal(e) { if (e && e.target !== document.getElementById('bomEditModal')) return; document.getElementById('bomEditModal').classList.remove('show'); }

  async function saveEditFile() {
    if (!requireAdminUI() || !editingFileId) return;
    const file = files.find(item => item.id === editingFileId);
    if (!file) return;
    const body = file.kind === 'bom'
      ? {
          board_type: document.getElementById('editBoardType').value,
          main_chip: document.getElementById('editMainChip').value.trim(),
          board_name: document.getElementById('editBoardName').value.trim()
        }
      : {
          title: document.getElementById('editTitle').value.trim(),
          category: document.getElementById('editCategory').value.trim(),
          vendor: document.getElementById('editVendor').value.trim(),
          package: document.getElementById('editPackage').value.trim(),
          remark: document.getElementById('editRemark').value.trim(),
          note: document.getElementById('editNote').value.trim()
        };
    try {
      const res = await fetch(apiUrl('/files/' + editingFileId), { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const data = await responseData(res);
      if (!res.ok) throw new Error(data.error || '保存失败');
      if (file.kind === 'bom') closeBomEditModal(); else closeEditModal();
      await refreshFilterOptions(); await loadFiles(); toast(file.kind === 'bom' ? 'BOM 标签已更新' : '文档标签已更新');
    } catch (error) { toast(error.message); }
  }

  async function analyzeExistingFile() {
    if (!requireAdminUI() || !editingFileId) return;
    const id = editingFileId;
    const button = document.getElementById('analyzeExistingButton');
    button.disabled = true;
    try {
      const data = await responseData(await fetch(apiUrl('/files/' + id + '/analyze'), { method: 'POST' }));
      if (editingFileId !== id) return;
      const fields = { title: 'editTitle', category: 'editCategory', vendor: 'editVendor', package: 'editPackage', intro: 'editNote' };
      Object.entries(fields).forEach(([key, field]) => { if (data.metadata[key]) document.getElementById(field).value = data.metadata[key]; });
      toast(data.warning || '已提取，请检查信息后保存');
    } catch (error) { toast(error.message); }
    finally { button.disabled = false; }
  }
  window.analyzeExistingFile = analyzeExistingFile;

  async function deleteFile(id) {
    if (!requireAdminUI()) return;
    if (!confirm('确定要删除这个文件吗？')) return;
    try {
      const res = await fetch(apiUrl('/files/' + id), { method: 'DELETE' });
      if (!res.ok) await responseData(res);
      await refreshFilterOptions();
      await loadFiles();
      toast('已删除文件');
    } catch (err) { toast('删除失败：' + err.message); }
  }

  function downloadFile(id) {
    window.open(apiUrl('/files/' + id + '/download'), '_blank');
  }

  async function previewFile(id) {
    const f = files.find(x => x.id === id);
    if (!f) return;
    if (f.kind === 'bom') return previewBom(f);
    document.getElementById('previewTitle').textContent = f.title;
    const body = document.getElementById('previewBody');
    const ext = (f.ext || '').toLowerCase();
    if (ext === 'pdf') body.innerHTML = `\u003ciframe src="${apiUrl('/files/' + id + '/preview')}"\u003e\u003c/iframe\u003e`;
    else if (['jpg','jpeg','png','gif','webp'].includes(ext)) body.innerHTML = `\u003cimg src="${apiUrl('/files/' + id + '/preview')}" alt="${escapeHtml(f.title)}"\u003e`;
    else body.innerHTML = '\u003cdiv style="padding:40px;text-align:center;color:var(--muted)"\u003e暂不支持该格式在线预览，请下载后查看。\u003c/div\u003e';
    document.getElementById('previewModal').classList.add('show');
  }

  async function previewBom(file) {
    document.getElementById('previewTitle').textContent = `BOM 预览 · ${file.title}`;
    const body = document.getElementById('previewBody');
    body.innerHTML = '\u003cdiv style="padding:32px;text-align:center;color:var(--muted)"\u003e正在读取 BOM 表格…\u003c/div\u003e';
    document.getElementById('previewModal').classList.add('show');
    try {
      const res = await fetch(apiUrl('/files/' + file.id + '/bom-preview'));
      const data = await responseData(res);
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      previewBomSheets = data.sheets || [];
      renderBomSheet(0);
    } catch (error) { body.textContent = 'BOM 预览失败：' + error.message; }
  }

  function renderBomSheet(index) {
    const sheet = previewBomSheets[index];
    const body = document.getElementById('previewBody');
    if (!sheet) { body.textContent = 'BOM 中未找到可显示的工作表。'; return; }
    const tabs = previewBomSheets.map((item, i) => `\u003cbutton class="library-tab ${i === index ? 'active' : ''}" onclick="renderBomSheet(${i})"\u003e${escapeHtml(item.name)}\u003c/button\u003e`).join('');
    const rows = sheet.rows || [];
    const table = rows.map((row, rowIndex) => `\u003ctr\u003e${row.map(cell => rowIndex === 0 ? `\u003cth\u003e${escapeHtml(cell)}\u003c/th\u003e` : `\u003ctd\u003e${escapeHtml(cell)}\u003c/td\u003e`).join('')}\u003c/tr\u003e`).join('');
    body.innerHTML = `\u003cdiv class="library-tabs"\u003e${tabs}\u003c/div\u003e\u003cdiv class="bom-preview"\u003e\u003ctable\u003e${table}\u003c/table\u003e\u003c/div\u003e`;
  }

  function openUploadModal() { if (!requireAdminUI()) return; if (!pendingFiles.length) hideProgress(); document.getElementById('uploadModal').classList.add('show'); }
  function closeUploadModal(e) { if (e && e.target !== document.getElementById('uploadModal')) return; document.getElementById('uploadModal').classList.remove('show'); }
  function openBomUploadModal() { if (!requireAdminUI()) return; document.getElementById('bomUploadModal').classList.add('show'); }
  function closeBomUploadModal(e) { if (e && e.target !== document.getElementById('bomUploadModal')) return; document.getElementById('bomUploadModal').classList.remove('show'); }
  function closePreviewModal(e) { if (e && e.target !== document.getElementById('previewModal')) return; document.getElementById('previewModal').classList.remove('show'); }

  function updateBomSelection() {
    const selected = Array.from(document.getElementById('bomFileInput').files || []);
    const container = document.getElementById('bomSelectedFiles');
    container.innerHTML = selected.length ? `已选择 ${selected.length} 个 BOM：\u003cbr\u003e${selected.map(file => '· ' + escapeHtml(file.name)).join('\u003cbr\u003e')}` : '';
    container.style.display = selected.length ? 'block' : 'none';
  }

  async function uploadBomFiles() {
    if (!requireAdminUI() || uploadInProgress) return;
    const input = document.getElementById('bomFileInput');
    const bomFiles = Array.from(input.files || []);
    if (!bomFiles.length) { toast('请先选择 Excel BOM 文件'); return; }
    uploadInProgress = true;
    const failed = [];
    let uploaded = 0;
    for (const file of bomFiles) {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('kind', 'bom');
      formData.append('title', file.name.replace(/\.[^.]+$/, ''));
      formData.append('file_modified_at', String(file.lastModified || ''));
      try {
        const res = await fetch(apiUrl('/files'), { method: 'POST', body: formData });
        if (!res.ok) await responseData(res);
        uploaded++;
      } catch (error) { failed.push(file); toast(file.name + '：' + error.message); }
    }
    uploadInProgress = false;
    const remaining = new DataTransfer();
    failed.forEach(file => remaining.items.add(file));
    input.files = remaining.files;
    updateBomSelection();
    if (!failed.length) { closeBomUploadModal(); activeKind = 'bom'; }
    setLibraryKind(activeKind);
    await refreshFilterOptions();
    await loadFiles();
    toast(`已上传 ${uploaded} / ${bomFiles.length} 个 BOM 文件`);
  }

  function openChatPanel() { document.getElementById('chatPanel').classList.add('show'); document.getElementById('messages').scrollTop = document.getElementById('messages').scrollHeight; }
  function closeChatPanel() { document.getElementById('chatPanel').classList.remove('show'); }

  function answerHtml(answer, sources, model) {
    const body = escapeHtml(answer).replace(/\n/g, '\u003cbr\u003e');
    if (!sources.length) return `${body}\u003cdiv class="cite"\u003e模型：${escapeHtml(model)} · 未检索到直接匹配的文档\u003c/div\u003e`;
    const references = sources.map(source => escapeHtml(source.title)).join('、');
    return `${body}\u003cdiv class="cite"\u003e模型：${escapeHtml(model)}\u003cbr\u003e检索资料：${references}\u003c/div\u003e`;
  }

  async function askAI() {
    const input = document.getElementById('chatInput');
    const q = input.value.trim(); if (!q) return;
    const msgs = document.getElementById('messages');
    msgs.insertAdjacentHTML('beforeend', `\u003cdiv class="msg user"\u003e${escapeHtml(q)}\u003c/div\u003e`);
    input.value = ''; msgs.scrollTop = msgs.scrollHeight;
    const loadingId = 'loading-' + Date.now();
    msgs.insertAdjacentHTML('beforeend', `\u003cdiv class="msg ai" id="${loadingId}"\u003e\u003cspan class="spinner"\u003e\u003c/span\u003e 正在检索文档并生成答案…\u003c/div\u003e`);
    const el = document.getElementById(loadingId);
    try {
      const res = await fetch(apiUrl('/ask'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: q })
      });
      const data = await responseData(res);
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      el.innerHTML = answerHtml(data.answer, data.sources || [], data.model || '已配置模型');
    } catch (error) {
      console.error('AI question failed', error);
      el.textContent = `AI 问答暂时不可用：${error.message}`;
    }
    msgs.scrollTop = msgs.scrollHeight;
  }

  document.getElementById('fileInput').addEventListener('change', updateSelectedFiles);
  document.getElementById('bomFileInput').addEventListener('change', updateBomSelection);
  document.getElementById('searchInput').addEventListener('input', debounce(loadFiles, 250));
  ['filterCategory','filterVendor'].forEach(id => document.getElementById(id).addEventListener('change', loadFiles));
  document.getElementById('chatInput').addEventListener('keydown', e => { if (e.key === 'Enter') askAI(); });
  const dz = document.getElementById('dropzone');
  dz.addEventListener('dragover', e => { e.preventDefault(); dz.classList.add('dragover'); });
  dz.addEventListener('dragleave', () => dz.classList.remove('dragover'));
  dz.addEventListener('drop', e => { e.preventDefault(); dz.classList.remove('dragover'); if (e.dataTransfer.files.length) { document.getElementById('fileInput').files = e.dataTransfer.files; updateSelectedFiles(); } });

  function debounce(fn, ms) { let t; return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); }; }

  window.openUploadModal = openUploadModal; window.closeUploadModal = closeUploadModal;
  window.openBomUploadModal = openBomUploadModal; window.closeBomUploadModal = closeBomUploadModal; window.uploadBomFiles = uploadBomFiles;
  window.openChatPanel = openChatPanel; window.closeChatPanel = closeChatPanel;
  window.closePreviewModal = closePreviewModal; window.prevPending = prevPending; window.nextPending = nextPending;
  window.simulateUpload = simulateUpload; window.askAI = askAI; window.downloadFile = downloadFile;
  window.previewFile = previewFile; window.renderBomSheet = renderBomSheet; window.deleteFile = deleteFile; window.setLibraryKind = setLibraryKind;
  window.openAdminModal = openAdminModal; window.closeAdminModal = closeAdminModal; window.loginAdmin = loginAdmin;
  window.editFile = editFile; window.closeEditModal = closeEditModal; window.closeBomEditModal = closeBomEditModal; window.saveEditFile = saveEditFile;

  loadAuthStatus().then(() => refreshFilterOptions().then(loadFiles));
})();
