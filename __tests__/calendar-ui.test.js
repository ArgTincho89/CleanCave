// Tests unitarios de los helpers puros del frontend de calendario
// (public/calendar-utils.js). Fechas SIEMPRE como strings 'YYYY-MM' /
// 'YYYY-MM-DD' (comparación lexicográfica segura); el módulo es UMD para
// correr en browser y en node. Patrón: calendar.test.js / rotation.test.js.

const { shiftMonth, monthDays, calendarMonthGrid, WEEKDAY_LABELS_ES } = require('../public/calendar-utils');

describe('calendar-utils', () => {
  describe('shiftMonth', () => {
    it('should advance and go back one month', () => {
      expect(shiftMonth('2026-09', 1)).toBe('2026-10');
      expect(shiftMonth('2026-09', -1)).toBe('2026-08');
    });

    it('should cross year boundaries', () => {
      expect(shiftMonth('2026-01', -1)).toBe('2025-12');
      expect(shiftMonth('2026-12', 1)).toBe('2027-01');
    });

    it('should keep a zero delta and multi-month deltas', () => {
      expect(shiftMonth('2026-09', 0)).toBe('2026-09');
      expect(shiftMonth('2026-09', 5)).toBe('2027-02');
      expect(shiftMonth('2026-09', -10)).toBe('2025-11');
    });

    it('should return null for invalid month input', () => {
      expect(shiftMonth('2026-13', 1)).toBeNull();
      expect(shiftMonth('2026-9', 1)).toBeNull();
      expect(shiftMonth(undefined, 1)).toBeNull();
      expect(shiftMonth('septiembre', 1)).toBeNull();
    });
  });

  describe('monthDays', () => {
    it('should return the length of 30 and 31 day months', () => {
      expect(monthDays('2026-09')).toBe(30);
      expect(monthDays('2026-04')).toBe(30);
      expect(monthDays('2026-01')).toBe(31);
      expect(monthDays('2026-12')).toBe(31);
    });

    it('should handle leap February', () => {
      expect(monthDays('2028-02')).toBe(29);
      expect(monthDays('2027-02')).toBe(28);
    });

    it('should return null for invalid month input', () => {
      expect(monthDays('2026-13')).toBeNull();
      expect(monthDays('2026-00')).toBeNull();
      expect(monthDays('2026-9')).toBeNull();
      expect(monthDays(undefined)).toBeNull();
    });
  });

  describe('calendarMonthGrid', () => {
    it('should build a 42-cell grid with Monday-first leading blanks', () => {
      // Septiembre 2026 arranca martes (JS dow 2 → leading 1 en lunes-primero).
      const grid = calendarMonthGrid('2026-09');
      expect(grid).toHaveLength(42);
      expect(grid[0]).toEqual({ date: null, day: null });
      expect(grid[1]).toEqual({ date: '2026-09-01', day: 1 });
      expect(grid[30]).toEqual({ date: '2026-09-30', day: 30 });
      expect(grid[31]).toEqual({ date: null, day: null });
      expect(grid[41]).toEqual({ date: null, day: null });
    });

    it('should start on Monday with no leading blanks when day 1 is Monday', () => {
      // Febrero 2027 arranca lunes (JS dow 1 → leading 0).
      const grid = calendarMonthGrid('2027-02');
      expect(grid[0]).toEqual({ date: '2027-02-01', day: 1 });
      expect(grid[27]).toEqual({ date: '2027-02-28', day: 28 });
      expect(grid[28]).toEqual({ date: null, day: null });
    });

    it('should fill a full leading week for a Sunday-start month', () => {
      // Marzo 2026 arranca domingo (JS dow 0 → leading 6).
      const grid = calendarMonthGrid('2026-03');
      expect(grid[0]).toEqual({ date: null, day: null });
      expect(grid[5]).toEqual({ date: null, day: null });
      expect(grid[6]).toEqual({ date: '2026-03-01', day: 1 });
      expect(grid[36]).toEqual({ date: '2026-03-31', day: 31 });
    });

    it('should return an empty array for invalid month input', () => {
      expect(calendarMonthGrid('2026-13')).toEqual([]);
      expect(calendarMonthGrid(undefined)).toEqual([]);
    });
  });

  describe('WEEKDAY_LABELS_ES', () => {
    it('should expose seven Spanish weekday labels starting Monday', () => {
      expect(WEEKDAY_LABELS_ES).toHaveLength(7);
      expect(WEEKDAY_LABELS_ES[0]).toBe('Lun');
      expect(WEEKDAY_LABELS_ES[6]).toBe('Dom');
    });
  });
});