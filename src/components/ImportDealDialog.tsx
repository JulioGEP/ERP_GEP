import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'

type Props = { onClose: () => void }

export default function ImportDealDialog({ onClose }: Props) {
  const [dealId, setDealId] = useState('')
  const [loading, setLoading] = useState(false)
  const qc = useQueryClient()

  async function importar() {
    if (!dealId.trim()) return
    setLoading(true)
    try {
      const res = await fetch('/.netlify/functions/deals_import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dealId: dealId.trim() }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok || json?.ok === false) {
        throw new Error(`[${json?.error_code || 'HTTP_' + res.status}] ${json?.message || 'Fallo importando el presupuesto'}`)
      }
      await qc.invalidateQueries({ queryKey: ['deals', 'noSessions'] })
      onClose()
    } catch (e: any) {
      alert(e?.message || 'No se pudo importar')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="modal show d-block" role="dialog">
      <div className="modal-dialog" role="document">
        <div className="modal-content">
          <div className="modal-header">
            <h5 className="modal-title">Importar presupuesto</h5>
            <button type="button" className="btn-close" aria-label="Close" onClick={onClose}></button>
          </div>
          <div className="modal-body">
            <input
              className="form-control"
              placeholder="Introduce el dealId"
              value={dealId}
              onChange={(e) => setDealId(e.target.value)}
            />
          </div>
          <div className="modal-footer">
            <button className="btn btn-secondary" onClick={onClose} disabled={loading}>
              Cancelar
            </button>
            <button className="btn btn-primary" onClick={importar} disabled={loading || !dealId.trim()}>
              {loading ? 'Importando…' : 'Importar'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
