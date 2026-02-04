// frontend/src/components/vacations/VacationCalendar.tsx
import type { VacationType, UserVacationDay } from '../../api/userVacations';
import { VACATION_TYPE_LABELS } from '../../constants/vacations';

const MONTH_FORMATTER = new Intl.DateTimeFormat('es-ES', { month: 'long' });
const WEEKDAY_LABELS = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];

export type VacationCalendarProps = {
  year: number;
  days: UserVacationDay[];
  onDayClick?: (date: string, type: VacationType | '') => void;
  selectedDates?: string[];
  readOnly?: boolean;
};

function buildDate(year: number, monthIndex: number, day: number): string {
  const iso = new Date(Date.UTC(year, monthIndex, day)).toISOString();
  return iso.slice(0, 10);
}

export function VacationCalendar({ year, days, onDayClick, selectedDates = [], readOnly }: VacationCalendarProps) {
  const daysMap = new Map<string, VacationType>();
  for (const day of days) {
    daysMap.set(day.date, day.type);
  }

  return (
    <div className="vacation-calendar d-grid gap-3">
      <div className="vacation-months-grid">
        {Array.from({ length: 12 }, (_, monthIndex) => {
          const monthStart = new Date(Date.UTC(year, monthIndex, 1));
          const monthName = MONTH_FORMATTER.format(monthStart);
          const daysInMonth = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
          const weekdayOffset = (monthStart.getUTCDay() + 6) % 7; // Monday first
          const cells: Array<{ date: string | null; dayLabel: string | null; type: VacationType | '' }> = [];

          for (let i = 0; i < weekdayOffset; i += 1) {
            cells.push({ date: null, dayLabel: null, type: '' });
          }

          for (let day = 1; day <= daysInMonth; day += 1) {
            const iso = buildDate(year, monthIndex, day);
            cells.push({ date: iso, dayLabel: String(day), type: daysMap.get(iso) ?? '' });
          }

          while (cells.length % 7 !== 0) {
            cells.push({ date: null, dayLabel: null, type: '' });
          }

          return (
            <div className="vacation-month" key={`${year}-${monthIndex + 1}`}>
              <div className="d-flex justify-content-between align-items-center mb-2">
                <h3 className="h6 text-capitalize mb-0">{monthName}</h3>
                <div className="text-muted small">{year}</div>
              </div>

              <div className="vacation-weekdays">
                {WEEKDAY_LABELS.map((label) => (
                  <div key={label} className="vacation-weekday">
                    {label}
                  </div>
                ))}
              </div>

              <div className="vacation-grid">
                {cells.map((cell, index) => {
                  if (!cell.date) {
                    return <div key={`empty-${index}`} className="vacation-day empty" aria-hidden />;
                  }

                  const isSelected = selectedDates.includes(cell.date as string);
                  const typeClass = cell.type ? `type-${cell.type}` : '';
                  const typeLabel = cell.type ? VACATION_TYPE_LABELS[cell.type] : '';

                  return (
                    <button
                      key={cell.date}
                      type="button"
                      className={`vacation-day ${typeClass} ${isSelected ? 'selected' : ''} ${
                        readOnly ? 'is-readonly' : ''
                      }`.trim()}
                      onClick={
                        onDayClick && !readOnly ? () => onDayClick(cell.date as string, cell.type) : undefined
                      }
                      aria-disabled={readOnly || undefined}
                    >
                      <span className="day-number">{cell.dayLabel}</span>
                      {cell.type ? (
                        <>
                          <span className="day-type">{cell.type}</span>
                          <span className="day-type-toggle">{typeLabel}</span>
                        </>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
