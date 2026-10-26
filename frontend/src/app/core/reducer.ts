import {
  Comment, Fiche, Op, Point, Question, Rating, Room, SharedField, SharedValue, VisitState,
} from './api.types';

const GLOBAL_NOTE_LABEL = 'Note globale de la pièce';

type Payload = Record<string, any>;

function maxPosition(items: { position: number }[]): number {
  return items.reduce((m, i) => Math.max(m, i.position), -1);
}

function upsert<T>(list: T[], item: T, same: (a: T) => boolean): T[] {
  const i = list.findIndex(same);
  if (i < 0) return [...list, item];
  const copy = [...list];
  copy[i] = item;
  return copy;
}

/** Applique une opération localement, comme le ferait le serveur (affichage seulement). Pure. */
export function applyOp(state: VisitState, op: Op): VisitState {
  const p = op.payload as Payload;
  const hasRoom = (id: string) => state.rooms.some((r) => r.id === id);

  switch (op.type) {
    case 'set_rating': {
      if (!state.points.some((x) => x.id === p['point_id'])) return state;
      const rating: Rating = { point_id: p['point_id'], value: p['value'], updated_at: op.client_ts };
      return { ...state, ratings: upsert(state.ratings, rating, (r) => r.point_id === rating.point_id) };
    }
    case 'set_comment': {
      if (!hasRoom(p['room_id'])) return state;
      const comment: Comment = { room_id: p['room_id'], text: p['text'], updated_at: op.client_ts };
      return { ...state, comments: upsert(state.comments, comment, (c) => c.room_id === comment.room_id) };
    }
    case 'set_shared': {
      const id = p['target_id'];
      // cible : la visite elle-même (ses notes, par son code), une pièce, un point ou une question
      const known = id === state.visit.code || hasRoom(id)
        || state.points.some((x) => x.id === id) || state.questions.some((q) => q.id === id);
      if (!known) return state;
      const sv: SharedValue = {
        target_id: id, field: p['field'] as SharedField, value: p['value'],
        updated_at: op.client_ts, author: state.me.number,
      };
      return { ...state, shared: upsert(state.shared, sv, (s) => s.target_id === id && s.field === sv.field) };
    }
    case 'set_fiche': {
      const fields = (p['fields'] ?? {}) as Partial<Fiche>;
      return { ...state, visit: { ...state.visit, fiche: { ...state.visit.fiche, ...fields } } };
    }
    case 'close_visit':
      return { ...state, visit: { ...state.visit, closed_at: new Date(op.client_ts).toISOString() } };
    case 'add_room': {
      const id: string = p['id'];
      if (hasRoom(id)) return state;
      const room: Room = {
        id, name: p['name'], dir_name: '', kind: 'room', position: maxPosition(state.rooms) + 1, hidden: false,
      };
      const next = { ...state, rooms: [...state.rooms, room] };
      // Le point note est créé seulement si l'appelant fournit son id (le serveur le réutilise).
      if (!p['note_point_id']) return next;
      const note: Point = {
        id: p['note_point_id'], room_id: id, label: GLOBAL_NOTE_LABEL, type: 'note',
        options: [], weight: 1, position: 0,
      };
      return { ...next, points: [...state.points, note] };
    }
    case 'rename_room':
      if (!hasRoom(p['room_id'])) return state;
      return { ...state, rooms: state.rooms.map((r) => (r.id === p['room_id'] ? { ...r, name: p['name'] } : r)) };
    case 'hide_room':
      if (!hasRoom(p['room_id'])) return state;
      return { ...state, rooms: state.rooms.map((r) => (r.id === p['room_id'] ? { ...r, hidden: true } : r)) };
    case 'add_point': {
      if (!hasRoom(p['room_id']) || state.points.some((x) => x.id === p['id'])) return state;
      const inRoom = state.points.filter((x) => x.room_id === p['room_id']);
      const point: Point = {
        id: p['id'], room_id: p['room_id'], label: p['label'], type: p['type'],
        options: [...(p['options'] ?? [])], weight: 1, position: maxPosition(inRoom) + 1,
      };
      return { ...state, points: [...state.points, point] };
    }
    case 'add_question': {
      if (!hasRoom(p['room_id']) || state.questions.some((x) => x.id === p['id'])) return state;
      const inRoom = state.questions.filter((x) => x.room_id === p['room_id']);
      const q: Question = { id: p['id'], room_id: p['room_id'], text: p['text'], position: maxPosition(inRoom) + 1 };
      return { ...state, questions: [...state.questions, q] };
    }
    default:
      return state;
  }
}

function mergeBy<T>(local: T[], incoming: T[], key: (t: T) => string): T[] {
  const result = [...local];
  const index = new Map(result.map((t, i) => [key(t), i]));
  for (const item of incoming) {
    const i = index.get(key(item));
    if (i === undefined) {
      index.set(key(item), result.length);
      result.push(item);
    } else {
      result[i] = item;
    }
  }
  return result;
}

/** Fusionne les changements du serveur dans l'état local. Pure. */
export function mergeChanges(state: VisitState, changes: VisitState): VisitState {
  return {
    ...state,
    seq: changes.seq,
    me: changes.me,
    visit: changes.visit,
    rooms: mergeBy(state.rooms, changes.rooms, (r) => r.id),
    points: mergeBy(state.points, changes.points, (p) => p.id),
    questions: mergeBy(state.questions, changes.questions, (q) => q.id),
    shared: mergeBy(state.shared, changes.shared, (s) => `${s.target_id}\u0000${s.field}`),
    ratings: mergeBy(state.ratings, changes.ratings, (r) => r.point_id),
    comments: mergeBy(state.comments, changes.comments, (c) => c.room_id),
    photos: mergeBy(state.photos, changes.photos, (p) => p.id),
  };
}
