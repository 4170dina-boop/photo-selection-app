// Español: filtros, aviso de "elegir juntos", tarjetas de la cuadrícula.
import type { Section } from '../types';
import type { grid as he } from '../he/grid';

export const grid: Section<typeof he> = {
  'f.all': 'Todas ({n})',
  'f.selected': 'Elegidas ({n})',
  'f.maybe': 'Quizás ({n})',
  'f.together': '💞 Elegidas por todos ({n})',
  'f.only': 'Solo {name} ({n})',
  'f.onlyMe': 'Solo yo ({n})',
  'grid.empty': 'No hay fotos con este filtro.',
  'grid.colsAria': 'Columnas de la cuadrícula: {n} (toca para cambiar)',

  'toast.othersItem': {
    one: '{name} marcó una foto nueva',
    other: '{name} marcó {count} fotos nuevas',
  },

  'card.compareOn': 'elegida para comparar',
  'card.compareOff': 'no elegida para comparar',
  'card.open': 'Abrir {label}',
  'card.hasNote': ', tiene una nota',
  'card.badgeMaybe': '🤔 Quizás',
  'card.blurAria': 'Puede que la foto no esté nítida (estimación automática)',
  'card.blurTitle': 'Estimación automática de nitidez: no siempre es exacta',
  'card.blurLabel': '💡 Puede no estar nítida',
  'card.markSelected': 'elegida',
  'card.markMaybe': 'quizás',
  'card.giftTitle': 'Foto de regalo: incluida automáticamente, no cuenta en el paquete y sin coste extra',
  'card.giftFooter': 'Incluida automáticamente · no cuenta en el paquete',
  'card.heartAria': 'Elegir {label}',
  'card.heartOn': 'Quitar elección',
  'card.heartOff': 'Elegir esta foto',
  'card.noteTitle': 'Esta foto tiene una nota',
};
