// Keys are the semantic colours of the approved Arts sheet. Changing the accent
// affects rules, headings and their tints. Neutral editorial ink stays readable.
export function palette(accent) {
  const base = '345B6F';
  const shades = ['D9DFE1','EDF0F2','E7EBEE','F3F5F6'];
  if (!/^[A-F0-9]{6}$/i.test(accent)) throw new TypeError('Invalid document accent');
  accent = accent.toUpperCase();
  const channels = value => value.match(/../g).map(v=>parseInt(v,16));
  const baseRGB = channels(base), accentRGB = channels(accent);
  const result = { [base]:accent, '263338':'263338', '667177':'667177', '717A7D':'717A7D' };
  for (const shade of shades) {
    result[shade] = channels(shade).map((v,i) => {
      const fraction=(255-v)/(255-baseRGB[i]);
      return Math.round(255-fraction*(255-accentRGB[i])).toString(16).padStart(2,'0');
    }).join('').toUpperCase();
  }
  return result;
}

