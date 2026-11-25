import { useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowLeft, ArrowUp, BookOpen, Download, ListPlus, Play, Shuffle, Trash2 } from 'lucide-react';
import { Dialog } from '../../components/Dialog';
import { MathText, originalTex } from '../../components/MathText';
import { equationText } from '../../core/mathematics/linear-expression';
import { exportCsv, listAssessments, type Assessment } from '../assessment/assessment';
import { levels, makeQuestion, questionBank, randomQuestion, type Question } from '../questions/questions';
import { readLocal, writeLocal, type LessonOptions } from '../settings/settings';

interface Props {
  options: LessonOptions;
  setOptions: (next: LessonOptions) => void;
  launch: (questions: Question[]) => void;
  home: () => void;
}
interface SavedQuestion { id: string; source: string; level: number }

export function TeacherScreen({ options, setOptions, launch, home }: Props) {
  const [level, setLevel] = useState(1);
  const [count, setCount] = useState(5);
  const [source, setSource] = useState('');
  const [list, setList] = useState<SavedQuestion[]>(() => readLocal('balance-quest-teacher-list', []));
  const [message, setMessage] = useState('');
  const [invalid, setInvalid] = useState(false);
  const [records, setRecords] = useState<Assessment[]>([]);
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<Assessment | null>(null);
  const increment = useRef(0);
  const nextId = () => 'teacher-' + Date.now() + '-' + ++increment.current;

  useEffect(() => { writeLocal('balance-quest-teacher-list', list); }, [list]);

  function flag(text: string, error = false) { setMessage(text); setInvalid(error); }
  function add(question: Question) {
    setList(current => [...current, { id: nextId(), source: question.originalExpression, level: question.level }]);
    flag('เพิ่มโจทย์เข้าชุดแล้ว');
  }
  function addRandom() {
    const used = new Set(list.map(item => {
      try { return equationText(makeQuestion(item.source, item.level, item.id).equation); } catch { return item.source; }
    }));
    const extra: SavedQuestion[] = [];
    for (let index = 0; index < count; index += 1) {
      const next = randomQuestion(level, used);
      if (!next) break;
      used.add(equationText(next.equation));
      extra.push({ id: nextId(), source: next.originalExpression, level });
    }
    setList(current => [...current, ...extra]);
    flag(extra.length ? 'เพิ่มโจทย์สุ่ม ' + extra.length + ' ข้อ' : 'ใช้โจทย์สุ่มของระดับนี้ครบแล้ว');
  }
  function reorder(index: number, offset: number) {
    if (!list[index + offset]) return;
    const items = [...list];
    [items[index], items[index + offset]] = [items[index + offset], items[index]];
    setList(items);
  }
  function start() {
    try {
      launch(list.map(item => makeQuestion(item.source, item.level, item.id)));
    } catch (error) { flag((error as Error).message, true); }
  }
  const toggle = (key: 'hints' | 'elapsed' | 'sound' | 'difference' | 'poe' | 'challengeLimit', name: string) =>
    <label className="check-label"><input type="checkbox" checked={options[key]} onChange={event => setOptions({ ...options, [key]: event.target.checked })}/>{name}</label>;

  return <main className="content-screen teacher-screen">
    <header className="screen-header"><div><button className="plain" onClick={home}><ArrowLeft size={17}/> เมนูหลัก</button><h1>โหมดครู</h1></div>
      <button className="secondary" onClick={() => { setOpen(true); void listAssessments().then(setRecords); }}><BookOpen size={18}/> ผลประเมินในเครื่อง</button></header>
    <div className="teacher-layout">
      <section className="paper-panel teacher-questions">
        <h2>เตรียมโจทย์</h2>
        <label>ระดับความยาก<select value={level} onChange={event => setLevel(+event.target.value)}>
          {levels.map((name, index) => <option key={name} value={index + 1}>{index + 1} · {name}</option>)}
        </select></label>
        <form onSubmit={event => {
          event.preventDefault();
          try { add(makeQuestion(source, level, nextId())); setSource(''); }
          catch (error) { flag((error as Error).message, true); }
        }}>
          <label>สมการที่กำหนดเอง<input value={source} onChange={event => setSource(event.target.value)} maxLength={160} required placeholder="เช่น −3x + 5 = 20"/></label>
          <button className="secondary" type="submit"><ListPlus size={18}/> เพิ่มสมการ</button>
        </form>
        <div className="teacher-random"><label>จำนวนโจทย์สุ่ม<input type="number" value={count} min="1" max="30"
          onChange={event => setCount(Math.max(1, Math.min(30, Number(event.target.value) || 1)))}/></label>
          <button className="secondary" onClick={addRandom}><Shuffle size={17}/> สุ่มเข้าชุด</button></div>
        <p className={invalid ? 'error-text' : 'muted'} role="status">{message}</p>
        <h3>คลังโจทย์ระดับ {level}</h3>
        <div className="teacher-bank">{questionBank.filter(question => question.level === level).map(question =>
          <button type="button" key={question.id} onClick={() => add(question)} className="bank-item">
            <MathText tex={originalTex(question.originalExpression)}/><ListPlus size={17}/>
          </button>)}</div>
      </section>
      <section className="paper-panel teacher-queue">
        <h2>ชุดกิจกรรม <span>{list.length} ข้อ</span></h2>
        {list.length ? <ol className="queue">{list.map((item, index) => <li key={item.id}>
          <span className="queue-order">{index + 1}.</span><MathText tex={originalTex(item.source)}/>
          <div className="queue-tools">
            <button className="icon-button" aria-label={'เลื่อนโจทย์ ' + (index + 1) + ' ขึ้น'} title="เลื่อนขึ้น" disabled={index === 0} onClick={() => reorder(index, -1)}><ArrowUp size={16}/></button>
            <button className="icon-button" aria-label={'เลื่อนโจทย์ ' + (index + 1) + ' ลง'} title="เลื่อนลง" disabled={index === list.length - 1} onClick={() => reorder(index, 1)}><ArrowDown size={16}/></button>
            <button className="icon-button" aria-label={'ลบโจทย์ ' + (index + 1)} title="ลบโจทย์" onClick={() => setList(current => current.filter(question => question.id !== item.id))}><Trash2 size={15}/></button>
          </div>
        </li>)}</ol> : <p className="muted">เพิ่มสมการเอง เลือกจากคลัง หรือสุ่มโจทย์เพื่อจัดลำดับกิจกรรม</p>}
        <button className="primary" disabled={!list.length} onClick={start}><Play size={18}/> เริ่มชุดกิจกรรม</button>
        <fieldset className="teacher-options"><legend>ตั้งค่าชั้นเรียน</legend>
          {toggle('hints', 'แสดงคำใบ้')}{toggle('sound', 'เปิดเสียง')}{toggle('elapsed', 'แสดงเวลา')}
          {toggle('difference', 'แสดงค่าผลต่าง')}{toggle('poe', 'เปิดคำถาม POE')}{toggle('challengeLimit', 'เปิดเงื่อนไขภารกิจท้าทาย')}
          <label>จำนวนรอบเป้าหมาย<input type="number" min="1" max="20" value={options.maxRounds} onChange={e => setOptions({ ...options, maxRounds: Math.max(1, Math.min(20, +e.target.value)) })}/></label>
          <label>เวลาท้าทายเป็นวินาที (0 คือไม่จำกัด)<input type="number" min="0" max="3600" value={options.challengeTimer} onChange={e => setOptions({ ...options, challengeTimer: Math.max(0, Math.min(3600, +e.target.value)) })}/></label>
        </fieldset>
        <div className="teacher-roles"><h3>กิจกรรมกลุ่ม 4 คน</h3><p>ผู้ควบคุมหยิบวัตถุ ผู้วางแผนเสนอวิธี ผู้บันทึกจดลงใบงาน และผู้ตรวจสอบแทนค่าและอธิบายเหตุผล</p></div>
      </section>
    </div>
    {open && <Dialog title={selected ? 'วิธีทำที่บันทึก' : 'ผลประเมินในเครื่อง'} onClose={() => { setOpen(false); setSelected(null); }} wide>
      {selected ? <>
        <p>{selected.question} · x = {selected.answer}</p>
        <ol>{selected.steps.map((step, index) => <li key={index}>{step.left} = {step.right} → {step.after}</li>)}</ol>
        <p>ตรวจคำตอบ · {selected.verification}</p><p>คำคาดการณ์ · {selected.prediction || '—'}</p><p>คำอธิบาย · {selected.explanation || '—'}</p>
        <button type="button" className="secondary" onClick={() => setSelected(null)}>กลับไปยังผลประเมิน</button>
      </> : records.length ? <>
        <div className="assessment-list">{records.map(record => <button type="button" className="bank-item" key={record.id} onClick={() => setSelected(record)}>
          <span>{record.question}</span><span>{record.rounds} รอบ · {record.seconds} วินาที</span></button>)}</div>
        <button className="primary" onClick={() => exportCsv(records)}><Download size={18}/> ส่งออกทั้งหมดเป็น CSV</button>
      </> : <p>ยังไม่มีผลที่ตรวจคำตอบสำเร็จบนเบราว์เซอร์นี้</p>}
    </Dialog>}
  </main>;
}
