import { ChangeEvent, FormEvent, useCallback, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Badge, Button, Card, Col, Form, InputGroup, ListGroup, Row, Spinner } from 'react-bootstrap';
import { changePassword } from '../../api/auth';
import { ApiError } from '../../api/client';
import { fetchUserDocuments, type UserDocument } from '../../api/userDocuments';
import { fetchUserById } from '../../api/users';
import {
  fetchUserVacations,
  sendVacationRequest,
  type UserVacationsResponse,
  type VacationType,
} from '../../api/userVacations';
import { fetchTrainerDocuments, fetchTrainers, uploadTrainerDocument } from '../../features/recursos/api';
import { TRAINER_DOCUMENT_TYPES, type TrainerDocumentTypeValue } from '../../features/recursos/trainers.constants';
import { VacationCalendar } from '../../components/vacations/VacationCalendar';
import { useAuth } from '../../context/AuthContext';
import type { TrainerDocument } from '../../types/trainer';

type ProfileDocument = TrainerDocument | UserDocument;

type ProfileUser = {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  role: string;
  active: boolean;
  bankAccount?: string | null;
  address?: string | null;
  position?: string | null;
  startDate?: string | null;
  trainerId?: string | null;
};

const VACATION_LABELS: Record<VacationType, { label: string; fullLabel: string }> = {
  V: { label: 'Vacaciones', fullLabel: 'Vacaciones' },
  L: { label: 'Festivo local', fullLabel: 'Festivo local' },
  A: { label: 'Día aniversario', fullLabel: 'Día aniversario' },
  T: { label: 'Teletrabajo', fullLabel: 'Teletrabajo' },
  M: { label: 'Matrimonio', fullLabel: 'Matrimonio o registro de pareja de hecho' },
  H: {
    label: 'Accidente',
    fullLabel: 'Accidente, enfermedad, hospitalización o intervención de un familiar',
  },
  F: { label: 'Fallecimiento', fullLabel: 'Fallecimiento de un familiar' },
  R: { label: 'Traslado', fullLabel: 'Traslado del domicilio habitual' },
  P: { label: 'Exámenes', fullLabel: 'Exámenes prenatales' },
  I: { label: 'Incapacidad', fullLabel: 'Incapacidad temporal' },
  N: { label: 'Festivos nacionales', fullLabel: 'Festivos nacionales' },
};

const VACATION_COLORS: Record<VacationType, string> = {
  V: '#2563eb',
  L: '#65a30d',
  A: '#e11d48',
  T: '#7c3aed',
  M: '#f97316',
  H: '#ef4444',
  F: '#0ea5e9',
  R: '#0f766e',
  P: '#a855f7',
  I: '#475569',
  N: '#facc15',
};

const VACATION_TAG_OPTIONS: Array<{ value: VacationType | ''; label: string }> = [
  { value: '', label: 'Sin marca' },
  { value: 'V', label: VACATION_LABELS.V.fullLabel },
  { value: 'L', label: VACATION_LABELS.L.fullLabel },
  { value: 'A', label: VACATION_LABELS.A.fullLabel },
  { value: 'T', label: VACATION_LABELS.T.fullLabel },
  { value: 'M', label: VACATION_LABELS.M.fullLabel },
  { value: 'H', label: VACATION_LABELS.H.fullLabel },
  { value: 'F', label: VACATION_LABELS.F.fullLabel },
  { value: 'R', label: VACATION_LABELS.R.fullLabel },
  { value: 'P', label: VACATION_LABELS.P.fullLabel },
  { value: 'I', label: VACATION_LABELS.I.fullLabel },
  { value: 'N', label: VACATION_LABELS.N.fullLabel },
];

async function fileToBase64(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  let binary = '';
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize) as any);
  }
  return btoa(binary);
}

function formatFileSize(file: File): string {
  const size = file.size;
  if (size >= 1024 * 1024) {
    return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  }
  if (size >= 1024) {
    return `${(size / 1024).toFixed(1)} KB`;
  }
  return `${size} B`;
}

