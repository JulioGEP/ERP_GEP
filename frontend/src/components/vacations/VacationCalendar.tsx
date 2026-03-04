// frontend/src/components/vacations/VacationCalendar.tsx
import type { UserVacationDay } from '../../api/userVacations';
import { getVacationTypeVisual } from '../../constants/vacations';

const MONTH_FORMATTER = new Intl.DateTimeFormat('es-ES', { month: 'long' });
const WEEKDAY_LABELS = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];

export type VacationCalendarProps = {
  year: number;
  days: UserVacationDay[];
  onDayClick?: (date: string, type: string | '') => void;
  selectedDates?: string[];
  readOnly?: boolean;
};

function toTransparentColor(hexColor: string, opacity: number): string {
  const hex = hexColor.replace('#', '');
  if (hex.length !== 6) return `rgba(15, 23, 42, ${opacity})`;

  const red = Number.parseInt(hex.slice(0, 2), 16);
  const green = Number.parseInt(hex.slice(2, 4), 16);
  const blue = Number.parseInt(hex.slice(4, 6), 16);

  return `rgba(${red}, ${green}, ${blue}, ${opacity})`;
}

function buildDate(year: number, monthIndex: number, day: number): string {
  const iso = new Date(Date.UTC(year, monthIndex, day)).toISOString();
  return iso.slice(0, 10);
}

export function VacationCalendar({ year, days, onDayClick, selectedDates = [], readOnly }: VacationCalendarProps) {
  const daysMap = new Map<string, string>();
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
          const cells: Array<{ date: string | null; dayLabel: string | null; type: string | '' }> = [];

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
                  const typeVisual = cell.type ? getVacationTypeVisual(cell.type) : null;
                  const dayTypeStyle = typeVisual
                    ? {
                        backgroundColor: typeVisual.color,
                      }
                    : undefined;
                  const dayStyle = typeVisual
                    ? {
                        borderColor: typeVisual.color,
                        backgroundColor: toTransparentColor(typeVisual.color, 0.16),
                      }
                    : undefined;

                  return (
                    <button
                      key={cell.date}
                      type="button"
                      className={`vacation-day ${typeClass} ${isSelected ? 'selected' : ''} ${
                        readOnly ? 'is-readonly' : ''
                      }`.trim()}
                      style={dayStyle}
                      onClick={
                        onDayClick && !readOnly ? () => onDayClick(cell.date as string, cell.type) : undefined
                      }
                      aria-disabled={readOnly || undefined}
                    >
                      <span className="day-number">{cell.dayLabel}</span>
                      {cell.type ? (
                        <>
                          <span className="day-type" style={dayTypeStyle}>
                            {cell.type}
                          </span>
                          <span className="day-type-toggle">{typeVisual?.fullLabel ?? cell.type}</span>
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
