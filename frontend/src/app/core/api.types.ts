// Contrat JSON partagé avec le backend Go (voir shared-context.md).

export type SectionKind = 'room' | 'per_bedroom' | 'topic' | 'summary';
export type PointType = 'note' | 'constat' | 'case';

export interface Template { version: number; packing_list: string; sections: TemplateSection[] }
export interface TemplateSection {
  id: string; name: string; kind: SectionKind; position: number;
  points: TemplatePoint[]; questions: TemplateQuestion[];
}
/** important : affiché par défaut dans la pièce ; sinon point secondaire. */
export interface TemplatePoint {
  id: string; label: string; type: PointType; options: string[]; weight: number; position: number;
  important: boolean;
}
export interface TemplateQuestion { id: string; text: string; position: number; important: boolean }

export type ListingStatus = 'contact' | 'mail' | 'planned' | 'done' | 'dropped';
export type ListingSource = 'bienici' | 'manual' | string;
export interface ListingPhoto { id: string; position: number }
/** Annonce suivie ; les champs de ListingData sont aplatis dans l'objet. */
export interface Listing {
  id: string; source: ListingSource; url: string; status: ListingStatus;
  created_at: string; mail_sent_at: string | null; visit_at: string | null;
  visited_at: string | null; fetched_at: string | null; removed_at: string | null;
  fetch_error: string; address: string; notes: string;
  title: string; property_type: string; price_eur: number | null;
  living_area_m2: number | null; land_area_m2: number | null;
  rooms: number | null; bedrooms: number | null; bathrooms: number | null;
  shower_rooms: number | null; toilets: number | null; parking: number | null;
  floor: number | null; construction_year: number | null;
  dpe: string; ges: string; heating: string; city: string; postal_code: string;
  description: string; agency: string; agent_phone: string; agent_email: string;
  features: string[]; photos: ListingPhoto[];
}

export interface VisitInfo {
  code: string; created_at: string; packing_list: string; participants: number;
}
export interface Room {
  id: string; name: string; dir_name: string; kind: SectionKind; position: number; hidden: boolean;
}
/** important : affiché(e) par défaut dans sa pièce ; sinon point ou question secondaire. */
export interface Point {
  id: string; room_id: string; label: string; type: PointType; options: string[];
  weight: number; position: number; important: boolean;
}
export interface Question { id: string; room_id: string; text: string; position: number; important: boolean }
export type SharedField = 'value' | 'blocking' | 'works_eur' | 'answer' | 'asked' | 'area_m2' | 'notes';
export interface SharedValue {
  target_id: string; field: SharedField; value: unknown; updated_at: number;
  author: number; // numéro du participant
}
export interface Rating { point_id: string; value: number | null; updated_at: number }
export interface Comment { room_id: string; text: string; updated_at: number }
export interface Photo { id: string; room_id: string | null; author: number; taken_at: string }

export interface VisitState {
  seq: number; me: { number: number }; visit: VisitInfo; rooms: Room[]; points: Point[];
  questions: Question[]; shared: SharedValue[]; ratings: Rating[]; comments: Comment[];
  photos: Photo[];
}

export type OpType = 'add_room' | 'rename_room' | 'hide_room' | 'add_point' | 'add_question'
  | 'set_rating' | 'set_comment' | 'set_shared';
export interface Op { op_id: string; type: OpType; client_ts: number; payload: object }
export interface OpResult {
  op_id: string; result: 'applied' | 'duplicate' | 'rejected';
  reason?: 'forbidden' | 'not_found' | 'invalid';
}
export interface OpsResponse { seq: number; results: OpResult[] }
/** Corps de POST /api/listings/{id}/visit/ops. */
export interface OpsRequest { ops: Op[] }

export interface JoinResponse { number: number }
export interface ErrorResponse { error: string }
