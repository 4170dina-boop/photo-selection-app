// English dictionary - combines the section files (same sections/keys as he).
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

export const en = {
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
};
