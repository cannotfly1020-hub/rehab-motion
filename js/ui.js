(function (global) {
  'use strict';

  const RM = global.RehabMotion = global.RehabMotion || {};
  const state = RM.state;
  const wrapper = document.getElementById('screen-wrapper');
  const video = document.getElementById('video');
  const playButton = document.getElementById('btn-play');
  const frameBackButton = document.getElementById('btn-step-back');
  const frameForwardButton = document.getElementById('btn-step-forward');
  const seek = document.getElementById('seek-bar');
  const timeLabel = document.getElementById('time-label');
  const sourceLabel = document.getElementById('source-label');
  const mediaName = document.getElementById('media-name');
  const note = document.getElementById('measure-note');
  const pickStatus = document.getElementById('pick-status');
  const swayButtons = document.querySelectorAll('.sway-key');

  function renderFrameOnly() { return RM._hooks.renderFrameOnly.apply(null, arguments); }
  function drawSwayChart() { return RM._hooks.drawSwayChart.apply(null, arguments); }
  function currentMediaSize() { return RM._hooks.currentMediaSize.apply(null, arguments); }

function canvasLabel() {
  if (state.plane === 'frontal') {
    const frontal = state.frontal;
    const base = '前額面姿勢アライメント。左上をタップするとAI認識ステータスの表示を切り替えます。';
    if (!frontal || !frontal.ok) return base;
    return base
      + ' 頭部 ' + (frontal.headTilt && frontal.headTilt.text)
      + '、肩 ' + (frontal.shoulderLevel && frontal.shoulderLevel.text)
      + '、骨盤 ' + (frontal.pelvisLevel && frontal.pelvisLevel.text)
      + '、重心 ' + (frontal.cogShift && frontal.cogShift.text)
      + '。';
  }
  const base = '矢状面姿勢アライメント。左上をタップするとAI認識ステータスの表示を切り替えます。';
  const alignment = state.alignment;
  if (!alignment || !alignment.ok || !alignment.points) return base;
  return base
    + ' 耳 ' + RM.formatDeviation(alignment.points.ear && alignment.points.ear.cm)
    + '、肩 ' + RM.formatDeviation(alignment.points.shoulder && alignment.points.shoulder.cm)
    + '、股関節 ' + RM.formatDeviation(alignment.points.hip && alignment.points.hip.cm)
    + '、膝 ' + RM.ClinicalAngleFormatter.formatKnee(alignment.kneeAngleDeg).text
    + '。';
}

function setSwayTarget(target) {
  const allowed = { ear: true, shoulder: true, hip: true, knee: true };
  state.swayTarget = allowed[target] ? target : 'ear';
  syncSwayKeyLabels();
  Array.prototype.forEach.call(swayButtons, function (button) {
    const on = button.getAttribute('data-joint') === state.swayTarget;
    button.classList.toggle('is-active', on);
    button.setAttribute('aria-pressed', on ? 'true' : 'false');
  });
  drawSwayChart();
}

function syncSwayKeyLabels() {
  const frontal = state.plane === 'frontal';
  const text = frontal
    ? { ear: '頭部', shoulder: '胸骨', hip: '骨盤', knee: '右膝' }
    : { ear: '耳', shoulder: '肩', hip: '股関節', knee: '膝' };
  const aria = frontal
    ? { ear: '頭部（左右動揺）', shoulder: '胸骨（左右動揺）', hip: '骨盤（左右動揺）', knee: '右膝（左右動揺）' }
    : { ear: '耳（前後動揺）', shoulder: '肩（前後動揺）', hip: '股関節（前後動揺）', knee: '膝（前後動揺）' };
  Array.prototype.forEach.call(swayButtons, function (button) {
    const key = button.getAttribute('data-joint');
    if (!text[key]) return;
    if (button.textContent !== text[key]) button.textContent = text[key];
    if (button.getAttribute('aria-label') !== aria[key]) button.setAttribute('aria-label', aria[key]);
  });
}

function uncertaintyKind(id) {
  const frontal = state.plane === 'frontal';
  if (id === 'metric-ear' || id === 'metric-shoulder' || id === 'metric-hip' || id === 'metric-cog') return 'cm';
  if (id === 'metric-head-tilt' || id === 'metric-shoulder-level' || id === 'metric-pelvis-level') return 'tilt';
  if (frontal && (id === 'rom-neck' || id === 'rom-shoulder' || id === 'rom-trunk')) return 'tilt';
  if (id === 'metric-knee' || id === 'metric-knee-right' || id === 'metric-knee-left' || id === 'metric-trunk' || id === 'metric-neck' || id === 'rom-shoulder' || id === 'rom-elbow' || id === 'rom-neck' || id === 'rom-trunk' || id === 'rom-hip' || id === 'rom-knee') return 'joint';
  return '';
}

function appendUncertainty(node, kind) {
  if (!kind || typeof RM.formatUncertainty !== 'function') return;
  const label = RM.formatUncertainty(kind);
  if (!label) return;
  const band = document.createElement('span');
  band.className = 'uncertainty';
  band.textContent = label;
  node.appendChild(band);
}

function paintMeasure(node, text, kind) {
  const raw = String(text == null ? '—' : text);
  const stamp = raw + '|' + (kind || '');
  if (node.dataset.raw === stamp) return;
  node.dataset.raw = stamp;
  node.textContent = '';
  const match = raw.match(/^(.*?)(\s*)(cm|°)(.*)$/);
  const showBand = /\d/.test(raw);
  if (!match) {
    node.textContent = raw;
    if (showBand) appendUncertainty(node, kind);
    return;
  }
  const num = document.createElement('span');
  num.className = 'num';
  num.textContent = match[1];
  const unit = document.createElement('span');
  unit.className = 'unit';
  unit.textContent = match[3] + match[4];
  node.appendChild(num);
  node.appendChild(unit);
  if (showBand) appendUncertainty(node, kind);
}

function splitClinical(text) {
  const raw = text == null || text === '' ? '—' : String(text);
  if (raw === '—') return { dir: '', value: '—' };
  if (raw === '正常アライメント') return { dir: '正常アライメント', value: '' };
  const match = raw.match(/^(頭頚部前傾|頭頚部後傾|右偏位|左偏位|右下がり|左下がり|右側屈|左側屈|正常アライメント|正中|前|後|屈曲|伸展位|過伸展|伸展|前傾|後傾|垂直|前屈|後屈|中間位|外反|内反|水平)\s+(.+)$/);
  if (!match) return { dir: '', value: raw };
  return { dir: match[1], value: match[2] };
}

function setMetric(id, text, tone) {
  const node = document.getElementById(id);
  if (!node) return;
  const safe = text == null || text === '' ? '—' : String(text);
  const parts = splitClinical(safe);
  const dirNode = node.querySelector('.hud-dir');
  if (dirNode && dirNode.textContent !== parts.dir) dirNode.textContent = parts.dir;
  const value = node.querySelector('.metric-value');
  if (value) paintMeasure(value, parts.value || '—', uncertaintyKind(id));
  const nextTone = safe === '—' ? 'none' : (tone || 'none');
  if (node.dataset.tone !== nextTone) node.dataset.tone = nextTone;
}

function setAngleMetric(id, view) {
  if (!view || view.val === '—') {
    setMetric(id, '—', 'none');
    return;
  }
  const tone = view.status === 'alert' || view.status === 'warn' || view.status === 'ok'
    ? view.status
    : (view.isWarning ? 'warn' : 'ok');
  setMetric(id, view.text, tone);
}

function setClinicalBadge(id, view) {
  const node = document.getElementById(id);
  if (!node) return;
  node.textContent = view && view.badge ? view.badge : '';
}

function frontalMetric(view) {
  if (!view || view.text == null || view.text === '' || view.text === '—' || view.val === '—') {
    return { text: '—', status: 'none' };
  }
  return { text: view.text, status: view.status || 'none' };
}

function updateFrontalSummary() {
  const frontal = state.frontal;
  if (!frontal || !frontal.ok) {
    setMetric('metric-head-tilt', '—', 'none');
    setMetric('metric-shoulder-level', '—', 'none');
    setMetric('metric-pelvis-level', '—', 'none');
    setMetric('metric-cog', '—', 'none');
    setMetric('metric-knee-right', '—', 'none');
    setMetric('metric-knee-left', '—', 'none');
    setClinicalBadge('metric-knee-right-judge', null);
    setClinicalBadge('metric-knee-left-judge', null);
    return;
  }
  const head = frontalMetric(frontal.headTilt);
  const shoulder = frontalMetric(frontal.shoulderLevel);
  const pelvis = frontalMetric(frontal.pelvisLevel);
  const cog = frontalMetric(frontal.cogShift);
  const rightKnee = frontalMetric(frontal.rightKnee);
  const leftKnee = frontalMetric(frontal.leftKnee);
  setMetric('metric-head-tilt', head.text, head.status);
  setMetric('metric-shoulder-level', shoulder.text, shoulder.status);
  setMetric('metric-pelvis-level', pelvis.text, pelvis.status);
  setMetric('metric-cog', cog.text, cog.status);
  setMetric('metric-knee-right', rightKnee.text, rightKnee.status);
  setMetric('metric-knee-left', leftKnee.text, leftKnee.status);
  setClinicalBadge('metric-knee-right-judge', rightKnee.text === '—' ? null : frontal.rightKnee);
  setClinicalBadge('metric-knee-left-judge', leftKnee.text === '—' ? null : frontal.leftKnee);
}

function updateSummary() {
  if (state.plane === 'frontal') {
    updateFrontalSummary();
    updateRom();
    updateNotes();
    return;
  }
  const alignment = state.alignment;
  const judge = document.getElementById('metric-knee-judge');
  const format = RM.ClinicalAngleFormatter;
  if (!alignment || !alignment.ok || !alignment.points) {
    setMetric('metric-ear', '—', 'none');
    setMetric('metric-shoulder', '—', 'none');
    setMetric('metric-hip', '—', 'none');
    setMetric('metric-knee', '—', 'none');
    setMetric('metric-trunk', '—', 'none');
    setMetric('metric-neck', '—', 'none');
    if (judge) judge.textContent = '';
  } else {
    setMetric('metric-ear', RM.formatDeviation(alignment.points.ear && alignment.points.ear.cm), RM.deviationTone(alignment.points.ear && alignment.points.ear.cm));
    setMetric('metric-shoulder', RM.formatDeviation(alignment.points.shoulder && alignment.points.shoulder.cm), RM.deviationTone(alignment.points.shoulder && alignment.points.shoulder.cm));
    setMetric('metric-hip', RM.formatDeviation(alignment.points.hip && alignment.points.hip.cm), RM.deviationTone(alignment.points.hip && alignment.points.hip.cm));
    const kneeView = format.formatKnee(alignment.kneeAngleDeg);
    setMetric('metric-knee', kneeView.text, RM.kneeTone(alignment.kneeAngleDeg));
    if (judge) judge.textContent = kneeView.val === '—' ? '' : (kneeView.badge || '');
    const rom = alignment.rom || {};
    setAngleMetric('metric-trunk', format.formatTrunk(rom.trunkDeg));
    setAngleMetric('metric-neck', format.formatNeck(rom.neckDeg));
  }
  updateRom();
  updateNotes();
}

function clinicalTone(view) {
  if (!view || view.val === '—') return 'none';
  if (view.status === 'alert' || view.status === 'warn' || view.status === 'ok') return view.status;
  return view.isWarning ? 'warn' : 'ok';
}

function paintRomValue(node, val, kind) {
  const raw = val || '—';
  const stamp = raw + '|' + (kind || '');
  if (node.dataset.raw === stamp) return;
  node.dataset.raw = stamp;
  node.textContent = '';
  if (raw === '—') {
    node.textContent = '—';
    return;
  }
  const showBand = /\d/.test(raw);
  if (!/^\d+(?:\.\d+)?°$/.test(raw)) {
    node.textContent = raw;
    if (showBand) appendUncertainty(node, kind);
    return;
  }
  const numeric = raw.replace('°', '');
  node.appendChild(document.createTextNode(numeric));
  const unit = document.createElement('small');
  unit.textContent = '°';
  node.appendChild(unit);
  if (showBand) appendUncertainty(node, kind);
}

function setRom(id, view) {
  const node = document.getElementById(id);
  if (!node) return;
  const missing = !view || view.val === '—';
  paintRomValue(node, missing ? '—' : view.val, uncertaintyKind(id));
  const dirNode = document.getElementById(id + '-dir');
  const dir = missing ? '' : (view.dir || '');
  if (dirNode && dirNode.textContent !== dir) dirNode.textContent = dir;
  const badgeNode = document.getElementById(id + '-badge');
  const badge = missing ? '' : (view.badge || '');
  if (badgeNode && badgeNode.textContent !== badge) badgeNode.textContent = badge;
  if (badgeNode) {
    badgeNode.className = 'rom-badge' + (missing || !view.status ? '' : ' ' + view.status);
  }
  const row = node.closest('.rom-item') || node.closest('.rom-row');
  const tone = clinicalTone(missing ? null : view);
  if (row && row.dataset.tone !== tone) row.dataset.tone = tone;
}

function updateRom() {
  syncSwayKeyLabels();
  if (state.plane === 'frontal') {
    updateFrontalRom();
    return;
  }
  setRomJoints(false);
  const alignment = state.alignment;
  const rom = alignment && alignment.rom;
  const sideNote = document.getElementById('rom-side');
  const format = RM.ClinicalAngleFormatter;
  if (!alignment || !alignment.ok || !rom) {
    setRom('rom-shoulder', null);
    setRom('rom-elbow', null);
    setRom('rom-neck', null);
    setRom('rom-trunk', null);
    setRom('rom-hip', null);
    setRom('rom-knee', null);
    if (sideNote) sideNote.textContent = '手前側の腕と体幹を計測します。';
    return;
  }
  setRom('rom-shoulder', format.formatShoulder(rom.shoulderDeg));
  setRom('rom-elbow', format.formatElbow(rom.elbowDeg));
  setRom('rom-neck', format.formatNeck(rom.neckDeg));
  setRom('rom-trunk', format.formatTrunk(rom.trunkDeg));
  setRom('rom-hip', format.formatHip(rom.hipDeg));
  setRom('rom-knee', format.formatKnee(rom.kneeDeg));
  if (sideNote) {
    sideNote.textContent = alignment.sideLabel + '側（手前）の腕・体幹・下肢です。前方は' + alignment.facingLabel + '。';
  }
}

function setRomJoints(frontal) {
  const names = frontal
    ? { 'rom-neck': '頭部側屈', 'rom-shoulder': '肩傾斜', 'rom-trunk': '骨盤傾斜', 'rom-knee': '膝アライメント', 'rom-elbow': '肘関節', 'rom-hip': '股関節' }
    : { 'rom-neck': '頚部', 'rom-shoulder': '肩関節', 'rom-trunk': '体幹', 'rom-knee': '膝関節', 'rom-elbow': '肘関節', 'rom-hip': '股関節' };
  Object.keys(names).forEach(function (id) {
    const node = document.getElementById(id);
    const label = node && node.parentElement ? node.parentElement.querySelector('.rom-joint') : null;
    if (label && label.textContent !== names[id]) label.textContent = names[id];
  });
  const title = document.querySelector('#rom-drawer .rom-head h3');
  const titleText = frontal ? '前額面アライメント' : '可動域（ROM）詳細';
  if (title && title.textContent !== titleText) title.textContent = titleText;
  const note = document.querySelector('#rom-drawer .rom-note');
  const noteText = frontal
    ? '前額面の参考値です。再生やシークはそのまま続けられます。'
    : '矢状面の参考値です。再生やシークはそのまま続けられます。';
  if (note && note.textContent !== noteText) note.textContent = noteText;
}

function frontalKneeRom(right, left) {
  function part(view, side) {
    if (!view || view.status === 'none' || !view.dir || view.val === '—') return null;
    return {
      dir: side + ' ' + view.dir,
      val: view.val,
      badge: view.badge ? side + ' ' + view.badge : '',
      status: view.status || 'ok'
    };
  }
  const parts = [part(right, '右'), part(left, '左')].filter(Boolean);
  if (!parts.length) return null;
  let status = 'ok';
  parts.forEach(function (partView) {
    if (partView.status === 'alert' || (partView.status === 'warn' && status !== 'alert')) status = partView.status;
  });
  return {
    dir: parts.map(function (partView) { return partView.dir; }).join(' / '),
    val: parts.map(function (partView) { return partView.val; }).join(' / '),
    badge: parts.map(function (partView) { return partView.badge; }).filter(Boolean).join(' / '),
    status: status
  };
}

function updateFrontalRom() {
  const frontal = state.frontal;
  const sideNote = document.getElementById('rom-side');
  setRomJoints(true);
  if (!frontal || !frontal.ok) {
    setRom('rom-neck', null);
    setRom('rom-shoulder', null);
    setRom('rom-trunk', null);
    setRom('rom-knee', null);
    setRom('rom-elbow', null);
    setRom('rom-hip', null);
    if (sideNote) sideNote.textContent = '前額面の傾斜を計測できません。';
    return;
  }
  setRom('rom-neck', frontal.headTilt);
  setRom('rom-shoulder', frontal.shoulderLevel);
  setRom('rom-trunk', frontal.pelvisLevel);
  setRom('rom-knee', frontalKneeRom(frontal.rightKnee, frontal.leftKnee));
  setRom('rom-elbow', null);
  setRom('rom-hip', null);
  if (sideNote) sideNote.textContent = '頭部側屈、肩と骨盤の傾斜、左右の膝アライメントです。';
}

function setRomOpen(open) {
  state.isRomDrawerOpen = !!open;
  const drawer = document.getElementById('rom-drawer');
  const toggle = document.getElementById('btn-rom');
  if (drawer) {
    drawer.classList.toggle('is-open', state.isRomDrawerOpen);
    drawer.setAttribute('aria-hidden', state.isRomDrawerOpen ? 'false' : 'true');
    if ('inert' in drawer) drawer.inert = !state.isRomDrawerOpen;
  }
  if (toggle) toggle.setAttribute('aria-expanded', state.isRomDrawerOpen ? 'true' : 'false');
  if (state.step === 3) renderFrameOnly();
}

function updateNotes() {
  const alignment = state.alignment;
  const frontal = state.frontal;
  const source = state.plane === 'frontal' ? frontal : alignment;
  let text = '参考表示です。診断は有資格者が行ってください。';
  if (source && source.warnings && source.warnings.length) {
    text = '参考表示。' + source.warnings[0];
  } else if (state.mode !== 'empty' && (!source || source.ok === false)) {
    text = state.plane === 'frontal'
      ? '参考表示。正面から全身を撮影してください。'
      : '参考表示。真横から全身を撮影してください。';
  }
  if (!note || note.textContent === text) return;
  note.textContent = text;
  note.title = text;
}

function syncPlaneControls() {
  if (wrapper) wrapper.dataset.plane = state.plane;
  const sagittal = document.getElementById('plane-sagittal');
  const frontal = document.getElementById('plane-frontal');
  if (sagittal) {
    const on = state.plane !== 'frontal';
    sagittal.classList.toggle('is-active', on);
    sagittal.setAttribute('aria-pressed', on ? 'true' : 'false');
  }
  if (frontal) {
    const on = state.plane === 'frontal';
    frontal.classList.toggle('is-active', on);
    frontal.setAttribute('aria-pressed', on ? 'true' : 'false');
  }
  syncSwayKeyLabels();
}

function showNotice(message) {
  const toast = document.getElementById('plane-toast');
  if (!toast) return;
  toast.textContent = message || '';
  toast.hidden = false;
  if (state.toastTimer) global.clearTimeout(state.toastTimer);
  state.toastTimer = global.setTimeout(function () {
    toast.hidden = true;
    state.toastTimer = 0;
  }, 2200);
}

function showPlaneToast(plane, mode) {
  const toast = document.getElementById('plane-toast');
  if (!toast) return;
  if (mode === 'suggest') {
    toast.textContent = plane === 'frontal'
      ? '前額面（正面）の可能性があります'
      : '矢状面（側面）の可能性があります';
  } else {
    toast.textContent = plane === 'frontal' ? '🤖 正面姿勢を検出しました' : '🤖 側面姿勢を検出しました';
  }
  toast.hidden = false;
  if (state.toastTimer) global.clearTimeout(state.toastTimer);
  state.toastTimer = global.setTimeout(function () {
    toast.hidden = true;
    state.toastTimer = 0;
  }, 2200);
}

function recordMeasure(text, kind) {
  const value = text == null || text === '' ? '—' : String(text);
  const uncertainty = value === '—' || typeof RM.formatUncertainty !== 'function'
    ? ''
    : RM.formatUncertainty(kind);
  return { text: value, uncertainty: uncertainty };
}

function localRecordedAt(date) {
  function pad(number) { return String(number).padStart(2, '0'); }
  const offsetMin = -date.getTimezoneOffset();
  const sign = offsetMin >= 0 ? '+' : '-';
  const absolute = Math.abs(offsetMin);
  return date.getFullYear()
    + '-' + pad(date.getMonth() + 1)
    + '-' + pad(date.getDate())
    + 'T' + pad(date.getHours())
    + ':' + pad(date.getMinutes())
    + ':' + pad(date.getSeconds())
    + sign + pad(Math.floor(absolute / 60))
    + ':' + pad(absolute % 60);
}

function buildMeasurementRecord() {
  const format = RM.ClinicalAngleFormatter;
  const alignment = state.alignment;
  const frontal = state.frontal;
  const sagittalOk = !!(alignment && alignment.ok && alignment.points);
  const frontalOk = !!(frontal && frontal.ok);
  const showingFrontal = state.plane === 'frontal';
  const active = showingFrontal ? frontal : alignment;
  const rom = alignment && alignment.rom ? alignment.rom : {};
  const version = RM.VERSION || null;
  const band = RM.UNCERTAINTY || null;
  let mediaTimeSec = null;
  if (state.mode === 'video' && video && Number.isFinite(video.currentTime) && video.currentTime >= 0) {
    mediaTimeSec = Math.round(video.currentTime * 1000) / 1000;
  }
  const sagittal = {
    ear: recordMeasure(sagittalOk ? RM.formatDeviation(alignment.points.ear && alignment.points.ear.cm) : '—', 'cm'),
    shoulder: recordMeasure(sagittalOk ? RM.formatDeviation(alignment.points.shoulder && alignment.points.shoulder.cm) : '—', 'cm'),
    hip: recordMeasure(sagittalOk ? RM.formatDeviation(alignment.points.hip && alignment.points.hip.cm) : '—', 'cm'),
    knee: recordMeasure(sagittalOk && format ? format.formatKnee(alignment.kneeAngleDeg).text : '—', 'joint'),
    trunk: recordMeasure(sagittalOk && format ? format.formatTrunk(rom.trunkDeg).text : '—', 'joint'),
    neck: recordMeasure(sagittalOk && format ? format.formatNeck(rom.neckDeg).text : '—', 'joint')
  };
  const frontalMeasures = {
    headTilt: recordMeasure(frontalOk ? frontal.headTilt && frontal.headTilt.text : '—', 'tilt'),
    shoulderLevel: recordMeasure(frontalOk ? frontal.shoulderLevel && frontal.shoulderLevel.text : '—', 'tilt'),
    pelvisLevel: recordMeasure(frontalOk ? frontal.pelvisLevel && frontal.pelvisLevel.text : '—', 'tilt'),
    cog: recordMeasure(frontalOk ? frontal.cogShift && frontal.cogShift.text : '—', 'cm'),
    kneeRight: recordMeasure(frontalOk ? frontal.rightKnee && frontal.rightKnee.text : '—', 'joint'),
    kneeLeft: recordMeasure(frontalOk ? frontal.leftKnee && frontal.leftKnee.text : '—', 'joint')
  };
  return {
    recordedAt: localRecordedAt(new Date()),
    fileName: state.sourceName || '',
    heightCm: state.heightCm,
    plane: showingFrontal ? 'frontal' : 'sagittal',
    mediaTimeSec: mediaTimeSec,
    version: version ? {
      model: version.model,
      engine: version.engine,
      fullString: version.fullString
    } : null,
    uncertainty: band ? {
      deviationCm: band.deviationCm,
      jointDeg: band.jointDeg,
      tiltDeg: band.tiltDeg
    } : null,
    ok: showingFrontal ? frontalOk : sagittalOk,
    warnings: active && active.warnings ? active.warnings.slice() : [],
    measures: showingFrontal ? frontalMeasures : sagittal,
    rom: showingFrontal ? {
      neck: recordMeasure(frontalOk ? frontal.headTilt && frontal.headTilt.text : '—', 'tilt'),
      shoulder: recordMeasure(frontalOk ? frontal.shoulderLevel && frontal.shoulderLevel.text : '—', 'tilt'),
      trunk: recordMeasure(frontalOk ? frontal.pelvisLevel && frontal.pelvisLevel.text : '—', 'tilt'),
      elbow: recordMeasure('—', 'joint'),
      hip: recordMeasure('—', 'joint'),
      kneeRight: recordMeasure(frontalOk ? frontal.rightKnee && frontal.rightKnee.text : '—', 'joint'),
      kneeLeft: recordMeasure(frontalOk ? frontal.leftKnee && frontal.leftKnee.text : '—', 'joint')
    } : {
      shoulder: recordMeasure(sagittalOk && format ? format.formatShoulder(rom.shoulderDeg).text : '—', 'joint'),
      elbow: recordMeasure(sagittalOk && format ? format.formatElbow(rom.elbowDeg).text : '—', 'joint'),
      neck: recordMeasure(sagittalOk && format ? format.formatNeck(rom.neckDeg).text : '—', 'joint'),
      trunk: recordMeasure(sagittalOk && format ? format.formatTrunk(rom.trunkDeg).text : '—', 'joint'),
      hip: recordMeasure(sagittalOk && format ? format.formatHip(rom.hipDeg).text : '—', 'joint'),
      knee: recordMeasure(sagittalOk && format ? format.formatKnee(rom.kneeDeg).text : '—', 'joint')
    }
  };
}

function formatClock(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '00:00';
  const total = Math.floor(seconds);
  const minutes = Math.floor(total / 60);
  const remain = total % 60;
  return String(minutes).padStart(2, '0') + ':' + String(remain).padStart(2, '0');
}

function updateTimeLabel() {
  if (state.mode === 'image') {
    timeLabel.textContent = '静止画';
    return;
  }
  if (state.mode !== 'video') {
    timeLabel.textContent = '00:00 / 00:00';
    return;
  }
  timeLabel.textContent = formatClock(video.currentTime) + ' / ' + formatClock(video.duration);
}

function updateSeek() {
  if (state.scrubbing) return;
  if (state.mode !== 'video' || !Number.isFinite(video.duration) || video.duration <= 0) {
    seek.value = '0';
    return;
  }
  seek.value = String(Math.round((video.currentTime / video.duration) * 1000));
}

function updateSourceLabel() {
  const label = state.sourceName || 'メディア未選択';
  sourceLabel.textContent = label;
  mediaName.textContent = state.sourceName ? '読み込み済み: ' + state.sourceName : 'メディア未選択';
}

function setPickStatus(text, tone) {
  pickStatus.textContent = text;
  if (tone) pickStatus.dataset.tone = tone;
  else pickStatus.removeAttribute('data-tone');
}

function syncPlayButton() {
  const playing = state.mode === 'video' && !video.paused && !video.ended;
  playButton.textContent = playing ? '一時停止' : '再生';
  playButton.setAttribute('aria-pressed', playing ? 'true' : 'false');
}

function syncTransport() {
  const videoMode = state.mode === 'video';
  playButton.disabled = !videoMode;
  frameBackButton.disabled = !videoMode;
  frameForwardButton.disabled = !videoMode;
  seek.disabled = !videoMode;
  syncPlayButton();
  updateTimeLabel();
  updateSeek();
}

function syncPillarbox() {
  if (!wrapper || state.step !== 3) return;
  const rect = wrapper.getBoundingClientRect();
  const size = currentMediaSize();
  let bar = Math.round(rect.width * 0.16);
  if (rect.width > 2 && rect.height > 2 && size.width > 0 && size.height > 0) {
    const bounds = RM.getAspectFitBounds(rect.width, rect.height, size.width, size.height);
    bar = Math.max(0, Math.round(bounds.x));
  }
  wrapper.style.setProperty('--pillar', bar + 'px');
}

function setClinicalUseOpen(open) {
  const dialog = document.getElementById('clinical-use');
  const opener = document.getElementById('btn-clinical-use');
  if (!dialog) return;
  const on = !!open;
  dialog.hidden = !on;
  dialog.classList.toggle('is-open', on);
  dialog.setAttribute('aria-hidden', on ? 'false' : 'true');
  const close = document.getElementById('btn-clinical-use-close');
  if (on && close) close.focus();
  else if (!on && opener) opener.focus();
}

function bindClinicalUse() {
  const opener = document.getElementById('btn-clinical-use');
  const dialog = document.getElementById('clinical-use');
  const close = document.getElementById('btn-clinical-use-close');
  if (opener) opener.addEventListener('click', function () { setClinicalUseOpen(true); });
  if (close) close.addEventListener('click', function () { setClinicalUseOpen(false); });
  if (dialog) {
    dialog.addEventListener('click', function (event) {
      if (event.target === dialog) setClinicalUseOpen(false);
    });
  }
  document.addEventListener('keydown', function (event) {
    if (event.key !== 'Escape' || !dialog || dialog.hidden) return;
    setClinicalUseOpen(false);
  });
}

bindClinicalUse();

  RM.canvasLabel = canvasLabel;
  RM.setSwayTarget = setSwayTarget;
  RM.paintMeasure = paintMeasure;
  RM.splitClinical = splitClinical;
  RM.setMetric = setMetric;
  RM.setAngleMetric = setAngleMetric;
  RM.setClinicalBadge = setClinicalBadge;
  RM.updateFrontalSummary = updateFrontalSummary;
  RM.updateSummary = updateSummary;
  RM.clinicalTone = clinicalTone;
  RM.paintRomValue = paintRomValue;
  RM.setRom = setRom;
  RM.updateRom = updateRom;
  RM.setRomOpen = setRomOpen;
  RM.updateNotes = updateNotes;
  RM.syncPlaneControls = syncPlaneControls;
  RM.showPlaneToast = showPlaneToast;
  RM.showNotice = showNotice;
  RM.buildMeasurementRecord = buildMeasurementRecord;
  RM.formatClock = formatClock;
  RM.updateTimeLabel = updateTimeLabel;
  RM.updateSeek = updateSeek;
  RM.updateSourceLabel = updateSourceLabel;
  RM.setPickStatus = setPickStatus;
  RM.syncPlayButton = syncPlayButton;
  RM.syncTransport = syncTransport;
  RM.syncPillarbox = syncPillarbox;
  RM.setClinicalUseOpen = setClinicalUseOpen;
})(typeof window !== 'undefined' ? window : globalThis);
