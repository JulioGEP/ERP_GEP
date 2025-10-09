// frontend/src/features/recursos/RoomsView.tsx
import { useEffect, useMemo, useState } from 'react';
import { Alert, Button, Form, Spinner, Table } from 'react-bootstrap';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { RoomModal, type RoomFormValues } from './RoomModal';
import { createRoom, fetchRooms, updateRoom, type RoomPayload } from './rooms.api';
import type { Room } from '../../types/room';
import { ApiError } from '../presupuestos/api';

export type ToastParams = {
  variant: 'success' | 'danger';
  message: string;
};

type RoomsViewProps = {
  onNotify: (toast: ToastParams) => void;
};

function buildPayload(values: RoomFormValues): RoomPayload {
  return {
    name: values.name.trim(),
    sede: values.sede.trim(),
  };
}

function formatError(error: unknown): string {
  if (error instanceof ApiError) {
    return `[${error.code}] ${error.message}`;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return 'Se ha producido un error inesperado';
}

export function RoomsView({ onNotify }: RoomsViewProps) {
  const [showModal, setShowModal] = useState(false);
  const [modalMode, setModalMode] = useState<'create' | 'edit'>('create');
  const [selectedRoom, setSelectedRoom] = useState<Room | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');

  const queryClient = useQueryClient();

  useEffect(() => {
    if (typeof window === 'undefined') {
      setDebouncedSearch(searchTerm.trim());
      return;
    }
    const handler = window.setTimeout(() => {
      setDebouncedSearch(searchTerm.trim());
    }, 300);
    return () => window.clearTimeout(handler);
  }, [searchTerm]);

  const roomsQuery = useQuery({
    queryKey: ['rooms', debouncedSearch],
    queryFn: () => fetchRooms({ search: debouncedSearch }),
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  const createMutation = useMutation({
    mutationFn: (payload: RoomPayload) => createRoom(payload),
    onSuccess: (room) => {
      onNotify({ variant: 'success', message: `Sala "${room.name}" creada correctamente.` });
      setShowModal(false);
      setSelectedRoom(null);
      queryClient.invalidateQueries({ queryKey: ['rooms'] });
    },
    onError: (error: unknown) => {
      onNotify({ variant: 'danger', message: formatError(error) });
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: RoomPayload }) => updateRoom(id, payload),
    onSuccess: (room) => {
      onNotify({ variant: 'success', message: `Sala "${room.name}" actualizada correctamente.` });
      setShowModal(false);
      setSelectedRoom(null);
      queryClient.invalidateQueries({ queryKey: ['rooms'] });
    },
    onError: (error: unknown) => {
      onNotify({ variant: 'danger', message: formatError(error) });
    },
  });

  const rooms = roomsQuery.data ?? [];
  const isLoading = roomsQuery.isLoading;
  const isFetching = roomsQuery.isFetching && !roomsQuery.isLoading;
  const isSaving = createMutation.isPending || updateMutation.isPending;
  const hasResults = rooms.length > 0;
  const errorMessage = roomsQuery.error ? formatError(roomsQuery.error) : null;

  const handleAddRoom = () => {
    setSelectedRoom(null);
    setModalMode('create');
    setShowModal(true);
  };

  const handleSelectRoom = (room: Room) => {
    setSelectedRoom(room);
    setModalMode('edit');
    setShowModal(true);
  };

  const handleModalClose = () => {
    if (createMutation.isPending || updateMutation.isPending) return;
    setShowModal(false);
  };

  const handleSubmit = (values: RoomFormValues) => {
    const payload = buildPayload(values);
    if (modalMode === 'create') {
      createMutation.mutate(payload);
    } else if (selectedRoom) {
      updateMutation.mutate({ id: selectedRoom.sala_id, payload });
    }
  };

  const modalInitialData = modalMode === 'edit' ? selectedRoom : null;

  const subtitle = useMemo(
    () => 'Gestiona las salas disponibles para tus formaciones.',
    []
  );

  return (
    <div className="d-grid gap-4">
      <section className="d-flex flex-column flex-lg-row align-items-lg-center justify-content-between gap-3">
        <div>
          <h1 className="h3 fw-bold mb-1">Salas</h1>
          <p className="text-muted mb-0">{subtitle}</p>
        </div>
        <div className="d-flex flex-column flex-md-row gap-3 align-items-stretch align-items-md-center w-100 w-lg-auto">
          <Form.Control
            type="search"
            placeholder="Buscar por nombre..."
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
          />
          <div className="d-flex align-items-center gap-3 justify-content-md-end">
            {(isFetching || isSaving) && (
              <Spinner animation="border" role="status" size="sm" className="me-1" />
            )}
            <Button onClick={handleAddRoom} disabled={isSaving}>
              Añadir Sala
            </Button>
          </div>
        </div>
      </section>

      {errorMessage && (
        <Alert variant="danger" className="mb-0">
          {errorMessage}
        </Alert>
      )}

      <div className="bg-white rounded-4 shadow-sm">
        <div className="table-responsive">
          <Table hover className="mb-0 align-middle">
            <thead>
              <tr className="text-muted text-uppercase small">
                <th className="fw-semibold">Nombre</th>
                <th className="fw-semibold">Sede</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={2} className="py-5 text-center">
                    <Spinner animation="border" role="status" />
                  </td>
                </tr>
              ) : hasResults ? (
                rooms.map((room) => (
                  <tr
                    key={room.sala_id}
                    role="button"
                    onClick={() => handleSelectRoom(room)}
                    style={{ cursor: 'pointer' }}
                  >
                    <td className="fw-semibold">{room.name}</td>
                    <td>{room.sede ?? '—'}</td>
                  </tr>
                ))
              ) : debouncedSearch ? (
                <tr>
                  <td colSpan={2} className="py-5 text-center text-muted">
                    No hay salas que coincidan con la búsqueda.
                  </td>
                </tr>
              ) : (
                <tr>
                  <td colSpan={2} className="py-5 text-center text-muted">
                    <div className="d-grid gap-3 justify-content-center">
                      <span>No hay salas registradas todavía.</span>
                      <div>
                        <Button onClick={handleAddRoom}>Añadir Sala</Button>
                      </div>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </Table>
        </div>
      </div>

      <RoomModal
        show={showModal}
        mode={modalMode}
        initialData={modalInitialData}
        isSaving={isSaving}
        onClose={handleModalClose}
        onSubmit={handleSubmit}
      />
    </div>
  );
}
