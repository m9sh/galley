import { forgetOutlines, outlineUse } from '../platforms/outline-store.ts';
import { loadSettings, updateSettings } from '../ui/preferences/settings.ts';

const control = document.querySelector<HTMLInputElement>('#read-button')!;
const remember = document.querySelector<HTMLInputElement>('#remember-outlines')!;
const kept = document.querySelector<HTMLElement>('#remembered')!;
const forget = document.querySelector<HTMLButtonElement>('#forget-outlines')!;
const status = document.querySelector<HTMLElement>('#status')!;
const retry = document.querySelector<HTMLButtonElement>('#retry')!;
let saved = true;
let rememberSaved = false;

function showChoice(input: HTMLInputElement, value: boolean): void {
  input.checked = value;
  input.setAttribute('aria-checked', String(value));
}

/** What is remembered now, so the reader can see what the switch has done and what Forget will remove. */
async function showKept(): Promise<void> {
  const { projects, chars } = await outlineUse();
  kept.textContent = projects
    ? `Remembered now: ${projects === 1 ? '1 project' : `${projects} projects`}, about ${Math.max(1, Math.round(chars / 1000))} KB.`
    : 'Nothing is remembered now.';
  forget.disabled = projects === 0;
}

async function refresh(): Promise<void> {
  control.disabled = true;
  remember.disabled = true;
  retry.hidden = true;
  try {
    const settings = await loadSettings(true);
    saved = settings.readButton;
    rememberSaved = settings.rememberOutlines;
    showChoice(control, saved);
    showChoice(remember, rememberSaved);
    await showKept();
    control.disabled = false;
    remember.disabled = false;
    status.textContent = '';
  } catch {
    status.textContent = 'Your settings could not be read. Try again before changing them.';
    retry.hidden = false;
  }
}

control.addEventListener('change', async () => {
  const readButton = control.checked;
  showChoice(control, readButton);
  control.disabled = true;
  try {
    await updateSettings({ readButton }, true);
    saved = readButton;
    status.textContent = readButton ? 'The Read button is on.' : 'The Read button is off. Open the reader from the toolbar or shortcut.';
  } catch {
    showChoice(control, saved);
    status.textContent = 'Your change was not saved. Try again.';
  }
  control.disabled = false;
});

remember.addEventListener('change', async () => {
  const value = remember.checked;
  showChoice(remember, value);
  remember.disabled = true;
  try {
    // Turning it off forgets what was kept, first: a switch that is off should leave nothing behind.
    if (!value) await forgetOutlines();
    await updateSettings({ rememberOutlines: value }, true);
    rememberSaved = value;
    await showKept();
    status.textContent = value
      ? 'Galley will remember project outlines on this device.'
      : 'Galley no longer remembers project outlines, and forgot the ones it kept.';
  } catch {
    showChoice(remember, rememberSaved);
    status.textContent = 'Your change was not saved. Try again.';
  }
  remember.disabled = false;
});

forget.addEventListener('click', async () => {
  forget.disabled = true;
  try {
    await forgetOutlines();
    await showKept();
    status.textContent = 'Galley forgot the project outlines it kept.';
  } catch {
    forget.disabled = false;
    status.textContent = 'Galley could not forget them. Try again.';
  }
});
retry.addEventListener('click', () => void refresh());
void refresh();
