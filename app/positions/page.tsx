'use client';

import { PositionsTab } from '@/components/PositionsTab';
import { Tokens as T } from '@/components/obsidian/primitives';

export default function PositionsPage() {
  return (
    <div style={{ padding: 24, color: T.text1 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 18 }}>
        <h1 style={{ fontSize: 22, fontWeight: 600, letterSpacing: '-0.015em', color: T.text1 }}>Positions</h1>
        <span style={{ fontSize: 12, color: T.text3 }}>Manually tracked · localStorage backed</span>
      </div>
      <PositionsTab />
    </div>
  );
}
