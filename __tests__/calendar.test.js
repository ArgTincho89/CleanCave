// Tests unitarios de los helpers puros de calendario (db/calendar.js).
// Las fechas se manejan como strings 'YYYY-MM-DD' (comparación
// lexicográfica segura); el patrón es el de rotation.test.js.

const { monthRange, monthOverlap } = require('../db/calendar');

describe('calendar', () => {
  describe('monthRange', () => {
    it('should return the inclusive range of a month', () => {
      expect(monthRange('2026-09')).toEqual({ start: '2026-09-01', end: '2026-09-30' });
    });

    it('should handle leap February', () => {
      expect(monthRange('2028-02')).toEqual({ start: '2028-02-01', end: '2028-02-29' });
      expect(monthRange('2027-02')).toEqual({ start: '2027-02-01', end: '2027-02-28' });
    });

    it('should handle months with 31 and 30 days', () => {
      expect(monthRange('2026-01').end).toBe('2026-01-31');
      expect(monthRange('2026-04').end).toBe('2026-04-30');
      expect(monthRange('2026-12').end).toBe('2026-12-31');
    });

    it('should return null for invalid month format or values', () => {
      expect(monthRange('2026-13')).toBeNull();
      expect(monthRange('2026-00')).toBeNull();
      expect(monthRange('2026-9')).toBeNull();
      expect(monthRange('septiembre')).toBeNull();
      expect(monthRange()).toBeNull();
    });
  });

  describe('monthOverlap', () => {
    const range = { start: '2026-09-01', end: '2026-09-30' };

    it('should return true for an event inside the month', () => {
      expect(monthOverlap({ startDate: '2026-09-10', endDate: '2026-09-15' }, range.start, range.end)).toBe(true);
    });

    it('should return true when the event touches the month start boundary', () => {
      // Termina el 1° de septiembre: toca el límite inferior del rango.
      expect(monthOverlap({ startDate: '2026-08-20', endDate: '2026-09-01' }, range.start, range.end)).toBe(true);
    });

    it('should return true when the event touches the month end boundary', () => {
      // Arranca el 30 de septiembre: toca el límite superior del rango.
      expect(monthOverlap({ startDate: '2026-09-30', endDate: '2026-10-05' }, range.start, range.end)).toBe(true);
    });

    it('should return true for a cross-month event spanning the whole month', () => {
      expect(monthOverlap({ startDate: '2026-08-25', endDate: '2026-10-04' }, range.start, range.end)).toBe(true);
    });

    it('should return false for an event fully before the month', () => {
      expect(monthOverlap({ startDate: '2026-08-01', endDate: '2026-08-31' }, range.start, range.end)).toBe(false);
    });

    it('should return false for an event fully after the month', () => {
      expect(monthOverlap({ startDate: '2026-10-01', endDate: '2026-10-10' }, range.start, range.end)).toBe(false);
    });
  });
});