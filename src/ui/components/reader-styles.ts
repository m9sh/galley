import palette from './styles/01-palette.css';
import chrome from './styles/02-chrome.css';
import layout from './styles/03-layout.css';
import article from './styles/04-article.css';
import changes from './styles/05-changes.css';
import contents_rail from './styles/06-contents-rail.css';
import loading_and_errors from './styles/07-loading-and-errors.css';
import small_screens_and_motion from './styles/08-small-screens-and-motion.css';
import folded_files from './styles/09-folded-files.css';
import diagrams from './styles/10-diagrams.css';
import source_files from './styles/11-source-files.css';
import top_bar from './styles/12-top-bar.css';
import documents_menu from './styles/13-documents-menu.css';
import sheet from './styles/14-sheet.css';
import sheet_chapters from './styles/15-sheet-chapters.css';
import sheet_library from './styles/16-sheet-library.css';
import sheet_motion from './styles/17-sheet-motion.css';
import settings_tabs from './styles/18-settings-tabs.css';
import comments from './styles/19-comments.css';
import threads from './styles/20-threads.css';
import link_changes_and_notes from './styles/21-link-changes-and-notes.css';
import syntax_colours from './styles/22-syntax-colours.css';
import layouts_and_density from './styles/23-layouts-and-density.css';
import code_file_views from './styles/24-code-file-views.css';
import test_plan from './styles/25-test-plan.css';
import source_changes from './styles/26-source-changes.css';

/**
 * The reader's stylesheet, in cascade order. The review reader (review/reader.ts) and the library reader
 * (library/repo-reader.ts) share it; the library adds library/repo-styles.ts after it. Each file in styles/ is one
 * section of what used to be a single file, and the order here is the order of the cascade, so a rule that
 * overrides an earlier one has to come after it.
 */
export default [
  palette,
  chrome,
  layout,
  article,
  changes,
  contents_rail,
  loading_and_errors,
  small_screens_and_motion,
  folded_files,
  diagrams,
  source_files,
  top_bar,
  documents_menu,
  sheet,
  sheet_chapters,
  sheet_library,
  sheet_motion,
  settings_tabs,
  comments,
  threads,
  link_changes_and_notes,
  syntax_colours,
  layouts_and_density,
  code_file_views,
  test_plan,
  source_changes,
].join('');
