import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Play, RotateCcw, Timer, Trophy } from 'lucide-react';
import { Dialog } from '../../components/Dialog';
import { levels, type Question } from '../questions/questions';
import { setMusicScene } from '../audio/audio';
import { GameScreen, type GameProps } from './GameScreen';

const presets = [1, 3, 5, 10];

export function RaceSetup({ level, minutes, home, start }: {
  level: number; minutes: number; home: () => void; start: (level: number, minutes: number) => void;
}) {
  const [topic, setTopic] = useState(level);
  const [duration, setDuration] = useState(String(minutes));
  const chosen = Number(duration);
  const valid = Number.isInteger(chosen) && chosen >= 1 && chosen <= 60;
  return <main className="content-screen race-setup">
    <button className="plain" type="button" onClick={home}><ArrowLeft size={18}/> เมนูหลัก</button>
    <h1><Timer size={34} aria-hidden="true"/> แข่งจับเวลา</h1>
    <p>แก้ให้ได้มากที่สุดภายในเวลาที่เลือก ข้อละ 1 คะแนน</p>
    <form className="paper-panel race-form" onSubmit={event => { event.preventDefault(); if (valid) start(topic, chosen); }}>
      <label>ประเภทโจทย์<select value={topic} onChange={event => setTopic(Number(event.target.value))}>
        {levels.map((name, index) => <option key={name} value={index + 1}>{name}</option>)}
      </select></label>
      <fieldset>
        <legend>ระยะเวลา</legend>
        <div className="race-presets">
          {presets.map(value => <button key={value} className="secondary" type="button" aria-pressed={chosen === value}
            onClick={() => setDuration(String(value))}>{value} นาที</button>)}
        </div>
        <label>กำหนดเวลาเอง (นาที)<input type="number" value={duration} min={1} max={60} step={1} required
          onChange={event => setDuration(event.target.value)}/></label>
      </fieldset>
      <button className="primary" type="submit" disabled={!valid}><Play size={19}/> เริ่มแข่ง</button>
    </form>
  </main>;
}

export interface TimedRound {
  id: number;
  questions: Question[];
  level: number;
  minutes: number;
  started: number;
}

type SharedGame = Omit<GameProps, 'question' | 'mode' | 'next' | 'retry' | 'hasNext' | 'race'>;

export function TimedRace({ round, game, restart, configure, onFinish }: {
  round: TimedRound;
  game: SharedGame;
  restart: () => void;
  configure: () => void;
  onFinish: () => void;
}) {
  const { questions, started, minutes, level } = round;
  const deadline = started + minutes * 60_000;
  const [clock, setClock] = useState(started);
  const [index, setIndex] = useState(0);
  const [complete, setComplete] = useState(false);
  const [score, setScore] = useState(0);
  const credited = useRef(new Set<number>());
  const remaining = Math.max(0, Math.ceil((deadline - clock) / 1000));
  const expired = clock >= deadline;
  const ended = expired || complete;

  useEffect(() => {
    if (ended) { onFinish(); return; }
    const tick = () => setClock(Date.now());
    const refresh = window.setInterval(tick, 200);
    const expiry = window.setTimeout(tick, Math.max(0, deadline - Date.now()));
    document.addEventListener('visibilitychange', tick);
    return () => {
      window.clearInterval(refresh);
      window.clearTimeout(expiry);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [deadline, ended]);

  const soundtrack = ended ? 'waiting' : remaining <= 15 ? 'finale' : 'playing';
  useEffect(() => { setMusicScene(soundtrack); }, [soundtrack]);

  function scored(at: number) {
    if (at >= deadline || credited.current.has(index)) return;
    credited.current.add(index);
    setScore(credited.current.size);
  }
  function next() {
    const now = Date.now();
    if (now >= deadline || index + 1 >= questions.length) {
      setClock(now);
      if (now < deadline) setComplete(true);
      return;
    }
    setIndex(index + 1);
  }

  const elapsed = Math.min(minutes * 60, Math.max(0, Math.floor((clock - started) / 1000)));
  const spent = String(Math.floor(elapsed / 60)).padStart(2, '0') + ':' + String(elapsed % 60).padStart(2, '0');
  return <>
    <GameScreen {...game} key={index} mode="race" question={questions[index]} next={next} retry={restart}
      hasNext={index + 1 < questions.length} race={{ deadline, remaining, score, expired: ended, expire: () => setClock(Date.now()), scored }}/>
    {ended && <Dialog title={expired ? 'หมดเวลา' : 'ทำครบทุกข้อ'} className="answer-dialog race-summary" onClose={configure}>
      <div className="answer-content">
        <Trophy className="answer-emblem" size={31} aria-hidden="true"/>
        <p className="race-summary-score"><strong data-testid="race-final-score">{score}</strong> คะแนน</p>
        <p>ทำถูก {score} ข้อ · ใช้เวลา {spent}</p>
        <p className="muted">{levels[level - 1]}</p>
        <div className="button-row">
          <button className="primary" autoFocus onClick={restart}><RotateCcw size={18}/> แข่งอีกครั้ง</button>
          <button className="secondary" onClick={configure}>เลือกประเภทโจทย์</button>
        </div>
      </div>
    </Dialog>}
  </>;
}