function resolveDocumentLink(doc: ProfileDocument): string | null {
  if ('download_url' in doc) {
    return doc.drive_web_view_link ?? doc.drive_web_content_link ?? doc.download_url;
  }

  return doc.drive_web_view_link ?? null;
}

export default function ProfilePage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [vacationYear, setVacationYear] = useState(new Date().getFullYear());
  const [vacationRequestMessage, setVacationRequestMessage] = useState<string | null>(null);
  const [vacationRequestError, setVacationRequestError] = useState<string | null>(null);
  const [vacationStart, setVacationStart] = useState('');
  const [vacationEnd, setVacationEnd] = useState('');
  const [vacationNotes, setVacationNotes] = useState('');
  const [vacationTag, setVacationTag] = useState<VacationType | ''>('');
  const [selectedDocumentType, setSelectedDocumentType] = useState<TrainerDocumentTypeValue>(
    TRAINER_DOCUMENT_TYPES[0]?.value ?? 'curriculum_vitae',
  );
  const [selectedDocument, setSelectedDocument] = useState<File | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadSuccess, setUploadSuccess] = useState<string | null>(null);

  const profileQuery = useQuery<ProfileUser | undefined>({
    queryKey: ['profile', user?.id],
    queryFn: async () => {
      if (!user?.id) return undefined;
      const fetched = await fetchUserById(user.id);
      return fetched;
    },
    enabled: !!user?.id,
  });

  const trainerId = useMemo(() => profileQuery.data?.trainerId ?? user?.trainerId ?? null, [
    profileQuery.data?.trainerId,
    user?.trainerId,
  ]);

  const documentsQuery = useQuery({
    queryKey: ['user-documents', user?.id],
    queryFn: async () => {
      if (!user?.id) return [];
      return fetchUserDocuments(user.id);
    },
    enabled: !!user?.id && !trainerId,
  });

  const trainerDocumentsQuery = useQuery({
    queryKey: ['trainer-documents-profile', trainerId],
    queryFn: async () => {
      if (!trainerId) {
        return { documents: [] as TrainerDocument[], driveFolderWebViewLink: null as string | null };
      }
      return fetchTrainerDocuments(trainerId);
    },
    enabled: Boolean(trainerId),
  });

  const trainerDetailsQuery = useQuery({
    queryKey: ['trainer-details-profile', trainerId],
    queryFn: async () => {
      if (!trainerId) return null;
      const trainers = await fetchTrainers();
      return trainers.find((trainer) => trainer.trainer_id === trainerId) ?? null;
    },
    enabled: Boolean(trainerId),
    staleTime: 5 * 60 * 1000,
  });

  const shouldShowVacations = trainerId ? trainerDetailsQuery.data?.contrato_fijo === true : true;

  const vacationsQuery = useQuery<UserVacationsResponse>({
    queryKey: ['user-vacations-profile', user?.id, vacationYear],
    queryFn: async () => {
      if (!user?.id) throw new Error('Usuario no encontrado');
      return fetchUserVacations(user.id, vacationYear);
    },
    enabled: !!user?.id && shouldShowVacations,
  });

  const mutation = useMutation({
    mutationFn: () => changePassword(currentPassword, newPassword),
    onSuccess: (response) => {
      setSuccessMessage(response.message || 'Contraseña actualizada correctamente.');
      setErrorMessage(null);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    },
    onError: (error: unknown) => {
      const apiError = error instanceof ApiError ? error : null;
      setErrorMessage(apiError?.message ?? 'No se pudo actualizar la contraseña.');
      setSuccessMessage(null);
    },
  });

  const vacationRequestMutation = useMutation({
    mutationFn: () =>
      sendVacationRequest({ startDate: vacationStart, endDate: vacationEnd, notes: vacationNotes, tag: vacationTag }),
    onSuccess: (response) => {
      setVacationRequestMessage(response.message || 'Petición enviada correctamente.');
      setVacationRequestError(null);
      setVacationStart('');
      setVacationEnd('');
      setVacationNotes('');
      setVacationTag('');
    },
    onError: (error: unknown) => {
      const apiError = error instanceof ApiError ? error : null;
      setVacationRequestError(apiError?.message ?? 'No se pudo enviar la petición.');
      setVacationRequestMessage(null);
    },
  });

  const passwordLengthValid = newPassword.length >= 8;
  const passwordsMatch = newPassword === confirmPassword;
  const canSubmit =
    currentPassword.length > 0 && passwordLengthValid && passwordsMatch && !mutation.isPending;

  const handleSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (!canSubmit) return;
      setErrorMessage(null);
      setSuccessMessage(null);
      await mutation.mutateAsync();
    },
    [canSubmit, mutation],
  );

  const canRequestVacation =
    Boolean(vacationStart && vacationEnd) && !vacationRequestMutation.isPending && Boolean(user?.email);

  const uploadMutation = useMutation({
    mutationFn: async () => {
      if (!trainerId) {
        throw new Error('No se ha encontrado tu ficha de formador.');
      }
      if (!selectedDocument) {
        throw new Error('Selecciona un archivo para subir.');
      }
      const contentBase64 = await fileToBase64(selectedDocument);
      return uploadTrainerDocument({
        trainerId,
        documentType: selectedDocumentType,
        fileName: selectedDocument.name,
        mimeType: selectedDocument.type,
        fileSize: selectedDocument.size,
        contentBase64,
      });
    },
    onSuccess: () => {
      setUploadError(null);
      setUploadSuccess('Documento subido correctamente.');
      setSelectedDocument(null);
      queryClient.invalidateQueries({ queryKey: ['trainer-documents-profile', trainerId] });
    },
    onError: (error) => {
      const apiError = error instanceof ApiError ? error.message : null;
      setUploadError(apiError ?? 'No se pudo subir el documento.');
      setUploadSuccess(null);
    },
  });

  const isUploadingDocument = uploadMutation.isPending;

  const handleVacationRequest = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      setVacationRequestMessage(null);
      setVacationRequestError(null);

      if (!vacationStart || !vacationEnd) {
        setVacationRequestError('Selecciona las fechas de inicio y fin.');
        return;
      }

      if (new Date(vacationStart) > new Date(vacationEnd)) {
        setVacationRequestError('La fecha de inicio debe ser anterior o igual a la de fin.');
        return;
      }

      await vacationRequestMutation.mutateAsync();
    },
    [vacationEnd, vacationRequestMutation, vacationStart],
  );

  const userDetails = useMemo<ProfileUser | null>(() => {
    if (profileQuery.data) return profileQuery.data;
    if (!user) return null;
    return user;
  }, [profileQuery.data, user]);

  const displayName = useMemo(() => {
    if (!userDetails) return '';
    const name = `${userDetails.firstName ?? ''} ${userDetails.lastName ?? ''}`.trim();
    return name.length ? name : userDetails.email;
  }, [userDetails]);

  const formattedStartDate = useMemo(() => {
    if (!userDetails?.startDate) return null;
    const date = new Date(userDetails.startDate);
    return Number.isNaN(date.getTime()) ? userDetails.startDate : date.toLocaleDateString();
  }, [userDetails?.startDate]);

  const documents = useMemo<ProfileDocument[]>(
    () =>
      trainerId
        ? (trainerDocumentsQuery.data?.documents ?? [])
        : (documentsQuery.data ?? []),
    [documentsQuery.data, trainerDocumentsQuery.data?.documents, trainerId],
  );
  const documentsLoading = trainerId ? trainerDocumentsQuery.isLoading : documentsQuery.isLoading;
  const documentsError = trainerId ? trainerDocumentsQuery.isError : documentsQuery.isError;
  const driveFolderLink = trainerId ? trainerDocumentsQuery.data?.driveFolderWebViewLink ?? null : null;

  const vacationData = vacationsQuery.data;
  const vacationCounts: Record<VacationType, number> =
    vacationData?.counts ?? { V: 0, L: 0, A: 0, T: 0, M: 0, H: 0, F: 0, R: 0, P: 0, I: 0, N: 0 };
  const vacationSummary = [
    { label: 'Vacaciones', value: vacationData?.allowance ?? 'Sin definir' },
    { label: 'Aniversario', value: vacationData?.anniversaryAllowance ?? 'Sin definir' },
    { label: 'Festivos locales', value: vacationData?.localHolidayAllowance ?? 'Sin definir' },
    { label: 'Vacaciones año anterior', value: vacationData?.previousYearAllowance ?? 'Sin definir' },
    { label: 'Disfrutadas', value: vacationData?.enjoyed ?? 0 },
    { label: 'Restantes', value: vacationData?.remaining ?? '—' },
  ];

  const personalInfoItems: Array<{ label: string; value: string | null }> = [
    { label: 'Nombre', value: displayName },
    { label: 'Email', value: userDetails?.email ?? null },
    { label: 'Rol', value: userDetails?.role ?? null },
    { label: 'Cuenta bancaria', value: userDetails?.bankAccount ?? null },
    { label: 'Dirección', value: userDetails?.address ?? null },
    { label: 'Posición', value: userDetails?.position ?? null },
    { label: 'Fecha alta', value: formattedStartDate },
  ];

  return (
    <div className="d-grid gap-4">
      <Card className="shadow-sm">
        <Card.Body className="d-grid gap-4">
          <div>
            <h1 className="h3 fw-bold mb-1">Mi perfil</h1>
            <p className="text-muted mb-0">Consulta tu información y gestiona tu contraseña.</p>
          </div>

          {profileQuery.isLoading ? (
            <div className="d-flex align-items-center gap-2 text-muted">
              <Spinner size="sm" animation="border" />
              <span>Cargando información…</span>
            </div>
          ) : profileQuery.isError ? (
            <Alert variant="danger" className="mb-0">
              No se pudo cargar la información del perfil.
            </Alert>
          ) : (
            <Row className="g-3">
              {personalInfoItems.map((item) => (
                <Col key={item.label} xs={12} md={6}>
                  <div className="border rounded p-3 h-100">
                    <div className="fw-semibold text-uppercase text-muted small">{item.label}</div>
                    <div>{item.value || <span className="text-muted">Sin datos</span>}</div>
                  </div>
                </Col>
              ))}
            </Row>
          )}
        </Card.Body>
      </Card>

      <Card className="shadow-sm">
        <Card.Body className="d-grid gap-3">
          <div className="d-flex justify-content-between align-items-center flex-wrap gap-2">
            <div>
              <h2 className="h5 fw-bold mb-1">Mis documentos</h2>
              <p className="text-muted mb-0">Consulta los enlaces públicos de tus documentos.</p>
            </div>
          </div>

          {documentsError ? <Alert variant="danger">No se pudieron cargar los documentos.</Alert> : null}

          {documentsLoading ? (
            <div className="d-flex align-items-center gap-2 text-muted">
              <Spinner size="sm" animation="border" />
              <span>Cargando documentos…</span>
            </div>
          ) : documents.length ? (
            <ListGroup>
              {documents.map((doc) => (
                <ListGroup.Item key={doc.id} className="d-flex justify-content-between align-items-center">
                  <div>
                    <div className="fw-semibold">{doc.file_name}</div>
                    <div className="text-muted small d-flex align-items-center gap-2">
                      <span>{doc.mime_type || 'Archivo'}</span>
                      {'document_type' in doc && doc.document_type_label ? (
                        <Badge bg="light" text="dark">{doc.document_type_label}</Badge>
                      ) : null}
                    </div>
                  </div>
                  <Button
                    as="a"
                    href={resolveDocumentLink(doc) ?? undefined}
                    variant="outline-primary"
                    size="sm"
                    target="_blank"
                    rel="noreferrer"
                  >
                    Ver
                  </Button>
                </ListGroup.Item>
              ))}
            </ListGroup>
          ) : (
            <p className="text-muted mb-0">No hay documentos disponibles.</p>
          )}

          {trainerId ? (
            <div className="border-top pt-3 d-grid gap-3">
              <div className="d-flex justify-content-between align-items-center flex-wrap gap-2">
                <div>
                  <h3 className="h6 fw-bold mb-1">Subir documento</h3>
                  <p className="text-muted mb-0">Selecciona la categoría y adjunta el archivo.</p>
                </div>
                {driveFolderLink ? (
                  <Button as="a" href={driveFolderLink} target="_blank" rel="noreferrer" variant="outline-secondary">
                    Ver carpeta en Drive
                  </Button>
                ) : null}
              </div>

              {uploadError ? <Alert variant="danger" className="mb-0">{uploadError}</Alert> : null}
              {uploadSuccess ? <Alert variant="success" className="mb-0">{uploadSuccess}</Alert> : null}

              <Row className="g-3 align-items-end">
                <Col xs={12} md={4}>
                  <Form.Label>Categoría</Form.Label>
                  <Form.Select
                    value={selectedDocumentType}
                    onChange={(event) => setSelectedDocumentType(event.target.value as TrainerDocumentTypeValue)}
                    disabled={isUploadingDocument}
                  >
                    {TRAINER_DOCUMENT_TYPES.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </Form.Select>
                </Col>
                <Col xs={12} md={5}>
                  <Form.Label>Archivo</Form.Label>
                  <Form.Control
                    type="file"
                    onChange={(event: ChangeEvent<HTMLInputElement>) =>
                      setSelectedDocument(event.target.files?.[0] ?? null)
                    }
                    disabled={isUploadingDocument}
                  />
                  {selectedDocument ? (
                    <div className="text-muted small mt-1">
                      Archivo seleccionado: {selectedDocument.name} ({formatFileSize(selectedDocument)})
                    </div>
                  ) : null}
                </Col>
                <Col xs={12} md={3} className="d-flex align-items-end">
                  <Button onClick={() => uploadMutation.mutate()} disabled={isUploadingDocument || !selectedDocument}>
                    {isUploadingDocument ? 'Subiendo…' : 'Subir documento'}
                  </Button>
                </Col>
              </Row>
            </div>
          ) : (
            <p className="text-muted mb-0">Tu perfil no está vinculado a una ficha de formador.</p>
          )}
        </Card.Body>
      </Card>

      {shouldShowVacations ? (
        <Card className="shadow-sm">
          <Card.Body className="d-grid gap-4">
          <div className="d-flex justify-content-between align-items-center flex-wrap gap-2">
            <div>
              <h2 className="h5 fw-bold mb-1">Vacaciones y teletrabajo</h2>
              <p className="text-muted mb-0">Consulta tu calendario anual y el balance disponible.</p>
            </div>
            <div className="d-flex align-items-center gap-2">
              <Form.Label className="mb-0">Año</Form.Label>
              <Form.Control
                type="number"
                value={vacationYear}
                onChange={(event) => setVacationYear(Number(event.target.value) || new Date().getFullYear())}
                style={{ maxWidth: '120px' }}
              />
              <Button
                variant="outline-secondary"
                onClick={() => vacationsQuery.refetch()}
                disabled={vacationsQuery.isFetching}
              >
                {vacationsQuery.isFetching ? 'Actualizando…' : 'Actualizar'}
              </Button>
            </div>
          </div>

          <div className="d-flex gap-3 flex-wrap">
            {vacationSummary.map((item) => (
              <div key={item.label} className="border rounded px-3 py-2">
                <div
                  className="text-muted text-uppercase text-truncate"
                  style={{ maxWidth: '180px', fontSize: '0.75rem' }}
                  title={item.label}
                >
                  {item.label}
                </div>
                <div
                  className="fw-semibold text-truncate"
                  style={{ maxWidth: '180px', fontSize: '0.95rem' }}
                  title={String(item.value)}
                >
                  {item.value}
                </div>
              </div>
            ))}
          </div>

          <div className="d-flex flex-wrap gap-2 align-items-stretch">
            {Object.entries(VACATION_LABELS).map(([key, { label, fullLabel }]) => (
              <div
                key={key}
                className="border rounded px-2 py-2 d-flex gap-2 align-items-center"
                title={fullLabel}
              >
                <span
                  className="d-inline-block"
                  style={{
                    width: '10px',
                    height: '10px',
                    borderRadius: '999px',
                    backgroundColor: VACATION_COLORS[key as VacationType],
                  }}
                ></span>
                <div>
                  <div
                    className="text-muted small text-uppercase text-truncate"
                    style={{ maxWidth: '150px', fontSize: '0.7rem' }}
                  >
                    {label}
                  </div>
                  <div
                    className="fw-semibold text-truncate"
                    style={{ maxWidth: '150px', fontSize: '0.9rem' }}
                  >
                    {vacationCounts[key as VacationType] ?? 0} días
                  </div>
                </div>
              </div>
            ))}
          </div>

          {vacationsQuery.isError ? <Alert variant="danger">No se pudo cargar el calendario.</Alert> : null}

          {vacationsQuery.isLoading ? (
            <div className="d-flex align-items-center gap-2 text-muted">
              <Spinner size="sm" animation="border" />
              <span>Cargando calendario…</span>
            </div>
          ) : (
            <VacationCalendar year={vacationYear} days={vacationData?.days ?? []} readOnly />
          )}

          <div className="border-top pt-3">
            <h3 className="h6 fw-bold mb-2">Petición de vacaciones</h3>
            <p className="text-muted mb-3">
              Selecciona el rango de fechas y enviaremos una petición a People. El correo se enviará a julio.garcia.becerra@gmail.com con tu email en copia.
            </p>
            {vacationRequestMessage ? <Alert variant="success">{vacationRequestMessage}</Alert> : null}
            {vacationRequestError ? <Alert variant="danger">{vacationRequestError}</Alert> : null}
            <Form onSubmit={handleVacationRequest} className="d-grid gap-3">
              <Row className="g-3">
                <Col xs={12} md={3}>
                  <Form.Label>Inicio</Form.Label>
                  <Form.Control
                    type="date"
                    value={vacationStart}
                    onChange={(event) => setVacationStart(event.target.value)}
                    required
                  />
                </Col>
                <Col xs={12} md={3}>
                  <Form.Label>Fin</Form.Label>
                  <Form.Control
                    type="date"
                    value={vacationEnd}
                    onChange={(event) => setVacationEnd(event.target.value)}
                    required
                  />
                </Col>
                <Col xs={12} md={3}>
                  <Form.Label>Tipo de petición</Form.Label>
                  <Form.Select
                    value={vacationTag}
                    onChange={(event) => setVacationTag(event.target.value as VacationType | '')}
                  >
                    {VACATION_TAG_OPTIONS.map((option) => (
                      <option key={option.value || 'none'} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </Form.Select>
                </Col>
                <Col xs={12} md={3}>
                  <Form.Label>Notas (opcional)</Form.Label>
                  <Form.Control
                    type="text"
                    value={vacationNotes}
                    placeholder="Añade comentarios"
                    onChange={(event) => setVacationNotes(event.target.value)}
                  />
                </Col>
              </Row>
              <div className="d-flex justify-content-end">
                <Button type="submit" disabled={!canRequestVacation}>
                  {vacationRequestMutation.isPending ? 'Enviando…' : 'Solicitar vacaciones'}
                </Button>
              </div>
            </Form>
          </div>
        </Card.Body>
      </Card>
      ) : null}

      <Card className="shadow-sm">
        <Card.Body className="d-grid gap-4">
          <div>
            <h2 className="h5 fw-bold mb-1">Cambiar contraseña</h2>
            <p className="text-muted mb-0">Por seguridad, la nueva contraseña debe tener al menos 8 caracteres.</p>
          </div>

          {successMessage ? <Alert variant="success">{successMessage}</Alert> : null}
          {errorMessage ? <Alert variant="danger">{errorMessage}</Alert> : null}

          <Form onSubmit={handleSubmit} autoComplete="off">
            <Row className="g-3">
              <Col xs={12} md={6}>
                <Form.Group controlId="profileCurrentPassword">
                  <Form.Label>Contraseña actual</Form.Label>
                  <InputGroup>
                    <Form.Control
                      type={showCurrentPassword ? 'text' : 'password'}
                      value={currentPassword}
                      onChange={(event) => setCurrentPassword(event.currentTarget.value)}
                      required
                      autoComplete="current-password"
                      disabled={mutation.isPending}
                    />
                    <Button
                      variant="outline-secondary"
                      onClick={() => setShowCurrentPassword((prev) => !prev)}
                      type="button"
                      disabled={mutation.isPending}
                    >
                      {showCurrentPassword ? 'Ocultar' : 'Mostrar'}
                    </Button>
                  </InputGroup>
                </Form.Group>
              </Col>
              <Col xs={12} md={6}>
                <Form.Group controlId="profileNewPassword">
                  <Form.Label>Nueva contraseña</Form.Label>
                  <InputGroup hasValidation>
                    <Form.Control
                      type={showNewPassword ? 'text' : 'password'}
                      value={newPassword}
                      onChange={(event) => setNewPassword(event.currentTarget.value)}
                      required
                      minLength={8}
                      autoComplete="new-password"
                      disabled={mutation.isPending}
                      isInvalid={newPassword.length > 0 && !passwordLengthValid}
                    />
                    <Button
                      variant="outline-secondary"
                      onClick={() => setShowNewPassword((prev) => !prev)}
                      type="button"
                      disabled={mutation.isPending}
                    >
                      {showNewPassword ? 'Ocultar' : 'Mostrar'}
                    </Button>
                  </InputGroup>
                  <Form.Control.Feedback type="invalid">
                    Debe tener al menos 8 caracteres.
                  </Form.Control.Feedback>
                </Form.Group>
              </Col>
              <Col xs={12} md={6}>
                <Form.Group controlId="profileConfirmPassword">
                  <Form.Label>Repetir nueva contraseña</Form.Label>
                  <InputGroup hasValidation>
                    <Form.Control
                      type={showConfirmPassword ? 'text' : 'password'}
                      value={confirmPassword}
                      onChange={(event) => setConfirmPassword(event.currentTarget.value)}
                      required
                      minLength={8}
                      autoComplete="new-password"
                      disabled={mutation.isPending}
                      isInvalid={confirmPassword.length > 0 && !passwordsMatch}
                    />
                    <Button
                      variant="outline-secondary"
                      onClick={() => setShowConfirmPassword((prev) => !prev)}
                      type="button"
                      disabled={mutation.isPending}
                    >
                      {showConfirmPassword ? 'Ocultar' : 'Mostrar'}
                    </Button>
                  </InputGroup>
                  <Form.Control.Feedback type="invalid">
                    Las contraseñas no coinciden.
                  </Form.Control.Feedback>
                </Form.Group>
              </Col>
            </Row>

            <div className="d-flex justify-content-end mt-4">
              <Button type="submit" disabled={!canSubmit}>
                {mutation.isPending ? (
                  <>
                    <Spinner animation="border" size="sm" className="me-2" /> Guardando…
                  </>
                ) : (
                  'Guardar cambios'
                )}
              </Button>
            </div>
          </Form>
        </Card.Body>
      </Card>
    </div>
  );
}
