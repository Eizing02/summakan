import { useEffect, useMemo, useReducer, useRef, useState, type RefObject } from 'react';
import { ArrowLeft, ArrowRight, BookOpen, Camera, Check, CircleHelp, Download, Gem, History, Lightbulb, Maximize, Minimize, Mouse, Pause, Play, Plus, Printer, RotateCcw, Scale, Sparkles, Undo2, X } from 'lucide-react';
import { assessBalance, angleForDifference } from '../../core/balance/balance-engine';
import { scheduleSimplification } from '../../core/balance/simplification-controller';
import { operators, visualExpression } from '../../core/mathematics/affine-transform';
import { isolatedValue } from '../../core/mathematics/equation-engine';
import { equationText, expressionText, type Side } from '../../core/mathematics/linear-expression';
import type { GestureFrame } from '../../core/input/gesture-machine';
import { Dialog } from '../../components/Dialog';
import { MathText, originalTex } from '../../components/MathText';
import { TileFace, tileName } from '../../components/Tiles';
import BalanceScene from '../../scene/BalanceScene';
import type { SceneMood } from '../../scene/types';
import { assessmentFor, exportCsv, saveAssessment } from '../assessment/assessment';
import { sound } from '../audio/audio';
import { hintFor, levels, type Question } from '../questions/questions';
import type { LessonOptions, Preferences } from '../settings/settings';
import { challenges, modeNames, type Challenge, type Mode } from './modes';
import { activeMilliseconds, canEdit, digits, gameReducer, newSession, type HistoryEntry, type Session, type Tile } from './session';
import { canPlaceTile, useDrag, type ObjectSource } from './useDrag';
import { expressionParts } from './expression-parts';

interface Props {
  question: Question;
  mode: Mode;
  preferences: Preferences;
  options: LessonOptions;
  cameraOpen: boolean;
  cameraRunning: boolean;
  cameraStatus: string;
  frameHandler: RefObject<((frame: GestureFrame) => boolean) | null>;
  openCamera: () => void;
  stopCamera: () => void;
  goHome: () => void;
  next: () => void;
  retry: () => void;
  fullscreen: () => void;
  full: boolean;
  hasNext: boolean;
  challenge: Challenge;
  previousRoute: string | null;
  saveRoute: (route: string) => void;
}

const sides = ['left', 'right'] as const;
const sideLabel = { left: 'ซ้าย', right: 'ขวา' };
type Panel = 'history' | 'hint' | 'predict' | 'explain' | 'controls';

function readableSeconds(total: number) {
  return Math.floor(total / 60) + ':' + String(total % 60).padStart(2, '0');
}
function historySignature(history: HistoryEntry[]) {
  return JSON.stringify(history.filter(step => step.changed).map(step => [step.before, step.left, step.right]));
}

function challengeResult(kind: Challenge, state: Session, options: LessonOptions, previous: string | null) {
  if (!options.challengeLimit) return null;
  const history = state.history.filter(step => step.changed);
  const elapsed = activeMilliseconds(state) / 1000;
  if (options.challengeTimer && elapsed > options.challengeTimer) return 'ตรวจคำตอบผ่านแล้ว ลองทำอีกครั้งเพื่อผ่านเงื่อนไขเวลา';
  switch (kind) {
    case 'rounds': return history.length <= options.maxRounds ? 'ผ่านภารกิจจำกัดรอบ' : 'ตรวจคำตอบผ่านแล้ว ลองค้นหาวิธีที่ใช้รอบน้อยลง';
    case 'hints': return state.hints === 0 ? 'ผ่านภารกิจโดยไม่ใช้คำใบ้' : 'ตรวจคำตอบผ่านแล้ว ลองเล่นอีกครั้งโดยไม่ใช้คำใบ้';
    case 'different':
      return history.some(step => step.left !== step.right && changedSequence(step))
        ? 'ผ่านภารกิจด้วยการดำเนินการต่างรูป' : 'ตรวจคำตอบผ่านแล้ว ลองแบ่งการดำเนินการเป็นหลายคำสั่งในฝั่งหนึ่ง';
    case 'routes':
      return previous && previous !== historySignature(state.history) ? 'พบวิธีแก้สมการสองเส้นทางแล้ว' : 'ตรวจคำตอบผ่านแล้ว เล่นโจทย์เดิมอีกครั้งด้วยเส้นทางใหม่';
  }
}

