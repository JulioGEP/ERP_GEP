// frontend/src/features/recursos/trainers.constants.ts
import { DOCUMENT_TYPES, type DocumentTypeValue } from '../../constants/documentTypes';

export const SEDE_OPTIONS = ['GEP Arganda', 'GEP Sabadell', 'In company'] as const;

export const TRAINER_DOCUMENT_TYPES = DOCUMENT_TYPES;

export type SedeOption = (typeof SEDE_OPTIONS)[number];
export type TrainerDocumentTypeValue = DocumentTypeValue;
