import { fitWithin } from './image';

describe('fitWithin', () => {
  it('réduit une image paysage au grand côté max', () => {
    expect(fitWithin(4000, 3000)).toEqual({ width: 2000, height: 1500 });
  });
  it('réduit une image portrait au grand côté max', () => {
    expect(fitWithin(3000, 4000)).toEqual({ width: 1500, height: 2000 });
  });
  it('laisse inchangée une image déjà assez petite', () => {
    expect(fitWithin(1000, 800)).toEqual({ width: 1000, height: 800 });
  });
  it('accepte un maximum personnalisé', () => {
    expect(fitWithin(1000, 500, 500)).toEqual({ width: 500, height: 250 });
  });
});
