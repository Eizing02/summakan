import { activeMilliseconds, type Session } from '../game/session';
import { isolatedValue } from '../../core/mathematics/equation-engine';
import { readLocal, writeLocal } from '../settings/settings';

const database = 'balance-quest';
const key = 'balance-quest-assessment';

export interface Assessment {
  id: string;
  completed: string;
  mode: string;
  question: string;
  answer: string;
  rounds: number;
  hints: number;
  undos: number;
  seconds: number;
  mathErrors: number;
  trackingLosses: number;
  verification: string;
  steps: Session['history'];
  operations?: string[];
  prediction: string;
  explanation: string;
}

export function assessmentFor(session: Session, mode: string, prediction: string, explanation: string): Assessment {
  const { history, verification } = session;
  return {
    id: session.source + ':' + session.started,
    completed: new Date(session.ended ?? Date.now()).toISOString(),
    mode, question: session.source, answer: isolatedValue(session.base)?.toString() ?? '',
    rounds: history.filter(step => step.changed).length, hints: session.hints, undos: session.undos,
    seconds: Math.round(activeMilliseconds(session) / 1000),
    mathErrors: session.mathErrors, trackingLosses: session.trackingLosses,
    verification: verification ? verification.left + ' = ' + verification.right : '',
    steps: history, operations: session.journal, prediction, explanation,
  };
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) { reject(new Error('IndexedDB unavailable')); return; }
    const request = indexedDB.open(database, 1);
    request.onupgradeneeded = () => request.result.createObjectStore('assessment', { keyPath: 'id' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('IndexedDB blocked'));
  });
}

export async function saveAssessment(record: Assessment) {
  try {
    const db = await openDatabase();
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction('assessment', 'readwrite');
      transaction.objectStore('assessment').put(record);
      transaction.oncomplete = () => resolve();
      transaction.onabort = () => reject(transaction.error);
    }).finally(() => db.close());
  } catch {
    const records = readLocal<Assessment[]>(key, []);
    writeLocal(key, [...records.filter(item => item.id !== record.id), record]);
  }
}

export async function listAssessments(): Promise<Assessment[]> {
  let stored: Assessment[] = [];
  try {
    const db = await openDatabase();
    stored = await new Promise<Assessment[]>((resolve, reject) => {
      const request = db.transaction('assessment').objectStore('assessment').getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    }).finally(() => db.close());
  } catch { /* Include any records from the local fallback. */ }
  return [...new Map([...readLocal<Assessment[]>(key, []), ...stored].map(item => [item.id, item])).values()]
    .sort((a, b) => b.completed.localeCompare(a.completed));
}

function cell(value: string | number) {
  const text = String(value);
  const safe = typeof value === 'string' && /^[\s]*[=+\-@]/.test(text) ? "'" + text : text;
  return '"' + safe.replaceAll('"', '""') + '"';
}

export function csvFor(records: Assessment[]) {
  const header = ['วันที่', 'โหมด', 'โจทย์', 'คำตอบ', 'รอบที่สมการเปลี่ยน', 'คำใบ้', 'ย้อนกลับ', 'วินาที', 'ข้อผิดพลาดคณิตศาสตร์', 'มือหลุด', 'ตรวจคำตอบ', 'วิธีทำ', 'การดำเนินการที่เลือก', 'คาดการณ์', 'อธิบาย'];
  const rows = records.map(record => [
    record.completed, record.mode, record.question, record.answer, record.rounds, record.hints, record.undos,
    record.seconds, record.mathErrors, record.trackingLosses, record.verification,
    record.steps.map(step => step.left + ' = ' + step.right + ' → ' + step.after).join('\n'),
    record.operations?.join('\n') ?? '', record.prediction, record.explanation,
  ]);
  return '\ufeff' + [header, ...rows].map(row => row.map(cell).join(',')).join('\r\n');
}

export function exportCsv(records: Assessment[]) {
  const url = URL.createObjectURL(new Blob([csvFor(records)], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = 'balance-quest-results.csv';
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1500);
}
