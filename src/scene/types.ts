import type { RefObject } from 'react';
import type { Side } from '../core/mathematics/linear-expression';
import type { Tile } from '../features/game/session';

export type Quality = 'auto' | 'low' | 'medium' | 'high' | '2d';
export type SceneMood = 'idle' | 'uneven' | 'even' | 'waiting' | 'victory';
export type PanAnchors = Record<Side, RefObject<HTMLDivElement | null>>;
export interface SceneProps {
  target: number;
  mood: SceneMood;
  reduced: boolean;
  quality: Quality;
  anchors?: PanAnchors;
  panTiles?: Record<Side, Tile[]>;
}
