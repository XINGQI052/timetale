/* 课间 · a personal, local-first timetable */
(() => {
  'use strict';

  const STORAGE_KEY = 'kejian.schedule.v1';
  const DAYS = ['周一','周二','周三','周四','周五','周六','周日'];
  const TONES = ['mint','blue','peach','lilac','yellow','rose'];
  const MIN_SLOTS = 4;
  const MAX_SLOTS = 14;
  const DEFAULT_SLOT_MINUTES = 60;
  function minutesToClock(minutes) {
    const total = Math.max(0, Math.min(24 * 60 - 1, Math.round(Number(minutes) || 0)));
    return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
  }
  function validClock(value) { return /^([01]\d|2[0-3]):[0-5]\d$/.test(String(value || '')); }
  // 默认作息：08:00 起、每节 60 分钟、共 8 节 —— 与旧版本行为完全一致，旧数据不受影响
  function defaultSlotTimes() {
    const list = [];
    for (let i = 0; i < 8; i++) {
      const start = 8 * 60 + i * DEFAULT_SLOT_MINUTES;
      list.push({ start: minutesToClock(start), end: minutesToClock(start + DEFAULT_SLOT_MINUTES) });
    }
    return list;
  }
  const DEFAULT_SETTINGS = { notifications: false, reminderMinutes: 10, dayStart: '08:00', dayEnd: '16:00', showWeekend: true, theme: '', slotHeight: 64, showNowLine: true, slotTimes: defaultSlotTimes() };
  const SEMESTER_START_KEY = 'kejian.semesterStart.v1';
  const $ = (selector, root = document) => root.querySelector(selector);
  const dateNow = new Date();
  const startOfThisWeek = mondayOf(dateNow);
  let semesterStart = readSemesterStart();
  let state = loadState();
  let weekOffset = 0;
  let toastTimer;
  let reminderTicker = 0;
  let deferredPrompt = null;
  window.addEventListener('beforeinstallprompt', event => { event.preventDefault(); deferredPrompt = event; });
  window.addEventListener('appinstalled', () => { deferredPrompt = null; showToast('已安装到桌面，点图标就能打开 ✨'); });

  function mondayIndex(date) { return (date.getDay() + 6) % 7; }
  function mondayOf(date) {
    const monday = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    monday.setDate(monday.getDate() - mondayIndex(date));
    monday.setHours(0, 0, 0, 0);
    return monday;
  }
  function dayAt(offset, index) { const date = new Date(startOfThisWeek); date.setDate(date.getDate() + offset * 7 + index); return date; }
  function dateKey(date) { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`; }
  function readSemesterStart() {
    try { const value = localStorage.getItem(SEMESTER_START_KEY); if (value) { const date = new Date(`${value}T00:00:00`); if (!Number.isNaN(date.getTime())) return mondayOf(date); } } catch (error) { /* storage may be unavailable */ }
    return startOfThisWeek;
  }
  function formatDate(date, options = { month: 'short', day: 'numeric' }) { return new Intl.DateTimeFormat('zh-CN', options).format(date).replace('月', '月'); }
  function escapeHTML(value = '') { return String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]); }
  function uid() { return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`; }
  function blankState() { return { version: 1, courses: [], settings: Object.assign({}, DEFAULT_SETTINGS) }; }
  function cleanCourse(course) {
    if (!course || typeof course !== 'object') return null;
    const day = Number(course.day), start = Number(course.start), end = Number(course.end);
    const startWeek = Number(course.startWeek) || 1, endWeek = Number(course.endWeek) || 20;
    if (!String(course.name || '').trim() || !Number.isInteger(day) || day < 0 || day > 6 || !Number.isInteger(start) || start < 0 || start > MAX_SLOTS - 1 || !Number.isInteger(end) || end < start || end > MAX_SLOTS - 1 || !Number.isInteger(startWeek) || !Number.isInteger(endWeek) || startWeek < 1 || endWeek < startWeek || endWeek > 100) return null;
    return { id: String(course.id || uid()), name: String(course.name).trim().slice(0, 80), teacher: String(course.teacher || '').trim().slice(0, 80), room: String(course.room || '').trim().slice(0, 80), day, start, end, startWeek, endWeek, tone: TONES.includes(course.tone) ? course.tone : TONES[0], note: String(course.note || '').trim().slice(0, 500) };
  }
  function loadState() {
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (!parsed || !Array.isArray(parsed.courses)) return blankState();
      return { version: 1, courses: parsed.courses.map(cleanCourse).filter(Boolean), settings: Object.assign({}, DEFAULT_SETTINGS, parsed.settings || {}) };
    } catch (error) { return blankState(); }
  }
  function saveState() { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); localStorage.setItem(SEMESTER_START_KEY, dateKey(semesterStart)); } catch (error) { showToast('本机存储不可用；请及时导出备份。'); } }
  function showToast(message) {
    const toast = $('#toast'); toast.textContent = message; toast.classList.add('visible');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => toast.classList.remove('visible'), 2900);
  }
  function weekNumber(offset = weekOffset) { return Math.max(1, Math.round((dayAt(offset, 0).getTime() - semesterStart.getTime()) / 604800000) + 1); }
  function weekCourses(offset = weekOffset, day = mondayIndex(dateNow)) {
    const teachingWeek = weekNumber(offset);
    return state.courses.filter(course => course.day === day && course.startWeek <= teachingWeek && course.endWeek >= teachingWeek).sort((a, b) => a.start - b.start || a.end - b.end);
  }
  function weekLabel(offset = weekOffset) { const first = dayAt(offset, 0), last = dayAt(offset, 6); return `${formatDate(first)} — ${formatDate(last)}`; }

  function slotH() { return Math.min(96, Math.max(44, Number(state.settings.slotHeight) || 64)); }
  function currentTheme() {
    if (state.settings.theme === 'dark' || state.settings.theme === 'light') return state.settings.theme;
    return (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light';
  }
  function applyDisplay() {
    const root = document.documentElement;
    if (root) {
      root.setAttribute('data-theme', currentTheme());
      if (root.style && root.style.setProperty) root.style.setProperty('--slot-h', slotH() + 'px');
    }
    const themeBtn = $('#themeToggle');
    if (themeBtn) { const dark = currentTheme() === 'dark'; themeBtn.textContent = dark ? '☀' : '🌙'; themeBtn.title = dark ? '切换浅色模式' : '切换深色模式'; }
    const themeHint = $('#themeSettingHint');
    if (themeHint) {
      const chosen = state.settings.theme === 'dark' || state.settings.theme === 'light';
      themeHint.textContent = chosen
        ? (currentTheme() === 'dark' ? '当前：深色（已手动选择）' : '当前：浅色（已手动选择）')
        : (currentTheme() === 'dark' ? '当前：深色（跟随系统）' : '当前：浅色（跟随系统）');
    }
  }
  function nowLineOffset() {
    if (state.settings.showNowLine === false) return -1;
    const minutes = dateNow.getHours() * 60 + dateNow.getMinutes();
    const table = slotTable();
    const h = slotH();
    for (let i = 0; i < table.length; i++) {
      const start = parseMinutes(table[i].start), end = parseMinutes(table[i].end);
      if (minutes >= start && minutes <= end) return Math.round((i + (minutes - start) / Math.max(1, end - start)) * h);
    }
    // 落在课间：停在下一节的开头
    for (let i = 0; i < table.length - 1; i++) {
      if (minutes > parseMinutes(table[i].end) && minutes < parseMinutes(table[i + 1].start)) return (i + 1) * h;
    }
    return -1;
  }
  function updateNowLine() {
    if (weekOffset !== 0) return;
    const col = document.querySelector('.day-col.today'); if (!col) return;
    const off = nowLineOffset(); const line = col.querySelector('.now-line');
    if (off < 0) { if (line && line.remove) line.remove(); return; }
    if (!line) { const el = document.createElement('div'); el.className = 'now-line'; col.appendChild(el); }
    const el2 = col.querySelector('.now-line'); if (el2) el2.style.top = off + 'px';
  }
  function openDisplaySettings() {
    openModal('显示设置', 'DISPLAY', `<div class="settings-list"><div class="setting-row"><div><strong>课程块高度</strong><p>当前 <span id="displayHeightVal">${slotH()}</span> px，拖动即时预览</p></div><input type="range" id="displayHeight" min="44" max="96" step="2" value="${slotH()}" aria-label="课程块高度"></div><div class="setting-row"><div><strong>当前时间线</strong><p>在今天那一列显示随时间移动的红色标线</p></div><button class="toggle${state.settings.showNowLine === false ? '' : ' on'}" type="button" id="displayNowToggle" role="switch" aria-checked="${state.settings.showNowLine !== false}" aria-label="显示当前时间线"></button></div><button class="setting-row" type="button" id="openSlotTimeRow"><div><strong>课节时间</strong><p id="slotTimeSummary">当前 ${slotCount()} 节 · ${slotStart(0)} 开始 · ${slotEnd(slotCount() - 1)} 结束</p></div><span style="font-size:14px;color:#8ba18e">›</span></button><div class="info-box">深色模式在「设置」里切换。</div><div class="form-actions"><button class="secondary-button" data-close>完成</button></div></div>`);
    const heightInput = $('#displayHeight'), nowBtn = $('#displayNowToggle');
    heightInput.addEventListener('input', () => {
      const v = Math.min(96, Math.max(44, Number(heightInput.value) || 64));
      state.settings.slotHeight = v; $('#displayHeightVal').textContent = String(v); saveState(); applyDisplay(); renderSchedule();
    });
    nowBtn.addEventListener('click', () => {
      state.settings.showNowLine = state.settings.showNowLine === false; saveState(); renderSchedule();
      const on = state.settings.showNowLine !== false; nowBtn.classList.toggle('on', on); nowBtn.setAttribute('aria-checked', String(on));
    });
    $('#openSlotTimeRow').addEventListener('click', openSlotTimeSettings);
    $('[data-close]').addEventListener('click', closeModal);
  }
  /* ---------- 课节时间设置 ---------- */
  // 把节数缩到 count 之后，哪些课程会落到课表之外（用来阻止「课程看不见」）
  function coursesBeyondSlot(count) {
    return state.courses.filter(course => course.start >= count || course.end >= count);
  }
  function slotPresets() {
    return {
      hourly: { label: '整点 60 分钟', build: count => Array.from({ length: count }, (_, i) => ({ start: minutesToClock(8 * 60 + i * 60), end: minutesToClock(9 * 60 + i * 60) })) },
      class45: { label: '45 分钟 + 10 分钟课间', build: count => { const list = []; let cursor = 8 * 60; for (let i = 0; i < count; i++) { list.push({ start: minutesToClock(cursor), end: minutesToClock(cursor + 45) }); cursor += 45 + 10; } return list; } },
      afternoon: { label: '上午 45 分钟 / 下午 14:00 起', build: count => { const list = []; let cursor = 8 * 60; for (let i = 0; i < count; i++) { if (i === 4) cursor = 14 * 60; list.push({ start: minutesToClock(cursor), end: minutesToClock(cursor + 45) }); cursor += 45 + 10; } return list; } }
    };
  }
  function openSlotTimeSettings() {
    const table = slotTable();
    openModal('课节时间', 'YOUR DAILY RHYTHM', slotTimeHtml(table));
    let draft = table.map(item => ({ start: item.start, end: item.end }));
    const paint = () => {
      $('#slotTimeList').innerHTML = draft.map((item, i) =>
        '<div class="slot-time-row" data-slot-row="' + i + '"><span class="slot-time-no">第 ' + (i + 1) + ' 节</span>' +
        '<input type="time" data-slot-start="' + i + '" value="' + item.start + '" aria-label="第 ' + (i + 1) + ' 节开始时间">' +
        '<span class="slot-time-dash">—</span>' +
        '<input type="time" data-slot-end="' + i + '" value="' + item.end + '" aria-label="第 ' + (i + 1) + ' 节结束时间">' +
        '<button class="slot-time-drop" type="button" data-slot-drop="' + i + '" aria-label="删除第 ' + (i + 1) + ' 节">×</button></div>').join('');
      $('#slotCount').value = String(draft.length);
      $('#slotTimeHint').textContent = '共 ' + draft.length + ' 节，' + draft[0].start + ' 开始，' + draft[draft.length - 1].end + ' 结束。';
      $('#slotAdd').disabled = draft.length >= MAX_SLOTS;
      $('#slotDrop').disabled = draft.length <= MIN_SLOTS;
    };
    const syncDraft = () => {
      draft = draft.map((item, i) => {
        const startNode = document.querySelector('[data-slot-start="' + i + '"]');
        const endNode = document.querySelector('[data-slot-end="' + i + '"]');
        return { start: (startNode && validClock(startNode.value)) ? startNode.value : item.start, end: (endNode && validClock(endNode.value)) ? endNode.value : item.end };
      });
    };
    paint();
    $('#slotTimeList').addEventListener('input', () => { syncDraft(); $('#slotTimeHint').textContent = '共 ' + draft.length + ' 节，' + draft[0].start + ' 开始，' + draft[draft.length - 1].end + ' 结束。'; });
    $('#slotTimeList').addEventListener('click', event => {
      const drop = event.target.getAttribute && event.target.getAttribute('data-slot-drop');
      if (drop === null || drop === undefined) return;
      syncDraft();
      if (draft.length <= MIN_SLOTS) { showToast('至少保留 ' + MIN_SLOTS + ' 节。'); return; }
      draft.splice(Number(drop), 1);
      paint();
    });
    $('#slotAdd').addEventListener('click', () => {
      syncDraft();
      if (draft.length >= MAX_SLOTS) return;
      const last = draft[draft.length - 1];
      const duration = Math.max(5, parseMinutes(last.end) - parseMinutes(last.start));
      const start = parseMinutes(last.end) + 10;
      draft.push({ start: minutesToClock(start), end: minutesToClock(start + duration) });
      paint();
    });
    $('#slotDrop').addEventListener('click', () => {
      syncDraft();
      if (draft.length <= MIN_SLOTS) return;
      draft.pop();
      paint();
    });
    $('#slotCount').addEventListener('change', event => {
      syncDraft();
      const target = Math.max(MIN_SLOTS, Math.min(MAX_SLOTS, Number(event.target.value) || draft.length));
      while (draft.length > target) draft.pop();
      while (draft.length < target) {
        const last = draft[draft.length - 1];
        const duration = Math.max(5, parseMinutes(last.end) - parseMinutes(last.start));
        const start = parseMinutes(last.end) + 10;
        draft.push({ start: minutesToClock(start), end: minutesToClock(start + duration) });
      }
      paint();
    });
    document.querySelectorAll('[data-slot-preset]').forEach(button => button.addEventListener('click', () => {
      const key = button.getAttribute('data-slot-preset');
      const preset = slotPresets()[key];
      if (!preset) return;
      draft = preset.build(draft.length).map(item => ({ start: item.start, end: item.end }));
      paint();
      showToast('已套用「' + preset.label + '」，还要点保存才生效。');
    }));
    $('#slotReset').addEventListener('click', () => { draft = defaultSlotTimes(); paint(); showToast('已恢复默认作息，还要点保存才生效。'); });
    $('#slotSave').addEventListener('click', () => {
      syncDraft();
      const cleaned = [];
      for (let i = 0; i < draft.length; i++) {
        const start = parseMinutes(draft[i].start), end = parseMinutes(draft[i].end);
        if (end <= start) { showToast('第 ' + (i + 1) + ' 节的结束时间要晚于开始时间。'); return; }
        if (cleaned.length && start < parseMinutes(cleaned[cleaned.length - 1].end)) { showToast('第 ' + (i + 1) + ' 节和上一节时间重叠了，请调整。'); return; }
        cleaned.push({ start: minutesToClock(start), end: minutesToClock(end) });
      }
      // 减少节数时不能让已有课程「消失」
      const blockingCourses = coursesBeyondSlot(cleaned.length);
      if (blockingCourses.length) {
        const highestUsed = state.courses.reduce((max, course) => Math.max(max, course.end + 1, course.start + 1), 0);
        showToast('有 ' + blockingCourses.length + ' 门课排在第 ' + highestUsed + ' 节，先改成 ' + cleaned.length + ' 节它们就看不见了。');
        return;
      }
      state.settings.slotTimes = cleaned;
      state.settings.dayStart = cleaned[0].start;
      state.settings.dayEnd = cleaned[cleaned.length - 1].end;
      saveState();
      closeModal();
      renderAll();
      showToast('课节时间已更新 ✨');
    });
    $('[data-close]').addEventListener('click', closeModal);
  }
  function slotTimeHtml(table) {
    const presets = slotPresets();
    const presetButtons = Object.keys(presets).map(key => '<button class="btn-ghost" type="button" data-slot-preset="' + key + '">' + escapeHTML(presets[key].label) + '</button>').join('');
    return '<div class="info-box">这里设置每节课的实际上课时间。国内大学的作息通常不是整点一小时，按你学校的作息表填就行。改完记得点保存。<br><br>节次本身不变（课程的「第几节」不受影响），所以<strong>已有课程不会丢失</strong>，只是显示和提醒的时间会跟着更新。</div>' +
      '<div class="setting-row"><div><strong>节数</strong><p>一般 8–12 节，最多 ' + MAX_SLOTS + ' 节</p></div><select id="slotCount" class="slot-count-select" aria-label="节数">' +
      Array.from({ length: MAX_SLOTS - MIN_SLOTS + 1 }, (_, i) => MIN_SLOTS + i).map(n => '<option value="' + n + '"' + (n === table.length ? ' selected' : '') + '>' + n + ' 节</option>').join('') +
      '</select></div>' +
      '<div class="slot-time-list" id="slotTimeList"></div>' +
      '<div class="ocr-summary" id="slotTimeHint"></div>' +
      '<div class="ocr-actions"><button class="btn-ghost" type="button" id="slotAdd">加一节</button><button class="btn-ghost" type="button" id="slotDrop">减一节</button></div>' +
      '<div class="info-box" style="margin-top:12px"><strong>快速套用</strong></div>' +
      '<div class="ocr-actions">' + presetButtons + '</div>' +
      '<div class="ocr-actions"><button class="btn-ghost" type="button" id="slotReset">恢复默认（08:00 起 · 每节 60 分钟）</button></div>' +
      '<div class="form-actions"><button class="btn-primary" type="button" id="slotSave">保存课节时间</button><button class="btn-ghost" data-close>取消</button></div>';
  }

  const BROWSER_NAMES = { wechat: '微信内置浏览器', quark: '夸克浏览器', uc: 'UC 浏览器', miui: '小米自带浏览器', huawei: '华为自带浏览器', oppo: 'OPPO 自带浏览器', vivo: 'vivo 自带浏览器', samsung: '三星浏览器', edge: 'Microsoft Edge', firefox: 'Firefox', chrome: 'Chrome', safari: 'Safari', other: '当前浏览器' };
  function detectBrowser() {
    const ua = String(navigator.userAgent || '');
    if (/MicroMessenger/i.test(ua)) return 'wechat';
    if (/Quark/i.test(ua)) return 'quark';
    if (/UCBrowser|UBrowser|UCWEB/i.test(ua)) return 'uc';
    if (/MiuiBrowser|XiaoMi|HyperOS/i.test(ua)) return 'miui';
    if (/HuaweiBrowser|HarmonyOS|HBPC/i.test(ua)) return 'huawei';
    if (/HeyTapBrowser|OppoBrowser|OPPO/i.test(ua)) return 'oppo';
    if (/VivoBrowser|vivo/i.test(ua)) return 'vivo';
    if (/SamsungBrowser/i.test(ua)) return 'samsung';
    if (/Edg[A-Z]?\//i.test(ua)) return 'edge';
    if (/Firefox|FxiOS/i.test(ua)) return 'firefox';
    if (/CriOS|Chrome\//i.test(ua)) return 'chrome';
    if (/Safari/i.test(ua)) return 'safari';
    return 'other';
  }
  function isIOS() { const ua = String(navigator.userAgent || ''); return /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1); }
  function isStandalone() {
    if (navigator.standalone === true) return true;
    if (window.matchMedia && (window.matchMedia('(display-mode: standalone)').matches || window.matchMedia('(display-mode: minimal-ui)').matches)) return true;
    return false;
  }
  function installAdvice() {
    const browser = detectBrowser();
    if (browser === 'wechat') return { full: false, head: '微信里无法安装', steps: ['点右上角 ⋯，选「在浏览器打开」', '用夸克、手机自带浏览器或 Chrome 重新打开这个网址', '再回到本页点「安装到手机」，就会显示对应浏览器的步骤'], warn: '微信内置浏览器不支持添加到桌面，必须换到真正的浏览器里操作。' };
    if (isIOS()) return { full: true, head: 'iPhone / iPad · Safari', steps: ['点屏幕底部的「分享」按钮', '在列表里往下找「添加到主屏幕」', '点「添加」——主屏出现课间图标，打开就是全屏 App'], warn: '必须用 Safari 操作。夸克、微信等 App 里的浏览器无法添加到主屏幕。' };
    if (browser === 'quark') return { full: false, head: '夸克浏览器', steps: ['点右下角「≡」或右上角「⋯」打开菜单', '选「添加到桌面」或「添加到主屏」', '确认后主屏出现课间快捷方式'], warn: '夸克不支持完整安装，只能得到快捷方式：打开时上方会带浏览器工具栏，网页通知提醒通常也无效。想要无地址栏、能离线、能收提醒的完整版，建议从应用商店装一个 Edge 或 Chrome，用它打开本页再安装。' };
    if (browser === 'uc') return { full: false, head: 'UC 浏览器', steps: ['点底部中间的「≡」菜单', '选「添加到桌面」', '主屏出现快捷方式即可使用'], warn: 'UC 不支持完整安装，只有快捷方式，通知提醒可能无效。想要完整版请用 Edge 或 Chrome。' };
    if (browser === 'miui' || browser === 'huawei' || browser === 'oppo' || browser === 'vivo') return { full: false, head: BROWSER_NAMES[browser], steps: ['点浏览器底部或右上的「菜单」（≡ 或 ⋮）', '选「添加到桌面」，或「添加书签」时选桌面', '主屏出现课间图标即可一键打开'], warn: '手机自带浏览器一般只支持「添加到桌面」的快捷方式，不支持无地址栏的完整安装，网页通知也可能无效。想要完整版，建议装 Edge 或 Chrome 打开本页安装。' };
    if (browser === 'chrome' || browser === 'edge' || browser === 'samsung') return { full: true, head: BROWSER_NAMES[browser], steps: ['点右上角「⋮」打开菜单', '选「安装应用」或「添加到主屏幕」', '确认后主屏出现课间图标，点开是无地址栏的全屏应用'], warn: '' };
    if (browser === 'firefox') return { full: false, head: 'Firefox', steps: ['点右上角「⋮」菜单', '选「安装」或「添加到主屏幕」', '按提示确认'], warn: 'Firefox 是否支持完整安装取决于版本；没有「安装」选项时用「添加到主屏幕」也一样能用。' };
    return { full: false, head: '当前浏览器', steps: ['打开浏览器菜单（≡ 或 ⋮）', '找「安装应用」「添加到主屏幕」或「添加到桌面」', '选其中可用的那一项'], warn: '如果菜单里没有「安装应用」，说明这个浏览器不支持完整安装，只能用快捷方式；想要完整版请换 Edge 或 Chrome。' };
  }
  function openInstallGuide() {
    const advice = installAdvice();
    const installed = isStandalone();
    const badge = advice.full ? '<span class="install-badge">支持完整安装</span>' : '<span class="install-badge">仅快捷方式</span>';
    const body = installed
      ? '<div class="info-box"><strong>已经装好了</strong><br>你现在就是从桌面图标打开的，正在独立窗口里运行。想重新安装，先在桌面长按图标卸载，再回到浏览器重新添加。</div>'
      : `<div class="info-box"><strong>${advice.head}</strong>${badge}<br>${deferredPrompt ? '这个浏览器支持完整安装，点下面的按钮一步到位。' : '按下面的步骤操作即可。'}</div><ol class="install-steps">${advice.steps.map(step => `<li>${escapeHTML(step)}</li>`).join('')}</ol>${advice.warn ? `<div class="install-warn">${escapeHTML(advice.warn)}</div>` : ''}${deferredPrompt ? '<div class="form-actions"><button class="primary-button" type="button" id="installNow">立即安装</button></div>' : ''}`;
    openModal(installed ? '安装状态' : '安装到手机', 'INSTALL', `${body}<div class="form-actions"><button class="secondary-button" data-close>${installed ? '知道了' : '关闭'}</button></div>`);
    const installBtn = $('#installNow');
    if (installBtn) installBtn.addEventListener('click', () => {
      const prompt = deferredPrompt; if (!prompt) return; deferredPrompt = null;
      prompt.prompt(); const choice = prompt.userChoice; closeModal();
      if (choice && choice.then) choice.then(result => showToast(result && result.outcome === 'accepted' ? '正在安装，装好后主屏就有啦 ✨' : '已取消，随时可以再安装'));
      else showToast('正在安装…');
    });
    $('[data-close]').addEventListener('click', closeModal);
  }
  function renderHeader() {
    $('#weekNum').textContent = `第 ${weekNumber()} 周`;
    $('#weekRange').textContent = weekLabel();
    const slider = $('#weekSlider'); if (slider) slider.value = String(weekNumber());
  }
  function renderSchedule() {
    const board = $('#weekGrid');
    const todayIndex = mondayIndex(dateNow);
    let html = '<div class="grid-head"><div class="grid-corner">节次</div>';
    DAYS.forEach((name, i) => {
      const date = dayAt(weekOffset, i), today = weekOffset === 0 && i === todayIndex;
      html += `<div class="day-head${today ? ' today' : ''}" data-head="${i}"><span class="d-name">${name}</span><span class="d-date">${date.getMonth() + 1}/${date.getDate()}</span></div>`;
    });
    // 时间轴显示每节的起止时间：45 分钟作息下只给开始时间会看不懂
    html += '</div><div class="grid-body"><div class="time-gutter">' + slotTable().map((item, i) => `<div class="time-slot"><span class="slot-no">${i + 1}</span><span class="slot-time">${item.start}</span><span class="slot-time-end">${item.end}</span></div>`).join('') + '</div>';
    DAYS.forEach((name, d) => {
      const today = weekOffset === 0 && d === todayIndex;
      const courses = weekCourses(weekOffset, d);
      const h = slotH();
      const total = slotCount();
      html += `<div class="day-col${today ? ' today' : ''}" data-daycol="${d}">` + slotTable().map((_, s) => `<button class="slot" type="button" data-day="${d}" data-slot="${s}" aria-label="${name}第${s + 1}节添加课程"></button>`).join('');
      courses.forEach(course => {
        const span = Math.min(course.end - course.start + 1, total - course.start);
        html += `<button class="class-card tone-${course.tone}" type="button" data-course="${escapeHTML(course.id)}" style="top:${course.start * h + 2}px;height:${span * h - 4}px"><span class="class-name">${escapeHTML(course.name)}</span>${course.teacher ? `<span class="class-meta">${escapeHTML(course.teacher)}</span>` : ''}${course.room ? `<span class="class-meta">${escapeHTML(course.room)}</span>` : ''}</button>`;
      });
      if (today && nowLineOffset() >= 0) html += `<div class="now-line" style="top:${nowLineOffset()}px"></div>`;
      html += '</div>';
    });
    html += '</div>';
    board.innerHTML = html;
    board.classList.toggle('hide-weekend', state.settings.showWeekend === false);
    // 一课都没有时：网格照常显示（能滑动、能点格子），只在上层浮一条提示
    const emptyHint = $('#gridEmptyHint');
    if (emptyHint) emptyHint.hidden = state.courses.length > 0;
    board.querySelectorAll('[data-course]').forEach(button => button.addEventListener('click', () => { if (gestureSuppressed()) return; showCourse(button.dataset.course); }));
    board.querySelectorAll('.slot').forEach(slot => slot.addEventListener('click', () => { if (gestureSuppressed()) return; openCourseForm(null, { day: Number(slot.dataset.day), start: Number(slot.dataset.slot) }); }));
    bindCourseGestures(board);
  }
  function parseMinutes(value) { const [hours, minutes] = String(value).split(':').map(Number); return hours * 60 + minutes; }
  /* ---------- 课节时间表 ---------- */
  function normalizeSlotTimes(list) {
    const source = Array.isArray(list) && list.length ? list : defaultSlotTimes();
    const out = [];
    for (let i = 0; i < source.length && out.length < MAX_SLOTS; i++) {
      const item = source[i] || {};
      const previousEnd = out.length ? parseMinutes(out[out.length - 1].end) : 8 * 60;
      const startClock = validClock(item.start) ? String(item.start) : minutesToClock(previousEnd + 10);
      let start = parseMinutes(startClock);
      if (start > 24 * 60 - 6) start = 24 * 60 - 6;
      const endClock = validClock(item.end) ? String(item.end) : minutesToClock(start + DEFAULT_SLOT_MINUTES);
      let end = parseMinutes(endClock);
      if (end > 24 * 60 - 1) end = 24 * 60 - 1;
      if (end <= start) end = Math.min(24 * 60 - 1, start + DEFAULT_SLOT_MINUTES);
      out.push({ start: minutesToClock(start), end: minutesToClock(end) });
    }
    while (out.length < MIN_SLOTS) {
      const start = (out.length ? parseMinutes(out[out.length - 1].end) : 8 * 60) + 10;
      out.push({ start: minutesToClock(start), end: minutesToClock(start + DEFAULT_SLOT_MINUTES) });
    }
    return out;
  }
  let slotCache = { key: '', value: null };
  function slotTable() {
    const raw = state.settings.slotTimes;
    const key = Array.isArray(raw) ? JSON.stringify(raw) : 'default';
    if (slotCache.key === key && slotCache.value) return slotCache.value;
    slotCache = { key: key, value: normalizeSlotTimes(raw) };
    return slotCache.value;
  }
  function slotCount() { return slotTable().length; }
  function slotStart(slot) { const table = slotTable(); return (table[slot] || table[table.length - 1]).start; }
  function slotEnd(slot) { const table = slotTable(); return (table[slot] || table[table.length - 1]).end; }
  function slotStartMinutes(slot) { return parseMinutes(slotStart(slot)); }
  function slotEndMinutes(slot) { return parseMinutes(slotEnd(slot)); }
  function courseTime(course) { return `${slotStart(course.start)} — ${slotEnd(course.end)}`; }
  // 由「几点几分」反查第几节（ICS 导入用）：落在课间或课表外时取最近的一节
  function findSlotByMinutes(minutes) {
    const table = slotTable();
    for (let i = 0; i < table.length; i++) {
      if (minutes >= parseMinutes(table[i].start) && minutes < parseMinutes(table[i].end)) return i;
    }
    let best = 0, bestDistance = Infinity;
    table.forEach((item, i) => {
      const start = parseMinutes(item.start), end = parseMinutes(item.end);
      const distance = minutes < start ? start - minutes : minutes - end;
      if (distance < bestDistance) { bestDistance = distance; best = i; }
    });
    return best;
  }
  function renderTodayStrip() {
    const strip = $('#todayStrip');
    const todayCourses = weekCourses(0, mondayIndex(dateNow));
    const nowMinutes = dateNow.getHours() * 60 + dateNow.getMinutes();
    const upcoming = todayCourses.find(course => slotStartMinutes(course.start) > nowMinutes);
    if (!todayCourses.length) { strip.textContent = '今天没有课，安排点自己喜欢的事吧。'; return; }
    if (upcoming) strip.textContent = `今天 ${todayCourses.length} 节课 · 下一节 ${slotStart(upcoming.start)} ${upcoming.name}${upcoming.room ? ' @' + upcoming.room : ''}`;
    else strip.textContent = `今天 ${todayCourses.length} 节课都已结束，辛苦啦。`;
  }
  function renderAll() { renderHeader(); renderSchedule(); renderTodayStrip(); }

  function openModal(title, eyebrow, html) {
    $('#modalTitle').textContent = title; $('#modalEyebrow').textContent = eyebrow; $('#modalBody').innerHTML = html; $('#modalBackdrop').hidden = false; document.body.style.overflow = 'hidden';
    setTimeout(() => { const firstField = $('#modalBody input, #modalBody select, #modalBody button'); if (firstField && firstField.focus) firstField.focus({ preventScroll: true }); }, 40);
  }
  function closeModal() { $('#modalBackdrop').hidden = true; document.body.style.overflow = ''; }
  function courseFields(course, prefill) {
    const c = course || {};
    const table = slotTable();
    const start = course ? course.start : (prefill && Number.isInteger(prefill.start) ? prefill.start : Math.min(table.length - 1, Math.max(0, findSlotByMinutes(dateNow.getHours() * 60 + dateNow.getMinutes()))));
    const end = course ? course.end : (prefill && Number.isInteger(prefill.end) ? prefill.end : start);
    const dayDefault = course ? course.day : (prefill && Number.isInteger(prefill.day) ? prefill.day : 0);
    const slotOptions = table.map((item, i) => `<option value="${i}"${i === start ? ' selected' : ''}>第 ${i + 1} 节 · ${item.start}</option>`).join('');
    const endOptions = table.map((item, i) => `<option value="${i}"${i === end ? ' selected' : ''}>第 ${i + 1} 节 · 到 ${item.end}</option>`).join('');
    const dayOptions = DAYS.map((day, i) => `<option value="${i}"${i === dayDefault ? ' selected' : ''}>${day}</option>`).join('');
    const toneOptions = TONES.map((tone, i) => `<option value="${tone}"${tone === (c.tone || TONES[(state.courses.length) % TONES.length]) ? ' selected' : ''}>${['薄荷绿','晴空蓝','杏子橙','丁香紫','奶油黄','樱桃粉'][i]}</option>`).join('');
    return `<form id="courseForm"><div class="form-grid"><div class="field wide"><label for="courseName">课程名称 *</label><input id="courseName" name="name" required maxlength="80" placeholder="例如：设计心理学" value="${escapeHTML(c.name || '')}"></div><div class="field"><label for="courseDay">上课星期</label><select id="courseDay" name="day">${dayOptions}</select></div><div class="field"><label for="courseRoom">教室</label><input id="courseRoom" name="room" maxlength="80" placeholder="例如：知行楼 204" value="${escapeHTML(c.room || '')}"></div><div class="field"><label for="courseStart">开始节次</label><select id="courseStart" name="start">${slotOptions}</select></div><div class="field"><label for="courseEnd">结束节次</label><select id="courseEnd" name="end">${endOptions}</select></div><div class="field"><label for="courseTeacher">老师</label><input id="courseTeacher" name="teacher" maxlength="80" placeholder="选填" value="${escapeHTML(c.teacher || '')}"></div><div class="field"><label for="courseTone">卡片颜色</label><select id="courseTone" name="tone">${toneOptions}</select></div><div class="field"><label for="startWeek">开始周</label><input type="number" name="startWeek" min="1" max="100" value="${c.startWeek || 1}"></div><div class="field"><label for="endWeek">结束周</label><input type="number" name="endWeek" min="1" max="100" value="${c.endWeek || 20}"></div><div class="field wide"><span class="field-hint">第 ${start + 1} 节的实际上课时间是 ${table[start] ? table[start].start : ''}。作息时间可以在「显示设置 → 课节时间」里改。</span></div><div class="field wide"><label for="courseNote">备注</label><textarea name="note" id="courseNote" maxlength="500" placeholder="选填，例如：需要带模型材料">${escapeHTML(c.note || '')}</textarea></div></div><div class="form-actions"><button class="primary-button" type="submit">${course ? '保存修改' : '添加课程'}</button><button class="secondary-button" type="button" data-close>取消</button></div></form>`;
  }
  function overlaps(candidate, ignoreId = null) { return state.courses.some(existing => existing.id !== ignoreId && existing.day === candidate.day && candidate.startWeek <= existing.endWeek && candidate.endWeek >= existing.startWeek && candidate.start <= existing.end && candidate.end >= existing.start); }
  function openCourseForm(course = null, prefill = null) {
    openModal(course ? '编辑课程' : '添加一门课', 'YOUR CLASS', courseFields(course, prefill));
    $('#courseForm').addEventListener('submit', event => {
      event.preventDefault(); const form = new FormData(event.currentTarget);
      const candidate = cleanCourse(Object.assign({}, course, { id: (course && course.id) || uid(), name: form.get('name'), teacher: form.get('teacher'), room: form.get('room'), day: form.get('day'), start: form.get('start'), end: form.get('end'), startWeek: form.get('startWeek'), endWeek: form.get('endWeek'), tone: form.get('tone'), note: form.get('note') }));
      if (!candidate) { showToast('请检查课程名称、时间和周次。'); return; }
      if (candidate.endWeek < candidate.startWeek) { showToast('结束周不能早于开始周。'); return; }
      if (overlaps(candidate, course ? course.id : null)) { if (!confirm('这门课与现有课程时间重叠，要继续保存吗？')) return; }
      if (course) state.courses = state.courses.map(item => item.id === course.id ? candidate : item); else state.courses.push(candidate);
      saveState(); closeModal(); weekOffset = 0; renderAll(); showToast(course ? '课程已更新 ✨' : '课程已加入课表 ✨');
    });
    $('[data-close]').addEventListener('click', closeModal);
  }
  function showCourse(id) {
    const course = state.courses.find(item => item.id === id); if (!course) return;
    openModal(course.name, 'A LITTLE CLASS DETAIL', `<div class="class-detail"><div class="detail-banner tone-${escapeHTML(course.tone)}"><h3>${escapeHTML(course.name)}</h3><p>${DAYS[course.day]} · ${courseTime(course)}</p></div>${course.room ? `<div class="detail-line"><span>⌖</span><span>${escapeHTML(course.room)}</span></div>` : ''}${course.teacher ? `<div class="detail-line"><span>♧</span><span>${escapeHTML(course.teacher)}</span></div>` : ''}<div class="detail-line"><span>◷</span><span>第 ${course.startWeek}–${course.endWeek} 周</span></div>${course.note ? `<div class="detail-note">${escapeHTML(course.note)}</div>` : ''}<div class="info-box" style="margin-top:10px">长按这张卡片可以<strong>复制、剪切、删除</strong>，长按后拖动可以<strong>换到别的星期或节次</strong>。</div><div class="form-actions"><button class="primary-button" id="editClass">编辑课程</button><button class="danger-button" id="deleteClass">删除</button><button class="secondary-button" data-close>完成</button></div></div>`);
    $('#editClass').addEventListener('click', () => openCourseForm(course));
    $('#deleteClass').addEventListener('click', () => { if (confirm(`确定删除「${course.name}」吗？`)) { state.courses = state.courses.filter(item => item.id !== id); saveState(); closeModal(); renderAll(); showToast('课程已删除。'); } });
    $('[data-close]').addEventListener('click', closeModal);
  }
  function openSettings() {
    const enabled = !!state.settings.notifications;
    openModal('给自己一点提醒', 'YOUR GENTLE REMINDER', `<div class="settings-list"><div class="info-box"><strong>提醒会在这台设备本地工作。</strong><br>请保持课表页面打开并允许浏览器通知；如果浏览器完全关闭，能否准时提醒由设备和系统决定。iPhone 若安装为主屏幕应用，通知支持仍取决于 iOS 版本、用户授权和应用活动状态。</div><div class="setting-row"><div><strong>上课前提醒</strong><p id="notificationPermission">${enabled ? '当前设备已开启提醒。' : '开启后会请求浏览器的通知权限。'}</p></div><button class="toggle${enabled ? ' on' : ''}" type="button" id="toggleNotifications" role="switch" aria-checked="${enabled}" aria-label="切换课程提醒"></button></div><div class="setting-row"><div><strong>提前多久</strong><p>建议选 5–30 分钟。</p></div><div><input type="number" min="1" max="120" value="${state.settings.reminderMinutes}" id="reminderMinutes" aria-label="提醒提前分钟数"> <span style="font-size:10px;color:#7d8a80">分钟</span></div></div><button class="setting-row" type="button" id="openSemesterRow"><div><strong>学期起始周</strong><p>当前是本学期第 ${weekNumber()} 周，点这里调整起点。</p></div><span style="font-size:14px;color:#8ba18e">›</span></button><div class="info-box">提醒使用课表里设置的上课时间。时区跟随当前设备；建议先添加课程，并用浏览器桌面通知测试。</div><div class="form-actions"><button class="primary-button" id="saveSettings">保存提醒设置</button><button class="secondary-button" data-close>完成</button></div></div>`);
    let draftEnabled = enabled;
    const toggle = $('#toggleNotifications');
    $('#openSemesterRow').addEventListener('click', openSemesterSettings);
    toggle.addEventListener('click', async () => {
      if (!draftEnabled && 'Notification' in window && Notification.permission === 'default') {
        try { const permission = await Notification.requestPermission(); if (permission !== 'granted') { $('#notificationPermission').textContent = '浏览器未授予通知权限；可以在浏览器网站设置中允许。'; showToast('没有通知权限，提醒暂时不会显示。'); return; } }
        catch (error) { $('#notificationPermission').textContent = '此浏览器无法请求通知权限。'; return; }
      } else if (!draftEnabled && !('Notification' in window)) {
        $('#notificationPermission').textContent = '此浏览器不支持通知；仍可设置提醒，但无法发出系统通知。'; showToast('当前浏览器不支持系统通知。'); return;
      } else if (!draftEnabled && Notification.permission === 'denied') {
        $('#notificationPermission').textContent = '通知权限已被浏览器阻止，请到网站设置手动开启。'; showToast('请先在浏览器网站设置中允许通知。'); return;
      }
      draftEnabled = !draftEnabled; toggle.classList.toggle('on', draftEnabled); toggle.setAttribute('aria-checked', String(draftEnabled));
      $('#notificationPermission').textContent = draftEnabled ? '已允许使用此设备的浏览器通知。' : '提醒已关闭。';
    });
    $('#saveSettings').addEventListener('click', () => {
      state.settings.notifications = draftEnabled;
      state.settings.reminderMinutes = Math.min(120, Math.max(1, Number($('#reminderMinutes').value) || 10));
      saveState(); closeModal(); renderAll(); startReminderChecks(); showToast(draftEnabled ? '提醒设置已保存 🌱' : '已保存，提醒已关闭。');
    });
    $('[data-close]').addEventListener('click', closeModal);
  }

  function exportJSON() {
    const payload = { format: 'kejian-timetable', version: 1, exportedAt: new Date().toISOString(), semesterStart: dateKey(semesterStart), courses: state.courses, settings: state.settings };
    downloadFile(`课间-课表-${dateKey(dateNow)}.json`, JSON.stringify(payload, null, 2), 'application/json;charset=utf-8'); showToast('备份文件已导出，发给同学即可。');
  }
  function escapeICS(value) { return String(value || '').replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;'); }
  function localDateTime(date, slot, classEndSlot = slot) { const startMinutes = slotStartMinutes(slot); const endMinutes = slotEndMinutes(classEndSlot); const start = new Date(date), end = new Date(date); start.setHours(Math.floor(startMinutes / 60), startMinutes % 60, 0, 0); end.setHours(Math.floor(endMinutes / 60), endMinutes % 60, 0, 0); return { start, end }; }
  function icsDate(date) { return `${date.getFullYear()}${String(date.getMonth()+1).padStart(2,'0')}${String(date.getDate()).padStart(2,'0')}T${String(date.getHours()).padStart(2,'0')}${String(date.getMinutes()).padStart(2,'0')}00`; }
  function exportICS() {
    if (!state.courses.length) { showToast('先添加課程，再來導出吧。'); return; }
    const events = [];
    for (const course of state.courses) for (let week = course.startWeek; week <= course.endWeek; week++) {
      const day = new Date(semesterStart); day.setDate(day.getDate() + course.day + (week - 1) * 7);
      const { start, end } = localDateTime(day, course.start, course.end);
      events.push(['BEGIN:VEVENT', `UID:${escapeICS(course.id)}-${week}@kejian.local`, `DTSTAMP:${icsDate(new Date())}Z`, `DTSTART;TZID=Asia/Shanghai:${icsDate(start)}`, `DTEND;TZID=Asia/Shanghai:${icsDate(end)}`, `SUMMARY:${escapeICS(course.name)}`, course.room ? `LOCATION:${escapeICS(course.room)}` : '', course.teacher ? `DESCRIPTION:${escapeICS(`老师：${course.teacher}${course.note ? `\\n${course.note}` : ''}`)}` : course.note ? `DESCRIPTION:${escapeICS(course.note)}` : '', 'END:VEVENT'].filter(Boolean).join('\r\n'));
    }
    const ics = ['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Kejian//Personal Timetable 1.0//ZH','CALSCALE:GREGORIAN', ...events, 'END:VCALENDAR'].join('\r\n');
    downloadFile(`课间-课表-${dateKey(dateNow)}.ics`, '\ufeff' + ics, 'text/calendar;charset=utf-8'); showToast('日历文件已导出，可以发给同学或导入日历。');
  }
  function downloadFile(filename, content, type) {
    const url = URL.createObjectURL(new Blob([content], { type })), link = document.createElement('a');
    link.href = url; link.download = filename; document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function chooseImport() { $('#importFile').click(); }
  function parseICSDate(value) {
    const match = String(value || '').match(/(\d{4})(\d{2})(\d{2})T?(\d{2})?(\d{2})?/); if (!match) return null;
    return { year: Number(match[1]), month: Number(match[2]) - 1, day: Number(match[3]), hour: Number(match[4] || 8), minute: Number(match[5] || 0) };
  }
  function weekdayIndex(dateParts) { return mondayIndex(new Date(dateParts.year, dateParts.month, dateParts.day)); }
  function unescapeICS(value = '') {
    let text = value.replace(/\\[nN]/g, '\n').replace(/\\,/g, ',').replace(/\\;/g, ';').replace(/\\\\/g, '\\');
    return text;
  }
  function parseICS(text) {
    const normalized = text.replace(/\r?\n[ \t]/g, '').split(/\r?\n/); let event = null; const courses = [];
    for (const line of normalized) {
      if (line === 'BEGIN:VEVENT') { event = {}; continue; }
      if (line === 'END:VEVENT') {
        if (event) {
          const start = parseICSDate(event.DTSTART), end = parseICSDate(event.DTEND), title = unescapeICS(event.SUMMARY || '');
          if (start && end && title) {
            const startDate = new Date(start.year, start.month, start.day);
            const day = weekdayIndex(start), weekGap = Math.round((mondayOf(startDate).getTime() - semesterStart.getTime()) / 604800000);
            const startMinutes = start.hour * 60 + start.minute;
            const endMinutes = end.hour * 60 + end.minute;
            const startSlot = findSlotByMinutes(startMinutes);
            const endSlot = findSlotByMinutes(Math.max(startMinutes, endMinutes - 1));
            const durationSlots = Math.max(1, endSlot - startSlot + 1);
            const room = unescapeICS(event.LOCATION || '');
            const description = unescapeICS(event.DESCRIPTION || '');
            const limit = MAX_SLOTS - 1;
            courses.push(cleanCourse({ name: title, day, start: Math.max(0, Math.min(limit, startSlot)), end: Math.max(0, Math.min(limit, startSlot + durationSlots - 1)), room, note: description, startWeek: Math.max(1, weekGap + 1), endWeek: Math.max(1, weekGap + 1), tone: TONES[courses.length % TONES.length] }));
          }
        }
        event = null; continue;
      }
      if (event) {
        const colon = line.indexOf(':'); if (colon < 0) continue;
        const key = line.slice(0, colon).split(';')[0].toUpperCase(); if (['DTSTART','DTEND','SUMMARY','LOCATION','DESCRIPTION'].includes(key)) event[key] = line.slice(colon + 1);
      }
    }
    return courses.filter(Boolean);
  }
  function importPayload(text, filename) {
    let courses;
    if (/\.ics$|\.ical$/i.test(filename) || text.includes('BEGIN:VCALENDAR')) courses = parseICS(text);
    else {
      const data = JSON.parse(text); const list = Array.isArray(data) ? data : data.courses;
      if (!Array.isArray(list)) throw new Error('未找到课表数据；请选择课间 JSON 备份或 ICS 日历文件。');
      if (!Array.isArray(data) && data.semesterStart) { const importedStart = new Date(`${data.semesterStart}T00:00:00`); if (!Number.isNaN(importedStart.getTime())) { semesterStart = mondayOf(importedStart); try { localStorage.setItem(SEMESTER_START_KEY, dateKey(semesterStart)); } catch (error) { /* optional persistence */ } } }
      courses = list.map(cleanCourse).filter(Boolean);
    }
    if (!courses.length) throw new Error('文件中没有识别到课程，或课表格式不兼容。');
    const unique = new Map(state.courses.map(course => [`${course.name}|${course.day}|${course.start}|${course.end}|${course.startWeek}|${course.endWeek}`, course]));
    let added = 0, skipped = 0;
    for (const course of courses) {
      const key = `${course.name}|${course.day}|${course.start}|${course.end}|${course.startWeek}|${course.endWeek}`;
      if (unique.has(key)) { skipped++; continue; } const imported = Object.assign({}, course, { id: uid() }); unique.set(key, imported); added++;
    }
    state.courses = [...unique.values()]; saveState(); closeModal(); renderAll(); showToast(`导入 ${added} 门课程${skipped ? `，跳过重复 ${skipped} 门` : ''}。`);
  }
  function importFile(file) {
    const reader = new FileReader();
    reader.onerror = () => showToast('文件读取失败，请重新选择。');
    reader.onload = () => { try { importPayload(String(reader.result), file.name); } catch (error) { showToast(error.message || '文件导入失败。'); } };
    reader.readAsText(file, 'UTF-8');
  }
  function openImportInfo() {
    openModal('从哪里找课表文件？', 'BRING YOUR CLASSES', `<div class="import-options"><button class="import-option" id="pickImport"><strong>我已有课表文件 · 现在选择</strong><span>支持本应用 JSON 备份，以及大多数日历 ICS 文件。选中后会先检查格式并合并课程。</span></button><div class="info-box"><strong>ICA 学校系统小提示</strong><br>先在登录后的课表页找“导出 / 下载 / 添加到日历 / iCalendar / .ics / Excel / CSV”，或使用打印功能保存为 PDF。若 ICA 能提供 .ics，选择上面的日历文件即可尝试导入。<br><br>学校若只提供 PDF、截图或无法导出的页面，目前请手动添加并核对；这里还没有实现 PDF/截图识别，也不会读取你的 ICA 登录信息。</div><div class="info-box">JSON 备份适合课间 ↔ 课间传递；ICS 适合课间 ↔ 日历或其他应用。发送课表文件前，请检查里面是否含有不想分享的课程、教室或备注。</div></div><div class="form-actions"><button class="secondary-button" data-close>返回课表</button></div>`);
    $('#pickImport').addEventListener('click', chooseImport); $('[data-close]').addEventListener('click', closeModal);
  }
  function openExportOptions() {
    openModal('把课表打包带走', 'EXPORT & SHARE', `<div class="import-options"><button class="import-option" id="exportJson"><strong>导出课间备份 · JSON</strong><span>保留课程与周次，方便对方导入课间或用于备份。建议把这个文件发给同学。</span></button><button class="import-option" id="exportICS"><strong>导出日历文件 · ICS</strong><span>适合发给同学或导入手机/电脑日历。它会按课程周次生成日历事件。</span></button><div class="info-box"><strong>分享是通过文件发送。</strong>课表不会上传到服务器，也不会自动同步；接收方导入自己的副本后，与你的课表互不联动。导出文件可能含课程、教师和教室信息，分享前请检查。</div></div><div class="form-actions"><button class="secondary-button" data-close>取消</button></div>`);
    $('#exportJson').addEventListener('click', exportJSON); $('#exportICS').addEventListener('click', exportICS); $('[data-close]').addEventListener('click', closeModal);
  }
  function openSemesterSettings() {
    const today = dateKey(semesterStart);
    openModal('学期起始周', 'SEMESTER SETUP', `<div class="import-options"><div class="info-box"><strong>教学第 1 周从哪一周开始？</strong><br>课表的“第几周”按这个日期计算（会自动对齐到该周周一）。学期已经开学时，把它设为开学第一周的任意一天即可。</div><div class="setting-row"><div><strong>第 1 周的周一日期</strong><p>当前：${today}（现在是本学期第 ${weekNumber()} 周）</p></div><input type="date" id="semesterStartInput" value="${today}" aria-label="学期第 1 周的日期"></div><div class="info-box">修改后课程的显示周次会立即按新起点重算；课程自身的周次区间（如第 3–16 周）不变。ICS 导入导出都使用这个起点。</div></div><div class="form-actions"><button class="primary-button" id="saveSemesterStart">保存</button><button class="secondary-button" data-close>取消</button></div>`);
    $('#saveSemesterStart').addEventListener('click', () => {
      const value = $('#semesterStartInput').value;
      const parsed = value ? new Date(`${value}T00:00:00`) : null;
      if (!parsed || Number.isNaN(parsed.getTime())) { showToast('请选择一个有效日期。'); return; }
      semesterStart = mondayOf(parsed); saveState(); closeModal(); renderAll(); startReminderChecks(); showToast(`学期起点已更新，当前是第 ${weekNumber()} 周。`);
    });
    $('[data-close]').addEventListener('click', closeModal);
  }
  function startReminderChecks() {
    clearInterval(reminderTicker); if (!state.settings.notifications || !('Notification' in window) || Notification.permission !== 'granted') return;
    const sent = new Set();
    const check = () => {
      const now = new Date(), index = mondayIndex(now), currentWeek = Math.max(1, Math.round((mondayOf(now).getTime() - semesterStart.getTime()) / 604800000) + 1), nowMinutes = now.getHours() * 60 + now.getMinutes();
      for (const course of state.courses) {
        if (course.day !== index || currentWeek < course.startWeek || currentWeek > course.endWeek) continue;
        const key = `${dateKey(now)}-${course.id}`; if (sent.has(key)) continue;
        const startMinutes = slotStartMinutes(course.start), remindAt = startMinutes - state.settings.reminderMinutes;
        if (nowMinutes >= remindAt && nowMinutes < startMinutes && document.visibilityState !== 'hidden') {
          new Notification(`快上课啦 · ${course.name}`, { body: `${course.room ? `${course.room} · ` : ''}${slotStart(course.start)} 开始，提前 ${state.settings.reminderMinutes} 分钟出发吧。`, tag: key }); sent.add(key);
        }
      }
      for (const value of [...sent]) if (!value.startsWith(dateKey(now))) sent.delete(value);
    };
    check(); reminderTicker = setInterval(check, 20000);
  }
  /* ---------- 图片识别导入 ---------- */
  const AI_CONFIG_KEY = 'kejian.ai.v1';
  const OCR = (typeof window !== 'undefined' && window.KejianRecognize) ? window.KejianRecognize : null;
  let ocrSession = null;
  function readAiConfig() {
    try {
      const raw = localStorage.getItem(AI_CONFIG_KEY);
      if (raw) return Object.assign({ provider: 'zhipu', key: '', url: '', model: '' }, JSON.parse(raw));
    } catch (error) { /* 读取失败就当作没配置 */ }
    return { provider: 'zhipu', key: '', url: '', model: '' };
  }
  function writeAiConfig(config) { try { localStorage.setItem(AI_CONFIG_KEY, JSON.stringify(config)); } catch (error) { /* 存储不可用 */ } }
  function resolvedAiConfig() {
    const config = readAiConfig();
    const providers = (OCR && OCR.AI_PROVIDERS) || {};
    const preset = providers[config.provider] || providers.zhipu || { url: '', model: '', label: 'AI' };
    return {
      provider: config.provider, key: String(config.key || '').trim(), label: preset.label || 'AI',
      url: config.provider === 'custom' ? String(config.url || '').trim() : preset.url,
      model: String(config.model || '').trim() || preset.model
    };
  }
  function openImageImport() {
    if (!OCR) { openModal('图片识别暂不可用', 'IMAGE IMPORT', '<div class="info-box">识别模块没有加载成功，请刷新页面后重试。你也可以继续用「从文件导入」。</div><div class="form-actions"><button class="secondary-button" data-close>知道了</button></div>'); $('[data-close]').addEventListener('click', closeModal); return; }
    ocrSession = { image: null, canvas: null, crop: null, engine: 'local', busy: false, courses: [], warnings: [], fileName: '' };
    openModal('图片识别导入', 'READ YOUR TIMETABLE', ocrStageHtml());
    $('[data-close]').addEventListener('click', closeModal);
    $('#ocrPick').addEventListener('click', () => $('#imageFile').click());
    bindEngineChoice();
  }
  function ocrStageHtml() {
    const ai = resolvedAiConfig();
    const aiReady = !!(ai.key && ai.url);
    return '<div class="info-box">传一张课表截图，自动读出课程。识别结果会先进下面的预览表，<strong>你确认后才写入课表</strong>，不会直接改动现有数据。</div>' +
      '<div class="ocr-stage">' +
        '<button class="ocr-dropzone" type="button" id="ocrPick"><strong>选择课表截图</strong><small>支持手机相册或电脑里的图片<br>截图识别效果最好，拍照请尽量正对课表</small></button>' +
        '<div id="ocrViewportBox"></div>' +
      '</div>' +
      '<div class="ocr-engine" id="ocrEngine">' +
        '<label class="on"><input type="radio" name="ocrEngine" value="local" checked><span><strong>离线识别</strong><small>免费，图片不离开这台设备；准确率一般，需要你核对</small></span></label>' +
        '<label><input type="radio" name="ocrEngine" value="ai"><span><strong>AI 识别</strong><small>' + (aiReady ? '已配置 Key，准确率更高' : '需要先填 API Key，图片会上传') + '</small></span></label>' +
      '</div>' +
      '<div id="ocrAiPanel"></div>' +
      '<div id="ocrProgress"></div>' +
      '<div id="ocrResults"></div>';
  }
  function bindEngineChoice() {
    const group = $('#ocrEngine');
    if (!group) return;
    group.querySelectorAll('input[name=ocrEngine]').forEach(input => input.addEventListener('change', () => {
      ocrSession.engine = input.value;
      group.querySelectorAll('label').forEach(label => label.classList.toggle('on', label.contains(input) && input.checked));
      if (input.checked) renderAiPanel(input.value === 'ai');
    }));
  }
  function renderAiPanel(show) {
    const panel = $('#ocrAiPanel');
    if (!panel) return;
    if (!show) { panel.innerHTML = ''; return; }
    const config = readAiConfig();
    const providers = OCR.AI_PROVIDERS;
    const options = Object.keys(providers).map(key => '<option value="' + key + '"' + (key === config.provider ? ' selected' : '') + '>' + escapeHTML(providers[key].label) + '</option>').join('');
    const preset = providers[config.provider] || providers.zhipu;
    panel.innerHTML = '<div class="install-warn">开启 AI 识别后，<strong>这张图片会通过你填写的接口上传给对应服务商</strong>。Key 只保存在这台设备的浏览器里，不会发给别人。介意图片外传就请用离线识别。</div>' +
      '<div class="ai-field"><label for="aiProvider">服务商</label><select id="aiProvider">' + options + '</select></div>' +
      '<div class="ai-field"><label for="aiKey">API Key</label><input id="aiKey" type="password" autocomplete="off" placeholder="粘贴你的 Key" value="' + escapeHTML(config.key || '') + '"></div>' +
      '<div class="ai-field"><label for="aiUrl">接口地址</label><input id="aiUrl" type="url" autocomplete="off" placeholder="' + escapeHTML(preset.url) + '" value="' + escapeHTML(config.url || '') + '"></div>' +
      '<div class="ai-field"><label for="aiModel">模型</label><input id="aiModel" autocomplete="off" placeholder="' + escapeHTML(preset.model) + '" value="' + escapeHTML(config.model || '') + '"></div>' +
      '<div class="form-actions"><button class="btn-ghost" type="button" id="saveAi">保存 Key</button></div>';
    $('#aiProvider').addEventListener('change', event => {
      const next = Object.assign(readAiConfig(), { provider: event.target.value, model: '' });
      writeAiConfig(next);
      renderAiPanel(true);
    });
    $('#saveAi').addEventListener('click', () => {
      writeAiConfig({ provider: $('#aiProvider').value, key: $('#aiKey').value.trim(), url: $('#aiUrl').value.trim(), model: $('#aiModel').value.trim() });
      showToast('AI 配置已保存在这台设备上。');
    });
  }
  function loadImageFile(file) {
    if (!file) return;
    if (!/^image\//.test(file.type)) { showToast('请选择图片文件。'); return; }
    const reader = new FileReader();
    reader.onload = () => {
      const image = new Image();
      image.onload = () => {
        ocrSession.image = image;
        ocrSession.fileName = file.name || '';
        ocrSession.crop = { x: 0, y: 0, w: image.naturalWidth, h: image.naturalHeight };
        renderOcrViewport();
        $('#ocrResults').innerHTML = '';
        $('#ocrProgress').innerHTML = '';
      };
      image.onerror = () => showToast('这张图片打不开，换一张试试。');
      image.src = reader.result;
    };
    reader.onerror = () => showToast('读取图片失败。');
    reader.readAsDataURL(file);
  }
  function renderOcrViewport() {
    const box = $('#ocrViewportBox');
    const image = ocrSession.image;
    if (!box || !image) return;
    const maxW = 900;
    const scale = Math.min(1, maxW / image.naturalWidth);
    const displayW = Math.round(image.naturalWidth * scale);
    const displayH = Math.round(image.naturalHeight * scale);
    box.innerHTML = '<div class="ocr-viewport" id="ocrViewport" style="max-width:' + displayW + 'px">' +
      '<canvas id="ocrCanvas" width="' + displayW + '" height="' + displayH + '"></canvas>' +
      '<div class="ocr-shade" id="shadeTop"></div><div class="ocr-shade" id="shadeBottom"></div>' +
      '<div class="ocr-shade" id="shadeLeft"></div><div class="ocr-shade" id="shadeRight"></div>' +
      '<div class="ocr-marquee" id="ocrMarquee"></div></div>' +
      '<div class="ocr-hint" id="ocrHint">在图上按住拖动，框住课表区域（去掉标题栏和按钮能明显提高准确率）；不框就是整张图。</div>' +
      '<div class="ocr-actions"><button class="btn-ghost" type="button" id="ocrReset">整张图</button><button class="btn-primary" type="button" id="ocrRun">开始识别</button></div>';
    const canvas = $('#ocrCanvas');
    canvas.getContext('2d').drawImage(image, 0, 0, displayW, displayH);
    ocrSession.view = { scale: scale, width: displayW, height: displayH };
    if (!ocrSession.crop) ocrSession.crop = { x: 0, y: 0, w: image.naturalWidth, h: image.naturalHeight };
    paintCrop();
    bindCropDrag();
    $('#ocrReset').addEventListener('click', () => { ocrSession.crop = { x: 0, y: 0, w: image.naturalWidth, h: image.naturalHeight }; paintCrop(); });
    $('#ocrRun').addEventListener('click', runOcrRecognition);
  }
  function paintCrop() {
    const view = ocrSession.view, crop = ocrSession.crop;
    if (!view || !crop) return;
    const scale = view.scale;
    const left = crop.x * scale, top = crop.y * scale;
    const width = crop.w * scale, height = crop.h * scale;
    const marquee = $('#ocrMarquee');
    if (!marquee) return;
    marquee.style.left = left + 'px'; marquee.style.top = top + 'px';
    marquee.style.width = width + 'px'; marquee.style.height = height + 'px';
    const full = crop.x <= 1 && crop.y <= 1 && crop.w >= ocrSession.image.naturalWidth - 1 && crop.h >= ocrSession.image.naturalHeight - 1;
    marquee.style.opacity = full ? '0' : '1';
    const set = (id, styles) => { const node = $('#' + id); if (!node) return; Object.assign(node.style, styles); };
    const vw = view.width, vh = view.height;
    set('shadeTop', { left: '0px', top: '0px', width: vw + 'px', height: Math.max(0, top) + 'px' });
    set('shadeBottom', { left: '0px', top: (top + height) + 'px', width: vw + 'px', height: Math.max(0, vh - top - height) + 'px' });
    set('shadeLeft', { left: '0px', top: top + 'px', width: Math.max(0, left) + 'px', height: height + 'px' });
    set('shadeRight', { left: (left + width) + 'px', top: top + 'px', width: Math.max(0, vw - left - width) + 'px', height: height + 'px' });
  }
  function bindCropDrag() {
    const viewport = $('#ocrViewport');
    if (!viewport) return;
    // 重新渲染视口前先摘掉上一次挂在 window 上的监听，避免反复选图时累积泄漏
    if (ocrSession.cleanupDrag) { ocrSession.cleanupDrag(); ocrSession.cleanupDrag = null; }
    let dragging = false, startX = 0, startY = 0;
    const pointToImage = event => {
      const rect = viewport.getBoundingClientRect();
      const x = (event.clientX - rect.left) / (rect.width / ocrSession.image.naturalWidth);
      const y = (event.clientY - rect.top) / (rect.height / ocrSession.image.naturalHeight);
      return { x: Math.max(0, Math.min(ocrSession.image.naturalWidth, x)), y: Math.max(0, Math.min(ocrSession.image.naturalHeight, y)) };
    };
    const onDown = event => {
      if (ocrSession.busy) return;
      dragging = true;
      const point = pointToImage(event);
      startX = point.x; startY = point.y;
      ocrSession.crop = { x: startX, y: startY, w: 1, h: 1 };
      event.preventDefault();
    };
    const onMove = event => {
      if (!dragging) return;
      const point = pointToImage(event);
      ocrSession.crop = { x: Math.min(startX, point.x), y: Math.min(startY, point.y), w: Math.abs(point.x - startX), h: Math.abs(point.y - startY) };
      paintCrop();
      event.preventDefault();
    };
    const onUp = () => {
      if (!dragging) return;
      dragging = false;
      const crop = ocrSession.crop;
      if (crop.w < 24 || crop.h < 24) { ocrSession.crop = { x: 0, y: 0, w: ocrSession.image.naturalWidth, h: ocrSession.image.naturalHeight }; showToast('框选太小了，已恢复为整张图。'); }
      paintCrop();
    };
    viewport.addEventListener('mousedown', onDown);
    viewport.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    viewport.addEventListener('touchstart', onDown, { passive: false });
    viewport.addEventListener('touchmove', onMove, { passive: false });
    viewport.addEventListener('touchend', onUp);
    ocrSession.cleanupDrag = () => { window.removeEventListener('mouseup', onUp); };
  }
  function setOcrProgress(message, tone) {
    const node = $('#ocrProgress');
    if (!node) return;
    if (!message) { node.innerHTML = ''; return; }
    node.innerHTML = '<div class="ocr-' + (tone === 'error' ? 'progress ocr-error' : 'progress') + '">' + escapeHTML(message) + '</div>';
  }
  async function runOcrRecognition() {
    if (ocrSession.busy || !ocrSession.image) return;
    const engine = ocrSession.engine;
    const aiConfig = resolvedAiConfig();
    if (engine === 'ai' && (!aiConfig.key || !aiConfig.url)) { showToast('请先填写并保存 API Key。'); renderAiPanel(true); return; }
    ocrSession.busy = true;
    const runButton = $('#ocrRun');
    if (runButton) { runButton.disabled = true; runButton.textContent = '识别中…'; }
    $('#ocrResults').innerHTML = '';
    try {
      const canvas = OCR.drawToCanvas(ocrSession.image, ocrSession.crop);
      setOcrProgress(engine === 'ai' ? '正在准备图片…' : '正在准备识别引擎，第一次使用需要下载约 2MB…');
      if (engine === 'ai') {
        const courses = await OCR.recognizeByAI(canvas, aiConfig, message => setOcrProgress(message));
        ocrSession.courses = courses;
        ocrSession.warnings = ['AI 识别结果，请核对后再导入。'];
      } else {
        const engineInfo = await OCR.loadEngine(message => setOcrProgress(message));
        setOcrProgress('正在识字，课表越清晰越快…');
        const recognized = await OCR.recognizeCanvas(canvas, message => setOcrProgress(message));
        const rows = OCR.groupWords(recognized.words);
        const built = OCR.buildCourses(rows, {});
        ocrSession.courses = built.courses;
        ocrSession.warnings = built.warnings || [];
        if (!built.courses.length && recognized.text) ocrSession.warnings.push('识别到的文字：' + String(recognized.text).replace(/\s+/g, ' ').slice(0, 120));
        if (engineInfo && engineInfo.lang) ocrSession.engineLabel = engineInfo.lang;
      }
      setOcrProgress('');
      renderOcrResults();
    } catch (error) {
      setOcrProgress('');
      const message = (error && error.message) ? error.message : '识别失败，请重试。';
      openModal('识别没有成功', 'OOPS', '<div class="install-warn">' + escapeHTML(message) + '</div><div class="info-box">可以试试：把识别区域框得更紧（只框课表本身）、换张更清晰的截图，或者改用另一种识别方式。</div><div class="form-actions"><button class="btn-primary" data-close>好</button></div>');
      $('[data-close]').addEventListener('click', closeModal);
    } finally {
      ocrSession.busy = false;
      if (runButton) { runButton.disabled = false; runButton.textContent = '重新识别'; }
    }
  }
  function renderOcrResults() {
    const box = $('#ocrResults');
    if (!box) return;
    const courses = ocrSession.courses || [];
    if (!courses.length) {
      box.innerHTML = '<div class="install-warn">没有读出课程。' + (ocrSession.warnings.length ? escapeHTML(ocrSession.warnings.join(' ')) : '') + '</div>';
      return;
    }
    const dayOptions = (selected) => DAYS.map((day, i) => '<option value="' + i + '"' + (i === selected ? ' selected' : '') + '>' + day + '</option>').join('');
    const slotOptions = (selected) => slotTable().map((item, i) => '<option value="' + i + '"' + (i === selected ? ' selected' : '') + '>第 ' + (i + 1) + ' 节</option>').join('');
    const rows = courses.map((course, index) =>
      '<tr data-row="' + index + '">' +
      '<td><input type="checkbox" data-check="' + index + '" checked aria-label="选择这一行"></td>' +
      '<td><input type="text" data-field="name" value="' + escapeHTML(course.name) + '" aria-label="课程名"></td>' +
      '<td><input type="text" data-field="teacher" value="' + escapeHTML(course.teacher || '') + '" aria-label="老师"></td>' +
      '<td><input type="text" data-field="room" value="' + escapeHTML(course.room || '') + '" aria-label="教室"></td>' +
      '<td><select data-field="day" aria-label="星期">' + dayOptions(course.day) + '</select></td>' +
      '<td><select data-field="start" aria-label="开始节次">' + slotOptions(course.start) + '</select></td>' +
      '<td><select data-field="end" aria-label="结束节次">' + slotOptions(course.end) + '</select></td>' +
      '<td><button class="ocr-row-remove" type="button" data-remove="' + index + '" aria-label="删除这一行">×</button></td>' +
      '</tr>').join('');
    const warn = ocrSession.warnings && ocrSession.warnings.length ? '<div class="install-warn">' + escapeHTML(ocrSession.warnings.join(' ')) + '</div>' : '';
    box.innerHTML = warn +
      '<div class="ocr-table-wrap"><table class="ocr-table"><thead><tr><th></th><th>课程名</th><th>老师</th><th>教室</th><th>星期</th><th>开始</th><th>结束</th><th></th></tr></thead><tbody>' + rows + '</tbody></table></div>' +
      '<div class="ocr-summary" id="ocrSummary"></div>' +
      '<div class="ocr-actions"><button class="btn-ghost" type="button" id="ocrAll">全选 / 全不选</button><button class="btn-primary" type="button" id="ocrImport">导入选中的课程</button></div>';
    const collect = () => {
      const picked = [];
      box.querySelectorAll('tbody tr').forEach(row => {
        const index = Number(row.getAttribute('data-row'));
        const course = ocrSession.courses[index];
        if (!course) return;
        const checked = row.querySelector('[data-check]').checked;
        const value = field => { const node = row.querySelector('[data-field=' + field + ']'); return node ? node.value.trim() : ''; };
        picked.push({
          index: index, checked: checked, name: value('name'), teacher: value('teacher'), room: value('room'),
          day: Number(value('day')), start: Number(value('start')), end: Number(value('end'))
        });
      });
      return picked;
    };
    const updateSummary = () => {
      const picked = collect();
      const valid = picked.filter(item => item.checked && item.name);
      let conflict = 0;
      valid.forEach(item => { if (item.end < item.start) conflict++; });
      $('#ocrSummary').textContent = '共 ' + picked.length + ' 行，已勾选 ' + valid.length + ' 行' + (conflict ? '；有 ' + conflict + ' 行的结束节次早于开始节次，导入时会自动对调。' : '。识别可能有错，导入前请核对课程名。');
    };
    updateSummary();
    box.addEventListener('change', updateSummary);
    box.addEventListener('input', updateSummary);
    box.querySelectorAll('[data-remove]').forEach(button => button.addEventListener('click', () => {
      const index = Number(button.getAttribute('data-remove'));
      ocrSession.courses.splice(index, 1);
      renderOcrResults();
    }));
    document.querySelectorAll('#ocrAll').forEach(button => button.addEventListener('click', () => {
      const boxes = box.querySelectorAll('[data-check]');
      const allOn = Array.prototype.every.call(boxes, node => node.checked);
      Array.prototype.forEach.call(boxes, node => { node.checked = !allOn; });
      updateSummary();
    }));
    $('#ocrImport').addEventListener('click', () => importOcrRows(collect()));
  }
  function importOcrRows(picked) {
    const valid = picked.filter(item => item.checked && item.name);
    if (!valid.length) { showToast('没有勾选任何课程。'); return; }
    const existing = state.courses;
    const defaultWeeks = { startWeek: 1, endWeek: 20 };
    if (existing.length) {
      defaultWeeks.startWeek = Math.min.apply(null, existing.map(course => course.startWeek));
      defaultWeeks.endWeek = Math.max.apply(null, existing.map(course => course.endWeek));
    }
    const added = [];
    let skipped = 0, fixed = 0;
    valid.forEach(item => {
      const limit = slotCount() - 1;
      const start = Math.max(0, Math.min(limit, item.start));
      let end = Math.max(0, Math.min(limit, item.end));
      if (end < start) { end = start; fixed++; }
      const duplicate = existing.concat(added).some(course => course.day === item.day && course.start === start && course.name === item.name);
      if (duplicate) { skipped++; return; }
      const candidate = cleanCourse({
        id: uid(), name: item.name, teacher: item.teacher, room: item.room, day: item.day, start: start, end: end,
        startWeek: defaultWeeks.startWeek, endWeek: defaultWeeks.endWeek,
        tone: TONES[(existing.length + added.length) % TONES.length], note: ''
      });
      if (candidate) added.push(candidate); else skipped++;
    });
    if (!added.length) { showToast(skipped ? '这些课程都已经在课表里了。' : '没有可导入的课程，请检查课程名。'); return; }
    state.courses = existing.concat(added);
    saveState();
    closeModal();
    weekOffset = 0;
    renderAll();
    let message = '已导入 ' + added.length + ' 门课 ✨';
    if (skipped) message += '，跳过重复 ' + skipped + ' 门';
    if (fixed) message += '（' + fixed + ' 行节次已修正）';
    showToast(message);
  }
  /* ---------- 课程复制 / 剪切 / 拖动移动 ---------- */
  const CLIPBOARD_KEY = 'kejian.clipboard.v1';
  const LONG_PRESS_MS = 450;
  const DRAG_SLOP = 8;
  let clipboard = readClipboard();
  let dragState = null;
  let gestureSuppressUntil = 0;
  function readClipboard() {
    try {
      const raw = localStorage.getItem(CLIPBOARD_KEY);
      if (raw) { const parsed = JSON.parse(raw); if (parsed && parsed.course && parsed.course.name) return parsed; }
    } catch (error) { /* 读取失败就当作空剪贴板 */ }
    return null;
  }
  function writeClipboard(value) {
    clipboard = value;
    try { if (value) localStorage.setItem(CLIPBOARD_KEY, JSON.stringify(value)); else localStorage.removeItem(CLIPBOARD_KEY); } catch (error) { /* 存储不可用 */ }
  }
  function gestureSuppressed() { return Date.now() < gestureSuppressUntil; }
  function suppressGestures(ms) { gestureSuppressUntil = Date.now() + (ms || 500); }
  function vibrate(ms) { try { if (navigator.vibrate) navigator.vibrate(ms); } catch (error) { /* 忽略 */ } }

  // 指针坐标 → 目标格子（纯函数，便于测试）
  function resolveDropTarget(clientX, clientY, columns, slotHeight, slotCount) {
    if (!columns || !columns.length) return null;
    let column = null;
    for (let i = 0; i < columns.length; i++) {
      if (clientX >= columns[i].left && clientX < columns[i].right) { column = columns[i]; break; }
    }
    if (!column) {
      let best = columns[0], bestDistance = Infinity;
      columns.forEach(item => {
        const distance = Math.abs((item.left + item.right) / 2 - clientX);
        if (distance < bestDistance) { bestDistance = distance; best = item; }
      });
      column = best;
    }
    const raw = Math.floor((clientY - column.top) / Math.max(1, slotHeight));
    return { day: column.day, start: Math.max(0, Math.min(slotCount - 1, raw)) };
  }
  // 移动：保持课程时长；接近底部时自动上移，保证整块留在课表内
  function applyMove(course, day, start, slotCount) {
    const span = Math.max(1, course.end - course.start + 1);
    const limit = Math.max(0, slotCount - span);
    const target = Math.max(0, Math.min(limit, start));
    return Object.assign({}, course, { day: day, start: target, end: target + span - 1 });
  }
  // 复制 / 粘贴：生成一门新课（新 id），时长保持，周次用指定范围
  function buildPlaced(course, day, start, startWeek, endWeek, slotCount) {
    const span = Math.max(1, course.end - course.start + 1);
    const limit = Math.max(0, slotCount - span);
    const target = Math.max(0, Math.min(limit, start));
    let from = Math.max(1, Math.min(100, Math.round(Number(startWeek) || 1)));
    let to = Math.max(1, Math.min(100, Math.round(Number(endWeek) || from)));
    if (to < from) { const swap = from; from = to; to = swap; }
    return cleanCourse(Object.assign({}, course, {
      id: uid(), day: day, start: target, end: target + span - 1, startWeek: from, endWeek: to
    }));
  }
  function columnGeometry() {
    const board = $('#weekGrid');
    const columns = [];
    if (!board || !board.querySelectorAll) return columns;
    const nodes = board.querySelectorAll('[data-daycol]');
    Array.prototype.forEach.call(nodes, node => {
      if (!node.getBoundingClientRect) return;
      const rect = node.getBoundingClientRect();
      columns.push({ day: Number(node.getAttribute('data-daycol')), left: rect.left, right: rect.right, top: rect.top });
    });
    return columns;
  }
  function cutCourse(course) {
    writeClipboard({ mode: 'cut', course: Object.assign({}, course) });
    state.courses = state.courses.filter(item => item.id !== course.id);
    saveState(); closeModal(); renderAll();
    showToast('已剪切「' + course.name + '」，长按空格子粘贴。');
  }
  function copyCourse(course) {
    writeClipboard({ mode: 'copy', course: Object.assign({}, course) });
    closeModal();
    showToast('已复制「' + course.name + '」，长按空格子就能粘贴。');
  }
  function deleteCourse(course) {
    state.courses = state.courses.filter(item => item.id !== course.id);
    saveState(); closeModal(); renderAll();
    showToast('课程已删除。');
  }
  function openCourseActions(course) {
    openModal(course.name, 'COURSE ACTIONS', '<div class="sheet-actions">' +
      '<button class="sheet-action" type="button" id="actCopyTo"><span>⧉</span><div><strong>复制到指定位置</strong><small>选星期、节次和教学周</small></div></button>' +
      '<button class="sheet-action" type="button" id="actCopy"><span>❐</span><div><strong>复制</strong><small>放进剪贴板，之后长按空格子粘贴</small></div></button>' +
      '<button class="sheet-action" type="button" id="actCut"><span>✂</span><div><strong>剪切</strong><small>从课表移走，粘贴到别处</small></div></button>' +
      '<button class="sheet-action danger" type="button" id="actDelete"><span>✕</span><div><strong>删除</strong><small>从课表里去掉这门课</small></div></button>' +
      '<button class="sheet-action" type="button" data-close><span>↩</span><div><strong>取消</strong></div></button>' +
      '<div class="info-box" style="margin-top:10px">也可以<strong>长按并拖动</strong>卡片，直接拖到别的星期或节次。</div>' +
      '</div>');
    $('#actCopyTo').addEventListener('click', () => openPlacementDialog(course, 'copyto'));
    $('#actCopy').addEventListener('click', () => copyCourse(course));
    $('#actCut').addEventListener('click', () => cutCourse(course));
    $('#actDelete').addEventListener('click', () => { if (confirm('确定删除「' + course.name + '」吗？')) deleteCourse(course); });
    $('[data-close]').addEventListener('click', closeModal);
  }
  function openSlotActions(day, start) {
    const paste = clipboard ? '<button class="sheet-action" type="button" id="slotPaste"><span>❐</span><div><strong>粘贴到这里</strong><small>' + escapeHTML(clipboard.course.name) + ' · ' + DAYS[day] + '第 ' + (start + 1) + ' 节</small></div></button>' : '';
    const pasteWeeks = clipboard ? '<button class="sheet-action" type="button" id="slotPasteWeeks"><span>⧉</span><div><strong>粘贴并指定周次…</strong><small>选教学周范围再放进来</small></div></button>' : '';
    openModal(DAYS[day] + ' · 第 ' + (start + 1) + ' 节', 'THIS SLOT', '<div class="sheet-actions">' +
      '<button class="sheet-action" type="button" id="slotAddClass"><span>＋</span><div><strong>在这里添加课程</strong><small>' + slotStart(start) + ' 开始</small></div></button>' +
      paste + pasteWeeks +
      '<button class="sheet-action" type="button" data-close><span>↩</span><div><strong>取消</strong></div></button></div>');
    $('#slotAddClass').addEventListener('click', () => { closeModal(); openCourseForm(null, { day: day, start: start }); });
    if (clipboard) {
      $('#slotPaste').addEventListener('click', () => pasteAt(day, start, null, null));
      $('#slotPasteWeeks').addEventListener('click', () => openPlacementDialog(clipboard.course, 'paste', { day: day, start: start }));
    }
    $('[data-close]').addEventListener('click', closeModal);
  }
  function placementHtml(course, options) {
    const table = slotTable();
    const day = options.day, start = options.start, span = Math.max(1, course.end - course.start + 1);
    const dayOptions = DAYS.map((name, i) => '<option value="' + i + '"' + (i === day ? ' selected' : '') + '>' + name + '</option>').join('');
    const startOptions = table.map((item, i) => '<option value="' + i + '"' + (i === start ? ' selected' : '') + '>第 ' + (i + 1) + ' 节 · ' + item.start + '</option>').join('');
    return '<div class="info-box">' + escapeHTML(course.name) + '（' + span + ' 节连排）</div>' +
      '<div class="form-grid"><div class="field"><label for="placeDay">星期</label><select id="placeDay">' + dayOptions + '</select></div>' +
      '<div class="field"><label for="placeStart">开始节次</label><select id="placeStart">' + startOptions + '</select></div>' +
      '<div class="field"><label for="placeFrom">开始周</label><input type="number" id="placeFrom" min="1" max="100" value="' + (options.startWeek || 1) + '"></div>' +
      '<div class="field"><label for="placeTo">结束周</label><input type="number" id="placeTo" min="1" max="100" value="' + (options.endWeek || 20) + '"></div>' +
      '<div class="field wide"><span class="field-hint">结束节次会按原来的 ' + span + ' 节自动排好；课程名称、老师、教室和配色都保持不变。</span></div></div>' +
      '<div class="form-actions"><button class="btn-primary" type="button" id="placeSave">' + (options.mode === 'copyto' ? '复制到这里' : '粘贴到这里') + '</button><button class="btn-ghost" data-close>取消</button></div>';
  }
  function openPlacementDialog(course, mode, target) {
    const options = {
      mode: mode,
      day: target && Number.isInteger(target.day) ? target.day : course.day,
      start: target && Number.isInteger(target.start) ? target.start : course.start,
      startWeek: course.startWeek || 1,
      endWeek: course.endWeek || 20
    };
    openModal(mode === 'copyto' ? '复制到…' : '粘贴到…', 'PLACE IT', placementHtml(course, options));
    $('#placeSave').addEventListener('click', () => {
      const day = Number($('#placeDay').value);
      const start = Number($('#placeStart').value);
      const from = Number($('#placeFrom').value);
      const to = Number($('#placeTo').value);
      const placed = buildPlaced(course, day, start, from, to, slotCount());
      if (!placed) { showToast('周次或位置不合法，请检查一下。'); return; }
      if (overlaps(placed) && !confirm('目标位置和现有课程重叠，仍要放进去吗？')) return;
      state.courses.push(placed);
      saveState(); closeModal(); renderAll();
      showToast((mode === 'copyto' ? '已复制到 ' : '已粘贴到 ') + DAYS[day] + '第 ' + (placed.start + 1) + ' 节 ✨');
    });
    $('[data-close]').addEventListener('click', closeModal);
  }
  function pasteAt(day, start, from, to) {
    if (!clipboard) { showToast('剪贴板是空的，先长按一门课复制。'); return; }
    const source = clipboard.course;
    const placed = buildPlaced(source, day, start, from === null ? source.startWeek : from, to === null ? source.endWeek : to, slotCount());
    if (!placed) { showToast('这个位置放不下，换个节次试试。'); return; }
    if (overlaps(placed) && !confirm('目标位置和现有课程重叠，仍要放进去吗？')) return;
    // 「复制」的剪贴板保留，可以连续粘到多个位置；「剪切」粘完就结束
    if (clipboard.mode === 'cut') writeClipboard(null);
    state.courses.push(placed);
    saveState(); closeModal(); renderAll();
    showToast('已粘贴到 ' + DAYS[day] + '第 ' + (placed.start + 1) + ' 节 ✨');
  }
  function moveCourse(course, day, start) {
    const moved = applyMove(course, day, start, slotCount());
    if (moved.day === course.day && moved.start === course.start) return false;
    if (overlaps(moved, course.id) && !confirm('目标位置和现有课程重叠，仍要移动吗？')) return false;
    const cleaned = cleanCourse(moved);
    if (!cleaned) { showToast('这个位置放不下，换个地方试试。'); return false; }
    state.courses = state.courses.map(item => item.id === course.id ? cleaned : item);
    saveState(); renderAll();
    showToast('已移动到 ' + DAYS[cleaned.day] + '第 ' + (cleaned.start + 1) + ' 节 ✨');
    return true;
  }
  function bindCourseGestures(board) {
    if (!board || !board.querySelectorAll) return;
    let pending = null;
    let timer = 0;

    const clearPending = () => { if (timer) { clearTimeout(timer); timer = 0; } pending = null; };
    const startDrag = () => {
      if (!pending) return;
      const course = state.courses.find(item => item.id === pending.id);
      if (!course) { clearPending(); return; }
      const span = Math.max(1, course.end - course.start + 1);
      const height = span * slotH() - 4;
      const width = pending.rect.width;
      const ghost = document.createElement('div');
      ghost.className = 'drag-ghost tone-' + course.tone;
      ghost.innerHTML = '<span class="class-name">' + escapeHTML(course.name) + '</span>';
      ghost.style.width = width + 'px';
      ghost.style.height = height + 'px';
      document.body.appendChild(ghost);
      if (pending.node.classList) pending.node.classList.add('drag-source');
      dragState = { course: course, ghost: ghost, width: width, height: height, span: span, preview: null, moved: true, pointerId: pending.pointerId };
      suppressGestures(1500);
      vibrate(12);
      dragState.autoScroll = setInterval(() => {
        if (!dragState) return;
        const x = dragState.lastX;
        if (typeof x !== 'number') return;
        const scroller = $('#weekScroll');
        if (!scroller || !scroller.getBoundingClientRect) return;
        const rect = scroller.getBoundingClientRect();
        if (x < rect.left + 44) scroller.scrollLeft -= 9;
        else if (x > rect.right - 44) scroller.scrollLeft += 9;
      }, 16);
    };
    const updateDrag = (clientX, clientY) => {
      if (!dragState) return;
      dragState.lastX = clientX;
      const ghost = dragState.ghost;
      ghost.style.left = Math.round(clientX - dragState.width / 2) + 'px';
      ghost.style.top = Math.round(clientY - 22) + 'px';
      const target = resolveDropTarget(clientX, clientY, columnGeometry(), slotH(), slotCount());
      if (!target) return;
      dragState.target = target;
      const moved = applyMove(dragState.course, target.day, target.start, slotCount());
      const column = board.querySelector('[data-daycol="' + target.day + '"]');
      if (!column) return;
      if (!dragState.preview) {
        const preview = document.createElement('div');
        preview.className = 'drop-preview';
        column.appendChild(preview);
        dragState.preview = preview;
        dragState.previewHost = column;
      }
      if (dragState.previewHost !== column) {
        if (dragState.preview.remove) dragState.preview.remove();
        column.appendChild(dragState.preview);
        dragState.previewHost = column;
      }
      const h = slotH();
      dragState.preview.style.top = (moved.start * h + 2) + 'px';
      dragState.preview.style.height = (dragState.span * h - 4) + 'px';
    };
    const endDrag = (commit) => {
      if (!dragState) return;
      const state_ = dragState;
      dragState = null;
      if (state_.autoScroll) clearInterval(state_.autoScroll);
      if (state_.ghost && state_.ghost.remove) state_.ghost.remove();
      if (state_.preview && state_.preview.remove) state_.preview.remove();
      const source = board.querySelector('[data-course="' + state_.course.id + '"]');
      if (source && source.classList) source.classList.remove('drag-source');
      suppressGestures(600);
      if (commit && state_.target) moveCourse(state_.course, state_.target.day, state_.target.start);
    };

    board.querySelectorAll('[data-course]').forEach(node => {
      const onDown = event => {
        if (event.button !== undefined && event.button !== 0) return;
        const course = state.courses.find(item => item.id === node.getAttribute('data-course'));
        if (!course) return;
        // 捕获指针：手指/鼠标移出卡片后仍能收到 move/up，拖动才不会中断
        if (node.setPointerCapture && event.pointerId !== undefined) { try { node.setPointerCapture(event.pointerId); } catch (error) { /* 忽略 */ } }
        const rect = node.getBoundingClientRect ? node.getBoundingClientRect() : { width: 80 };
        pending = { id: course.id, node: node, pointerId: event.pointerId, x: event.clientX, y: event.clientY, rect: rect, lifted: false };
        clearTimeout(timer);
        timer = setTimeout(() => {
          if (!pending) return;
          pending.lifted = true;
          if (pending.node.classList) pending.node.classList.add('lifted');
          vibrate(15);
        }, LONG_PRESS_MS);
      };
      const onMove = event => {
        if (!pending || (event.pointerId !== undefined && pending.pointerId !== undefined && event.pointerId !== pending.pointerId)) return;
        const dx = event.clientX - pending.x, dy = event.clientY - pending.y;
        if (dragState) { if (event.cancelable) event.preventDefault(); updateDrag(event.clientX, event.clientY); return; }
        if (!pending.lifted) {
          if (Math.abs(dx) > DRAG_SLOP || Math.abs(dy) > DRAG_SLOP) clearPending();
          return;
        }
        if (Math.abs(dx) > DRAG_SLOP || Math.abs(dy) > DRAG_SLOP) {
          startDrag();
          if (event.cancelable) event.preventDefault();
          updateDrag(event.clientX, event.clientY);
        }
      };
      const onUp = () => {
        if (node.releasePointerCapture && pending && pending.pointerId !== undefined) { try { node.releasePointerCapture(pending.pointerId); } catch (error) { /* 忽略 */ } }
        if (dragState) { endDrag(true); clearPending(); return; }
        if (pending && pending.lifted) {
          const course = state.courses.find(item => item.id === pending.id);
          if (pending.node.classList) pending.node.classList.remove('lifted');
          suppressGestures(700);
          clearPending();
          if (course) openCourseActions(course);
          return;
        }
        clearPending();
      };
      const onCancel = () => {
        if (dragState) { endDrag(false); clearPending(); return; }
        if (pending && pending.node.classList) pending.node.classList.remove('lifted');
        clearPending();
      };
      node.addEventListener('pointerdown', onDown);
      node.addEventListener('pointermove', onMove);
      node.addEventListener('pointerup', onUp);
      node.addEventListener('pointercancel', onCancel);
      node.addEventListener('contextmenu', event => { if (event.preventDefault) event.preventDefault(); });
    });
    // 拖动过程中必须阻止页面跟着滚：touchmove 需要非被动监听才能 preventDefault
    if (!board.__kejianTouchGuard) {
      board.__kejianTouchGuard = true;
      board.addEventListener('touchmove', event => {
        if (dragState && event.cancelable) event.preventDefault();
      }, { passive: false });
    }

    board.querySelectorAll('.slot').forEach(node => {
      let slotPending = null, slotTimer = 0;
      node.addEventListener('pointerdown', event => {
        if (event.button !== undefined && event.button !== 0) return;
        slotPending = { x: event.clientX, y: event.clientY };
        clearTimeout(slotTimer);
        slotTimer = setTimeout(() => {
          if (!slotPending) return;
          const day = Number(node.getAttribute('data-day'));
          const slot = Number(node.getAttribute('data-slot'));
          suppressGestures(700);
          vibrate(15);
          openSlotActions(day, slot);
          slotPending = null;
        }, LONG_PRESS_MS);
      });
      node.addEventListener('pointermove', event => {
        if (!slotPending) return;
        if (Math.abs(event.clientX - slotPending.x) > DRAG_SLOP || Math.abs(event.clientY - slotPending.y) > DRAG_SLOP) { clearTimeout(slotTimer); slotPending = null; }
      });
      node.addEventListener('pointerup', () => { clearTimeout(slotTimer); slotPending = null; });
      node.addEventListener('pointercancel', () => { clearTimeout(slotTimer); slotPending = null; });
    });
  }
  /* ---------- 底部导航 ---------- */
  function switchTab(name) {
    const panels = document.querySelectorAll('.tab-panel');
    Array.prototype.forEach.call(panels, panel => {
      panel.hidden = panel.getAttribute('data-panel') !== name;
    });
    const buttons = document.querySelectorAll('#tabBar .tab-button');
    Array.prototype.forEach.call(buttons, button => {
      const on = button.getAttribute('data-tab') === name;
      button.classList.toggle('on', on);
      if (on) button.setAttribute('aria-current', 'page');
      else if (button.removeAttribute) button.removeAttribute('aria-current');
    });
    const weekActions = $('#weekViewActions');
    if (weekActions) weekActions.hidden = name !== 'schedule';
  }
  /* ---------- 版本与更新 ---------- */
  const APP_VERSION = 'v9 · 空课表也能点格子';
  function showVersion() {
    const node = $('#footerVersion');
    if (node) node.textContent = '课间 ' + APP_VERSION;
    const hint = $('#updateHint');
    if (hint) hint.textContent = '当前 ' + APP_VERSION + '；界面没变化时点这里强制更新';
  }
  // 清掉所有缓存并注销 service worker 后重新载入：遇到「传了新版本却看不到」时的一键自救
  async function forceUpdate() {
    const row = $('#checkUpdateRow');
    if (row) row.disabled = true;
    showToast('正在获取最新版本…');
    try {
      if (typeof caches !== 'undefined' && caches.keys) {
        const keys = await caches.keys();
        await Promise.all(keys.map(key => caches.delete(key)));
      }
      if ('serviceWorker' in navigator && navigator.serviceWorker.getRegistrations) {
        const registrations = await navigator.serviceWorker.getRegistrations();
        await Promise.all(registrations.map(item => item.unregister()));
      }
      location.reload();
    } catch (error) {
      if (row) row.disabled = false;
      showToast('自动更新失败，请手动关闭页面再重新打开。');
    }
  }
  function wireActions() {
    $('#prevWeek').addEventListener('click', () => { weekOffset--; renderAll(); }); $('#nextWeek').addEventListener('click', () => { weekOffset++; renderAll(); });
    $('#todayButton').addEventListener('click', () => { weekOffset = 0; renderAll(); });
    const weekendToggle = $('#weekendToggle');
    const syncWeekendToggle = () => { const on = state.settings.showWeekend !== false; weekendToggle.classList.toggle('on', on); weekendToggle.setAttribute('aria-pressed', String(on)); };
    weekendToggle.addEventListener('click', () => { state.settings.showWeekend = state.settings.showWeekend === false; saveState(); syncWeekendToggle(); renderSchedule(); });
    syncWeekendToggle();
    let touchX = 0, touchY = 0;
    const scroller = $('#weekScroll');
    scroller.addEventListener('touchstart', event => { touchX = event.touches[0].clientX; touchY = event.touches[0].clientY; }, { passive: true });
    scroller.addEventListener('touchend', event => {
      if (gestureSuppressed() || dragState) return;
      const dx = event.changedTouches[0].clientX - touchX, dy = event.changedTouches[0].clientY - touchY;
      if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) { weekOffset += dx < 0 ? 1 : -1; renderAll(); }
    }, { passive: true });
    $('#reminderQuick').addEventListener('click', openSettings);
    $('#themeToggle').addEventListener('click', () => { state.settings.theme = currentTheme() === 'dark' ? 'light' : 'dark'; saveState(); applyDisplay(); showToast(currentTheme() === 'dark' ? '已切换到深色模式 🌙' : '已切换到浅色模式 ☀'); });    $('#displayButton').addEventListener('click', openDisplaySettings);
    $('#profileButton').addEventListener('click', () => openModal('你的课表，只属于你的设备', 'A SMALL PRIVACY NOTE', `<div class="info-box"><strong>无需账号，无需把 ICA 密码交给应用。</strong><br><br>课表数据存在当前浏览器的本地存储中。清除浏览器数据、卸载 PWA 或更换设备可能会清掉课表，请定期导出 JSON 备份。<br><br>将本地课表同步到别人的设备，请你主动导出文件并发送。此应用不会上传课程或实时同步。系统通知则由浏览器和设备按你的授权发出。</div><div class="form-actions"><button class="secondary-button" data-close>知道了</button></div>`));
    $('#exportQuick').addEventListener('click', openExportOptions);
    document.querySelectorAll('#tabBar .tab-button').forEach(button => button.addEventListener('click', () => {
      switchTab(button.getAttribute('data-tab'));
      if (typeof window.scrollTo === 'function') { try { window.scrollTo({ top: 0, behavior: 'smooth' }); } catch (error) { window.scrollTo(0, 0); } }
    }));
    document.querySelectorAll('[data-action=add]').forEach(button => button.addEventListener('click', () => openCourseForm()));
    document.querySelectorAll('[data-action=import]').forEach(button => button.addEventListener('click', openImportInfo));
    document.querySelectorAll('[data-action=share]').forEach(button => button.addEventListener('click', openExportOptions));
    document.querySelectorAll('[data-action=install]').forEach(button => button.addEventListener('click', openInstallGuide));
    document.querySelectorAll('[data-action=ocr]').forEach(button => button.addEventListener('click', openImageImport));
    $('#imageFile').addEventListener('change', event => { const [file] = event.target.files; if (file) loadImageFile(file); event.target.value = ''; });
    $('#importFile').addEventListener('change', event => { const [file] = event.target.files; if (file) importFile(file); event.target.value = ''; });
    $('#checkUpdateRow').addEventListener('click', forceUpdate);
    $('#emptyAdd').addEventListener('click', () => openCourseForm());
    $('#emptyImport').addEventListener('click', chooseImport);
    $('#closeModal').addEventListener('click', closeModal); $('#modalBackdrop').addEventListener('click', event => { if (event.target === $('#modalBackdrop')) closeModal(); });
    document.addEventListener('keydown', event => { if (event.key === 'Escape' && !$('#modalBackdrop').hidden) closeModal(); });
  }
  wireActions(); applyDisplay(); renderAll(); startReminderChecks(); showVersion();
  setInterval(updateNowLine, 30000);
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
    navigator.serviceWorker.register('./service-worker.js').catch(() => {});
  }
})();
