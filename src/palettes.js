// Trace palettes for the Live views. "Mono" is the house look (VEATION grey); the others help tell
// channels apart. "Custom" lets the user pick each channel's colour.
export const PALETTES = [
  { id: 'mono', name: 'Mono', colors: ['#E0E0E0', '#E0E0E0', '#E0E0E0', '#E0E0E0', '#E0E0E0', '#E0E0E0', '#E0E0E0', '#E0E0E0'] },
  { id: 'sides', name: 'Left / right', colors: ['#7FB2E8', '#7FB2E8', '#7FB2E8', '#7FB2E8', '#E5B567', '#E5B567', '#E5B567', '#E5B567'] },
  { id: 'regions', name: 'Temples / forehead', colors: ['#C58BD0', '#C58BD0', '#E0E0E0', '#E0E0E0', '#E0E0E0', '#E0E0E0', '#C58BD0', '#C58BD0'] },
  { id: 'spectrum', name: 'Rainbow', colors: ['#E06C6C', '#E0954B', '#E8C84B', '#8FD16F', '#3FC7B2', '#4FA8F0', '#9B8CF0', '#E07FC8'] },
  { id: 'custom', name: 'Custom', colors: null },
];
export const PALETTE_BY_ID = Object.fromEntries(PALETTES.map((p) => [p.id, p]));
export const DEFAULT_CUSTOM = ['#E0E0E0', '#B8B8B8', '#7FB2E8', '#4FC3E8', '#E5B567', '#E0954B', '#C58BD0', '#D06FB0'];
