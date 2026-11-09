import { describe, expect, it } from 'vitest';
import { KNOWN_GAPS } from '../knownGaps';

describe('known-gap registry (tests/knownGaps.ts)', () => {
  it('every entry has a category, a reason and an audit reference', () => {
    for (const [name, g] of KNOWN_GAPS) {
      expect(['model-deficiency', 'test-premise', 'reference-data'], name).toContain(g.category);
      expect(g.reason.trim().length, name).toBeGreaterThan(10);
      expect(g.ref, name).toMatch(/^physics_audit §\d+/);
    }
  });

  it('reports the number of tracked expected failures per category', () => {
    const counts: Record<string, number> = {};
    for (const g of KNOWN_GAPS.values()) counts[g.category] = (counts[g.category] ?? 0) + 1;
    console.log(`Known gaps (expected failures): ${KNOWN_GAPS.size}`, counts);
    expect(KNOWN_GAPS.size).toBeGreaterThan(0);
  });
});
