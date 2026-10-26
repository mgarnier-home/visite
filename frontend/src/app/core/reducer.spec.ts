import { describe, expect, it } from 'vitest';
import { Op, OpType, VisitState } from './api.types';
import { applyOp, mergeChanges } from './reducer';

function baseState(): VisitState {
  return {
    seq: 1,
    me: { number: 2 },
    visit: {
      code: 'abc', is_creator: false, created_at: '2026-01-01T00:00:00Z', closed_at: null,
      fiche: {
        address: 'rue A', price_eur: null, living_area_m2: null, floor_area_m2: null,
        land_area_m2: null, visit_at: null, agent_name: null, agent_phone: null,
        agent_email: null, construction_year: null, dpe_energy: null, dpe_ges: null,
        rooms_count: null, bedrooms_count: null, listing_url: null, heating_type: null,
      },
      packing_list: '', participants: 2,
    },
    rooms: [{ id: 'r1', name: 'Salon', dir_name: 'salon', kind: 'room', position: 3, hidden: false }],
    points: [{ id: 'p1', room_id: 'r1', label: 'Murs', type: 'constat', options: [], weight: 1, position: 4, important: true }],
    questions: [{ id: 'q1', room_id: 'r1', text: 'Âge ?', position: 2, important: false }],
    shared: [], ratings: [], comments: [], photos: [],
  };
}

function op(type: OpType, payload: object, client_ts = 1000): Op {
  return { op_id: 'o-' + type, type, client_ts, payload };
}

describe('applyOp', () => {
  it('set_rating ajoute ou remplace ma note', () => {
    const s1 = applyOp(baseState(), op('set_rating', { point_id: 'p1', value: 4 }, 10));
    expect(s1.ratings).toEqual([{ point_id: 'p1', value: 4, updated_at: 10 }]);
    const s2 = applyOp(s1, op('set_rating', { point_id: 'p1', value: null }, 20));
    expect(s2.ratings).toEqual([{ point_id: 'p1', value: null, updated_at: 20 }]);
  });

  it('set_comment ajoute ou remplace mon commentaire', () => {
    const s = applyOp(baseState(), op('set_comment', { room_id: 'r1', text: 'ok' }, 10));
    expect(s.comments).toEqual([{ room_id: 'r1', text: 'ok', updated_at: 10 }]);
  });

  it('set_shared met author et updated_at', () => {
    const s1 = applyOp(baseState(), op('set_shared', { target_id: 'p1', field: 'blocking', value: true }, 10));
    expect(s1.shared).toEqual([{ target_id: 'p1', field: 'blocking', value: true, updated_at: 10, author: 2 }]);
    const s2 = applyOp(s1, op('set_shared', { target_id: 'p1', field: 'blocking', value: false }, 20));
    expect(s2.shared).toEqual([{ target_id: 'p1', field: 'blocking', value: false, updated_at: 20, author: 2 }]);
  });

  it('set_shared sur le code de la visite : notes de la visite', () => {
    const s = applyOp(baseState(), op('set_shared', { target_id: 'abc', field: 'notes', value: 'Rappeler' }, 10));
    expect(s.shared).toEqual([{ target_id: 'abc', field: 'notes', value: 'Rappeler', updated_at: 10, author: 2 }]);
    expect(applyOp(baseState(), op('set_shared', { target_id: 'autre', field: 'notes', value: 'x' })).shared).toEqual([]);
  });

  it('set_fiche fusionne les champs', () => {
    const s = applyOp(baseState(), op('set_fiche', { fields: { price_eur: 250000 } }));
    expect(s.visit.fiche.price_eur).toBe(250000);
    expect(s.visit.fiche.address).toBe('rue A');
  });

  it('close_visit renseigne closed_at', () => {
    const s = applyOp(baseState(), op('close_visit', {}, 0));
    expect(s.visit.closed_at).toBe('1970-01-01T00:00:00.000Z');
  });

  it('add_room avec note_point_id ajoute la pièce et le point note globale', () => {
    const s = applyOp(baseState(), op('add_room', { id: 'r2', name: 'Cave', from_section_id: null, note_point_id: 'n2' }));
    expect(s.rooms[1]).toEqual({ id: 'r2', name: 'Cave', dir_name: '', kind: 'room', position: 4, hidden: false });
    expect(s.points[1]).toEqual({
      id: 'n2', room_id: 'r2', label: 'Note globale de la pièce', type: 'note',
      options: [], weight: 1, position: 0, important: true,
    });
  });

  it('add_room sans note_point_id ajoute la pièce seule', () => {
    const s = applyOp(baseState(), op('add_room', { id: 'r2', name: 'Cave', from_section_id: 's1' }));
    expect(s.rooms.map((r) => r.id)).toEqual(['r1', 'r2']);
    expect(s.points).toHaveLength(1);
  });

  it('add_room avec section et note_point_id ajoute aussi le point', () => {
    const s = applyOp(baseState(), op('add_room', { id: 'r2', name: 'Cave', from_section_id: 's1', note_point_id: 'n2' }));
    expect(s.points.map((p) => p.id)).toEqual(['p1', 'n2']);
  });

  it('rename_room change le nom', () => {
    const s = applyOp(baseState(), op('rename_room', { room_id: 'r1', name: 'Séjour' }));
    expect(s.rooms[0].name).toBe('Séjour');
  });

  it('hide_room masque la pièce', () => {
    const s = applyOp(baseState(), op('hide_room', { room_id: 'r1' }));
    expect(s.rooms[0].hidden).toBe(true);
  });

  it('add_point ajoute un point en dernière position', () => {
    const s = applyOp(baseState(), op('add_point', { id: 'p2', room_id: 'r1', label: 'Sol', type: 'case', options: ['a'] }));
    expect(s.points[1]).toEqual({ id: 'p2', room_id: 'r1', label: 'Sol', type: 'case', options: ['a'], weight: 1, position: 5, important: true });
  });

  it('add_question ajoute une question en dernière position', () => {
    const s = applyOp(baseState(), op('add_question', { id: 'q2', room_id: 'r1', text: 'Taxe ?' }));
    // ajoutée pendant la visite : importante
    expect(s.questions[1]).toEqual({ id: 'q2', room_id: 'r1', text: 'Taxe ?', position: 3, important: true });
  });

  it('renvoie l\'état inchangé pour un type ou une cible inconnus', () => {
    const st = baseState();
    expect(applyOp(st, { op_id: 'x', type: 'bogus' as OpType, client_ts: 1, payload: {} })).toEqual(st);
    expect(applyOp(st, op('rename_room', { room_id: 'nope', name: 'x' }))).toEqual(st);
    expect(applyOp(st, op('add_point', { id: 'p9', room_id: 'nope', label: 'x', type: 'note', options: [] }))).toEqual(st);
  });

  it('ne modifie jamais son entrée', () => {
    const st = baseState();
    const copy = structuredClone(st);
    const types: [OpType, object][] = [
      ['set_rating', { point_id: 'p1', value: 1 }], ['set_comment', { room_id: 'r1', text: 't' }],
      ['set_shared', { target_id: 'p1', field: 'value', value: 1 }], ['set_fiche', { fields: { address: 'z' } }],
      ['close_visit', {}], ['add_room', { id: 'r2', name: 'n', from_section_id: null, note_point_id: 'n2' }],
      ['rename_room', { room_id: 'r1', name: 'n' }], ['hide_room', { room_id: 'r1' }],
      ['add_point', { id: 'p2', room_id: 'r1', label: 'l', type: 'note', options: [] }],
      ['add_question', { id: 'q2', room_id: 'r1', text: 't' }],
    ];
    for (const [t, p] of types) {
      const out = applyOp(st, op(t, p));
      expect(out).not.toBe(st);
    }
    expect(st).toEqual(copy);
  });
});