function changedSequence(step: HistoryEntry) {
  const [left, right] = step.before.split(' = ');
  const strip = (text: string, base: string) => text.replace(base, '…');
  return strip(step.left, left) !== strip(step.right, right);
}

function HistoryList({ entries }: { entries: HistoryEntry[] }) {
  if (!entries.length) return <p className="muted">ประวัติจะปรากฏเมื่อจัดรูปสมการรอบแรก</p>;
  return <ol className="history-list">{entries.map((entry, i) => <li key={i}>
    <div><strong>{entry.before}</strong><span className="muted">{entry.changed ? 'จัดรูป' : 'สมการคงเดิม'}</span></div>
    <p>{entry.left} = {entry.right}</p><p><ArrowRight size={15}/> {entry.after}</p>
  </li>)}</ol>;
}

function tilesOnPan(state: Session, side: Side): Tile[] {
  const tiles = state.pending[side].flatMap(({ operator, value }): Tile[] => value.numerator < 0n
    ? [operator, '−', String(value.abs().numerator) as Tile] : [operator, String(value.numerator) as Tile]);
  const draft = state.drafts[side];
  if (draft) tiles.push(draft.operator, ...(draft.negative ? ['−' as const] : []));
  return tiles;
}

function MathExpression({ state, side }: { state: Session; side: Side }) {
  const parts = expressionParts(state.base[side], state.pending[side]);
  return <>{parts.map(({ tex, cancellation, additive }, index) => <MathText key={index} tex={tex}
    className={'math-part' + (cancellation ? ' cancel-' + cancellation : additive ? ' combinable' : '')}/>)}</>;
}

