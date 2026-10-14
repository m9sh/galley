import frame from './map-styles/01-frame.css';
import shell_and_places from './map-styles/02-shell-and-places.css';
import controls_and_list from './map-styles/03-controls-and-list.css';
import details_sheet from './map-styles/04-details-sheet.css';
import reading_density_stacked from './map-styles/05-reading-density-stacked.css';

/**
 * The demo's project map stylesheet, in cascade order. It comes after the shared reader styles, so what is here may
 * override them. Each file in map-styles/ is one section of what used to be a single file.
 */
export default [frame, shell_and_places, controls_and_list, details_sheet, reading_density_stacked].join('\n');
