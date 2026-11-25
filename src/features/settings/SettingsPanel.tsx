import { Camera } from 'lucide-react';
import { Dialog } from '../../components/Dialog';
import type { Quality } from '../../scene/types';
import type { Preferences } from './settings';

export function SettingsPanel({ value, onChange, close, camera }: { value: Preferences; onChange: (value: Preferences) => void; close: () => void; camera: () => void }) {
  const range = (key: 'master' | 'music' | 'sfx' | 'tilt' | 'settle', label: string, min: number, max: number, step: number, display: string) =>
    <label>{label} <output>{display}</output><input type="range" min={min} max={max} step={step} value={value[key]} onChange={e => onChange({ ...value, [key]: +e.target.value })}/></label>;
  return <Dialog title="ตั้งค่า" onClose={close}>
    <div className="settings-grid">
      <label>คุณภาพกราฟิก<select value={value.quality} onChange={e => onChange({ ...value, quality: e.target.value as Quality })}>
        <option value="auto">อัตโนมัติ</option><option value="low">ต่ำ</option><option value="medium">กลาง</option><option value="high">สูง</option><option value="2d">ตาชั่ง 2 มิติ</option>
      </select></label>
      <label>การประมวลผลกล้อง<select value={value.delegate} onChange={e => onChange({ ...value, delegate: e.target.value === 'CPU' ? 'CPU' : 'GPU' })}>
        <option value="GPU">ลอง GPU ก่อน</option><option value="CPU">เลือก CPU</option>
      </select></label>
      <label className="check-label"><input type="checkbox" checked={value.reduced} onChange={e => onChange({ ...value, reduced: e.target.checked })}/> ลดการเคลื่อนไหว</label>
      <label className="check-label"><input type="checkbox" checked={value.mute} onChange={e => onChange({ ...value, mute: e.target.checked })}/> ปิดเสียงทั้งหมด</label>
      {range('master', 'เสียงหลัก', 0, 1, .01, Math.round(value.master * 100) + '%')}
      {range('music', 'ดนตรี', 0, 1, .01, Math.round(value.music * 100) + '%')}
      {range('sfx', 'เสียงเอฟเฟกต์', 0, 1, .01, Math.round(value.sfx * 100) + '%')}
      {range('tilt', 'สเกลความเอียง', 1, 12, .5, String(value.tilt))}
      {range('settle', 'รอก่อนจัดรูป', 600, 1000, 20, value.settle + ' ms')}
    </div>
    <button type="button" className="secondary" onClick={camera}><Camera size={18}/> ตั้งค่ากล้องและปรับเทียบ</button>
  </Dialog>;
}
