import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, BookOpen, Camera, CircleHelp, Compass, GraduationCap, Maximize, Minimize, Mouse, Scale, Settings, Shuffle, Sword, Timer } from 'lucide-react';
import { Dialog } from '../components/Dialog';
import { MathText, originalTex } from '../components/MathText';
import { equationText } from '../core/mathematics/linear-expression';
import type { GameHandInput } from '../core/input/gesture-machine';
import { CameraPanel, type CameraControl } from '../features/camera/CameraPanel';
import { GameScreen } from '../features/game/GameScreen';
import { RaceSetup, TimedRace, type TimedRound } from '../features/game/TimedRace';
import { challenges, type Challenge, type Mode } from '../features/game/modes';
import { firstLesson, levels, questionBank, questionsForLevel, randomQuestion, shuffledQuestions, tutorialQuestion, type Question } from '../features/questions/questions';
import { SettingsPanel } from '../features/settings/SettingsPanel';
import { defaultLesson, initialPreferences, readLocal, writeLocal, type LessonOptions } from '../features/settings/settings';
import { setAudio, setMusicScene, sound, unlockAudio } from '../features/audio/audio';
import { TeacherScreen } from '../features/teacher/TeacherScreen';
import BalanceScene from '../scene/BalanceScene';

type Screen = 'MAIN_MENU' | 'MISSIONS' | 'TEACHER' | 'PLAYING' | 'RACE_SETUP' | 'RACING';
interface Journey { mode: Mode; questions: Question[]; index: number; key: number; level: number }
const keyFor = (question: Question) => equationText(question.equation);
const firstCameraKey = 'balance-quest-first-camera';

