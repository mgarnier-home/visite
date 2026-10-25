import { CODE_RE, normalizeCode } from './code';

describe('normalizeCode', () => {
  it('retire les espaces autour et passe en minuscules', () => {
    expect(normalizeCode('  Maison-Nantes-Centre ')).toBe('maison-nantes-centre');
  });
  it('remplace les espaces par un tiret', () => {
    expect(normalizeCode('maison nantes')).toBe('maison-nantes');
    expect(normalizeCode('maison   \t nantes')).toBe('maison-nantes');
  });
  it('fusionne les tirets répétés et retire ceux des bords', () => {
    expect(normalizeCode('--a---b--')).toBe('a-b');
  });
  it('supprime les caractères hors [a-z0-9-]', () => {
    expect(normalizeCode('Maison_é!#12')).toBe('maison12');
  });
  it('produit un code accepté par CODE_RE', () => {
    expect(CODE_RE.test(normalizeCode(' Maison Nantes '))).toBe(true);
    expect(CODE_RE.test('a')).toBe(false);
  });
});
