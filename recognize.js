/* 课间 · 图片识别引擎
 * 离线 OCR（Tesseract.js，从 CDN 按镜像顺序加载）+ 可选 AI 视觉识别
 * 纯逻辑部分（groupWords / buildCourses / splitCellText）不依赖 DOM，可单独测试。
 */
(function (global) {
  'use strict';

  const SCRIPT_MIRRORS = [
    'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js',
    'https://fastly.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js',
    'https://gcore.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js',
    'https://unpkg.com/tesseract.js@5.1.1/dist/tesseract.min.js'
  ];
  // 1.7MB 精简版中文包；最后一个是官方默认（约 20MB，仅作兜底）
  const LANG_MIRRORS = [
    'https://cdn.jsdelivr.net/npm/@tesseract.js-data/chi_sim@1.0.0/4.0.0_best_int',
    'https://fastly.jsdelivr.net/npm/@tesseract.js-data/chi_sim@1.0.0/4.0.0_best_int',
    'https://unpkg.com/@tesseract.js-data/chi_sim@1.0.0/4.0.0_best_int',
    'https://tessdata.projectnaptha.com/4.0.0'
  ];
  const CORE_VERSION = 'tesseract.js-core@5.1.0';
  const SCRIPT_VERSION = 'tesseract.js@5.1.1';
  const SLOT_COUNT = 8;
  const DAY_PATTERNS = [
    ['周一', '星期一', '礼拜一', '周1', 'Mon', 'MON', 'Monday'],
    ['周二', '星期二', '礼拜二', '周2', 'Tue', 'TUE', 'Tuesday'],
    ['周三', '星期三', '礼拜三', '周3', 'Wed', 'WED', 'Wednesday'],
    ['周四', '星期四', '礼拜四', '周4', 'Thu', 'THU', 'Thursday'],
    ['周五', '星期五', '礼拜五', '周5', 'Fri', 'FRI', 'Friday'],
    ['周六', '星期六', '礼拜六', '周6', 'Sat', 'SAT', 'Saturday'],
    ['周日', '周天', '星期日', '星期天', '礼拜日', '周7', 'Sun', 'SUN', 'Sunday']
  ];

  function isCJK(ch) { return /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/.test(ch); }
  function joinText(parts) {
    let out = '';
    for (let i = 0; i < parts.length; i++) {
      const piece = parts[i];
      if (!piece) continue;
      if (!out) { out = piece; continue; }
      const prev = out.charAt(out.length - 1), next = piece.charAt(0);
      out += (isCJK(prev) || isCJK(next)) ? piece : ' ' + piece;
    }
    return out;
  }
  function median(values) {
    if (!values.length) return 0;
    const sorted = values.slice().sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  }
  function clampSlot(value) { return Math.min(SLOT_COUNT - 1, Math.max(0, Math.round(value))); }

  /* ---------- 词块聚合成行列 ---------- */
  function groupWords(rawWords) {
    const items = [];
    (rawWords || []).forEach(word => {
      if (!word || !word.text || !String(word.text).trim() || !word.bbox) return;
      const box = word.bbox;
      const height = Math.max(1, box.y1 - box.y0);
      items.push({
        text: String(word.text).trim(),
        x0: box.x0, x1: box.x1, y0: box.y0, y1: box.y1,
        xc: (box.x0 + box.x1) / 2, yc: (box.y0 + box.y1) / 2, h: height
      });
    });
    if (!items.length) return [];
    const medH = median(items.map(item => item.h)) || 12;
    const rowTol = Math.max(4, medH * 0.62);
    const sorted = items.slice().sort((a, b) => a.yc - b.yc);
    const rows = [];
    sorted.forEach(item => {
      let target = null;
      for (let i = 0; i < rows.length; i++) {
        if (Math.abs(rows[i].yc - item.yc) <= rowTol) { target = rows[i]; break; }
      }
      if (target) {
        target.items.push(item);
        target.yc = (target.yc * (target.items.length - 1) + item.yc) / target.items.length;
        target.y0 = Math.min(target.y0, item.y0);
        target.y1 = Math.max(target.y1, item.y1);
      } else {
        rows.push({ yc: item.yc, y0: item.y0, y1: item.y1, items: [item] });
      }
    });
    rows.sort((a, b) => a.yc - b.yc);
    const gapTol = Math.max(6, medH * 0.9);
    rows.forEach(row => {
      row.items.sort((a, b) => a.xc - b.xc);
      row.cells = [];
      let current = null;
      row.items.forEach(item => {
        if (current && item.x0 - current.x1 <= gapTol) {
          current.items.push(item);
          current.x1 = Math.max(current.x1, item.x1);
          current.x0 = Math.min(current.x0, item.x0);
          current.y0 = Math.min(current.y0, item.y0);
          current.y1 = Math.max(current.y1, item.y1);
        } else {
          current = { items: [item], x0: item.x0, x1: item.x1, y0: item.y0, y1: item.y1 };
          row.cells.push(current);
        }
      });
      row.cells.forEach(cell => {
        cell.text = joinText(cell.items.map(item => item.text));
        cell.xc = (cell.x0 + cell.x1) / 2;
        cell.yc = (cell.y0 + cell.y1) / 2;
        cell.rowYc = row.yc;
      });
    });
    return rows;
  }

  /* ---------- 文字 → 课程字段 ---------- */
  const ROOM_HINT = /(楼|教室|教|室|馆|区|号|栋|阶|座|机房|实验室|操场|体育馆)/;
  const TEACHER_HINT = /(老师|教师|教授|讲师|助教)/;
  const ROOM_CODE = /^[A-Za-z]?\d{1,4}[A-Za-z]?$/;
  const ROOM_MIX = /^[A-Za-z]?\d{2,4}[-—]\d{1,4}$|^[A-Za-z]{1,3}\d{2,4}$/;
  function looksLikeRoom(token) {
    if (!token) return false;
    if (ROOM_HINT.test(token)) return true;
    if (ROOM_CODE.test(token)) return true;
    if (ROOM_MIX.test(token)) return true;
    return false;
  }
  function looksLikeTeacher(token) {
    if (!token) return false;
    if (TEACHER_HINT.test(token)) return true;
    // 教师名一般为 2-3 个汉字；4 个汉字多半是课程名（高等数学/线性代数），不能当教师
    const stripped = token.replace(/[,\s，、]/g, '');
    if (stripped.length >= 2 && stripped.length <= 3 && /^[\u4e00-\u9fff]{2,3}$/.test(stripped)) return true;
    return false;
  }
  function splitCellText(text) {
    const raw = String(text == null ? '' : text).replace(/\s+/g, ' ').trim();
    const result = { name: '', teacher: '', room: '', raw: raw };
    if (!raw) return result;
    const tokens = raw.split(/[\s,，、·|/@()（）\[\]【】;；]+/).filter(Boolean);
    if (tokens.length <= 1) { result.name = raw; return result; }
    const rest = tokens.slice();
    // 课名几乎总是第一个词；只有它明显是教室编号时才另找课名
    if (!looksLikeRoom(rest[0])) {
      result.name = rest.shift();
    } else {
      result.room = rest.shift();
    }
    const leftovers = [];
    rest.forEach(token => {
      if (!result.room && looksLikeRoom(token)) { result.room = token; return; }
      if (!result.teacher && looksLikeTeacher(token)) { result.teacher = token; return; }
      leftovers.push(token);
    });
    if (leftovers.length) result.name = result.name ? joinText([result.name].concat(leftovers)) : joinText(leftovers);
    if (!result.name) result.name = raw;
    if (result.teacher && result.teacher === result.name) result.teacher = '';
    return result;
  }

  /* ---------- 行列 → 课程 ---------- */
  function matchDay(text) {
    const compact = String(text || '').replace(/\s/g, '');
    if (!compact) return -1;
    for (let day = 0; day < DAY_PATTERNS.length; day++) {
      const patterns = DAY_PATTERNS[day];
      for (let i = 0; i < patterns.length; i++) {
        if (compact === patterns[i]) return day;
      }
    }
    for (let day = 0; day < DAY_PATTERNS.length; day++) {
      const patterns = DAY_PATTERNS[day];
      for (let i = 0; i < patterns.length; i++) {
        if (patterns[i].length >= 2 && compact.indexOf(patterns[i]) > -1 && compact.length <= patterns[i].length + 4) return day;
      }
    }
    return -1;
  }
  function parsePeriodToken(text) {
    if (!text) return -1;
    const compact = String(text).replace(/\s/g, '');
    const timeMatch = compact.match(/(\d{1,2})[:：](\d{2})/);
    if (timeMatch) {
      const minutes = Number(timeMatch[1]) * 60 + Number(timeMatch[2]);
      return clampSlot((minutes - 8 * 60) / 60);
    }
    const numMatch = compact.match(/^第?(\d{1,2})(?:[-—~](\d{1,2}))?(?:节|课)?$/);
    if (numMatch) return clampSlot(Number(numMatch[1]) - 1);
    return -1;
  }
  /* 按列中心划出列带（用于判断一段文字属于星期几） */
  function buildBands(centers) {
    const sorted = centers.slice().sort((a, b) => a.xc - b.xc);
    const bands = [];
    for (let i = 0; i < sorted.length; i++) {
      const leftGap = i === 0
        ? (sorted.length > 1 ? (sorted[1].xc - sorted[0].xc) / 2 : 40)
        : (sorted[i].xc - sorted[i - 1].xc) / 2;
      const rightGap = i === sorted.length - 1
        ? (sorted.length > 1 ? (sorted[i].xc - sorted[i - 1].xc) / 2 : 40)
        : (sorted[i + 1].xc - sorted[i].xc) / 2;
      bands.push({ day: sorted[i].day, xc: sorted[i].xc, left: sorted[i].xc - leftGap, right: sorted[i].xc + rightGap });
    }
    return bands;
  }
  /* 两级聚合：先按列带分列，再把同一列里上下相邻的文本行合并成一个单元格块
     （课表单元格里课名/教师/教室是上下堆叠的多行，必须合并，否则会错位到不同节次） */
  function buildCellBlocks(rows, bands) {
    const perDay = {};
    (rows || []).forEach(row => {
      (row.cells || []).forEach(cell => {
        let band = null;
        for (let i = 0; i < bands.length; i++) {
          if (cell.xc >= bands[i].left && cell.xc < bands[i].right) { band = bands[i]; break; }
        }
        if (!band) return;
        const key = String(band.day);
        if (!perDay[key]) perDay[key] = { day: band.day, cells: [] };
        perDay[key].cells.push({ text: cell.text, x0: cell.x0, x1: cell.x1, y0: cell.y0, y1: cell.y1 });
      });
    });
    const blocks = [];
    Object.keys(perDay).forEach(key => {
      const list = perDay[key].cells.slice().sort((a, b) => a.y0 - b.y0);
      let current = null;
      list.forEach(cell => {
        const height = Math.max(1, cell.y1 - cell.y0);
        const mergeTol = Math.max(8, height * 1.3);
        if (current && cell.y0 - current.y1 <= mergeTol) {
          current.parts.push(cell.text);
          current.x0 = Math.min(current.x0, cell.x0);
          current.x1 = Math.max(current.x1, cell.x1);
          current.y0 = Math.min(current.y0, cell.y0);
          current.y1 = Math.max(current.y1, cell.y1);
        } else {
          current = { day: perDay[key].day, parts: [cell.text], x0: cell.x0, x1: cell.x1, y0: cell.y0, y1: cell.y1 };
          blocks.push(current);
        }
      });
    });
    blocks.forEach(block => {
      // 行间必须分隔（课名/教师/教室是不同字段）；行内碎片的粘合已在 groupWords 里处理过
      block.text = block.parts.join(' ').replace(/\s+/g, ' ').trim();
      block.xc = (block.x0 + block.x1) / 2;
      block.yc = (block.y0 + block.y1) / 2;
    });
    return blocks;
  }

  function buildCourses(rows, options) {
    const opts = options || {};
    const warnings = [];
    const rowList = (rows || []).filter(row => row && row.cells && row.cells.length);
    if (!rowList.length) return { courses: [], warnings: ['没有识别到任何文字，试试把识别区域框得更紧一些。'], dayAnchors: [], periodAnchors: [] };

    // 1) 找表头里的星期
    const dayAnchors = [];
    rowList.forEach(row => {
      row.cells.forEach(cell => {
        const day = matchDay(cell.text);
        if (day > -1) dayAnchors.push({ day: day, xc: cell.xc, yc: row.yc, text: cell.text });
      });
    });
    const headerYc = dayAnchors.length >= 3 ? median(dayAnchors.map(a => a.yc)) : null;
    const headerTol = headerYc === null ? 0 : Math.max(12, median(rowList.map(r => r.y1 - r.y0)) * 0.9);

    // 2) 找节次栏（左侧数字或时间）
    const periodAnchors = [];
    rowList.forEach(row => {
      const first = row.cells[0];
      if (!first) return;
      if (headerYc !== null && Math.abs(row.yc - headerYc) <= headerTol) return;
      const slot = parsePeriodToken(first.text);
      if (slot > -1) periodAnchors.push({ slot: slot, yc: row.yc, text: first.text, x1: first.x1 });
    });

    // 3) 列中心：优先用星期表头，否则按所有文字的 x 聚类
    let columnCenters = [];
    if (dayAnchors.length >= 3) {
      const byDay = {};
      dayAnchors.forEach(anchor => { if (byDay[anchor.day] === undefined) byDay[anchor.day] = anchor.xc; });
      columnCenters = Object.keys(byDay).map(key => ({ day: Number(key), xc: byDay[key] })).sort((a, b) => a.xc - b.xc);
    }
    if (columnCenters.length < 3) {
      const xs = [];
      rowList.forEach(row => row.cells.forEach(cell => xs.push(cell.xc)));
      const sortedX = xs.sort((a, b) => a - b);
      const span = sortedX.length ? sortedX[sortedX.length - 1] - sortedX[0] : 0;
      const minGap = Math.max(18, span * 0.055);
      const groups = [];
      sortedX.forEach(x => {
        const last = groups[groups.length - 1];
        if (last && x - last.max <= minGap) { last.sum += x; last.count++; last.max = x; }
        else groups.push({ sum: x, count: 1, max: x });
      });
      columnCenters = groups.map(group => ({ day: -1, xc: group.sum / group.count }));
      if (columnCenters.length < 5 || columnCenters.length > 8) {
        warnings.push('没能自动认出星期表头，已按 ' + columnCenters.length + ' 列猜测，请在下面的预览表里核对星期。');
      } else {
        warnings.push('没有找到星期表头，已按 ' + columnCenters.length + ' 列从左到右推断为对应星期，请核对。');
      }
      columnCenters = columnCenters.map((column, index) => ({ day: index, xc: column.xc }));
    }

    const periodYcs = periodAnchors.map(a => a.yc).sort((a, b) => a - b);
    let rowHeight = 0;
    if (periodYcs.length >= 2) {
      const diffs = [];
      for (let i = 1; i < periodYcs.length; i++) diffs.push(periodYcs[i] - periodYcs[i - 1]);
      rowHeight = median(diffs);
    }
    const bands = buildBands(columnCenters);
    const blocks = buildCellBlocks(rowList, bands);
    if (!rowHeight) {
      const y0s = blocks.map(block => block.y0).sort((a, b) => a - b);
      const diffs = [];
      for (let i = 1; i < y0s.length; i++) { const gap = y0s[i] - y0s[i - 1]; if (gap > 4) diffs.push(gap); }
      rowHeight = median(diffs) || 0;
    }
    // 没有节次栏时：把所有单元格块的纵向中心聚成若干行带，用行带序号当作节次
    const fallbackRows = [];
    if (!periodAnchors.length) {
      const ycs = blocks.map(block => block.yc).sort((a, b) => a - b);
      ycs.forEach(y => {
        const last = fallbackRows[fallbackRows.length - 1];
        if (last && y - last.max <= Math.max(10, (rowHeight || 24) * 0.6)) { last.sum += y; last.count++; last.max = y; }
        else fallbackRows.push({ sum: y, count: 1, max: y });
      });
    }
    function slotForY(yc) {
      if (!periodAnchors.length) {
        let bestIndex = 0, bestDist = Infinity;
        fallbackRows.forEach((row, index) => {
          const center = row.sum / row.count;
          const distance = Math.abs(center - yc);
          if (distance < bestDist) { bestDist = distance; bestIndex = index; }
        });
        return clampSlot(bestIndex);
      }
      let best = periodAnchors[0], bestDist = Infinity;
      periodAnchors.forEach(anchor => {
        const distance = Math.abs(anchor.yc - yc);
        if (distance < bestDist) { bestDist = distance; best = anchor; }
      });
      return best.slot;
    }

    const courses = [];
    const seen = {};
    blocks.forEach(block => {
      if (headerYc !== null && Math.abs(block.yc - headerYc) <= headerTol) return;
      if (matchDay(block.text) > -1 && headerYc !== null) return;
      const compactText = String(block.text).replace(/\s/g, '');
      if (parsePeriodToken(compactText) > -1 && compactText.length <= 6) return;
      const parsed = splitCellText(block.text);
      if (!parsed.name) return;
      const day = block.day;
      const start = slotForY(block.yc);
      let span = 1;
      // 纯文字的高度不足以可靠判断连排（教师/教室行会让文字块变高），
      // 只有明显超过一节课高度的文字块才按连排处理，其余默认 1 节，由预览表手动调整。
      if (rowHeight > 6 && (block.y1 - block.y0) > rowHeight * 1.35) {
        span = Math.max(1, Math.round((block.y1 - block.y0) / rowHeight));
      }
      if (span > SLOT_COUNT) span = SLOT_COUNT;
      const end = clampSlot(start + span - 1);
      const key = day + '|' + start + '|' + parsed.name;
      if (seen[key]) return;
      seen[key] = true;
      courses.push({ day: day, start: start, end: end, name: parsed.name, teacher: parsed.teacher, room: parsed.room, raw: parsed.raw });
    });
    courses.sort((a, b) => (a.day - b.day) || (a.start - b.start));
    if (!courses.length) warnings.push('识别到文字但没能拼出课程，试试只框住课表区域（去掉标题栏和按钮）。');
    return { courses: courses, warnings: warnings, dayAnchors: dayAnchors, periodAnchors: periodAnchors, columnCenters: columnCenters, rowHeight: rowHeight, blocks: blocks };
  }

  /* ---------- 图片预处理 ---------- */
  function drawToCanvas(image, crop, maxSide) {
    const limit = maxSide || 1600;
    const naturalW = image.naturalWidth || image.width;
    const naturalH = image.naturalHeight || image.height;
    const sx = crop ? Math.max(0, Math.round(crop.x)) : 0;
    const sy = crop ? Math.max(0, Math.round(crop.y)) : 0;
    const sw = crop ? Math.min(naturalW - sx, Math.round(crop.w)) : naturalW;
    const sh = crop ? Math.min(naturalH - sy, Math.round(crop.h)) : naturalH;
    let scale = Math.min(2, Math.max(1, limit / Math.max(1, sw)));
    const maxPixels = 4200000;
    if (sw * sh * scale * scale > maxPixels) scale = Math.sqrt(maxPixels / Math.max(1, sw * sh));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(sw * scale));
    canvas.height = Math.max(1, Math.round(sh * scale));
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(image, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
    return canvas;
  }

  /* ---------- 引擎加载（多镜像降级） ---------- */
  let enginePromise = null;
  let engineInfo = { script: '', lang: '' };
  function loadScript(url) {
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = url;
      script.async = true;
      script.onload = () => resolve(url);
      script.onerror = () => reject(new Error('加载失败: ' + url));
      document.head.appendChild(script);
    });
  }
  function scriptBase(url) { return url.replace(/tesseract\.js@[\d.]+\/dist\/tesseract\.min\.js$/, ''); }
  function loadEngine(onStatus) {
    if (enginePromise) return enginePromise;
    const report = typeof onStatus === 'function' ? onStatus : function () {};
    enginePromise = (async function () {
      let script = null, lastError = null;
      for (let i = 0; i < SCRIPT_MIRRORS.length && !script; i++) {
        try { report('正在下载识别引擎（' + (i + 1) + '/' + SCRIPT_MIRRORS.length + '）…'); script = await loadScript(SCRIPT_MIRRORS[i]); }
        catch (error) { lastError = error; }
      }
      if (!script) { enginePromise = null; throw new Error('识别引擎下载失败，请检查网络后重试（或改用 AI 识别）。' + (lastError ? ' ' + lastError.message : '')); }
      const base = scriptBase(script);
      if (!global.Tesseract) { enginePromise = null; throw new Error('识别引擎已下载但未能初始化，请刷新页面重试。'); }
      let lang = null;
      for (let i = 0; i < LANG_MIRRORS.length && !lang; i++) {
        const candidate = LANG_MIRRORS[i];
        try {
          report(i === LANG_MIRRORS.length - 1 ? '正在下载中文语言包（约 20MB，较慢）…' : '正在下载中文语言包（约 1.7MB）…');
          const worker = await global.Tesseract.createWorker('chi_sim', 1, {
            langPath: candidate,
            // worker 与 wasm 内核都固定用「脚本来源的那个镜像」，避免主脚本可用但 jsDelivr 被墙时半途失败
            workerPath: base + SCRIPT_VERSION + '/dist/worker.min.js',
            corePath: base + CORE_VERSION + '/',
            logger: message => { if (message && message.status && typeof message.progress === 'number') report(message.status + ' ' + Math.round(message.progress * 100) + '%'); }
          });
          lang = candidate;
          engineInfo = { script: script, lang: candidate, worker: worker };
        } catch (error) { lastError = error; }
      }
      if (!lang) { enginePromise = null; throw new Error('中文语言包下载失败，请检查网络（或改用 AI 识别）。' + (lastError ? ' ' + lastError.message : '')); }
      report('识别引擎已就绪');
      return engineInfo;
    })();
    return enginePromise;
  }
  async function recognizeCanvas(canvas, onProgress) {
    const info = await loadEngine(onProgress);
    const result = await info.worker.recognize(canvas);
    const data = (result && result.data) || {};
    let words = Array.isArray(data.words) ? data.words : [];
    if (!words.length && Array.isArray(data.blocks)) {
      data.blocks.forEach(block => {
        (block.paragraphs || []).forEach(paragraph => {
          (paragraph.lines || []).forEach(line => { (line.words || []).forEach(word => words.push(word)); });
        });
      });
    }
    return { words: words, text: data.text || '' };
  }

  /* ---------- AI 视觉识别 ---------- */
  const AI_PROVIDERS = {
    zhipu: { label: '智谱 GLM-4V-Flash（有免费额度）', url: 'https://open.bigmodel.cn/api/paas/v4/chat/completions', model: 'glm-4v-flash', keyUrl: 'https://open.bigmodel.cn/' },
    siliconflow: { label: '硅基流动 Qwen2.5-VL（有免费额度）', url: 'https://api.siliconflow.cn/v1/chat/completions', model: 'Qwen/Qwen2.5-VL-32B-Instruct', keyUrl: 'https://cloud.siliconflow.cn/' },
    custom: { label: '自定义（OpenAI 兼容接口）', url: '', model: '', keyUrl: '' }
  };
  const AI_PROMPT = '这是一张课程表截图。请把里面的课程提取成 JSON 数组，不要输出任何解释文字。\n' +
    '每个元素格式：{"name":"课程名","teacher":"教师或空字符串","room":"教室或空字符串","day":1到7的整数(周一=1,周日=7),"startPeriod":开始节次整数(1开始),"endPeriod":结束节次整数}\n' +
    '注意：节次按课表左侧的节次序号填写，不要换算成时间；同一门课连排两节请填 startPeriod 与 endPeriod；无法确定的字段用空字符串。只输出 JSON 数组。';
  function extractJsonArray(text) {
    if (!text) return null;
    let cleaned = String(text).replace(/```json/gi, '').replace(/```/g, '').trim();
    const start = cleaned.indexOf('[');
    const end = cleaned.lastIndexOf(']');
    if (start === -1 || end === -1 || end <= start) return null;
    cleaned = cleaned.slice(start, end + 1);
    try { return JSON.parse(cleaned); } catch (error) { return null; }
  }
  function normalizeAIItems(items) {
    const courses = [];
    (items || []).forEach(item => {
      if (!item || typeof item !== 'object') return;
      const name = String(item.name || item.course || item['课程'] || '').trim();
      if (!name) return;
      const dayValue = Number(item.day != null ? item.day : item.weekday);
      const day = Number.isFinite(dayValue) ? Math.min(6, Math.max(0, Math.round(dayValue) - 1)) : 0;
      const startRaw = Number(item.startPeriod != null ? item.startPeriod : item.start);
      const endRaw = Number(item.endPeriod != null ? item.endPeriod : item.end);
      const start = Number.isFinite(startRaw) ? clampSlot(startRaw - 1) : 0;
      const end = Number.isFinite(endRaw) ? clampSlot(endRaw - 1) : start;
      courses.push({
        day: day, start: Math.min(start, end), end: Math.max(start, end), name: name,
        teacher: String(item.teacher || item['教师'] || '').trim(),
        room: String(item.room || item['教室'] || '').trim(),
        raw: 'AI'
      });
    });
    return courses;
  }
  async function recognizeByAI(canvas, config, onProgress) {
    const cfg = config || {};
    if (!cfg.key) throw new Error('还没有填 API Key。');
    if (!cfg.url) throw new Error('还没有填接口地址。');
    const report = typeof onProgress === 'function' ? onProgress : function () {};
    report('正在上传图片到 ' + (cfg.label || 'AI 服务') + ' …');
    const dataUrl = canvas.toDataURL('image/png');
    const body = {
      model: cfg.model,
      temperature: 0.1,
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: AI_PROMPT },
          { type: 'image_url', image_url: { url: dataUrl } }
        ]
      }]
    };
    let response;
    try {
      response = await fetch(cfg.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + cfg.key },
        body: JSON.stringify(body)
      });
    } catch (error) {
      throw new Error('请求没发出去（多半是该服务商不允许浏览器直接调用，或网络不通）。可以改用离线识别。');
    }
    if (!response.ok) {
      let detail = '';
      try { const text = await response.text(); detail = text.slice(0, 200); } catch (error) { detail = ''; }
      throw new Error('AI 接口返回 ' + response.status + '。' + detail);
    }
    report('正在解析 AI 结果…');
    const payload = await response.json();
    const content = payload && payload.choices && payload.choices[0] && payload.choices[0].message
      ? payload.choices[0].message.content : '';
    let text = content;
    if (Array.isArray(content)) text = content.map(part => (part && part.text) || '').join('');
    const items = extractJsonArray(text);
    if (!items) throw new Error('AI 返回的内容不是预期格式，请重试或改用离线识别。');
    const courses = normalizeAIItems(items);
    if (!courses.length) throw new Error('AI 没有识别出课程，试试把识别区域框得更紧一些。');
    return courses;
  }

  global.KejianRecognize = {
    SCRIPT_MIRRORS: SCRIPT_MIRRORS,
    LANG_MIRRORS: LANG_MIRRORS,
    AI_PROVIDERS: AI_PROVIDERS,
    SLOT_COUNT: SLOT_COUNT,
    loadEngine: loadEngine,
    recognizeCanvas: recognizeCanvas,
    drawToCanvas: drawToCanvas,
    recognizeByAI: recognizeByAI,
    groupWords: groupWords,
    buildBands: buildBands,
    buildCellBlocks: buildCellBlocks,
    buildCourses: buildCourses,
    splitCellText: splitCellText,
    matchDay: matchDay,
    parsePeriodToken: parsePeriodToken,
    extractJsonArray: extractJsonArray,
    normalizeAIItems: normalizeAIItems
  };
})(typeof window !== 'undefined' ? window : globalThis);
