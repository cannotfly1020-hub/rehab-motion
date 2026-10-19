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
      + '、肩峰 ' + (frontal.shoulderLevel && frontal.shoulderLevel.text)
      + '、骨盤 ' + (frontal.pelvisLevel && frontal.pelvisLevel.text)
      + '、重心 ' + (frontal.cogShift && frontal.cogShift.text)
      + '。';
  }
  const base = '矢状面姿勢アライメント。左上をタップするとAI認識ステータスの表示を切り替えます。';
  const alignment = state.alignment;
  if (!alignment || !alignment.ok || !alignment.points) return base;
  return base
    + ' 耳垂 ' + RM.formatDeviation(alignment.points.ear && alignment.points.ear.cm)
    + '、肩峰 ' + RM.formatDeviation(alignment.points.shoulder && alignment.points.shoulder.cm)
    + '、大転子 ' + RM.formatDeviation(alignment.points.hip && alignment.points.hip.cm)
    + '、膝 ' + RM.ClinicalAngleFormatter.formatKnee(alignment.kneeAngleDeg).text
    + '。';
}

function setSwayTarget(target) {
  const allowed = { ear: true, shoulder: true, hip: true, knee: true };
  state.swayTarget = allowed[target] ? target : 'ear';
  Array.prototype.forEach.call(swayButtons, function (button) {
    const on = button.getAttribute('data-joint') === state.swayTarget;
    button.classList.toggle('is-active', on);
    button.setAttribute('aria-pressed', on ? 'true' : 'false');
  });
  drawSwayChart();
}

function paintMeasure(node, text) {
  const raw = String(text);
  if (node.dataset.raw === raw) return;
  node.dataset.raw = raw;
  node.textContent = '';
  const match = raw.match(/^(.*?)(\s*)(cm|°)(.*)$/);
  if (!match) {
    node.textContent = raw;
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
}

function splitClinical(text) {
  const raw = String(text || '—');
  if (raw === '—') return { dir: '', value: '—' };
  if (raw === '正常アライメント') return { dir: '正常アライメント', value: '' };
  const match = raw.match(/^(右偏位|左偏位|右下がり|左下がり|右側屈|左側屈|正常アライメント|正中|前|後|屈曲|伸展位|過伸展|伸展|前傾|後傾|垂直|前屈|後屈|中間位|外反|内反|水平)\s+(.+)$/);
  if (!match) return { dir: '', value: raw };
  return { dir: match[1], value: match[2] };
}

function setMetric(id, text, tone) {
  const node = document.getElementById(id);
  if (!node) return;
  const parts = splitClinical(text);
  const dirNode = node.querySelector('.hud-dir');
  if (dirNode && dirNode.textContent !== parts.dir) dirNode.textContent = parts.dir;
  const value = node.querySelector('.metric-value');
  if (value) paintMeasure(value, parts.value);
  if (node.dataset.tone !== tone) node.dataset.tone = tone;
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
  setMetric('metric-head-tilt', frontal.headTilt.text, frontal.headTilt.status);
  setMetric('metric-shoulder-level', frontal.shoulderLevel.text, frontal.shoulderLevel.status);
  setMetric('metric-pelvis-level', frontal.pelvisLevel.text, frontal.pelvisLevel.status);
  setMetric('metric-cog', frontal.cogShift.text, frontal.cogShift.status);
  setMetric('metric-knee-right', frontal.rightKnee.text, frontal.rightKnee.status);
  setMetric('metric-knee-left', frontal.leftKnee.text, frontal.leftKnee.status);
  setClinicalBadge('metric-knee-right-judge', frontal.rightKnee);
  setClinicalBadge('metric-knee-left-judge', frontal.leftKnee);
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
    setMetric('metric-ear', RM.formatDeviation(alignment.points.ear.cm), RM.deviationTone(alignment.points.ear.cm));
    setMetric('metric-shoulder', RM.formatDeviation(alignment.points.shoulder.cm), RM.deviationTone(alignment.points.shoulder.cm));
    setMetric('metric-hip', RM.formatDeviation(alignment.points.hip.cm), RM.deviationTone(alignment.points.hip.cm));
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

function paintRomValue(node, val) {
  const raw = val || '—';
  if (node.dataset.raw === raw) return;
  node.dataset.raw = raw;
  node.textContent = '';
  if (raw === '—') {
    node.textContent = '—';
    return;
  }
  const numeric = String(raw).replace('°', '');
  node.appendChild(document.createTextNode(numeric));
  const unit = document.createElement('small');
  unit.textContent = '°';
  node.appendChild(unit);
}

function setRom(id, view) {
  const node = document.getElementById(id);
  if (!node) return;
  const missing = !view || view.val === '—';
  paintRomValue(node, missing ? '—' : view.val);
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
  const lines = [];
  if (state.plane === 'frontal' && state.frontal && state.frontal.ok) {
    lines.push('前額面として左右対称と水平傾斜を計測しています。');
    lines.push('校正は身長 ' + state.frontal.heightCm + ' cm の 94% を頭頂〜外果に対応づけています。');
  } else if (alignment && alignment.ok) {
    lines.push(alignment.sideLabel + '側面を計測。前方は' + alignment.facingLabel + '。');
    lines.push('校正は身長 ' + alignment.heightCm + ' cm の 94% を頭頂〜外果に対応づけています。');
  } else if (state.mode !== 'empty') {
    lines.push('姿勢を計測できません。全身の真横が写るように調整してください。');
  }
  if (alignment && alignment.warnings && alignment.warnings.length) {
    alignment.warnings.forEach(function (warning) { lines.push(warning); });
  }
  lines.push('参考表示です。診断は有資格者が行ってください。');
  const text = lines.join(' ');
  if (note.textContent !== text) note.textContent = text;
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
}

function showPlaneToast(plane) {
  const toast = document.getElementById('plane-toast');
  if (!toast) return;
  toast.textContent = plane === 'frontal' ? '🤖 正面姿勢を検出しました' : '🤖 側面姿勢を検出しました';
  toast.hidden = false;
  if (state.toastTimer) global.clearTimeout(state.toastTimer);
  state.toastTimer = global.setTimeout(function () {
    toast.hidden = true;
    state.toastTimer = 0;
  }, 2200);
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
  RM.formatClock = formatClock;
  RM.updateTimeLabel = updateTimeLabel;
  RM.updateSeek = updateSeek;
  RM.updateSourceLabel = updateSourceLabel;
  RM.setPickStatus = setPickStatus;
  RM.syncPlayButton = syncPlayButton;
  RM.syncTransport = syncTransport;
  RM.syncPillarbox = syncPillarbox;
})(typeof window !== 'undefined' ? window : globalThis);
