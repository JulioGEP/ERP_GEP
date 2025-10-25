export {
  API_BASE,
  ApiError,
  isApiError,
  requestJson,
  toStringValue,
  toStringArray,
  blobToBase64,
} from '../../api/client';

export * from './types';

export {
  fetchDealsWithoutSessions,
  fetchDealsWithPendingCertificates,
  fetchDealDetail,
  importDeal,
  deleteDeal,
  patchDealEditable,
  createDealNote,
  updateDealNote,
  deleteDealNote,
  buildDealDetailViewModel,
  type DealEditablePatch,
  type DealProductEditablePatch,
  type ImportDealResult,
} from './deals.api';

export {
  listDocuments,
  getDocPreviewUrl,
  uploadManualDocument,
  deleteDocument,
  fetchSessionDocuments,
  uploadSessionDocuments,
  updateSessionDocumentShare,
  deleteSessionDocument,
  uploadSessionCertificate,
  MANUAL_DOCUMENT_SIZE_LIMIT_BYTES,
  MANUAL_DOCUMENT_SIZE_LIMIT_LABEL,
  MANUAL_DOCUMENT_SIZE_LIMIT_MESSAGE,
  SESSION_DOCUMENT_SIZE_LIMIT_BYTES,
  SESSION_DOCUMENT_SIZE_LIMIT_LABEL,
  SESSION_DOCUMENT_SIZE_LIMIT_MESSAGE,
  type SessionCertificateUploadResult,
} from './documents.api';

export {
  generateSessionsFromDeal,
  fetchDealSessions,
  createSession,
  patchSession,
  fetchSessionCounts,
  deleteSession,
  fetchActiveTrainers,
  fetchRoomsCatalog,
  fetchMobileUnitsCatalog,
  fetchProductVariants,
  fetchVariantSiblings,
  fetchSessionAvailability,
  fetchSessionComments,
  createSessionComment,
  updateSessionComment,
  deleteSessionComment,
  fetchSessionPublicLink,
  createSessionPublicLink,
  deleteSessionPublicLink,
  type VariantSiblingOption,
  type VariantSiblingsResponse,
} from './sessions.api';

export {
  fetchSessionStudents,
  fetchDealStudents,
  createSessionStudent,
  updateSessionStudent,
  deleteSessionStudent,
  fetchPublicSessionStudents,
  createPublicSessionStudent,
  updatePublicSessionStudent,
  deletePublicSessionStudent,
  type CreateSessionStudentInput,
  type UpdateSessionStudentInput,
} from './students.api';
