'use strict';
/** تنظیمات و توصیف سطوح کارنامه */
const settings = require('../settings');

/** «90|عالی\n75|خیلی خوب» → [{min:90,label:'عالی'},...] مرتب نزولی بر حسب حداقل درصد */
function parseLevels(raw) {
  return String(raw || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((l) => { const [m, ...rest] = l.split('|'); return { min: Number(String(m).trim()), label: rest.join('|').trim() }; }).filter((x) => Number.isFinite(x.min) && x.label).sort((a, b) => b.min - a.min);
}
/** سطح توصیفی یک میانگین (از مقیاس scale) */
function describe(avg, scale, levels) {
  if (avg === null || avg === undefined) return '';
  const pct = (Number(avg) / (Number(scale) || 20)) * 100;
  const lv = (levels || []).find((l) => pct >= l.min);
  return lv ? lv.label : (levels && levels.length ? levels[levels.length - 1].label : '');
}
function config() {
  return {
    title: settings.get('rc_title') || 'کارنامه تحصیلی', ministry: settings.get('rc_ministry_line') || '', region: settings.get('rc_region') || '',
    layout: settings.get('rc_layout') || 'numeric', levels: parseLevels(settings.get('rc_levels')),
    showAttendance: settings.bool('rc_show_attendance'), showBehavior: settings.bool('rc_show_behavior'), showRank: settings.bool('rc_show_rank'), showComment: settings.bool('rc_show_comment'),
    signLeft: settings.get('rc_sign_left') || '', signRight: settings.get('rc_sign_right') || '', footer: settings.get('rc_footer_note') || '',
  };
}
module.exports = { parseLevels, describe, config };
