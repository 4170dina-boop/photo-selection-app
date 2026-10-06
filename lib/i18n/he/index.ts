// מילון העברית המלא (מקור האמת) - איחוד כל קבצי הסעיפים. שאר השפות חייבות
// להכיל בדיוק את אותם מפתחות, סעיף מול סעיף (Section<...> ב-types.ts).
import { common } from './common';
import { access } from './access';
import { welcome } from './welcome';
import { banners } from './banners';
import { actions } from './actions';
import { enlarged } from './enlarged';
import { grid } from './grid';
import { finish } from './finish';
import { serverErrors } from './serverErrors';
import { emails } from './emails';
import { payment } from './payment';
import { stages } from './stages';

export const heSections = { common, access, welcome, banners, actions, enlarged, grid, finish, serverErrors, emails, payment, stages };

export const he = {
  ...common,
  ...access,
  ...welcome,
  ...banners,
  ...actions,
  ...enlarged,
  ...grid,
  ...finish,
  ...serverErrors,
  ...emails,
  ...payment,
  ...stages,
};

export type HeSections = typeof heSections;
