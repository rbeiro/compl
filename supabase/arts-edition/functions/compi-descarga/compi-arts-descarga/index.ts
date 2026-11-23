import {guideFiles} from '../_shared/guide-files.ts';
import {rebrandLegacy} from '../_shared/rebrand.js';
Deno.serve(guideFiles(false,rebrandLegacy));