export function App() {
  const [screen, setScreen] = useState<Screen>('MAIN_MENU');
  const [journey, setJourney] = useState<Journey | null>(null);
  const [timedRound, setTimedRound] = useState<TimedRound | null>(null);
  const [raceChoice, setRaceChoice] = useState({ level: 5, minutes: 5 });
  const [level, setLevel] = useState(1);
  const [mode, setMode] = useState<'practice' | 'challenge'>('practice');
  const [challenge, setChallenge] = useState<Challenge>('rounds');
  const [route, setRoute] = useState<string | null>(null);
  const [overlay, setOverlay] = useState<'settings' | 'help' | null>(null);
  const [preferences, setPreferences] = useState(initialPreferences);
  const [lesson, setLesson] = useState<LessonOptions>(() => ({ ...defaultLesson, ...readLocal('balance-quest-lesson', {}) }));
  const [cameraOpen, setCameraOpen] = useState(false);
  const [cameraRequired, setCameraRequired] = useState(false);
  const [cameraConfirmed, setCameraConfirmed] = useState(() => readLocal<boolean>(firstCameraKey, false) === true);
  const [cameraRunning, setCameraRunning] = useState(false);
  const [cameraStatus, setCameraStatus] = useState('กล้องปิด');
  const [full, setFull] = useState(Boolean(document.fullscreenElement));
  const [notice, setNotice] = useState('');
  const controls = useRef<CameraControl>(null);
  const frameHandler = useRef<GameHandInput | null>(null);
  const pendingPlay = useRef<(() => void) | null>(null);
  const used = useRef(new Set<string>());
  const counter = useRef(0);

  useEffect(() => {
    writeLocal('balance-quest-preferences', preferences);
    setAudio(preferences, lesson.sound);
  }, [preferences, lesson.sound]);
  useEffect(() => { writeLocal('balance-quest-lesson', lesson); }, [lesson]);
  useEffect(() => {
    if (screen !== 'RACING') setMusicScene(screen === 'PLAYING' ? 'playing' : 'waiting');
  }, [screen]);
  useEffect(() => {
    const toggle = () => setFull(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', toggle);
    return () => document.removeEventListener('fullscreenchange', toggle);
  }, []);

  function cameraState(status: string, running: boolean) {
    setCameraStatus(status);
    setCameraRunning(running);
  }
  function stopCamera() { controls.current?.stop(); }
  function dismissCamera() {
    pendingPlay.current = null;
    setCameraOpen(false);
    setCameraRequired(false);
  }
  function confirmCamera() {
    writeLocal(firstCameraKey, true);
    setCameraConfirmed(true);
  }
  function useCamera() {
    if (!cameraRunning) return;
    const start = pendingPlay.current;
    confirmCamera();
    dismissCamera();
    start?.();
  }
  function beginWithCamera(start: () => void) {
    if (cameraConfirmed || cameraRunning) {
      if (!cameraConfirmed) confirmCamera();
      start();
      return;
    }
    pendingPlay.current = start;
    setCameraRequired(true);
    openSetup();
  }
  function home() { stopCamera(); dismissCamera(); setScreen('MAIN_MENU'); setJourney(null); setTimedRound(null); setNotice(''); }
  function fullscreen() {
    try {
      const promise = document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen();
      void promise.catch(() => setNotice('ไม่สามารถเปิดเต็มหน้าจอในเบราว์เซอร์นี้'));
    } catch { setNotice('ไม่สามารถเปิดเต็มหน้าจอในเบราว์เซอร์นี้'); }
  }
  function launch(nextMode: Mode, questions: Question[], nextLevel = questions[0]?.level ?? 1) {
    if (!questions.length) return;
    beginWithCamera(() => {
      used.current = new Set([keyFor(questions[0])]);
      setRoute(null);
      setOverlay(null);
      setJourney({ mode: nextMode, questions, index: 0, level: nextLevel, key: ++counter.current });
      setScreen('PLAYING');
      sound('ui_click');
    });
  }
  function advance() {
    if (!journey) return;
    setRoute(null);
    if (journey.mode === 'tutorial') {
      launch('learning', [firstLesson, ...questionBank.filter(question => keyFor(question) !== keyFor(firstLesson))]);
      return;
    }
    if (journey.mode === 'practice' || journey.mode === 'challenge') {
      const question = randomQuestion(journey.level, used.current);
      if (!question) { setNotice('เล่นโจทย์สุ่มระดับนี้ครบแล้ว เลือกระดับอื่นในหน้าภารกิจได้'); return; }
      used.current.add(keyFor(question));
      setJourney({ ...journey, questions: [question], index: 0, key: ++counter.current });
      return;
    }
    if (journey.questions[journey.index + 1]) setJourney({ ...journey, index: journey.index + 1, key: ++counter.current });
  }
  function showMissions(nextMode: typeof mode) { setMode(nextMode); setScreen('MISSIONS'); }
  function configureRace() {
    setTimedRound(null);
    dismissCamera();
    setScreen('RACE_SETUP');
  }
  function startRace(level: number, minutes: number) {
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > 60) return;
    beginWithCamera(() => {
      const questions = shuffledQuestions(level);
      if (!questions.length) return;
      setRaceChoice({ level, minutes });
      setTimedRound({ id: ++counter.current, questions, level, minutes, started: Date.now() });
      dismissCamera();
      setNotice('');
      setScreen('RACING');
    });
  }
  function openSetup() { setOverlay(null); setCameraOpen(true); }
  const question = journey?.questions[journey.index];
  const game = { preferences, options: lesson, cameraOpen, cameraRunning, cameraStatus, frameHandler,
    openCamera: openSetup, stopCamera, goHome: home, fullscreen, full, challenge, previousRoute: route, saveRoute: setRoute };

  return <div className={'app-shell screen-' + screen.toLowerCase()} data-reduced={preferences.reduced}
    onPointerDown={() => unlockAudio(preferences, lesson.sound)} onKeyDown={() => unlockAudio(preferences, lesson.sound)}>
    <a className="skip-link" href="#app-content">ข้ามไปเนื้อหาหลัก</a>
    {screen !== 'PLAYING' && screen !== 'RACING' && <header className="topbar">
      <button type="button" className="brand" onClick={home} aria-label="Balance Quest เมนูหลัก"><span className="brand-emblem"><Scale size={23} strokeWidth={1.6}/></span><span>Balance <strong>Quest</strong></span></button>
      <nav aria-label="การตั้งค่าเกม">
        <button type="button" className="mini-button teacher-nav" aria-label="โหมดครู" onClick={() => { stopCamera(); setScreen('TEACHER'); }}><GraduationCap size={19}/><span>โหมดครู</span></button>
        <button type="button" className="icon-button" aria-label="ตั้งค่า" title="ตั้งค่า" onClick={() => setOverlay('settings')}><Settings size={19}/></button>
        <button type="button" className="icon-button" aria-label={full ? 'ออกจากเต็มหน้าจอ' : 'เต็มหน้าจอ'} title="เต็มหน้าจอ" onClick={fullscreen}>{full ? <Minimize size={19}/> : <Maximize size={19}/>}</button>
      </nav>
    </header>}
    <div className="app-content" id="app-content">
      {screen === 'MAIN_MENU' && <main className="home-screen">
        <div className="hero">
          <div className="hero-scene"><BalanceScene target={0} mood="idle" reduced={preferences.reduced || cameraOpen || Boolean(overlay)} quality={preferences.quality}/></div>
          <div className="hero-shade"/>
          <div className="hero-content">
            <div className="title-ornament" aria-hidden="true"><span/><Scale size={22}/><span/></div>
            <h1>มนตราแห่ง<span>สมดุล</span></h1>
            <p className="hero-description">หยิบเครื่องหมายและตัวเลข ทดลองทำให้ตาชั่งสมดุล แล้วค้นหาค่า <i>x</i> ด้วยตัวเอง</p>
            <div className="hero-actions">
              <button className="primary launch-button" onClick={() => launch('learning', [firstLesson, ...questionBank.filter(item => keyFor(item) !== keyFor(firstLesson))])}><BookOpen size={21}/> เริ่มเรียนรู้ <ArrowRight size={20}/></button>
              <div className="sub-actions">
                <button className="secondary" onClick={() => showMissions('practice')}><Compass size={18}/> ฝึกแก้สมการ</button>
                <button className="secondary" onClick={() => showMissions('challenge')}><Sword size={18}/> เลือกภารกิจ</button>
                <button className="secondary" onClick={configureRace}><Timer size={18}/> แข่งจับเวลา</button>
              </div>
            </div>
          </div>
          <div className="hero-caption"><span aria-hidden="true"/> คณิตศาสตร์ ม.1 <span aria-hidden="true"/></div>
        </div>
        <footer className="home-footer">
          <div><button type="button" className="mini-button" onClick={openSetup}><Camera size={18}/> {cameraRunning ? 'เปิดกล้องแล้ว' : 'ตั้งค่ากล้อง'}</button>
            <button type="button" className="mini-button" onClick={() => setOverlay('help')}><CircleHelp size={18}/> วิธีเล่น</button></div>
          <p><Mouse size={17}/> {cameraRunning ? cameraStatus : cameraConfirmed ? 'เล่นด้วยเมาส์ได้' : 'เปิดกล้องก่อนเล่นครั้งแรก'}</p>
        </footer>
      </main>}
      {screen === 'MISSIONS' && <main className="content-screen missions-screen">
        <button className="plain" onClick={home}><ArrowLeft size={18}/> เมนูหลัก</button>
        <h1>{mode === 'challenge' ? 'ภารกิจท้าทาย' : 'ฝึกแก้สมการ'}</h1>
        <div className="tab-row" aria-label="โหมด">
          <button type="button" aria-pressed={mode === 'practice'} onClick={() => setMode('practice')}><Compass size={18}/> แบบฝึก</button>
          <button type="button" aria-pressed={mode === 'challenge'} onClick={() => setMode('challenge')}><Sword size={18}/> ท้าทาย</button>
        </div>
        <div className="missions-layout">
          <section className="level-list" aria-label="ระดับความยาก">{levels.map((label, index) =>
            <button type="button" key={label} onClick={() => setLevel(index + 1)} aria-pressed={level === index + 1}>
              <span>{index + 1}</span><strong>{label}</strong><ArrowRight size={17}/>
            </button>)}</section>
          <section className="paper-panel mission-questions">
            <header><h2>{levels[level - 1]}</h2><button className="primary" onClick={() => { const next = randomQuestion(level, new Set()); if (next) launch(mode, [next], level); }}><Shuffle size={18}/> สุ่มโจทย์</button></header>
            {mode === 'challenge' && lesson.challengeLimit && <label>เงื่อนไขภารกิจ<select value={challenge} onChange={e => setChallenge(e.target.value as Challenge)}>
              {Object.entries(challenges).map(([id, name]) => <option key={id} value={id}>{name}</option>)}
            </select></label>}
            <div className="mission-bank">{questionsForLevel(level).map(item => <button key={item.id} type="button" className="bank-item" onClick={() => launch(mode, [item], level)}><MathText tex={originalTex(item.originalExpression)}/><ArrowRight size={17}/></button>)}</div>
          </section>
        </div>
      </main>}
      {screen === 'TEACHER' && <TeacherScreen options={lesson} setOptions={setLesson} launch={items => launch('teacher', items)} home={home}/>}
      {screen === 'PLAYING' && journey && question && <GameScreen {...game} key={journey.key} question={question} mode={journey.mode}
        next={advance} retry={() => setJourney({ ...journey, key: ++counter.current })}
        hasNext={journey.mode === 'tutorial' || ((journey.mode === 'practice' || journey.mode === 'challenge')
          ? used.current.size < questionsForLevel(journey.level).length : journey.index + 1 < journey.questions.length)}/>}
      {screen === 'RACE_SETUP' && <RaceSetup {...raceChoice} home={home} start={startRace}/>}
      {screen === 'RACING' && timedRound && <TimedRace key={timedRound.id} round={timedRound} game={game}
        restart={() => startRace(timedRound.level, timedRound.minutes)} configure={configureRace} onFinish={() => setCameraOpen(false)}/>}
    </div>
    {overlay === 'settings' && <SettingsPanel value={preferences} onChange={setPreferences} close={() => setOverlay(null)} camera={openSetup}/>}
    {overlay === 'help' && <Dialog title="วิธีเล่น" onClose={() => setOverlay(null)}>
      <ol className="instructions"><li>ใช้เมาส์หรือกล้อง ชี้และหนีบนิ้วเพื่อหยิบวัตถุ</li>
        <li>หยิบเครื่องหมายไปวางบนจาน แล้วตามด้วยตัวเลขหนึ่งหลัก</li><li>เติมคำสั่งให้อีกฝั่ง ผลสะสมที่สมมูลกันจะจัดรูปโดยอัตโนมัติ</li>
        <li>เมื่อแยก x ได้ เกมจะแทนค่าตรวจสมการเดิม แล้วแสดงคำตอบ</li></ol>
      <div className="button-row"><button type="button" className="primary" onClick={() => launch('tutorial', [tutorialQuestion])}><BookOpen size={18}/> เริ่มบทสอน</button>
        {cameraConfirmed && <button type="button" className="secondary" onClick={() => { stopCamera(); launch('tutorial', [tutorialQuestion]); }}><Mouse size={17}/> เล่นด้วยเมาส์</button>}</div>
    </Dialog>}
    <CameraPanel open={cameraOpen} required={cameraRequired} control={controls} preferences={preferences} onCalibration={calibration => setPreferences({ ...preferences, calibration })}
      onClose={dismissCamera} onUse={useCamera} onStatus={cameraState} gameFrame={frameHandler}/>
    {notice && <div className="app-notice" role="status"><span>{notice}</span><button className="plain" type="button" onClick={() => setNotice('')}>ปิด</button></div>}
  </div>;
}
