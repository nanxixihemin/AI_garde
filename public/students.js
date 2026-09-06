(() => {
  'use strict';

  const TOKEN_KEY = 'student_archive_token';
  const state = {
    token: sessionStorage.getItem(TOKEN_KEY) || '',
    offset: 0,
    limit: 50,
    total: 0,
    selectedStudent: null,
  };

  const byId = (id) => document.getElementById(id);
  const nodes = {
    gateLayer: byId('gateLayer'),
    gateForm: byId('gateForm'),
    gateError: byId('gateError'),
    tokenInput: byId('tokenInput'),
    searchInput: byId('searchInput'),
    classFilter: byId('classFilter'),
    sortSelect: byId('sortSelect'),
    clearFilters: byId('clearFilters'),
    studentRows: byId('studentRows'),
    emptyState: byId('emptyState'),
    statusLine: byId('statusLine'),
    resultMeta: byId('resultMeta'),
    previousPage: byId('previousPage'),
    nextPage: byId('nextPage'),
    pageMeta: byId('pageMeta'),
    detailLayer: byId('detailLayer'),
    recordForm: byId('recordForm'),
    recordList: byId('recordList'),
    toast: byId('toast'),
  };

  function makeElement(tagName, className, text) {
    const element = document.createElement(tagName);
    if (className) element.className = className;
    if (text !== undefined && text !== null) element.textContent = String(text);
    return element;
  }

  function formatNumber(value, digits = 2) {
    return Number(value || 0).toLocaleString('zh-CN', {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    });
  }

  function showToast(message) {
    nodes.toast.textContent = message;
    nodes.toast.classList.add('show');
    window.clearTimeout(showToast.timer);
    showToast.timer = window.setTimeout(() => nodes.toast.classList.remove('show'), 2400);
  }

  function setStatus(message, isError = false) {
    nodes.statusLine.textContent = message || '';
    nodes.statusLine.classList.toggle('error', isError);
  }

  async function api(path, options = {}) {
    const response = await fetch(path, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${state.token}`,
        ...(options.headers || {}),
      },
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(body.error || '请求失败');
      error.status = response.status;
      throw error;
    }
    return body;
  }

  function showGate(message = '') {
    nodes.gateError.textContent = message;
    nodes.gateLayer.hidden = false;
    window.setTimeout(() => nodes.tokenInput.focus(), 0);
  }

  function hideGate() {
    nodes.gateError.textContent = '';
    nodes.gateLayer.hidden = true;
  }

  function lockArchive() {
    state.token = '';
    state.selectedStudent = null;
    sessionStorage.removeItem(TOKEN_KEY);
    nodes.studentRows.replaceChildren();
    closeDetail();
    showGate();
  }

  function handleAccessError(error) {
    if (error.status === 401) {
      state.token = '';
      sessionStorage.removeItem(TOKEN_KEY);
      showGate('访问口令无效，请重新输入。');
      return true;
    }
    return false;
  }

  async function loadSummary(prefetched) {
    const summary = prefetched || await api('/api/students/summary');
    byId('studentCount').textContent = String(summary.student_count || 0);
    byId('recordCount').textContent = String(summary.record_count || 0);
    byId('studentsWithRecords').textContent = String(summary.students_with_records || 0);
    byId('totalPoints').textContent = formatNumber(summary.total_points, 2);
  }

  async function loadClasses() {
    const classes = await api('/api/students/classes');
    const previous = nodes.classFilter.value;
    nodes.classFilter.replaceChildren(new Option('全部班级', ''));
    for (const item of classes) {
      nodes.classFilter.add(new Option(`${item.class_name}（${item.student_count}）`, item.class_name));
    }
    nodes.classFilter.value = previous;
  }

  function createCell(text, className) {
    const cell = makeElement('td', className, text);
    return cell;
  }

  function renderStudents(result) {
    nodes.studentRows.replaceChildren();
    state.total = result.total;
    nodes.emptyState.hidden = result.rows.length !== 0;

    for (const student of result.rows) {
      const row = document.createElement('tr');
      row.append(
        createCell(student.student_id, 'student-id'),
        createCell(student.name, 'student-name'),
        createCell(student.class_name),
        createCell(student.gpa === null ? '未录入' : formatNumber(student.gpa, 2), 'metric-number'),
        createCell(formatNumber(student.total_points, 2), 'metric-number points-number'),
        createCell(`获奖 ${student.award_count} · 论文 ${student.paper_count}`, 'record-counts')
      );
      const actionCell = document.createElement('td');
      const openButton = makeElement('button', 'row-button', '查看档案');
      openButton.type = 'button';
      openButton.addEventListener('click', () => openStudent(student.student_id));
      actionCell.append(openButton);
      row.append(actionCell);
      nodes.studentRows.append(row);
    }

    const first = result.total === 0 ? 0 : result.offset + 1;
    const last = Math.min(result.offset + result.rows.length, result.total);
    nodes.resultMeta.textContent = result.total === 0 ? '0 名学生' : `显示 ${first}—${last}，共 ${result.total} 名`;
    const page = Math.floor(result.offset / result.limit) + 1;
    const pages = Math.max(Math.ceil(result.total / result.limit), 1);
    nodes.pageMeta.textContent = `第 ${page} / ${pages} 页`;
    nodes.previousPage.disabled = result.offset <= 0;
    nodes.nextPage.disabled = result.offset + result.limit >= result.total;
  }

  async function loadStudents() {
    setStatus('正在查询…');
    const params = new URLSearchParams({
      q: nodes.searchInput.value.trim(),
      class_name: nodes.classFilter.value,
      sort: nodes.sortSelect.value,
      limit: String(state.limit),
      offset: String(state.offset),
    });
    try {
      const result = await api(`/api/students?${params.toString()}`);
      renderStudents(result);
      setStatus('');
    } catch (error) {
      if (!handleAccessError(error)) setStatus(error.message, true);
    }
  }

  async function loadInitial(prefetchedSummary) {
    try {
      await Promise.all([loadSummary(prefetchedSummary), loadClasses()]);
      await loadStudents();
      hideGate();
    } catch (error) {
      if (!handleAccessError(error)) showGate(error.message);
    }
  }

  function recordTypeName(type) {
    return ({ award: '获奖', paper: '论文', other: '其他' })[type] || '其他';
  }

  function safeEvidenceUrl(value) {
    if (!value) return null;
    try {
      const url = new URL(value);
      return ['http:', 'https:'].includes(url.protocol) ? url.href : null;
    } catch {
      return null;
    }
  }

  function renderRecords(records) {
    nodes.recordList.replaceChildren();
    if (!records.length) {
      nodes.recordList.append(makeElement('div', 'no-records', '还没有成果记录。点击“添加成果”开始录入。'));
      return;
    }

    for (const record of records) {
      const card = makeElement('article', 'record-card');
      const head = makeElement('div', 'record-card-head');
      const titleBlock = document.createElement('div');
      titleBlock.append(
        makeElement('span', 'record-type', recordTypeName(record.record_type)),
        makeElement('h4', '', record.title)
      );
      head.append(titleBlock, makeElement('strong', 'record-points', `+${formatNumber(record.points, 2)}`));
      card.append(head);

      const meta = makeElement('div', 'record-meta');
      [record.level, record.role, record.organization, record.record_date]
        .filter(Boolean)
        .forEach((value) => meta.append(makeElement('span', '', value)));
      if (meta.childElementCount) card.append(meta);
      if (record.notes) card.append(makeElement('p', 'record-notes', record.notes));

      const actions = makeElement('div', 'record-actions');
      const evidenceUrl = safeEvidenceUrl(record.evidence_url);
      if (evidenceUrl) {
        const link = makeElement('a', '', '查看证明');
        link.href = evidenceUrl;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        actions.append(link);
      }
      const editButton = makeElement('button', '', '编辑');
      editButton.type = 'button';
      editButton.addEventListener('click', () => showRecordForm(record));
      const deleteButton = makeElement('button', 'delete-record', '删除');
      deleteButton.type = 'button';
      deleteButton.addEventListener('click', () => deleteRecord(record.id));
      actions.append(editButton, deleteButton);
      card.append(actions);
      nodes.recordList.append(card);
    }
  }

  function populateStudentDetail(student) {
    state.selectedStudent = student;
    byId('detailClass').textContent = `${student.class_name} · ${student.gender}`;
    byId('detailName').textContent = student.name;
    byId('detailId').textContent = student.student_id;
    byId('detailPoints').textContent = formatNumber(student.total_points, 2);
    byId('detailAwards').textContent = String(student.award_count || 0);
    byId('detailPapers').textContent = String(student.paper_count || 0);
    byId('gpaInput').value = student.gpa === null ? '' : String(student.gpa);
    byId('studentNotes').value = student.notes || '';
    renderRecords(student.records || []);
  }

  async function openStudent(studentId) {
    try {
      const student = await api(`/api/students/${encodeURIComponent(studentId)}`);
      populateStudentDetail(student);
      nodes.detailLayer.hidden = false;
      document.body.style.overflow = 'hidden';
    } catch (error) {
      if (!handleAccessError(error)) showToast(error.message);
    }
  }

  function closeDetail() {
    nodes.detailLayer.hidden = true;
    nodes.recordForm.hidden = true;
    document.body.style.overflow = '';
  }

  function showRecordForm(record = null) {
    nodes.recordForm.reset();
    byId('recordId').value = record ? String(record.id) : '';
    byId('recordType').value = record?.record_type || 'award';
    byId('recordTitle').value = record?.title || '';
    byId('recordLevel').value = record?.level || '';
    byId('recordRole').value = record?.role || '';
    byId('recordOrganization').value = record?.organization || '';
    byId('recordDate').value = record?.record_date || '';
    byId('recordPoints').value = record ? String(record.points) : '0';
    byId('recordEvidence').value = record?.evidence_url || '';
    byId('recordNotes').value = record?.notes || '';
    nodes.recordForm.hidden = false;
    byId('recordTitle').focus();
    nodes.recordForm.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function recordPayload() {
    return {
      record_type: byId('recordType').value,
      title: byId('recordTitle').value.trim(),
      level: byId('recordLevel').value.trim(),
      role: byId('recordRole').value.trim(),
      organization: byId('recordOrganization').value.trim(),
      record_date: byId('recordDate').value,
      points: byId('recordPoints').value,
      evidence_url: byId('recordEvidence').value.trim(),
      notes: byId('recordNotes').value.trim(),
    };
  }

  async function refreshSelectedStudent() {
    if (!state.selectedStudent) return;
    const student = await api(`/api/students/${encodeURIComponent(state.selectedStudent.student_id)}`);
    populateStudentDetail(student);
  }

  async function deleteRecord(recordId) {
    if (!window.confirm('确认删除这条成果记录吗？')) return;
    try {
      await api(`/api/student-records/${recordId}`, { method: 'DELETE' });
      await Promise.all([refreshSelectedStudent(), loadSummary(), loadStudents()]);
      showToast('成果记录已删除');
    } catch (error) {
      if (!handleAccessError(error)) showToast(error.message);
    }
  }

  nodes.gateForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    nodes.gateError.textContent = '正在验证…';
    state.token = nodes.tokenInput.value.trim();
    try {
      const summary = await api('/api/students/summary');
      sessionStorage.setItem(TOKEN_KEY, state.token);
      nodes.tokenInput.value = '';
      await loadInitial(summary);
    } catch (error) {
      state.token = '';
      nodes.gateError.textContent = '访问口令无效，请重试。';
    }
  });

  byId('studentForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!state.selectedStudent) return;
    try {
      const response = await api(`/api/students/${encodeURIComponent(state.selectedStudent.student_id)}`, {
        method: 'PATCH',
        body: JSON.stringify({
          gpa: byId('gpaInput').value,
          notes: byId('studentNotes').value.trim(),
        }),
      });
      populateStudentDetail(response.data);
      await loadStudents();
      showToast('基本信息已保存');
    } catch (error) {
      if (!handleAccessError(error)) showToast(error.message);
    }
  });

  nodes.recordForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!state.selectedStudent) return;
    const recordId = byId('recordId').value;
    const path = recordId
      ? `/api/student-records/${recordId}`
      : `/api/students/${encodeURIComponent(state.selectedStudent.student_id)}/records`;
    try {
      await api(path, {
        method: recordId ? 'PUT' : 'POST',
        body: JSON.stringify(recordPayload()),
      });
      nodes.recordForm.hidden = true;
      await Promise.all([refreshSelectedStudent(), loadSummary(), loadStudents()]);
      showToast(recordId ? '成果记录已更新' : '成果记录已添加');
    } catch (error) {
      if (!handleAccessError(error)) showToast(error.message);
    }
  });

  let searchTimer;
  nodes.searchInput.addEventListener('input', () => {
    window.clearTimeout(searchTimer);
    searchTimer = window.setTimeout(() => {
      state.offset = 0;
      loadStudents();
    }, 220);
  });
  nodes.classFilter.addEventListener('change', () => { state.offset = 0; loadStudents(); });
  nodes.sortSelect.addEventListener('change', () => { state.offset = 0; loadStudents(); });
  nodes.clearFilters.addEventListener('click', () => {
    nodes.searchInput.value = '';
    nodes.classFilter.value = '';
    nodes.sortSelect.value = 'points_desc';
    state.offset = 0;
    loadStudents();
  });
  nodes.previousPage.addEventListener('click', () => {
    state.offset = Math.max(0, state.offset - state.limit);
    loadStudents();
  });
  nodes.nextPage.addEventListener('click', () => {
    if (state.offset + state.limit < state.total) state.offset += state.limit;
    loadStudents();
  });

  byId('addRecordButton').addEventListener('click', () => showRecordForm());
  byId('cancelRecord').addEventListener('click', () => { nodes.recordForm.hidden = true; });
  byId('closeDetail').addEventListener('click', closeDetail);
  byId('closeDetailScrim').addEventListener('click', closeDetail);
  byId('lockButton').addEventListener('click', lockArchive);
  byId('mobileLock').addEventListener('click', lockArchive);

  const sidebar = byId('sidebar');
  const sidebarBackdrop = byId('sidebarBackdrop');
  const closeSidebar = () => {
    sidebar.classList.remove('open');
    sidebarBackdrop.classList.remove('show');
  };
  byId('openSidebar').addEventListener('click', () => {
    sidebar.classList.add('open');
    sidebarBackdrop.classList.add('show');
  });
  byId('closeSidebar').addEventListener('click', closeSidebar);
  sidebarBackdrop.addEventListener('click', closeSidebar);

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !nodes.detailLayer.hidden) closeDetail();
  });

  loadInitial();
})();
