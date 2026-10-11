import type { OutlineHeading } from '../../core/markdown.ts';
import { button, h } from './dom.ts';

/** Explicit session attachment: the document and heading come from this rendered snapshot. */
export function chapterAttachment(options: {
  chapters: Array<{ id: string; title: string }>;
  current?: string;
  headings: OutlineHeading[];
  add(chapter: string, heading: string, label: string): void;
}): HTMLElement {
  const details = h('details', 'mr-chapter-attachment');
  details.append(h('summary', '', 'Add to chapter'));
  const form = h('form');
  const chapterLabel = h('label', '', 'Chapter');
  const chapter = h('select');
  chapter.setAttribute('aria-label', 'Chapter for this document');
  for (const item of options.chapters) {
    const option = h('option', '', item.title);
    option.value = item.id;
    chapter.append(option);
  }
  if (options.current) chapter.value = options.current;
  chapterLabel.append(chapter);
  const sectionLabel = h('label', '', 'Section');
  const section = h('select');
  section.setAttribute('aria-label', 'Section to add');
  const whole = h('option', '', 'Whole document');
  whole.value = '';
  section.append(whole);
  for (const heading of options.headings) {
    const option = h('option', '', heading.text);
    option.value = heading.id;
    section.append(option);
  }
  sectionLabel.append(section);
  const add = button('Add for this session', '', 'mr-btn mr-outline');
  add.type = 'submit';
  const feedback = h('p', 'mr-repo-quiet');
  feedback.setAttribute('role', 'status');
  form.append(chapterLabel, sectionLabel, h('p', 'mr-repo-quiet', 'Only for this review. Reading context does not mark files Viewed.'), add, feedback);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    event.stopPropagation();
    options.add(chapter.value, section.value, section.selectedOptions[0].textContent!);
    feedback.textContent = `Added to ${chapter.selectedOptions[0].textContent}.`;
  });
  details.append(form);
  return details;
}
