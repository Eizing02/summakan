import type { CSSProperties, ReactNode } from 'react';
import type { Tile } from '../features/game/session';

export const tileColor: Record<Tile, string> = {
  '+': 'emerald', '−': 'ruby', '×': 'amber', '÷': 'purple',
  '0': 'sapphire', '1': 'sapphire', '2': 'sapphire', '3': 'sapphire', '4': 'sapphire',
  '5': 'sapphire', '6': 'sapphire', '7': 'sapphire', '8': 'sapphire', '9': 'sapphire',
};
export const tileName: Partial<Record<Tile, string>> = { '+': 'บวก', '−': 'ลบ', '×': 'คูณ', '÷': 'หาร' };

export function TileFace({ tile, children, style }: { tile: Tile; children?: ReactNode; style?: CSSProperties }) {
  return <span className={'tile-face tile-' + tileColor[tile]} style={style} aria-hidden="true">{children ?? tile}</span>;
}