describe('mergeChanges', () => {
  it('remplace une valeur partagée existante et ajoute une nouvelle pièce', () => {
    const st = baseState();
    st.shared = [{ target_id: 'p1', field: 'value', value: 1, updated_at: 1, author: 1 }];
    const ch = baseState();
    ch.seq = 9;
    ch.me = { number: 3 };
    ch.visit = { ...ch.visit, participants: 5 };
    ch.rooms = [{ id: 'r2', name: 'Cave', dir_name: 'cave', kind: 'room', position: 5, hidden: false }];
    ch.points = []; ch.questions = [];
    ch.shared = [{ target_id: 'p1', field: 'value', value: 2, updated_at: 5, author: 3 }];
    const m = mergeChanges(st, ch);
    expect(m.shared).toEqual([{ target_id: 'p1', field: 'value', value: 2, updated_at: 5, author: 3 }]);
    expect(m.rooms.map((r) => r.id)).toEqual(['r1', 'r2']);
    expect(m.seq).toBe(9);
    expect(m.me.number).toBe(3);
    expect(m.visit.participants).toBe(5);
    expect(st.shared[0].value).toBe(1);
  });

  it('fusionne ratings, comments, photos et questions par clé', () => {
    const st = baseState();
    st.ratings = [{ point_id: 'p1', value: 1, updated_at: 1 }];
    st.comments = [{ room_id: 'r1', text: 'a', updated_at: 1 }];
    const ch = baseState();
    ch.points = []; ch.rooms = [];
    ch.questions = [{ id: 'q1', room_id: 'r1', text: 'Nouveau', position: 2, important: false }];
    ch.ratings = [{ point_id: 'p1', value: 5, updated_at: 2 }];
    ch.comments = [{ room_id: 'r1', text: 'b', updated_at: 2 }];
    ch.photos = [{ id: 'ph1', room_id: null, author: 1, taken_at: 't' }];
    const m = mergeChanges(st, ch);
    expect(m.ratings).toEqual([{ point_id: 'p1', value: 5, updated_at: 2 }]);
    expect(m.comments).toEqual([{ room_id: 'r1', text: 'b', updated_at: 2 }]);
    expect(m.questions).toHaveLength(1);
    expect(m.questions[0].text).toBe('Nouveau');
    expect(m.photos).toHaveLength(1);
  });

  it('le point note globale local est remplacé par id par celui du serveur', () => {
    const st = applyOp(baseState(), op('add_room', { id: 'r2', name: 'Cave', from_section_id: null, note_point_id: 'n2' }));
    const ch = baseState();
    ch.rooms = []; ch.questions = [];
    ch.points = [{ id: 'n2', room_id: 'r2', label: 'Note globale de la pièce', type: 'note', options: [], weight: 1, position: 0, important: true }];
    const m = mergeChanges(st, ch);
    expect(m.points.filter((p) => p.room_id === 'r2')).toHaveLength(1);
  });
});
