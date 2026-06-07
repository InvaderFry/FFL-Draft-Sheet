import { describe, it, expect } from 'vitest'
import { ecrColor, ecrColorStyle } from './ecrColor'

describe('ecrColor', () => {
  const nTeams = 12

  it('returns "none" when either rank is missing', () => {
    expect(ecrColor(null, 10, nTeams)).toBe('none')
    expect(ecrColor(10, null, nTeams)).toBe('none')
    expect(ecrColor(null, null, nTeams)).toBe('none')
  })

  it('returns "blue" when ADP is a full round or more earlier than ECR', () => {
    // adp <= ecr - nTeams  →  going earlier than ranked
    expect(ecrColor(10, 24, nTeams)).toBe('blue')
    expect(ecrColor(12, 24, nTeams)).toBe('blue') // exactly on the boundary
  })

  it('returns "orange" when ADP is a full round or more later than ECR', () => {
    expect(ecrColor(40, 24, nTeams)).toBe('orange')
    expect(ecrColor(36, 24, nTeams)).toBe('orange') // exactly on the boundary
  })

  it('returns "none" within one round of divergence', () => {
    expect(ecrColor(24, 24, nTeams)).toBe('none')
    expect(ecrColor(20, 24, nTeams)).toBe('none')
    expect(ecrColor(30, 24, nTeams)).toBe('none')
  })

  it('respects league size for the threshold', () => {
    expect(ecrColor(25, 30, 8)).toBe('none')   // diff 5 < 8 → none
    expect(ecrColor(22, 30, 8)).toBe('blue')   // 22 <= 30-8 → blue
  })
})

describe('ecrColorStyle', () => {
  it('maps colors to CSS variables', () => {
    expect(ecrColorStyle('blue')).toBe('var(--c-ecr-blue)')
    expect(ecrColorStyle('orange')).toBe('var(--c-ecr-orange)')
    expect(ecrColorStyle('none')).toBe('inherit')
    expect(ecrColorStyle('anything-else')).toBe('inherit')
  })
})
