import { parseEquation } from '../../core/mathematics/parser';
import { equationText, type Equation } from '../../core/mathematics/linear-expression';
import { composeOperations, operators } from '../../core/mathematics/affine-transform';
import type { Rational } from '../../core/mathematics/rational';

export const levels = ['สมการการบวก', 'สมการการลบ', 'สมการการคูณ', 'สมการการหาร', 'สมการสองขั้นตอน', 'จำนวนเต็มลบ'];
export interface Question {
  id: string;
  level: number;
  originalExpression: string;
  equation: Equation;
  expectedSolution: Rational;
  allowedOperations: readonly string[];
  learningObjective: string;
}

function availableFactors(value: bigint) {
  let remaining = value < 0n ? -value : value;
  if (!remaining) return true;
  for (const prime of [2n, 3n, 5n, 7n]) {
    while (remaining % prime === 0n) remaining /= prime;
  }
  return remaining === 1n;
}

export function makeQuestion(originalExpression: string, level: number, id: string): Question {
  const { equation, solution } = parseEquation(originalExpression);
  const { left, right } = equation;
  if (!left.coefficient.isZero && !right.coefficient.isZero) {
    throw new Error('ระดับ 1–6 รองรับพจน์ x เพียงฝั่งเดียว เพราะคลังยังไม่มีวัตถุ x');
  }
  const variable = left.coefficient.isZero ? right : left;
  const coefficient = variable.coefficient;
  if (!availableFactors(coefficient.numerator) || !availableFactors(coefficient.denominator) || !availableFactors(variable.constant.denominator)) {
    throw new Error('โจทย์นี้ต้องใช้ตัวคูณ ตัวหาร หรือตัวส่วนที่สร้างจากเลข 1–9 ไม่ได้');
  }
  // A known short route keeps custom activities manageable with single-digit tiles.
  if (coefficient.abs().toNumber() > 81 || coefficient.denominator > 81n || variable.constant.abs().toNumber() * Number(variable.constant.denominator) > 81) {
    throw new Error('ค่าสัมประสิทธิ์หรือพจน์คงตัวฝั่ง x ใหญ่เกินเครื่องมือในกิจกรรมนี้');
  }
  if (!Number.isInteger(level) || level < 1 || level > levels.length) throw new Error('เลือกระดับ 1–6');
  return { id, level, originalExpression, equation, expectedSolution: solution, allowedOperations: operators, learningObjective: levels[level - 1] };
}

export function generateQuestion(level: number, seed: number, id = `${level}-${seed}`): Question {
  const x = 3 + seed % 13;
  const k = 2 + Math.floor(seed / 13) % 8;
  const n = 1 + (seed * 7) % 9;
  const sources = [
    `x + ${n} = ${x + n}`,
    `x − ${n} = ${x - n}`,
    `${k}x = ${k * x}`,
    `x / ${k} = ${x}`,
    `${k}x + ${n} = ${k * x + n}`,
    seed % 2 ? `−${k}x + ${n} = ${k * x + n}` : `${k}x − ${n} = ${-k * x - n}`,
  ];
  const question = makeQuestion(sources[level - 1] ?? '', level, id);
  const target = level === 4 ? k * x : level === 6 ? -x : x;
  if (!question.expectedSolution.equals(parseEquation(`x = ${target}`).solution)) throw new Error('คำตอบโจทย์สุ่มไม่ตรง');
  return question;
}

const questionsPerLevel = 60;
const bankByLevel = levels.map((_, index) => {
  const level = index + 1;
  const questions = new Map<string, Question>();
  const add = (seed: number) => {
    const question = generateQuestion(level, seed);
    const key = equationText(question.equation);
    if (!questions.has(key)) questions.set(key, question);
  };
  for (let i = 0; i < 10; i++) add(i * 17 + index);
  for (let i = 0; questions.size < questionsPerLevel && i < 936; i++) add((i * 53 + index * 97) % 936);
  if (questions.size !== questionsPerLevel) throw new Error('จำนวนโจทย์ไม่ครบในระดับ ' + level);
  return [...questions.values()];
});
export const questionBank = bankByLevel.flat();
export const tutorialQuestion = makeQuestion('x − 3 = 5', 2, 'tutorial');
export const firstLesson = makeQuestion('x + 3 = 8', 1, 'learning-1');

export function questionsForLevel(level: number): readonly Question[] {
  return bankByLevel[level - 1] ?? [];
}

export function randomQuestion(level: number, used: ReadonlySet<string>, random = Math.random): Question | null {
  const available = questionsForLevel(level).filter(candidate => !used.has(equationText(candidate.equation)));
  return available[Math.floor(random() * available.length)] ?? null;
}

export function shuffledQuestions(level: number, random = Math.random): Question[] {
  const questions = [...questionsForLevel(level)];
  for (let i = questions.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [questions[i], questions[j]] = [questions[j], questions[i]];
  }
  return questions;
}

export function hintFor(question: Equation, pending: Parameters<typeof composeOperations>[0], right: Parameters<typeof composeOperations>[0]) {
  if (pending.length || right.length) return 'ลองเปรียบเทียบผลสะสมทั้งสองฝั่ง การบวกจำนวนเดียวกันอาจแบ่งเป็นหลายครั้งได้ ลำดับของการคูณและการบวกมีผลด้วย';
  const variable = question.left.coefficient.isZero ? question.right : question.left;
  if (!variable.constant.isZero) return 'สังเกตพจน์ที่ไม่มี x เลือกการดำเนินการตรงข้ามเพื่อลดพจน์นั้นให้เป็น 0 แล้วทำให้มีผลเท่ากันทั้งสองฝั่ง';
  return 'สังเกตตัวคูณของ x เลือกคูณหรือหารทั้งนิพจน์ให้เหลือ x หนึ่งตัว ถ้าสัมประสิทธิ์ติดลบ ลาก − ลงช่องจำนวนก่อนใส่ตัวเลข';
}
