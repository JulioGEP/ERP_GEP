import type { ReactNode } from 'react';

type ClassValue = string | undefined | null | false;

const cx = (...values: ClassValue[]) => values.filter(Boolean).join(' ');

interface FieldWithStatusProps {
  label: ReactNode;
  children: ReactNode;
  status?: ReactNode;
  className?: string;
  mainClassName?: string;
  statusClassName?: string;
}

export const FieldWithStatus = ({
  label,
  children,
  status,
  className,
  mainClassName,
  statusClassName,
}: FieldWithStatusProps) => (
  <div className={cx('field-with-status', className)}>
    <div className={cx('field-with-status__main', mainClassName)}>
      {label}
      {children}
    </div>
    <div className={cx('field-with-status__status', statusClassName)} aria-hidden={status ? undefined : true}>
      {status}
    </div>
  </div>
);

export default FieldWithStatus;
