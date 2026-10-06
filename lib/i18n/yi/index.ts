// מילון היידיש - איחוד קבצי הסעיפים (אותם סעיפים/מפתחות כמו בעברית).
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

export const yi = {
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