export function GameScreen(props: Props) {
  const { question, mode, options, preferences, cameraOpen, cameraRunning, frameHandler } = props;
  const [state, dispatch] = useReducer(gameReducer, question, item => newSession(item.equation, item.originalExpression));
  const [panel, setPanel] = useState<Panel | null>(null);
  const [prediction, setPrediction] = useState('');
  const [explanation, setExplanation] = useState('');
  const [answer, setAnswer] = useState('');
  const [verificationOpen, setVerificationOpen] = useState(true);
  const [clock, setClock] = useState(Date.now());
  const stage = useRef<HTMLElement>(null);
  const leftAnchor = useRef<HTMLDivElement>(null);
  const rightAnchor = useRef<HTMLDivElement>(null);
  const anchors = useMemo(() => ({ left: leftAnchor, right: rightAnchor }), []);
  const verifyInput = useRef<HTMLInputElement>(null);
  const enabled = !panel && !cameraOpen && canEdit(state);
  const drag = useDrag(state, dispatch, enabled, stage);
  const balance = useMemo(() => assessBalance(state.base, state.pending), [state.base, state.pending]);
  const target = angleForDifference(balance.difference.toNumber(), preferences.tilt);
  const mood: SceneMood = state.phase === 'RESULT' ? 'victory' : state.phase === 'BALANCE_PENDING' || state.phase === 'SIMPLIFYING' ? 'even' :
    !balance.visual ? 'uneven' : !balance.mathematical ? 'waiting' : 'idle';
  const rounds = state.history.filter(step => step.changed).length;
  const solved = isolatedValue(state.base);
  const record = state.phase === 'RESULT' ? assessmentFor(state, modeNames[mode], prediction, explanation) : null;

  useEffect(() => {
    frameHandler.current = drag.handFrame;
    return () => { frameHandler.current = null; };
  });

  useEffect(() => {
    if (panel || cameraOpen) return;
    return scheduleSimplification(state, preferences.settle, preferences.reduced, dispatch);
  }, [state.revision, state.phase, state.animation, preferences.settle, preferences.reduced, panel, cameraOpen]);

  useEffect(() => {
    if (!options.elapsed && !(mode === 'challenge' && options.challengeLimit && options.challengeTimer)) return;
    const timer = window.setInterval(() => setClock(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [options.elapsed, mode, options.challengeLimit, options.challengeTimer]);

  useEffect(() => {
    if (state.phase === 'SOLVED') setVerificationOpen(true);
    if (state.phase === 'RESULT') {
      sound('quest_complete');
      window.setTimeout(() => sound('victory'), preferences.reduced ? 0 : 280);
    }
  }, [state.phase]);
  useEffect(() => {
    if (verificationOpen && state.phase === 'SOLVED') verifyInput.current?.focus();
  }, [verificationOpen, state.phase]);

  useEffect(() => {
    if (record) void saveAssessment(record);
  }, [state.ended, prediction, explanation]);

  useEffect(() => {
    if (mood === 'uneven') sound('scale_imbalance');
    if (mood === 'even') sound('scale_balance');
  }, [mood]);
  useEffect(() => {
    if (state.animation === 'cancel') sound('magic_cancel');
    if (state.animation === 'combine') sound('equation_simplify');
  }, [state.animation]);

  const cancellations = state.animation === 'cancel' && sides.some(side =>
    expressionParts(state.base[side], state.pending[side]).some(part => part.cancellation));
  const status = !balance.mathematical && balance.visual
    ? 'ตาชั่งอยู่ในแนวระดับ แต่การดำเนินการทั้งสองฝั่งยังไม่สมมูลกัน'
    : state.phase === 'BALANCE_PENDING' ? 'ผลสะสมสองฝั่งสมมูลกัน รอจัดรูป'
    : state.animation === 'highlight' ? 'ไฮไลต์การดำเนินการที่ให้ผลเท่ากัน'
    : state.animation === 'cancel' ? cancellations ? 'หักล้างพจน์ที่รวมกันได้ศูนย์' : 'นำผลสะสมไปจัดรูปแต่ละฝั่ง'
    : state.animation === 'combine' ? 'รวมพจน์ที่คล้ายกัน'
    : !balance.visual ? 'ยังไม่สมดุล · ฝั่ง' + (balance.difference.numerator > 0n ? 'ซ้าย' : 'ขวา') + 'ต่ำกว่า'
    : 'ตาชั่งอยู่ในสมดุล';

  const tutorial = state.phase === 'SOLVED' ? 'แทนค่าที่พบลงในสมการเดิมเพื่อตรวจสอบ' :
    state.drafts.left || state.drafts.right ? 'หยิบตัวเลขไปวางต่อท้ายเครื่องหมายบนจาน'
    : state.pending.left.length || state.pending.right.length ? 'สังเกตตาชั่ง แล้วเติมคำสั่งให้อีกฝั่งมีผลสะสมเท่ากัน'
    : 'เลื่อนเคอร์เซอร์ไปที่เครื่องหมาย แล้วหนีบนิ้วหรือคลิกเพื่อหยิบ';
  const snap = (side: Side, element: HTMLButtonElement) => {
    if (drag.selection) drag.finish({ side, inventory: false });
    else if (enabled) element.focus();
  };
  const buttonFor = (tile: Tile) => <button type="button" className="inventory-tile" key={tile}
    data-tile={tile} disabled={!enabled} title={tileName[tile] ?? tile}
    aria-label={tileName[tile] ? tileName[tile] + ' ' + tile : tile} aria-pressed={drag.selection?.tile === tile && !drag.selection.side}
    onPointerDown={event => drag.pointerDown(event, { tile })}
    onClick={event => { if (event.detail === 0) drag.keyboardPick({ tile }, event.currentTarget); }}
    onPointerEnter={() => sound('ui_hover')}><TileFace tile={tile}/></button>;

  function pendingToken(side: Side, index: number | 'draft', tile: Tile, text: string) {
    const source: ObjectSource = { tile, side, index };
    return <button key={index} type="button" className="pending-token" data-tile={tile} data-from-side={side} data-from-index={index}
      disabled={!enabled} title="ลากกลับลงคลังเพื่อนำออก" aria-label={'หยิบ ' + text + ' ออกจากฝั่ง' + sideLabel[side]}
      onPointerDown={event => drag.pointerDown(event, source)}
      onClick={event => { if (event.detail === 0) drag.keyboardPick(source, event.currentTarget); }}>{text}</button>;
  }

  const cameraControls = <>
    <button type="button" className={cameraRunning ? 'mini-button is-live' : 'mini-button'} aria-label="ตั้งค่ากล้อง" title={props.cameraStatus} onClick={props.openCamera}>
      {cameraRunning ? <Camera size={17}/> : <Mouse size={17}/>}<span>{cameraRunning ? record ? 'กล้องเปิดอยู่' : props.cameraStatus : 'ตั้งค่ากล้อง'}</span>
    </button>
    {cameraRunning && <button type="button" className="icon-button" aria-label="ปิดกล้อง" title="ปิดกล้อง" onClick={props.stopCamera}><X size={19}/></button>}
  </>;

  if (record && solved) {
    const criterion = mode === 'challenge' ? challengeResult(props.challenge, state, options, props.previousRoute) : null;
    return <main className="result-screen content-screen">
      <div className="result-head">
        <div className="victory-seal" aria-hidden="true"><Gem size={36}/><Sparkles size={20}/>
          <div className="victory-sparks"><i/><i/><i/><i/><i/><i/></div>
        </div>
        <h1>ผ่านภารกิจ</h1>
        <div className="result-answer"><MathText tex={'x = ' + solved.toTex()}/></div>
        <p>แทนค่าลงในสมการเดิมแล้ว ได้ค่าเท่ากันทั้งสองฝั่ง</p>
        {options.challengeLimit && criterion && <p className="challenge-result">{criterion}</p>}
        <div className="result-camera button-row">{cameraControls}</div>
      </div>
      <section className="result-sheet">
        <div className="result-original"><div><h2>สมการเริ่มต้น</h2><MathText tex={originalTex(question.originalExpression)} /></div>
          <div><h2>ตรวจคำตอบ</h2><MathText tex={originalTex(question.originalExpression, solved.toTex())} /><br/>
            <MathText tex={state.verification!.left.toTex() + ' = ' + state.verification!.right.toTex()}/></div></div>
        <dl className="result-metrics"><div><dt>รอบที่สมการเปลี่ยน</dt><dd>{record.rounds}</dd></div><div><dt>คำใบ้</dt><dd>{record.hints}</dd></div>
          <div><dt>ย้อนกลับ</dt><dd>{record.undos}</dd></div><div><dt>เวลาที่ใช้</dt><dd>{readableSeconds(record.seconds)}</dd></div></dl>
        <h2>วิธีทำ</h2><HistoryList entries={state.history}/>
        {options.poe && <div className="poe-result"><h2>นำไปใช้</h2><p>เลือกโจทย์อีกหนึ่งข้อ แล้วอธิบายเป็นลายลักษณ์อักษรว่าการดำเนินการแต่ละรอบรักษาความเท่ากันอย่างไร</p>
          {prediction && <p>คำคาดการณ์ · {prediction}</p>}
          <label>เหตุผลของผู้เรียน<textarea value={explanation} onChange={event => setExplanation(event.target.value)} maxLength={500}/></label></div>}
      </section>
      <div className="result-actions button-row">
        {props.hasNext && <button className="primary" onClick={props.next}>โจทย์ถัดไป <ArrowRight size={18}/></button>}
        <button className="secondary" onClick={() => { if (mode === 'challenge') props.saveRoute(historySignature(state.history)); props.retry(); }}><RotateCcw size={17}/> เล่นใหม่</button>
        <button className="secondary" onClick={() => setPanel('history')}><History size={17}/> ดูประวัติ</button>
        <button className="secondary" onClick={() => exportCsv([record])}><Download size={17}/> ส่งออก CSV</button>
        <button className="secondary" onClick={() => window.print()}><Printer size={17}/> พิมพ์วิธีทำ</button>
        <button className="plain" onClick={props.goHome}><ArrowLeft size={17}/> เมนูหลัก</button>
      </div>
      {panel === 'history' && <Dialog title="ประวัติการจัดรูป" onClose={() => setPanel(null)}><HistoryList entries={state.history}/></Dialog>}
    </main>;
  }

  const lock = state.phase === 'PAUSED' || state.phase === 'SIMPLIFYING';
  const dropTile = drag.selection && !drag.selection.side ? drag.selection.tile : null;
  return <main className="gameplay" ref={stage} data-phase={state.phase}>
    <div className="game-hud">
      <div className="game-heading"><button type="button" className="icon-button back-button" aria-label="กลับเมนูหลัก" title="กลับเมนูหลัก" onClick={props.goHome}><ArrowLeft size={22}/></button>
        <div><p>{modeNames[mode]}</p><h1>{mode === 'tutorial' ? 'ก้าวแรกสู่สมดุล' : levels[question.level - 1]}</h1></div></div>
      <div className="hud-actions">
        {cameraControls}
        <button type="button" className="icon-button" aria-label={props.full ? 'ออกจากเต็มหน้าจอ' : 'เต็มหน้าจอ'} title="เต็มหน้าจอ" onClick={props.fullscreen}>{props.full ? <Minimize size={19}/> : <Maximize size={19}/>}</button>
        <button type="button" className="icon-button" aria-label="หยุดชั่วคราว" title="หยุดชั่วคราว" disabled={lock || state.phase === 'SOLVED'} onClick={() => dispatch({ type: 'pause', now: Date.now() })}><Pause size={20}/></button>
      </div>
    </div>

    <div className="lab">
      <BalanceScene target={target} mood={mood} anchors={anchors}
        panTiles={{ left: tilesOnPan(state, 'left'), right: tilesOnPan(state, 'right') }}
        quality={preferences.quality} reduced={preferences.reduced || cameraOpen || Boolean(panel) || state.phase === 'PAUSED'}/>
      {enabled && dropTile && <div className="drop-regions" aria-hidden="true">
        {sides.map(side => {
          const valid = canPlaceTile(state, side, dropTile);
          return <div key={side} className="drop-region" data-drop-region={side} data-valid={valid} data-over={drag.overSide === side}
            onClick={() => drag.finish({ side, inventory: false })}>
            <span>{valid ? 'วางฝั่ง' + sideLabel[side] : 'ฝั่ง' + sideLabel[side] + (state.drafts[side] ? ' · รอตัวเลข' : ' · รอเครื่องหมาย')}</span>
          </div>;
        })}
      </div>}
      <div className="lab-top">
        <div className="equation-plaque">
          <span className="equation-label">{rounds ? 'สมการปัจจุบัน' : 'สมการเริ่มต้น'}</span>
          <MathText className="base-equation" tex={equationText(state.base, true)}/>
        </div>
        <div className="stage-tools">
          {options.hints && <button className="mini-button" aria-label="คำใบ้" disabled={lock} type="button" onClick={() => { setPanel('hint'); dispatch({ type: 'hint' }); sound('hint_open'); }}><Lightbulb size={17}/><span>คำใบ้</span></button>}
          <button className="mini-button" aria-label="ย้อนกลับ" type="button" disabled={!state.undo.length || state.held || lock} onClick={() => dispatch({ type: 'undo' })}><Undo2 size={17}/><span>ย้อนกลับ</span></button>
          <button className="mini-button" aria-label="ประวัติ" type="button" onClick={() => setPanel('history')}><History size={17}/><span>ประวัติ</span></button>
          <button className="mini-button help-button" type="button" aria-label="วิธีหยิบวัตถุ" title="วิธีหยิบวัตถุ" onClick={() => setPanel('controls')}><CircleHelp size={17}/></button>
        </div>
        <div className="lab-left">
          {options.poe && <div className="stage-tools poe-actions">
            <button className="mini-button" type="button" onClick={() => setPanel('predict')}><BookOpen size={17}/><span>คาดการณ์</span></button>
            {state.history.length > 0 && <button className="mini-button" type="button" onClick={() => setPanel('explain')}><BookOpen size={17}/><span>อธิบาย</span></button>}
          </div>}
          {(options.elapsed || (mode === 'challenge' && options.challengeLimit && options.challengeTimer > 0)) && <span className="timer">{readableSeconds(Math.floor(activeMilliseconds(state, clock) / 1000))}</span>}
        </div>
      </div>
      {sides.map(side => {
        const draft = state.drafts[side];
        const possible = dropTile && canPlaceTile(state, side, dropTile);
        return <div key={side} className={`pan-anchor pan-${side} ${state.animation || ''} ${drag.impact === side ? 'impact' : ''}`}
          ref={side === 'left' ? leftAnchor : rightAnchor} data-testid={'anchor-' + side} data-pan-side={side}>
          <div className="pan-math" aria-label={visualExpression(expressionText(state.base[side]), state.pending[side])} data-testid={'expression-' + side}>
            <MathExpression state={state} side={side}/>
          </div>
          <button className={possible ? 'drop-slot valid-slot' : 'drop-slot'} data-drop-side={side}
            type="button" disabled={!enabled} aria-label={'จาน' + sideLabel[side] + ' · ' + (draft ? 'วางตัวเลข' : 'วางเครื่องหมาย')}
            onClick={event => snap(side, event.currentTarget)}>
            {draft ? <><TileFace tile={draft.operator}/>{draft.negative && <span>−</span>}<span className="slot-box">?</span></> : <><Plus size={15}/><span>จาน{sideLabel[side]}</span></>}
          </button>
          {(state.pending[side].length > 0 || draft) && <div className="pending-line">
            {state.pending[side].map((operation, index) => pendingToken(side, index, operation.operator, operation.operator + ' ' + operation.value.toString()))}
            {draft && pendingToken(side, 'draft', draft.operator, draft.operator + (draft.negative ? ' −' : ' …'))}
          </div>}
        </div>;
      })}
      {state.animation && !preferences.reduced && <div className={'magic-ring magic-' + state.animation} aria-hidden="true"/>}
      {mode === 'challenge' && options.challengeLimit && <div className="challenge-label"><Gem size={14}/> {challenges[props.challenge]}{props.challenge === 'rounds' ? ' · ' + options.maxRounds + ' รอบ' : ''}</div>}
      <div className="stage-footer">
        <p className={'balance-status status-' + mood} role="status"><Scale size={17}/>{status}{options.difference && <span>Δ {balance.difference.toString()}</span>}</p>
      </div>
    </div>

    <div className="inventory" data-return-inventory>
      <div className="inventory-header">
        <p className="inventory-title">คลังมนตรา</p>
        <p className="inventory-instruction" aria-live="polite">{drag.selection ? drag.selection.side ? 'ลากลงคลังหรือกดคืนเข้าคลังเพื่อนำคำสั่งออก' : 'ปล่อยวัตถุในฝั่งที่ต้องการ' : state.message || (
          mode === 'tutorial' ? tutorial : 'หยิบเครื่องหมายไปที่จาน จากนั้นวางตัวเลข')}</p>
        {drag.selection && <button type="button" className="mini-button" onClick={() => drag.finish({ inventory: true })}><X size={16}/> {drag.selection.side ? 'คืนเข้าคลัง' : 'ยกเลิกการหยิบ'}</button>}
        {state.phase === 'SOLVED' && !verificationOpen && <button className="mini-button" type="button" onClick={() => setVerificationOpen(true)}><Check size={17}/> แทนค่าตรวจคำตอบ</button>}
      </div>
      <div className="tile-group operators" aria-label="เครื่องหมาย">{operators.map(buttonFor)}</div>
      <div className="tile-group digits" aria-label="ตัวเลข">{digits.map(buttonFor)}</div>
    </div>

    <div className="hand-cursor" ref={drag.cursor} hidden aria-hidden="true"/>
    {drag.drawing && <div className={'drag-ghost' + (drag.drawing.returning ? ' is-returning' : '')} ref={drag.ghost} aria-hidden="true"><TileFace tile={drag.drawing.tile}/></div>}

    {state.phase === 'SOLVED' && verificationOpen && <Dialog title="แทนค่าตรวจคำตอบ" onClose={() => setVerificationOpen(false)}>
      <div className="verification"><MathText tex={originalTex(question.originalExpression)} className="verification-equation"/>
        <p>พิมพ์ค่า x ที่ได้จากสมการ <MathText tex={equationText(state.base, true)}/> แล้วตรวจผลสองฝั่ง</p>
        <form onSubmit={event => { event.preventDefault(); dispatch({ type: 'verify', value: answer, now: Date.now() }); }}>
          <label>ค่า x <input ref={verifyInput} value={answer} onChange={event => setAnswer(event.target.value)} required maxLength={160} placeholder="เช่น −5 หรือ 2/3"/></label>
          {state.message && <p className={state.verification?.valid === false ? 'error-text' : 'muted'} role="status">{state.message}</p>}
          {state.verification && !state.verification.valid && <MathText tex={state.verification.left.toTex() + '\\ne ' + state.verification.right.toTex()}/>}
          <button className="primary" type="submit"><Check size={19}/> ตรวจคำตอบ</button>
        </form>
        {state.undo.length > 0 && <button type="button" className="plain" onClick={() => dispatch({ type: 'undo' })}><Undo2 size={17}/> กลับไปแก้สมการ</button>}
      </div>
    </Dialog>}
    {state.phase === 'PAUSED' && <Dialog title="หยุดชั่วคราว" onClose={() => dispatch({ type: 'resume', now: Date.now() })}>
      <div className="button-row"><button className="primary" onClick={() => dispatch({ type: 'resume', now: Date.now() })}><Play size={17}/> เล่นต่อ</button>
        <button className="secondary" onClick={props.goHome}><ArrowLeft size={17}/> เมนูหลัก</button></div>
    </Dialog>}
    {panel && <Dialog title={{ history: 'ประวัติการจัดรูป', hint: 'คำใบ้', predict: 'คาดการณ์ก่อนลงมือ', explain: 'อธิบายสิ่งที่สังเกต', controls: 'วิธีหยิบวัตถุ' }[panel]}
      onClose={() => setPanel(null)}>
      {panel === 'history' && <HistoryList entries={state.history}/>}
      {panel === 'hint' && <p>{hintFor(state.base, state.pending.left, state.pending.right)}</p>}
      {panel === 'predict' && <><p>ถ้าเพิ่มจำนวนทางจานซ้ายเพียงฝั่งเดียว ตาชั่งจะเอียงอย่างไร แล้วจะทำให้กลับมาอยู่ในแนวระดับได้อย่างไร</p>
        <label>คำคาดการณ์<textarea value={prediction} onChange={event => setPrediction(event.target.value)} maxLength={500}/></label></>}
      {panel === 'explain' && <><p>เหตุใดการดำเนินการที่เขียนต่างกันจึงอาจให้ผลสะสมเท่ากันทั้งสองฝั่ง</p>
        <label>คำอธิบาย<textarea value={explanation} onChange={event => setExplanation(event.target.value)} maxLength={500}/></label></>}
      {panel === 'controls' && <ol className="instructions"><li>ชี้และหนีบนิ้ว หรือลากด้วยเมาส์เพื่อหยิบเครื่องหมาย</li><li>ปล่อยเครื่องหมายบนจาน แล้วหยิบตัวเลขไปวางต่อ</li>
        <li>สังเกตความเอียง แล้วทำให้ผลสะสมทั้งสองฝั่งสมมูลกัน</li><li>กด Tab และ Enter เพื่อเลือกวัตถุและจานด้วยคีย์บอร์ด</li></ol>}
    </Dialog>}
  </main>;
}
