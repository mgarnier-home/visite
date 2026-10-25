import { Fiche, Point, Rating, Room, SharedValue, VisitState } from './api.types';
import {
  blockingPoints, buildingAge, notaryFees, pricePerM2, realPrice, totalWorks, unaskedCount,
  weightedScore,
} from './compute';

function fiche(p: Partial<Fiche> = {}): Fiche {
  return {
    address: '', price_eur: null, living_area_m2: null, floor_area_m2: null, land_area_m2: null,
    visit_at: null, agent_name: null, agent_phone: null, agent_email: null,
    construction_year: null, dpe_energy: null, dpe_ges: null, rooms_count: null,
    bedrooms_count: null, listing_url: null, heating_type: null, ...p,
  };
}
function room(id: string, position: number, o: Partial<Room> = {}): Room {
  return { id, name: id, dir_name: id, kind: 'room', position, hidden: false, ...o };
}
function point(id: string, room_id: string, position: number, o: Partial<Point> = {}): Point {
  return { id, room_id, label: id, type: 'note', options: [], weight: 1, position, ...o };
}
function shared(target_id: string, field: SharedValue['field'], value: unknown): SharedValue {
  return { target_id, field, value, updated_at: 1, author: 1 };
}
function rating(point_id: string, value: number | null): Rating {
  return { point_id, value, updated_at: 1 };
}
function state(o: Partial<VisitState> = {}, f: Partial<Fiche> = {}): VisitState {
  return {
    seq: 0, me: { number: 1 },
    visit: {
      code: 'abc', is_creator: true, created_at: '', closed_at: null, fiche: fiche(f),
      packing_list: '', participants: 1,
    },
    rooms: [], points: [], questions: [], shared: [], ratings: [], comments: [], photos: [], ...o,
  };
}

describe('notaryFees', () => {
  it('vaut 7,5 % du prix', () => {
    expect(notaryFees(300000)).toBeCloseTo(22500, 9);
  });
});

describe('pricePerM2', () => {
  it('divise le prix par la surface habitable', () => {
    expect(pricePerM2(fiche({ price_eur: 300000, living_area_m2: 120 }))).toBe(2500);
  });
  it('est null si prix ou surface manque, ou si la surface est nulle', () => {
    expect(pricePerM2(fiche({ price_eur: 300000, living_area_m2: 0 }))).toBeNull();
    expect(pricePerM2(fiche({ price_eur: 300000 }))).toBeNull();
    expect(pricePerM2(fiche({ living_area_m2: 120 }))).toBeNull();
  });
});

describe('buildingAge', () => {
  it('soustrait l\'année de construction', () => {
    expect(buildingAge(fiche({ construction_year: 1990 }), 2026)).toBe(36);
  });
  it('est null si l\'année est inconnue', () => {
    expect(buildingAge(fiche(), 2026)).toBeNull();
  });
});

describe('totalWorks / realPrice', () => {
  const rooms = [room('r1', 0), room('r2', 1, { hidden: true }), room('s', 2, { kind: 'summary' })];
  const points = [point('p1', 'r1', 0), point('p2', 'r2', 0), point('p3', 's', 0)];
  const sh = [
    shared('p1', 'works_eur', 1000), shared('p2', 'works_eur', 5000),
    shared('p3', 'works_eur', 200), shared('p1', 'works_eur', 'x'),
  ];
  it('ignore une pièce masquée et compte le récapitulatif', () => {
    const s = state({ rooms, points, shared: sh.slice(0, 3) });
    expect(totalWorks(s)).toBe(1200);
  });
  it('ignore les valeurs non numériques', () => {
    const s = state({ rooms, points, shared: [sh[3]] });
    expect(totalWorks(s)).toBe(0);
  });
  it('realPrice = prix + frais de notaire + travaux', () => {
    const s = state({ rooms, points, shared: sh.slice(0, 3) }, { price_eur: 300000 });
    expect(realPrice(s)).toBeCloseTo(323700, 6);
  });
  it('realPrice est null sans prix', () => {
    expect(realPrice(state({ rooms, points, shared: sh.slice(0, 3) }))).toBeNull();
  });
});

describe('weightedScore', () => {
  const rooms = [room('s', 0, { kind: 'summary' }), room('h', 1, { kind: 'summary', hidden: true })];
  const points = [
    point('a', 's', 0, { weight: 3 }), point('b', 's', 1, { weight: 1 }),
    point('c', 's', 2, { weight: 2 }), point('d', 's', 3, { type: 'case', weight: 5 }),
  ];
  it('moyenne pondérée, N/A et points hors note exclus', () => {
    const ratings = [rating('a', 5), rating('b', 3), rating('c', null), rating('d', 1)];
    expect(weightedScore(state({ rooms, points, ratings }))).toBe(4.5);
  });
  it('arrondit au dixième (4,25 -> 4,3)', () => {
    const pts = [point('x', 's', 0, { weight: 1 }), point('y', 's', 1, { weight: 3 })];
    expect(weightedScore(state({ rooms, points: pts, ratings: [rating('x', 5), rating('y', 4)] })))
      .toBe(4.3);
  });
  it('est null sans note', () => {
    expect(weightedScore(state({ rooms, points, ratings: [rating('c', null)] }))).toBeNull();
    expect(weightedScore(state({ rooms, points }))).toBeNull();
  });
  it('est null sans pièce récapitulatif visible', () => {
    const r = [room('s', 0, { kind: 'summary', hidden: true })];
    expect(weightedScore(state({ rooms: r, points, ratings: [rating('a', 5)] }))).toBeNull();
  });
});

describe('blockingPoints', () => {
  it('liste les points bloquants des pièces visibles, par pièce puis position', () => {
    const rooms = [room('r2', 1), room('r1', 0), room('rh', 2, { hidden: true })];
    const points = [
      point('b', 'r1', 1), point('a', 'r1', 0), point('c', 'r2', 0), point('d', 'rh', 0),
      point('e', 'r1', 2),
    ];
    const sh = [
      shared('c', 'blocking', true), shared('b', 'blocking', true), shared('a', 'blocking', true),
      shared('d', 'blocking', true), shared('e', 'blocking', false),
    ];
    expect(blockingPoints(state({ rooms, points, shared: sh })).map(p => p.id))
      .toEqual(['a', 'b', 'c']);
  });
});

describe('unaskedCount', () => {
  it('compte les questions non posées des pièces visibles seulement', () => {
    const rooms = [room('r1', 0), room('rh', 1, { hidden: true })];
    const questions = [
      { id: 'q1', room_id: 'r1', text: '', position: 0 },
      { id: 'q2', room_id: 'r1', text: '', position: 1 },
      { id: 'q3', room_id: 'r1', text: '', position: 2 },
      { id: 'q4', room_id: 'rh', text: '', position: 0 },
    ];
    const sh = [shared('q1', 'asked', true), shared('q2', 'asked', false)];
    expect(unaskedCount(state({ rooms, questions, shared: sh }))).toBe(2);
  });
});
