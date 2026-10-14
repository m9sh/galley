import frame from './styles/01-frame.css';
import menu_facts_backlinks from './styles/02-menu-facts-backlinks.css';
import project_map from './styles/03-project-map.css';
import documents_map from './styles/04-documents-map.css';
import map_places from './styles/05-map-places.css';
import map_list_and_details from './styles/06-map-list-and-details.css';
import map_lenses from './styles/07-map-lenses.css';
import your_notes from './styles/08-your-notes.css';
import export_diagram_narrow from './styles/09-export-diagram-narrow.css';

/**
 * The library reader's own stylesheet, in cascade order. It comes after the shared reader styles
 * (components/reader-styles.ts), so what is here may override them. Each file in styles/ is one section of what
 * used to be a single file, and the order here is the order of the cascade.
 */
export default [frame, menu_facts_backlinks, project_map, documents_map, map_places, map_list_and_details, map_lenses, your_notes, export_diagram_narrow].join(
  '\n',
);
