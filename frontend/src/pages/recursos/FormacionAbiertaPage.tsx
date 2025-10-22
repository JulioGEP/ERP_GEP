import ProductVariantsList from '../../features/formacion_abierta/ProductVariantsList';
import VariationsSync from '../../features/formacion_abierta/VariationsSync';

export type RecursosFormacionAbiertaPageProps = Record<string, never>;

export default function RecursosFormacionAbiertaPage(
  _props: RecursosFormacionAbiertaPageProps,
) {
  return (
    <section className="d-flex flex-column gap-4">
      <header>
        <p className="text-uppercase text-muted fw-semibold mb-1">Recursos</p>
        <h1 className="h3 text-uppercase mb-0">Formación Abierta</h1>
      </header>

      <VariationsSync />
      <ProductVariantsList />
    </section>
  );
}
