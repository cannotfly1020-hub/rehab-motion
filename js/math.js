(function (global) {
  'use strict';

  const RM = global.RehabMotion = global.RehabMotion || {};

  RM.DEFAULT_HEIGHT_CM = 160;

  RM.THRESHOLDS = Object.freeze({
    deviationOkCm: 1.5,
    deviationWarnCm: 3.0,
    recurvatumDeg: -5,
    flexionNotableDeg: 5,
    minVisibility: 0.5,
    drawVisibility: 0.35
  });

  // 頭頂は MediaPipe に無いので、外耳孔の上方を成人比で補う。
  // 頭頂〜外耳孔 ≈ 身長の 7.5%、外耳孔〜外果 ≈ 88.5%。
  const VERTEX_OFFSET_PER_EAR_MALLEOLUS = 0.075 / 0.885;
  // 頭頂〜外果は身長の 94% として校正する（仕様の 0.94）。
  const VERTEX_MALLEOLUS_OF_STATURE = 0.94;

  const SIDES = {
    right: {
      key: 'right',
      label: '右',
      ear: 8,
      shoulder: 12,
      hip: 24,
      knee: 26,
      ankle: 28,
      heel: 30,
      toe: 32
    },
    left: {
      key: 'left',
      label: '左',
      ear: 7,
      shoulder: 11,
      hip: 23,
      knee: 25,
      ankle: 27,
      heel: 29,
      toe: 31
    }
  };

  function visibilityOf(landmark) {
    if (!landmark || !Number.isFinite(landmark.x) || !Number.isFinite(landmark.y)) return 0;
    if (typeof landmark.visibility === 'number' && Number.isFinite(landmark.visibility)) {
      return Math.min(1, Math.max(0, landmark.visibility));
    }
    return 1;
  }

  function round1(value) {
    if (typeof value !== 'number' || !Number.isFinite(value)) return null;
    const rounded = Math.round(value * 10) / 10;
    return Object.is(rounded, -0) ? 0 : rounded;
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function normalizeHeight(userHeight) {
    const value = Number(userHeight);
    if (!Number.isFinite(value)) return RM.DEFAULT_HEIGHT_CM;
    return clamp(value, 50, 250);
  }

  function resolveBounds(canvasWidth, canvasHeight, bounds) {
    if (bounds && Number.isFinite(bounds.width) && bounds.width > 0 && Number.isFinite(bounds.height) && bounds.height > 0) {
      return {
        x: Number.isFinite(bounds.x) ? bounds.x : 0,
        y: Number.isFinite(bounds.y) ? bounds.y : 0,
        width: bounds.width,
        height: bounds.height
      };
    }
    return {
      x: 0,
      y: 0,
      width: Math.max(1, Number(canvasWidth) || 1),
      height: Math.max(1, Number(canvasHeight) || 1)
    };
  }

  function toCanvas(landmark, bounds) {
    if (!landmark || !Number.isFinite(landmark.x) || !Number.isFinite(landmark.y)) return null;
    return {
      x: bounds.x + landmark.x * bounds.width,
      y: bounds.y + landmark.y * bounds.height,
      visibility: visibilityOf(landmark),
      cm: null,
      label: ''
    };
  }

  function sideScore(landmarks, side) {
    return visibilityOf(landmarks[side.ear])
      + visibilityOf(landmarks[side.shoulder])
      + visibilityOf(landmarks[side.hip])
      + visibilityOf(landmarks[side.knee])
      + visibilityOf(landmarks[side.ankle])
      + visibilityOf(landmarks[side.heel])
      + visibilityOf(landmarks[side.toe]);
  }

  function pickSide(landmarks) {
    const rightAnkle = visibilityOf(landmarks[SIDES.right.ankle]);
    const leftAnkle = visibilityOf(landmarks[SIDES.left.ankle]);
    if (Math.abs(rightAnkle - leftAnkle) > 0.02) {
      return rightAnkle > leftAnkle ? SIDES.right : SIDES.left;
    }
    return sideScore(landmarks, SIDES.right) >= sideScore(landmarks, SIDES.left) ? SIDES.right : SIDES.left;
  }

  function detectFacing(landmarks, side) {
    const toe = landmarks[side.toe];
    const heel = landmarks[side.heel];
    if (visibilityOf(toe) >= 0.4 && visibilityOf(heel) >= 0.4) {
      const delta = toe.x - heel.x;
      if (Math.abs(delta) >= 0.004) {
        return { facingSign: delta > 0 ? 1 : -1, facingSource: 'foot' };
      }
    }
    const nose = landmarks[0];
    const ear = landmarks[side.ear];
    if (visibilityOf(nose) >= 0.4 && visibilityOf(ear) >= 0.4) {
      const delta = nose.x - ear.x;
      if (Math.abs(delta) >= 0.004) {
        return { facingSign: delta > 0 ? 1 : -1, facingSource: 'face' };
      }
    }
    return { facingSign: 0, facingSource: 'unknown' };
  }

  function facingText(sign) {
    if (sign > 0) return '画面右';
    if (sign < 0) return '画面左';
    return '不明';
  }

  function estimateVertex(ear, ankle) {
    const deltaY = ankle.y - ear.y;
    const span = Math.abs(deltaY);
    const offset = span * VERTEX_OFFSET_PER_EAR_MALLEOLUS;
    return {
      x: ear.x,
      y: deltaY >= 0 ? ear.y - offset : ear.y + offset,
      visibility: ear.visibility,
      cm: null,
      label: '頭頂'
    };
  }

  /**
   * 膝の臨床角度。0 が伸展中間位、正が屈曲、負が過伸展。
   * acos は左右を区別しないので、股-足線に対する膝の前後で符号を付ける。
   * 画面 Y は下向き。cross < 0 は膝が股→足線の +X 側。
   */
  function clinicalKneeAngle(hip, knee, ankle, facingSign) {
    if (!hip || !knee || !ankle || !facingSign) return null;
    const thighX = hip.x - knee.x;
    const thighY = hip.y - knee.y;
    const shankX = ankle.x - knee.x;
    const shankY = ankle.y - knee.y;
    const magnitude = Math.hypot(thighX, thighY) * Math.hypot(shankX, shankY);
    if (!Number.isFinite(magnitude) || magnitude < 1e-4) return null;

    const cosine = clamp((thighX * shankX + thighY * shankY) / magnitude, -1, 1);
    const interiorDeg = Math.acos(cosine) * 180 / Math.PI;
    const deviation = 180 - interiorDeg;
    if (deviation < 0.5) return 0;

    const lineX = ankle.x - hip.x;
    const lineY = ankle.y - hip.y;
    const kneeX = knee.x - hip.x;
    const kneeY = knee.y - hip.y;
    const cross = lineX * kneeY - lineY * kneeX;
    if (Math.abs(cross) < 1e-4) return 0;
    const isAnterior = facingSign > 0 ? cross < 0 : cross > 0;
    return (isAnterior ? 1 : -1) * deviation;
  }

  function emptyResult(heightCm, warnings, extra) {
    return Object.assign({
      ok: false,
      warnings: warnings || [],
      side: null,
      sideLabel: '',
      facingSign: 0,
      facingLabel: '不明',
      facingSource: 'unknown',
      heightCm: heightCm,
      px2cm: null,
      originX: null,
      meanVisibility: null,
      kneeAngleDeg: null,
      recurvatum: null,
      points: null
    }, extra || {});
  }

  function deviationTone(cm) {
    if (typeof cm !== 'number' || !Number.isFinite(cm)) return 'none';
    const magnitude = Math.abs(cm);
    if (magnitude <= RM.THRESHOLDS.deviationOkCm) return 'ok';
    if (magnitude <= RM.THRESHOLDS.deviationWarnCm) return 'warn';
    return 'alert';
  }

  RM.deviationTone = deviationTone;

  RM.kneeTone = function kneeTone(angle) {
    if (typeof angle !== 'number' || !Number.isFinite(angle)) return 'none';
    if (angle < RM.THRESHOLDS.recurvatumDeg) return 'alert';
    if (angle > RM.THRESHOLDS.flexionNotableDeg) return 'warn';
    return 'ok';
  };

  RM.formatSignedCm = function formatSignedCm(cm) {
    const rounded = round1(cm);
    if (rounded === null) return '—';
    if (rounded === 0) return '0.0 cm';
    return (rounded > 0 ? '+' : '') + rounded.toFixed(1) + ' cm';
  };

  RM.formatDeviation = function formatDeviation(cm) {
    const rounded = round1(cm);
    if (rounded === null) return '—';
    if (rounded === 0) return '正中 0.0 cm';
    const direction = rounded > 0 ? '前' : '後';
    return direction + ' ' + (rounded > 0 ? '+' : '') + rounded.toFixed(1) + ' cm';
  };

  RM.formatKnee = function formatKnee(angle) {
    const rounded = round1(angle);
    if (rounded === null) return '—';
    const text = (rounded > 0 ? '+' : '') + rounded.toFixed(1) + '°';
    if (rounded < RM.THRESHOLDS.recurvatumDeg) return text + '（反張）';
    if (rounded > RM.THRESHOLDS.flexionNotableDeg) return text + '（屈曲拘縮疑い）';
    return text;
  };

  RM.formatKneeJudgement = function formatKneeJudgement(angle) {
    const rounded = round1(angle);
    if (rounded === null) return '—';
    if (rounded < RM.THRESHOLDS.recurvatumDeg) return '反張膝';
    if (rounded > RM.THRESHOLDS.flexionNotableDeg) return '屈曲拘縮疑い';
    return '基準範囲';
  };

  RM.formatRecurvatum = function formatRecurvatum(recurvatum) {
    if (recurvatum === true) return '陽性';
    if (recurvatum === false) return '陰性';
    return '—';
  };

  /**
   * Kendall 矢状面アライメント。
   * 原点 X は手前側外果（visibility が高い 28 または 27）。
   * S_px2cm = |Y_top − Y_ankle| / (H_user × 0.94)
   * ΔX = (X_joint − X_origin) × FacingSign / S_px2cm
   * FacingSign は +1 で画面右が前方。正の ΔX は前方偏位。
   * 膝は大転子・膝・外果のなす角を 180° − Angle とし、
   * −5° 未満を反張膝、+5° 超を屈曲拘縮疑いとする。
   *
   * landmarks は MediaPipe 正規化座標。fitBounds を渡すとアスペクト維持後の
   * Canvas 画素へ写してから測る。省略時は Canvas 全面へ写す。
   */
  RM.calculateSagittalAlignment = function calculateSagittalAlignment(landmarks, userHeight, canvasWidth, canvasHeight, fitBounds) {
    const heightCm = normalizeHeight(userHeight);
    const warnings = [];
    if (!landmarks || landmarks.length < 33) {
      return emptyResult(heightCm, ['姿勢ランドマークが得られませんでした。']);
    }

    const bounds = resolveBounds(canvasWidth, canvasHeight, fitBounds);
    const side = pickSide(landmarks);
    const ankleVis = visibilityOf(landmarks[side.ankle]);
    const facing = detectFacing(landmarks, side);

    const leftVis = visibilityOf(landmarks[SIDES.left.ankle]);
    const rightVis = visibilityOf(landmarks[SIDES.right.ankle]);
    if (leftVis >= RM.THRESHOLDS.minVisibility && rightVis >= RM.THRESHOLDS.minVisibility) {
      const separation = Math.abs(landmarks[SIDES.left.ankle].x - landmarks[SIDES.right.ankle].x);
      if (separation > 0.08) {
        warnings.push('両脚が左右に分離して見えています。真横から撮影してください。');
      }
    }

    if (ankleVis < RM.THRESHOLDS.minVisibility) {
      warnings.push('手前側の外果を十分に視認できません。');
      return emptyResult(heightCm, warnings, {
        side: side.key,
        sideLabel: side.label,
        facingSign: facing.facingSign,
        facingLabel: facingText(facing.facingSign),
        facingSource: facing.facingSource
      });
    }

    const ear = toCanvas(landmarks[side.ear], bounds);
    const shoulder = toCanvas(landmarks[side.shoulder], bounds);
    const hip = toCanvas(landmarks[side.hip], bounds);
    const knee = toCanvas(landmarks[side.knee], bounds);
    const ankle = toCanvas(landmarks[side.ankle], bounds);
    if (!ear || !shoulder || !hip || !knee || !ankle) {
      warnings.push('計測に必要な関節座標が欠けています。');
      return emptyResult(heightCm, warnings, {
        side: side.key,
        sideLabel: side.label,
        facingSign: facing.facingSign,
        facingLabel: facingText(facing.facingSign),
        facingSource: facing.facingSource
      });
    }
    const heel = landmarks[side.heel] ? toCanvas(landmarks[side.heel], bounds) : null;
    const toe = landmarks[side.toe] ? toCanvas(landmarks[side.toe], bounds) : null;
    ear.label = '耳垂';
    shoulder.label = '肩峰';
    hip.label = '大転子';
    knee.label = '膝';
    ankle.label = '外果';
    if (heel) heel.label = '踵';
    if (toe) toe.label = 'つま先';

    const vertex = estimateVertex(ear, ankle);
    const euclidean = Math.hypot(ankle.x - ear.x, ankle.y - ear.y);
    const pixelSpan = Math.abs(ankle.y - vertex.y);
    const tiltDeg = euclidean > 0
      ? Math.atan2(Math.abs(ankle.x - ear.x), Math.abs(ankle.y - ear.y)) * 180 / Math.PI
      : 90;

    let px2cm = null;
    if (ear.visibility < RM.THRESHOLDS.minVisibility) {
      warnings.push('耳孔を十分に視認できないため、スケールを確定できません。');
    } else if (euclidean < 8 || pixelSpan < Math.max(8, euclidean * 0.5)) {
      warnings.push('立位の真横で、頭から足まで写してください。スケールを確定できません。');
    } else {
      px2cm = pixelSpan / (heightCm * VERTEX_MALLEOLUS_OF_STATURE);
      if (tiltDeg > 25) {
        warnings.push('体が鉛直から傾いています。カメラを水平にし、立位の真横で撮影してください。');
      }
    }

    if (facing.facingSource === 'face') {
      warnings.push('足部の視認性が低いため、鼻と耳孔の位置で前方を推定しています。');
    } else if (facing.facingSource === 'unknown') {
      warnings.push('前後方向を判定できません。つま先と踵、または顔が写るようにしてください。');
    }

    const originX = ankle.x;
    [ear, shoulder, hip].forEach(function (point) {
      if (!px2cm || !facing.facingSign || point.visibility < RM.THRESHOLDS.minVisibility) return;
      point.cm = round1((point.x - originX) * facing.facingSign / px2cm);
    });

    const chain = [ear, shoulder, hip, knee, ankle];
    let visibilitySum = 0;
    chain.forEach(function (point) { visibilitySum += point.visibility; });
    const meanVisibility = visibilitySum / chain.length;
    if (meanVisibility < RM.THRESHOLDS.minVisibility) {
      warnings.push('関節の視認性が低いため、数値は参考です。');
    }

    let kneeAngleDeg = null;
    const kneeReliable = hip.visibility >= RM.THRESHOLDS.minVisibility
      && knee.visibility >= RM.THRESHOLDS.minVisibility
      && ankle.visibility >= RM.THRESHOLDS.minVisibility;
    if (facing.facingSign && kneeReliable) {
      const rawAngle = clinicalKneeAngle(hip, knee, ankle, facing.facingSign);
      if (rawAngle === null) {
        warnings.push('膝角度を計算できません。');
      } else {
        kneeAngleDeg = round1(rawAngle);
        if (kneeAngleDeg < RM.THRESHOLDS.recurvatumDeg) {
          warnings.push('反張膝の基準（−5°未満）に該当します。');
        } else if (kneeAngleDeg > RM.THRESHOLDS.flexionNotableDeg) {
          warnings.push('膝屈曲位です。屈曲拘縮が疑われます（+5°超）。');
        }
      }
    }

    return {
      ok: true,
      warnings: warnings,
      side: side.key,
      sideLabel: side.label,
      facingSign: facing.facingSign,
      facingLabel: facingText(facing.facingSign),
      facingSource: facing.facingSource,
      heightCm: heightCm,
      px2cm: px2cm,
      originX: originX,
      meanVisibility: meanVisibility,
      kneeAngleDeg: kneeAngleDeg,
      recurvatum: kneeAngleDeg === null ? null : kneeAngleDeg < RM.THRESHOLDS.recurvatumDeg,
      points: {
        vertex: vertex,
        ear: ear,
        shoulder: shoulder,
        hip: hip,
        knee: knee,
        ankle: ankle,
        heel: heel,
        toe: toe
      }
    };
  };
})(typeof window !== 'undefined' ? window : globalThis);
