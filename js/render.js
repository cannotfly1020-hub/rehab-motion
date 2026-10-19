(function (global) {
  'use strict';

  const RM = global.RehabMotion = global.RehabMotion || {};
  const FONT = '-apple-system, BlinkMacSystemFont, "SF Pro Display", "Segoe UI", Roboto, "Hiragino Sans", sans-serif';

  RM.hudHitRect = { x: 0, y: 0, width: 0, height: 0 };

  const FALLBACK_THRESHOLDS = {
    deviationOkCm: 1.5,
    deviationWarnCm: 3.0,
    recurvatumDeg: -5,
    flexionNotableDeg: 5,
    minVisibility: 0.5,
    drawVisibility: 0.35
  };

  function thresholds() {
    return RM.THRESHOLDS || FALLBACK_THRESHOLDS;
  }

  function toneColor(tone) {
    if (tone === 'ok') return '#34d399';
    if (tone === 'warn') return '#fbbf24';
    if (tone === 'alert') return '#f43f5e';
    return '#94a3b8';
  }

  function deviationColor(cm) {
    const tone = typeof RM.deviationTone === 'function' ? RM.deviationTone(cm) : 'none';
    return toneColor(tone);
  }

  function kneeColor(angle) {
    const tone = typeof RM.kneeTone === 'function' ? RM.kneeTone(angle) : 'none';
    return toneColor(tone);
  }

  RM.getAspectFitBounds = function getAspectFitBounds(canvasWidth, canvasHeight, mediaWidth, mediaHeight) {
    const canvasW = Math.max(0, Number(canvasWidth) || 0);
    const canvasH = Math.max(0, Number(canvasHeight) || 0);
    const mediaW = Number(mediaWidth) || 0;
    const mediaH = Number(mediaHeight) || 0;
    if (!canvasW || !canvasH || !mediaW || !mediaH) {
      return { x: 0, y: 0, width: canvasW, height: canvasH };
    }
    const scale = Math.min(canvasW / mediaW, canvasH / mediaH);
    const width = mediaW * scale;
    const height = mediaH * scale;
    return {
      x: (canvasW - width) / 2,
      y: (canvasH - height) / 2,
      width: width,
      height: height
    };
  };

  RM.hitTestHud = function hitTestHud(x, y) {
    const rect = RM.hudHitRect;
    if (!rect || rect.width <= 0 || rect.height <= 0) return false;
    return x >= rect.x && y >= rect.y && x <= rect.x + rect.width && y <= rect.y + rect.height;
  };

  function cssScale(canvas) {
    const cssWidth = canvas.clientWidth || canvas.width || 1;
    return canvas.width / cssWidth || 1;
  }

  function roundedRect(ctx, x, y, width, height, radius) {
    const r = Math.max(0, Math.min(radius, width / 2, height / 2));
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + width, y, x + width, y + height, r);
    ctx.arcTo(x + width, y + height, x, y + height, r);
    ctx.arcTo(x, y + height, x, y, r);
    ctx.arcTo(x, y, x + width, y, r);
    ctx.closePath();
  }

  function mediaPixelSize(media, frame) {
    const width = (frame && frame.mediaWidth) || (media && (media.videoWidth || media.naturalWidth)) || 0;
    const height = (frame && frame.mediaHeight) || (media && (media.videoHeight || media.naturalHeight)) || 0;
    return { width: width, height: height };
  }

  function canDrawMedia(media) {
    if (!media) return false;
    const width = media.videoWidth || media.naturalWidth || media.width || 0;
    const height = media.videoHeight || media.naturalHeight || media.height || 0;
    if (!width || !height) return false;
    if (typeof HTMLImageElement !== 'undefined' && media instanceof HTMLImageElement) {
      return media.complete;
    }
    return true;
  }

  function drawEmptyState(ctx, canvas, scale, message, hint) {
    const centerX = canvas.width / 2;
    ctx.save();
    ctx.shadowColor = 'rgba(16, 185, 129, 0.4)';
    ctx.shadowBlur = 8 * scale;
    ctx.setLineDash([6 * scale, 6 * scale]);
    ctx.lineWidth = 2 * scale;
    ctx.strokeStyle = '#10b981';
    ctx.beginPath();
    ctx.moveTo(centerX, canvas.height * 0.16);
    ctx.lineTo(centerX, canvas.height * 0.84);
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.setLineDash([]);
    ctx.fillStyle = '#e2e8f0';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const maxText = canvas.width * 0.78;
    ctx.font = '600 ' + Math.round(15 * scale) + 'px ' + FONT;
    const lines = wrapText(ctx, message || '横向きの立位動画または写真を選択してください', maxText);
    ctx.font = '500 ' + Math.round(12 * scale) + 'px ' + FONT;
    const hintLines = hint ? wrapText(ctx, hint, maxText) : [];
    const lineHeight = 22 * scale;
    const hintHeight = 16 * scale;
    const blockHeight = lines.length * lineHeight + hintLines.length * hintHeight;
    let y = canvas.height * 0.5 - blockHeight / 2;
    ctx.font = '600 ' + Math.round(15 * scale) + 'px ' + FONT;
    lines.forEach(function (line) {
      ctx.fillText(line, centerX, y);
      y += lineHeight;
    });
    if (hintLines.length) {
      ctx.fillStyle = '#94a3b8';
      ctx.font = '500 ' + Math.round(12 * scale) + 'px ' + FONT;
      hintLines.forEach(function (line) {
        ctx.fillText(line, centerX, y);
        y += hintHeight;
      });
    }
    ctx.restore();
  }

  function wrapText(ctx, text, maxWidth) {
    const source = String(text || '');
    const chars = Array.from(source);
    const lines = [];
    let current = '';
    for (let i = 0; i < chars.length; i += 1) {
      const next = current + chars[i];
      if (current && ctx.measureText(next).width > maxWidth) {
        lines.push(current);
        current = chars[i];
      } else {
        current = next;
      }
    }
    if (current) lines.push(current);
    return lines.length ? lines : [''];
  }

  function drawArm(ctx, alignment, scale) {
    const points = alignment.points;
    const minVis = thresholds().drawVisibility;
    const chain = [points.shoulder, points.elbow, points.wrist].filter(function (point) {
      return point && point.visibility >= minVis;
    });
    if (chain.length < 2) return;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(chain[0].x, chain[0].y);
    for (let i = 1; i < chain.length; i += 1) ctx.lineTo(chain[i].x, chain[i].y);
    ctx.lineWidth = 2 * scale;
    ctx.strokeStyle = 'rgba(52, 211, 153, 0.9)';
    ctx.stroke();
    chain.forEach(function (point) {
      if (point === points.shoulder) return;
      drawDot(ctx, point, '#34d399', 3.6 * scale, scale);
    });
    ctx.restore();
  }

  function drawChain(ctx, alignment, scale) {
    const points = alignment.points;
    const minVis = thresholds().drawVisibility;
    const chain = [points.ear, points.shoulder, points.hip, points.knee, points.ankle]
      .filter(function (point) { return point && point.visibility >= minVis; });
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.setLineDash([]);
    if (chain.length >= 2) {
      ctx.beginPath();
      ctx.moveTo(chain[0].x, chain[0].y);
      for (let i = 1; i < chain.length; i += 1) ctx.lineTo(chain[i].x, chain[i].y);
      ctx.lineWidth = 5 * scale;
      ctx.strokeStyle = 'rgba(15, 23, 42, 0.45)';
      ctx.stroke();
      ctx.lineWidth = 2 * scale;
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.92)';
      ctx.stroke();
    }
    if (points.ankle && points.heel && points.toe
      && points.heel.visibility >= minVis && points.toe.visibility >= minVis) {
      ctx.beginPath();
      ctx.moveTo(points.ankle.x, points.ankle.y);
      ctx.lineTo(points.heel.x, points.heel.y);
      ctx.lineTo(points.toe.x, points.toe.y);
      ctx.lineWidth = 2 * scale;
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.7)';
      ctx.stroke();
      drawDot(ctx, points.heel, '#cbd5e1', 3.2 * scale, scale);
      drawDot(ctx, points.toe, '#cbd5e1', 3.2 * scale, scale);
    }
    ctx.restore();
  }

  function drawDot(ctx, point, color, radius, scale) {
    ctx.beginPath();
    ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
    ctx.fillStyle = '#0f172a';
    ctx.fill();
    ctx.lineWidth = Math.max(1, 2 * scale);
    ctx.strokeStyle = color;
    ctx.stroke();
  }

  function drawPlumbLine(ctx, canvas, originX, scale) {
    if (!Number.isFinite(originX)) return;
    ctx.save();
    ctx.lineCap = 'butt';
    // 破線 6px・発光 8px は CSS ピクセル。キャンバスは devicePixelRatio 倍。
    ctx.shadowColor = 'rgba(16, 185, 129, 0.4)';
    ctx.shadowBlur = 8 * scale;
    ctx.setLineDash([6 * scale, 6 * scale]);
    ctx.beginPath();
    ctx.moveTo(originX, 0);
    ctx.lineTo(originX, canvas.height);
    ctx.lineWidth = 2 * scale;
    ctx.strokeStyle = '#10b981';
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.setLineDash([]);

    const label = 'Plum Line';
    ctx.font = '600 ' + Math.round(11 * scale) + 'px ' + FONT;
    const width = ctx.measureText(label).width + 12 * scale;
    const height = 18 * scale;
    const placeLeft = originX > canvas.width * 0.72;
    const x = Math.max(6 * scale, Math.min(canvas.width - width - 6 * scale, placeLeft ? originX - width - 6 * scale : originX + 6 * scale));
    const y = canvas.height - height - 10 * scale;
    roundedRect(ctx, x, y, width, height, height / 2);
    ctx.fillStyle = 'rgba(15, 23, 42, 0.75)';
    ctx.fill();
    ctx.lineWidth = Math.max(1, scale);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
    ctx.stroke();
    ctx.fillStyle = '#34d399';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, x + width / 2, y + height / 2);
    ctx.restore();
  }

  function splitMeasure(text) {
    const raw = String(text);
    const match = raw.match(/^(.*?)(\s*)(cm|°)(.*)$/);
    if (!match) return { main: raw, unit: '' };
    return { main: match[1], unit: match[3] + match[4] };
  }

  function drawBadge(ctx, x, y, text, color, scale) {
    ctx.save();
    const parts = splitMeasure(text);
    const mainSize = Math.round(12 * scale);
    const unitSize = Math.round(9 * scale);
    ctx.font = '700 ' + mainSize + 'px ' + FONT;
    const mainWidth = ctx.measureText(parts.main).width;
    let unitWidth = 0;
    if (parts.unit) {
      ctx.font = '620 ' + unitSize + 'px ' + FONT;
      unitWidth = ctx.measureText(parts.unit).width;
    }
    const gap = parts.unit ? 3 * scale : 0;
    const padX = 8 * scale;
    const width = mainWidth + gap + unitWidth + padX * 2;
    const height = 20 * scale;
    const pad = 4 * scale;
    const canvas = ctx.canvas;
    const left = Math.max(pad, Math.min(x - width / 2, canvas.width - width - pad));
    const top = Math.max(pad, Math.min(y - height / 2, canvas.height - height - pad));
    roundedRect(ctx, left, top, width, height, height / 2);
    ctx.fillStyle = 'rgba(15, 23, 42, 0.75)';
    ctx.fill();
    ctx.lineWidth = Math.max(1, 1.25 * scale);
    ctx.strokeStyle = color;
    ctx.stroke();
    ctx.textBaseline = 'middle';
    const textY = top + height / 2 + 0.5;
    let cursor = left + padX;
    ctx.font = '700 ' + mainSize + 'px ' + FONT;
    ctx.fillStyle = color;
    ctx.textAlign = 'left';
    ctx.fillText(parts.main, cursor, textY);
    if (parts.unit) {
      cursor += mainWidth + gap;
      ctx.font = '620 ' + unitSize + 'px ' + FONT;
      ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
      ctx.fillText(parts.unit, cursor, textY + 0.5 * scale);
    }
    ctx.restore();
  }

  function boxesOverlap(a, b, pad) {
    const bw = b.w != null ? b.w : b.width || 0;
    const bh = b.h != null ? b.h : b.height || 0;
    return a.x < b.x + bw + pad && a.x + a.w > b.x - pad
      && a.y < b.y + bh + pad && a.y + a.h > b.y - pad;
  }

  function measureBadge(ctx, text, scale) {
    const parts = splitMeasure(text);
    ctx.save();
    ctx.font = '700 ' + Math.round(12 * scale) + 'px ' + FONT;
    let width = ctx.measureText(parts.main).width;
    if (parts.unit) {
      ctx.font = '620 ' + Math.round(9 * scale) + 'px ' + FONT;
      width += ctx.measureText(parts.unit).width + 3 * scale;
    }
    ctx.restore();
    return {
      width: width + 16 * scale,
      height: 20 * scale
    };
  }

  function placeBadge(point, size, scale, canvas, placed) {
    const pad = 4 * scale;
    const gap = 12 * scale;
    let x = Math.max(pad + size.width / 2, Math.min(point.x, canvas.width - pad - size.width / 2));
    let y = point.y - size.height / 2 - gap;
    const obstacles = [];
    const hud = RM.hudHitRect;
    if (hud && hud.width > 0 && hud.height > 0) {
      obstacles.push({ x: hud.x, y: hud.y, w: hud.width, h: hud.height });
    }
    (placed || []).forEach(function (box) { obstacles.push(box); });

    function boxAt(cx, cy) {
      return { x: cx - size.width / 2, y: cy - size.height / 2, w: size.width, h: size.height };
    }
    function blocked(cx, cy) {
      const box = boxAt(cx, cy);
      if (cy - size.height / 2 < pad || cy + size.height / 2 > canvas.height - pad) return true;
      const coversPoint = point.x >= box.x && point.x <= box.x + box.w
        && point.y >= box.y - 2 * scale && point.y <= box.y + box.h + 2 * scale;
      if (coversPoint) return true;
      return obstacles.some(function (other) { return boxesOverlap(box, other, 4 * scale); });
    }

    let guard = 0;
    while (blocked(x, y) && guard < 12) {
      y += size.height + 6 * scale;
      guard += 1;
    }
    y = Math.max(pad + size.height / 2, Math.min(canvas.height - pad - size.height / 2, y));
    if (placed) placed.push(boxAt(x, y));
    return { x: x, y: y };
  }

  function clinicalKneeLabel(angle) {
    const format = RM.ClinicalAngleFormatter || RM.RomFormatter;
    if (!format || typeof format.formatKnee !== 'function') return '膝: —';
    const view = format.formatKnee(angle);
    if (!view || view.val === '—') return '膝: —';
    return '膝: ' + view.text;
  }

  function drawConnectors(ctx, canvas, alignment, scale) {
    const originX = alignment.originX;
    const joints = [alignment.points.ear, alignment.points.shoulder, alignment.points.hip];
    const placed = [];
    ctx.save();
    ctx.lineCap = 'round';
    ctx.setLineDash([]);
    joints.forEach(function (point) {
      if (!point || point.visibility < thresholds().drawVisibility) return;
      const color = typeof point.cm === 'number' ? deviationColor(point.cm) : '#94a3b8';
      if (typeof point.cm === 'number') {
        ctx.beginPath();
        ctx.moveTo(point.x, point.y);
        ctx.lineTo(originX, point.y);
        ctx.lineWidth = 1.5 * scale;
        ctx.strokeStyle = color;
        ctx.stroke();
      }
      drawDot(ctx, point, color, 4.5 * scale, scale);
      const text = point.label + ' ' + (typeof RM.formatSignedCm === 'function'
        ? RM.formatSignedCm(point.cm)
        : '—');
      if (typeof point.cm === 'number' || point.visibility < thresholds().minVisibility) {
        const shown = typeof point.cm === 'number' ? text : point.label + ' 視認不足';
        const at = placeBadge(point, measureBadge(ctx, shown, scale), scale, canvas, placed);
        drawBadge(ctx, at.x, at.y, shown, color, scale);
      }
    });

    if (alignment.points.knee && alignment.points.knee.visibility >= thresholds().drawVisibility) {
      drawDot(ctx, alignment.points.knee, kneeColor(alignment.kneeAngleDeg), 4.5 * scale, scale);
      if (typeof alignment.kneeAngleDeg === 'number') {
        const label = clinicalKneeLabel(alignment.kneeAngleDeg);
        const at = placeBadge(alignment.points.knee, measureBadge(ctx, label, scale), scale, canvas, placed);
        drawBadge(ctx, at.x, at.y, label, kneeColor(alignment.kneeAngleDeg), scale);
      }
    }

    if (alignment.points.ankle) {
      ctx.save();
      ctx.shadowColor = 'rgba(16, 185, 129, 0.4)';
      ctx.shadowBlur = 8 * scale;
      drawDot(ctx, alignment.points.ankle, '#34d399', 6.2 * scale, scale);
      ctx.restore();
    }
    ctx.restore();
  }

  function statusLabel(status) {
    switch (status) {
      case 'loading': return '読込中';
      case 'ready': return '準備完了';
      case 'running': return '推論中';
      case 'tracking': return '追跡中';
      case 'no-pose': return '未検出';
      case 'error': return 'エラー';
      default: return '待機';
    }
  }

  function statusColor(status) {
    if (status === 'tracking' || status === 'ready') return '#34d399';
    if (status === 'running' || status === 'loading') return '#fbbf24';
    if (status === 'error' || status === 'no-pose') return '#f43f5e';
    return '#94a3b8';
  }

  function hudLines(diagnostics, alignment, collapsed) {
    const fps = diagnostics && diagnostics.fps ? diagnostics.fps : 0;
    const hasFrame = !!(diagnostics && diagnostics.frameCount > 0);
    if (collapsed) {
      return ['AI ' + (hasFrame && fps ? fps.toFixed(0) + ' fps' : '状態') + '  ▸'];
    }
    const visibility = diagnostics && typeof diagnostics.visibility === 'number' ? diagnostics.visibility : 0;
    const latency = diagnostics && typeof diagnostics.latencyMs === 'number' ? diagnostics.latencyMs : 0;
    const lines = [
      'AI認識ステータス  ▾',
      '状態  ' + statusLabel(diagnostics && diagnostics.status),
      'レイテンシ  ' + (hasFrame ? Math.round(latency) + ' ms' : '—'),
      'FPS  ' + (hasFrame && fps ? fps.toFixed(1) : '—'),
      '視認性  ' + (hasFrame ? Math.round(visibility * 100) + '%' : '—')
    ];
    if (alignment && alignment.sideLabel) {
      lines.push('側面  ' + alignment.sideLabel);
      lines.push('前方  ' + (alignment.facingLabel || '不明'));
    }
    if (alignment && typeof alignment.px2cm === 'number') {
      lines.push('校正  ' + (1 / alignment.px2cm).toFixed(3) + ' cm/px');
    }
    if (diagnostics && diagnostics.status === 'error' && diagnostics.error) {
      lines.push(diagnostics.error);
    }
    return lines;
  }

  function drawHud(ctx, canvas, frame, scale) {
    const diagnostics = frame.diagnostics || {};
    const collapsed = !!frame.hudCollapsed;
    const maxTextWidth = Math.min(canvas.width * 0.7, 260 * scale);
    ctx.save();
    ctx.font = '600 ' + Math.round(12 * scale) + 'px ' + FONT;
    const rawLines = hudLines(diagnostics, frame.alignment, collapsed);
    let lines = [];
    rawLines.forEach(function (line) {
      wrapText(ctx, line, maxTextWidth).forEach(function (part) { lines.push(part); });
    });
    if (collapsed) lines = [rawLines[0]];

    const lineHeight = 16 * scale;
    const padX = 10 * scale;
    const padY = 8 * scale;
    let widest = 0;
    lines.forEach(function (line) {
      widest = Math.max(widest, ctx.measureText(line).width);
    });
    const boxWidth = widest + padX * 2;
    const boxHeight = Math.max(collapsed ? 32 * scale : 0, lines.length * lineHeight + padY * 2);
    const x = 10 * scale;
    const y = 10 * scale;

    roundedRect(ctx, x, y, boxWidth, boxHeight, 10 * scale);
    ctx.fillStyle = 'rgba(15, 23, 42, 0.75)';
    ctx.fill();
    ctx.lineWidth = Math.max(1, scale);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
    ctx.stroke();
    ctx.lineWidth = Math.max(1, 1.25 * scale);
    ctx.strokeStyle = 'rgba(16, 185, 129, 0.45)';
    ctx.stroke();

    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    lines.forEach(function (line, index) {
      const isTitle = index === 0;
      ctx.fillStyle = isTitle ? '#34d399' : '#e2e8f0';
      if (!isTitle && line.indexOf('視認性') === 0 && diagnostics.frameCount > 0 && diagnostics.visibility < thresholds().minVisibility) {
        ctx.fillStyle = '#fbbf24';
      }
      if (!isTitle && diagnostics.status === 'error' && line === diagnostics.error) {
        ctx.fillStyle = '#fda4af';
      }
      ctx.fillText(line, x + padX, y + padY + lineHeight * index + lineHeight / 2);
    });

    const dot = statusColor(diagnostics.status);
    ctx.beginPath();
    ctx.arc(x + boxWidth - 10 * scale, y + 12 * scale, 3.2 * scale, 0, Math.PI * 2);
    ctx.fillStyle = dot;
    ctx.fill();
    ctx.restore();

    const minTap = 44 * scale;
    RM.hudHitRect = {
      x: x,
      y: y,
      width: Math.max(boxWidth, minTap),
      height: Math.max(boxHeight, minTap)
    };
  }

  RM.renderFrame = function renderFrame(ctx, frame) {
    if (!ctx) return;
    const canvas = ctx.canvas;
    const scale = cssScale(canvas);
    const safeFrame = frame || {};
    const media = safeFrame.media || null;
    const size = mediaPixelSize(media, safeFrame);

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#060911';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    let drewMedia = false;
    if (canDrawMedia(media) && size.width > 0 && size.height > 0) {
      const bounds = RM.getAspectFitBounds(canvas.width, canvas.height, size.width, size.height);
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(media, bounds.x, bounds.y, bounds.width, bounds.height);
      drewMedia = true;
    }

    if (!drewMedia) {
      drawEmptyState(ctx, canvas, scale, safeFrame.message, safeFrame.hint);
    }

    const alignment = safeFrame.alignment;
    if (alignment && alignment.ok && alignment.points && Number.isFinite(alignment.originX)) {
      drawChain(ctx, alignment, scale);
      if (safeFrame.romOpen) drawArm(ctx, alignment, scale);
      drawPlumbLine(ctx, canvas, alignment.originX, scale);
    }

    // HUD の領域を先に確定し、数値バッジを避けてからもう一度手前に描く。
    drawHud(ctx, canvas, safeFrame, scale);
    if (alignment && alignment.ok && alignment.points && Number.isFinite(alignment.originX)) {
      drawConnectors(ctx, canvas, alignment, scale);
      drawHud(ctx, canvas, safeFrame, scale);
    }
  };
})(typeof window !== 'undefined' ? window : globalThis);
