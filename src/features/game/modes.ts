export type Mode = 'tutorial' | 'learning' | 'practice' | 'challenge' | 'teacher' | 'race';
export const modeNames: Record<Mode, string> = {
  tutorial: 'วิธีเล่น', learning: 'บทเรียน', practice: 'ฝึกแก้สมการ', challenge: 'ภารกิจท้าทาย', teacher: 'ชุดกิจกรรมครู', race: 'แข่งจับเวลา',
};

export type Challenge = 'rounds' | 'hints' | 'different' | 'routes';
export const challenges: Record<Challenge, string> = {
  rounds: 'ทำให้สำเร็จภายในจำนวนรอบที่กำหนด',
  hints: 'แก้สมการโดยไม่เปิดคำใบ้',
  different: 'ใช้คำสั่งต่างกันสองฝั่งให้ได้ผลเดียวกัน',
  routes: 'หาเส้นทางแก้โจทย์เดียวกันสองวิธี',
};
