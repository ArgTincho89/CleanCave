const { FREQUENCIES, normalizeFrequencyLabel, daysForLabel } = require('../db/frequencies');

describe('frequencies', () => {
  describe('FREQUENCIES', () => {
    it('should have expected frequencies', () => {
      expect(FREQUENCIES).toEqual({
        'Semanal': 7,
        'Quincenal': 14,
        'Mensual': 30,
        'Bimensual': 60,
        'Trimestral': 90,
        'Semestral': 182,
        'Anual': 365
      });
    });
  });

  describe('normalizeFrequencyLabel', () => {
    it('should normalize standard labels', () => {
      expect(normalizeFrequencyLabel('semanal')).toBe('Semanal');
      expect(normalizeFrequencyLabel('SEMANAL')).toBe('Semanal');
      expect(normalizeFrequencyLabel('  Semanal  ')).toBe('Semanal');
      expect(normalizeFrequencyLabel('mensual')).toBe('Mensual');
      expect(normalizeFrequencyLabel('anual')).toBe('Anual');
    });

    it('should normalize common variants', () => {
      expect(normalizeFrequencyLabel('cada 2 semanas')).toBe('Quincenal');
      expect(normalizeFrequencyLabel('cada 2 seamanas')).toBe('Quincenal');
    });

    it('should return null for unknown labels', () => {
      expect(normalizeFrequencyLabel('diario')).toBeNull();
      expect(normalizeFrequencyLabel('')).toBeNull();
      expect(normalizeFrequencyLabel(null)).toBeNull();
      expect(normalizeFrequencyLabel(undefined)).toBeNull();
    });
  });

  describe('daysForLabel', () => {
    it('should return days for known labels', () => {
      expect(daysForLabel('Semanal')).toBe(7);
      expect(daysForLabel('Quincenal')).toBe(14);
      expect(daysForLabel('Anual')).toBe(365);
    });

    it('should return null for unknown labels', () => {
      expect(daysForLabel('Diario')).toBeNull();
      expect(daysForLabel('')).toBeNull();
    });
  });
});
