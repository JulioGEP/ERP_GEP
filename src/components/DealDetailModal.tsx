import { useState, useMemo } from 'react'
import { useDealDetail } from '@/hooks/useDealDetail'
import { useQueryClient } from '@tanstack/react-query'

// Simulación auth mínima (ajusta a tu sistema real)
function useAuth() {
  return {
    userId: localStorage.getItem('userId') || 'user@example.com',
    userName: localStorage.getItem('userName') || 'Usuario',
  }
}

type Props = { dealId: string; onClose: () => void }

export default function DealDetailModal({ dealId, onClose }: Props) {
  const qc = useQueryClient()
  const { userId, userName } = useAuth()
  const { data: deal, isLoading, isError } = useDealDetail(dealId)

  const [form, setForm] = useState<any>(null)
  const [newComments, setNewComments] = useState<string[]>([])
  const [editComments, setEditComments] = useState<Record<string, string>>({})
  const [showConfirm, setShowConfirm] = useState(false)

  const editable = ['sede', 'hours', 'deal_direction', 'CAES', 'FUNDAE', 'Hotel_Night', 'alumnos']

  useMemo(() => {
    if (deal) setForm(pickEditable(deal))
  }, [deal])

  if (isLoading || !deal) return null
  if (isError) return null

  const dirtyDeal = form && JSON.stringify(pickEditable(deal)) !== JSON.stringify(form)
  const dirtyComments = newComments.some((c) => c.trim().length > 0) || Object.keys(editComments).length > 0
  const isDirty = !!(dirtyDeal || dirtyComments)

  function pickEditable(d: any) {
    const r: any = {}
    r.sede = d.sede ?? ''
    r.hours = d.hours ?? 0
    r.deal_direction = d.deal_direction ?? ''
    r.CAES = !!d.CAES
    r.FUNDAE = !!d.FUNDAE
    r.Hotel_Night = !!d.Hotel_Night
    r.alumnos = d.alumnos ?? 0
    return r
  }

  function onField(k: string, v: any) {
    setForm((f: any) => ({ ...f, [k]: v }))
  }

  async function onSave() {
    const patch: any = {}
    if (form.sede !== (deal.sede ?? '')) patch.sede = String(form.sede ?? '')
    if (Number(form.hours ?? 0) !== Number(deal.hours ?? 0)) patch.hours = Number(form.hours ?? 0)
    if (form.deal_direction !== (deal.deal_direction ?? '')) patch.deal_direction = String(form.deal_direction ?? '')
    if (!!form.CAES !== !!deal.CAES) patch.CAES = !!form.CAES
    if (!!form.FUNDAE !== !!deal.FUNDAE) patch.FUNDAE = !!form.FUNDAE
    if (!!form.Hotel_Night !== !!deal.Hotel_Night) patch.Hotel_Night = !!form.Hotel_Night
    if (Number(form.alumnos ?? 0) !== Number(deal.alumnos ?? 0)) patch.alumnos = Number(form.alumnos ?? 0)

    const body: any = {}
    if (Object.keys(patch).length) body.deal = patch

    const create = newComments.map((c) => c.trim()).filter(Boolean).map((content) => ({ content, author_name: userName }))
    const update = Object.entries(editComments).map(([comment_id, content]) => ({ comment_id, content: String(content).trim() }))
    if (create.length || update.length) body.comments = { create, update }

    if (!Object.keys(body).length) {
      onClose()
      return
    }

    const res = await fetch(`/.netlify/functions/deals/${dealId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'X-User-Id': userId, 'X-User-Name': userName },
      body: JSON.stringify(body),
    })
    const json = await res.json()
    if (!res.ok || json.ok === false) {
      alert(`[${json.error_code || 'ERROR'}] ${json.message || 'No se pudieron guardar los cambios'}`)
      return
    }
    await qc.invalidateQueries({ queryKey: ['dealDetail', dealId] })
    await qc.invalidateQueries({ queryKey: ['deals', 'noSessions'] })
    onClose()
  }

  function requestClose() {
    if (isDirty) setShowConfirm(true)
    else onClose()
  }

  async function openPreview(d: any) {
    const res = await fetch(`/.netlify/functions/deal_documents/${dealId}/${d.doc_id}/url`)
    const json = await res.json()
    if (json?.url) window.open(json.url, '_blank')
  }

  async function removeDoc(dealId: string, docId: string) {
    const sure = confirm('¿Eliminar documento?')
    if (!sure) return
    const res = await fetch(`/.netlify/functions/deal_documents/${dealId}/${docId}`, { method: 'DELETE' })
    const json = await res.json()
    if (!res.ok || json.ok === false) {
      alert(`[${json.error_code || 'ERROR'}] ${json.message || 'No se pudo eliminar'}`)
      return
    }
    await qc.invalidateQueries({ queryKey: ['dealDetail', dealId] })
  }

  return (
    <div className="modal show d-block" role="dialog">
      <div className="modal-dialog modal-xl" role="document">
        <div className="modal-content">
          <div className="modal-header">
            <h5 className="modal-title">Detalle presupuesto</h5>
            <button type="button" className="btn-close" aria-label="Close" onClick={requestClose}></button>
          </div>

          <div className="modal-body">
            {/* Campos editables (solo los 7) */}
            <div className="row g-3">
              <div className="col-md-4">
                <label className="form-label">Sede</label>
                <input className="form-control" value={form?.sede || ''} onChange={(e) => onField('sede', e.target.value)} />
              </div>
              <div className="col-md-2">
                <label className="form-label">Horas</label>
                <input type="number" min={0} className="form-control" value={form?.hours ?? 0} onChange={(e) => onField('hours', e.target.value)} />
              </div>
              <div className="col-md-6">
                <label className="form-label">Dirección del deal</label>
                <input className="form-control" value={form?.deal_direction || ''} onChange={(e) => onField('deal_direction', e.target.value)} />
              </div>

              <div className="col-md-2 form-check mt-4">
                <input id="caes" type="checkbox" className="form-check-input" checked={!!form?.CAES} onChange={(e) => onField('CAES', e.target.checked)} />
                <label className="form-check-label" htmlFor="caes">CAE/S</label>
              </div>
              <div className="col-md-2 form-check mt-4">
                <input id="fundae" type="checkbox" className="form-check-input" checked={!!form?.FUNDAE} onChange={(e) => onField('FUNDAE', e.target.checked)} />
                <label className="form-check-label" htmlFor="fundae">FUNDAE</label>
              </div>
              <div className="col-md-2 form-check mt-4">
                <input id="hotel" type="checkbox" className="form-check-input" checked={!!form?.Hotel_Night} onChange={(e) => onField('Hotel_Night', e.target.checked)} />
                <label className="form-check-label" htmlFor="hotel">Hotel/Noche</label>
              </div>
              <div className="col-md-2">
                <label className="form-label">Alumnos</label>
                <input type="number" min={0} className="form-control" value={form?.alumnos ?? 0} onChange={(e) => onField('alumnos', e.target.value)} />
              </div>
            </div>

            {/* Comentarios */}
            <hr className="my-4" />
            <h6>Comentarios</h6>
            <div className="mb-3">
              <textarea
                className="form-control"
                rows={2}
                placeholder="Añadir comentario..."
                onChange={(e) => {
                  const t = e.target.value
                  setNewComments([t])
                }}
              />
              <small className="text-muted">Se guardará al pulsar “Guardar Cambios”.</small>
            </div>
            <ul className="list-group">
              {deal.comments?.map((c: any) => {
                const isMine = c.author_id === userId
                const value = editComments[c.comment_id] ?? c.content
                return (
                  <li key={c.comment_id} className="list-group-item">
                    <div className="d-flex justify-content-between">
                      <small className="text-muted">
                        {c.author_name || c.author_id} • {new Date(c.created_at).toLocaleString()}
                      </small>
                    </div>
                    {isMine ? (
                      <textarea
                        className="form-control mt-2"
                        rows={2}
                        value={value}
                        onChange={(e) => setEditComments((s) => ({ ...s, [c.comment_id]: e.target.value }))}
                      />
                    ) : (
                      <p className="mt-2 mb-0">{c.content}</p>
                    )}
                  </li>
                )
              })}
            </ul>

            {/* Documentos */}
            <hr className="my-4" />
            <h6>Documentos</h6>
            <DropDocuments dealId={dealId} />
            <ul className="list-group mt-3">
              {deal.documents?.map((d: any) => (
                <li key={d.doc_id} className="list-group-item d-flex justify-content-between align-items-center">
                  <div>
                    <strong>{d.file_name}</strong>{' '}
                    <small className="text-muted">
                      ({Math.round((d.file_size || 0) / 1024)} KB) • {d.origin}
                    </small>
                  </div>
                  <div className="btn-group">
                    <button className="btn btn-sm btn-outline-secondary" onClick={() => openPreview(d)}>
                      Ver
                    </button>
                    {d.origin === 'user_upload' && (
                      <button className="btn btn-sm btn-outline-danger" onClick={() => removeDoc(dealId, d.doc_id)}>
                        Eliminar
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </div>

          <div className="modal-footer">
            <button className="btn btn-secondary" onClick={requestClose}>
              Cerrar
            </button>
            {isDirty && (
              <button className="btn btn-primary" onClick={onSave}>
                Guardar Cambios
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Confirmación cambios pendientes */}
      {showConfirm && (
        <div className="modal show d-block" role="dialog" aria-modal="true">
          <div className="modal-dialog">
            <div className="modal-content">
              <div className="modal-header">
                <h5 className="modal-title">Cambios sin guardar</h5>
              </div>
              <div className="modal-body">Tienes cambios pendientes de guardar</div>
              <div className="modal-footer">
                <button className="btn btn-secondary" onClick={() => setShowConfirm(false)}>
                  Seguir con los cambios
                </button>
                <button className="btn btn-danger" onClick={onClose}>
                  Salir sin guardar
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function DropDocuments({ dealId }: { dealId: string }) {
  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const up1 = await fetch(`/.netlify/functions/deal_documents/${dealId}/upload-url`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fileName: file.name, mimeType: file.type, fileSize: file.size }),
    })
    const j1 = await up1.json()
    await fetch(j1.uploadUrl, { method: 'PUT', body: file })
    await fetch(`/.netlify/functions/deal_documents/${dealId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ file_name: file.name, mime_type: file.type, file_size: file.size, storage_key: j1.storageKey }),
    })
    // Ideal: invalidar query del detalle; como el componente no tiene qc aquí, fuerza recarga simple:
    location.reload()
  }

  return (
    <div>
      <input type="file" onChange={onFile} />
      <small className="text-muted d-block">Arrastra o selecciona un archivo. Se sube al momento y queda como “user_upload”.</small>
    </div>
  )
}
