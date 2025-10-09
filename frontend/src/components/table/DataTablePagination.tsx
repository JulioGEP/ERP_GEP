import Pagination from 'react-bootstrap/Pagination';

interface DataTablePaginationProps {
  page: number;
  totalPages: number;
  pageSize: number;
  totalItems: number;
  onPageChange: (page: number) => void;
}

function buildPageList(current: number, total: number): (number | 'ellipsis')[] {
  const maxButtons = 7;

  if (total <= maxButtons) {
    return Array.from({ length: total }, (_, index) => index + 1);
  }

  const pages: (number | 'ellipsis')[] = [];
  const first = 1;
  const last = total;
  const siblings = 1;
  const start = Math.max(first + 1, current - siblings);
  const end = Math.min(last - 1, current + siblings);

  pages.push(first);

  if (start > first + 1) {
    pages.push('ellipsis');
  } else {
    for (let page = first + 1; page < start; page += 1) {
      pages.push(page);
    }
  }

  for (let page = start; page <= end; page += 1) {
    pages.push(page);
  }

  if (end < last - 1) {
    pages.push('ellipsis');
  } else {
    for (let page = end + 1; page < last; page += 1) {
      pages.push(page);
    }
  }

  pages.push(last);

  return pages;
}

export function DataTablePagination({
  page,
  totalPages,
  pageSize,
  totalItems,
  onPageChange,
}: DataTablePaginationProps) {
  if (totalItems <= pageSize) return null;

  const start = (page - 1) * pageSize + 1;
  const end = Math.min(page * pageSize, totalItems);
  const pages = buildPageList(page, totalPages);

  return (
    <div className="d-flex flex-column flex-lg-row align-items-lg-center justify-content-between gap-3 px-3 py-2 border-top">
      <small className="text-muted">
        Mostrando {start.toLocaleString()}-{end.toLocaleString()} de {totalItems.toLocaleString()} registros
      </small>
      <Pagination className="mb-0">
        <Pagination.Prev
          onClick={() => onPageChange(page - 1)}
          disabled={page <= 1}
        />
        {pages.map((item, index) => {
          if (item === 'ellipsis') {
            return <Pagination.Ellipsis key={`ellipsis-${index}`} disabled />;
          }

          return (
            <Pagination.Item
              key={item}
              active={item === page}
              onClick={() => onPageChange(item)}
            >
              {item}
            </Pagination.Item>
          );
        })}
        <Pagination.Next
          onClick={() => onPageChange(page + 1)}
          disabled={page >= totalPages}
        />
      </Pagination>
    </div>
  );
}
