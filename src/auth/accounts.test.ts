import { describe, expect, it } from 'vitest';

process.env.JWT_SECRET ??= 'x'.repeat(40);
const { cleanName, generatePassword, slug } = await import('./accounts.js');

describe('identifiants', () => {
  it('slug retire accents et caractères spéciaux', () => {
    expect(slug('Jean-Éric')).toBe('jeaneric');
    expect(slug("D'Artagnan")).toBe('dartagnan');
  });

  it('identifiant = 1re lettre du nom + prénom', () => {
    expect(`${slug('Dupont').charAt(0)}${slug('Jean')}`).toBe('djean');
  });

  it('cleanName normalise la casse', () => {
    expect(cleanName('  jean-éRIC   de la  fontaine ')).toBe('Jean-Éric De La Fontaine');
  });

  it('mot de passe lisible et aléatoire', () => {
    const a = generatePassword();
    expect(a).toMatch(/^[A-Z][a-z]+-[A-Z][a-z]+-[A-Z][a-z]+-\d{4}$/);
    expect(new Set(Array.from({ length: 50 }, generatePassword)).size).toBe(50);
  });
});
