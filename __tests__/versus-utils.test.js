// Tests unitarios de los helpers puros del frontend de versus
// (public/versus-utils.js). Patrón: calendar-ui.test.js — el script es UMD
// (browser vía <script> + node vía require) y estos tests cubren el único
// caso de seguridad de render (RF-07: el texto de una card debe mostrarse
// como texto literal inerte, nunca como markup) y el límite de la pill de
// novedad (D8: 48 h según el reloj del cliente).

const { escapeHtml, vsIsNewCard } = require('../public/versus-utils');

describe('versus-utils', () => {
  describe('escapeHtml', () => {
    it('should escape a script payload so it renders as literal inert text (RF-07)', () => {
      expect(escapeHtml('<script>alert(1)</script>')).toBe('&lt;script&gt;alert(1)&lt;/script&gt;');
    });

    it('should escape all five map characters', () => {
      expect(escapeHtml('&<>"\'')).toBe('&amp;&lt;&gt;&quot;&#39;');
    });

    it('should leave plain text unchanged', () => {
      expect(escapeHtml('Deja la luz prendida')).toBe('Deja la luz prendida');
    });

    it('should leave the empty string unchanged', () => {
      expect(escapeHtml('')).toBe('');
    });
  });

  describe('vsIsNewCard', () => {
    const HOUR_MS = 60 * 60 * 1000;
    const nowMs = Date.parse('2026-09-23T12:00:00Z');

    it('should mark a card created 1 hour ago as new', () => {
      expect(vsIsNewCard({ createdAt: new Date(nowMs - 1 * HOUR_MS).toISOString() }, nowMs)).toBe(true);
    });

    it('should mark a card created 47.9 hours ago as new (just under the 48 h boundary)', () => {
      expect(vsIsNewCard({ createdAt: new Date(nowMs - 47.9 * HOUR_MS).toISOString() }, nowMs)).toBe(true);
    });

    it('should mark a card created 49 hours ago as not new (past the 48 h boundary)', () => {
      expect(vsIsNewCard({ createdAt: new Date(nowMs - 49 * HOUR_MS).toISOString() }, nowMs)).toBe(false);
    });
  });
});